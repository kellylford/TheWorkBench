using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace HyperVManage.Services;

/// <summary>What the New VM window asks for: the parameters of New-HyperVRdpVM.ps1.</summary>
public sealed record NewVmOptions(
    string VMName,
    string IsoPath,
    string Edition,
    string UserName,
    string Password,
    int ProcessorCount,
    int MemoryGB,
    int DiskGB,
    bool HostOnly,
    bool AutoStart,
    bool Connect);

/// <summary>How a build ended.</summary>
public enum BuildOutcome { Succeeded, Failed, Stopped }

/// <summary>
/// Runs New-HyperVRdpVM.ps1, which is embedded in the app, and hands back each line it prints.
/// The script is the single source of truth for building a VM; the app only fills in its options,
/// checks up front what the script would refuse, and cleans up if the user stops it.
/// </summary>
public static class NewVmScript
{
    public const string ResourceName = "New-HyperVRdpVM.ps1";

    /// <summary>Characters a VM name can't have: it becomes file names, and Get-VM -Name reads
    /// * ? [ ] as wildcards.</summary>
    public static bool HasForbiddenCharacters(string name) => name.IndexOfAny(['\\', '/', ':', '*', '?', '"', '<', '>', '|', '[', ']']) >= 0;

    /// <summary>Why a name can't be a VM's, or null if it can. It becomes folder and file names,
    /// which can't be "." or "..", or end in a dot or space.</summary>
    public static string? NameProblem(string name)
    {
        if (name.Length == 0) return "Give the VM a name.";
        if (HasForbiddenCharacters(name)) return "The name can't contain any of these: \\ / : * ? \" < > | [ ]";
        if (name.EndsWith('.') || name.EndsWith(' ')) return "The name can't end with a dot or a space.";
        return null;
    }

    /// <summary>
    /// The PowerShell command that runs the script with these options: every value a quoted
    /// literal, so nothing typed into the form can be read as code. Empty text fields are left
    /// out so the script's own defaults apply. The script itself is read from the named pipe
    /// <paramref name="pipeName"/> (see <see cref="StartWithScriptAsync"/>), never from a file.
    /// </summary>
    public static string BuildCommand(NewVmOptions o, string pipeName) =>
        ReadScriptFromPipe(pipeName) + "& ([scriptblock]::Create($scriptText))" + Arguments(o);

    /// <summary>PowerShell lines that read the script from the app's pipe into $scriptText.</summary>
    internal static string ReadScriptFromPipe(string pipeName) => $$"""
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
        $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', {{Ps.Quote(pipeName)}}, [System.IO.Pipes.PipeDirection]::In)
        $pipe.Connect(30000)
        $reader = New-Object System.IO.StreamReader($pipe, (New-Object System.Text.UTF8Encoding $false))
        $scriptText = $reader.ReadToEnd()
        $reader.Dispose()

        """;

    private static string Arguments(NewVmOptions o)
    {
        var sb = new StringBuilder();
        sb.Append(" -VMName ").Append(Ps.Quote(o.VMName));
        if (o.IsoPath.Length > 0) sb.Append(" -IsoPath ").Append(Ps.Quote(o.IsoPath));
        if (o.Edition.Length > 0) sb.Append(" -Edition ").Append(Ps.Quote(o.Edition));
        if (o.UserName.Length > 0) sb.Append(" -UserName ").Append(Ps.Quote(o.UserName));
        if (o.Password.Length > 0) sb.Append(" -Password ").Append(Ps.Quote(o.Password));
        sb.Append(" -ProcessorCount ").Append(o.ProcessorCount);
        sb.Append(" -MemoryGB ").Append(o.MemoryGB);
        sb.Append(" -DiskGB ").Append(o.DiskGB);
        if (o.HostOnly) sb.Append(" -HostOnly");
        if (!o.AutoStart) sb.Append(" -NoAutoStart");
        if (!o.Connect) sb.Append(" -NoConnect");
        return sb.ToString();
    }

    /// <summary>
    /// What the script would refuse, asked before it starts: a VM of that name, or a disk already
    /// at the path it would build. Also returns that path, which the cleanup after a stop needs;
    /// knowing the disk didn't exist beforehand is what makes it safe to delete then.
    /// </summary>
    internal static string BuildPrecheckScript(string vmName, string isoPath) => $$"""
        $name = {{Ps.Quote(vmName)}}
        $iso = {{Ps.Quote(isoPath)}}
        $vhd = Join-Path (Get-VMHost).VirtualHardDiskPath "$name.vhdx"
        ConvertTo-Json -Compress -InputObject ([pscustomobject]@{
            Vhd = $vhd
            VhdExists = [bool](Test-Path -LiteralPath $vhd)
            VmExists = [bool](Get-VM | Where-Object Name -eq $name)
            IsoWasMounted = [bool]($iso -and (Get-DiskImage -ImagePath $iso -ErrorAction SilentlyContinue).Attached)
        })
        """;

    /// <summary>
    /// Undoes a build stopped partway. Killing powershell.exe skips the script's own finally
    /// block, which would have done this: dismount the ISO and the half-built disk, and delete
    /// the disk if no VM was made from it yet. The precheck established that the disk didn't
    /// exist before the build, so it is the build's own. A VM that already exists is left for
    /// the user to delete, since by then it is a real VM.
    /// </summary>
    internal static string BuildCleanupScript(string vmName, string isoPath, string vhdPath, bool isoWasMounted = false) => $$"""
        $name = {{Ps.Quote(vmName)}}
        # An ISO that was already open before the build, in File Explorer, stays open, as the
        # script itself leaves it.
        $iso = {{(isoWasMounted ? "''" : Ps.Quote(isoPath))}}
        $vhd = {{Ps.Quote(vhdPath)}}
        # Each in its own try: the runner stops on errors, and a dismount of something already
        # dismounted mustn't skip the rest.
        if ($iso) { try { Dismount-DiskImage -ImagePath $iso -ErrorAction Stop | Out-Null } catch { } }
        try { Dismount-VHD -Path $vhd -ErrorAction Stop } catch { }
        if (Get-VM | Where-Object Name -eq $name) {
            "The virtual machine $name had already been created. Delete it from the list if you don't want it."
        } elseif (Test-Path -LiteralPath $vhd) {
            Remove-Item -LiteralPath $vhd -Force
            "Removed the half-built disk $vhd."
        } else {
            "Nothing had been built yet."
        }
        """;

    /// <summary>
    /// Builds a VM: checks, runs the script with each line to <paramref name="onLine"/> (on a
    /// background thread), and if <paramref name="ct"/> is cancelled, stops it and cleans up.
    /// </summary>
    public static async Task<BuildOutcome> RunAsync(NewVmOptions options, Action<string> onLine, CancellationToken ct)
    {
        string vhdPath;
        bool isoWasMounted;
        try
        {
            using var doc = JsonDocument.Parse(await PowerShellRunner.RunAsync(BuildPrecheckScript(options.VMName, options.IsoPath), ct).ConfigureAwait(false));
            var r = doc.RootElement;
            vhdPath = r.GetProperty("Vhd").GetString() ?? "";
            isoWasMounted = r.TryGetProperty("IsoWasMounted", out var m) && m.ValueKind == JsonValueKind.True;
            if (r.GetProperty("VmExists").GetBoolean())
            {
                onLine($"There is already a virtual machine named {options.VMName}. Pick another name.");
                return BuildOutcome.Failed;
            }
            if (r.GetProperty("VhdExists").GetBoolean())
            {
                onLine($"The virtual disk {vhdPath} already exists. Delete it or pick another name.");
                return BuildOutcome.Failed;
            }
        }
        catch (OperationCanceledException) { return BuildOutcome.Stopped; }

        {
            using var process = await StartWithScriptAsync(ScriptText(), pipe => BuildCommand(options, pipe), onLine, ct: ct).ConfigureAwait(false);
            try
            {
                await process.WaitForExitAsync(ct).ConfigureAwait(false);
                // The parameterless wait drains the last output lines after exit.
                process.WaitForExit();
                return process.ExitCode == 0 ? BuildOutcome.Succeeded : BuildOutcome.Failed;
            }
            catch (OperationCanceledException)
            {
                // Whatever the kill reports, the cleanup still has to run.
                try { process.Kill(entireProcessTree: true); } catch (Exception) { }
                process.WaitForExit();
                onLine("Stopped. Cleaning up what the build had made so far.");
                try
                {
                    var report = await PowerShellRunner.RunAsync(BuildCleanupScript(options.VMName, options.IsoPath, vhdPath, isoWasMounted)).ConfigureAwait(false);
                    foreach (var line in report.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) onLine(line);
                }
                catch (Exception ex) { onLine($"Couldn't clean up: {ex.Message}"); }
                return BuildOutcome.Stopped;
            }
        }
    }

    /// <summary>
    /// Starts powershell.exe running the command <paramref name="commandFor"/> makes for a pipe
    /// name, and hands it <paramref name="scriptText"/> through that pipe. Every line PowerShell
    /// prints goes to <paramref name="onLine"/>.
    ///
    /// The script is never written to a file: the app runs it elevated, and a file is something
    /// another program could rewrite in the moment before PowerShell opens it. It doesn't go on
    /// standard input either, which makes Windows PowerShell wrap its progress and errors in XML.
    /// The pipe has a random name, refuses a second instance, and only Administrators and SYSTEM
    /// can open it, so only the elevated PowerShell the app starts can read it.
    /// </summary>
    /// <param name="allowCurrentUser">Only for tests, which run without administrator rights.</param>
    internal static async Task<Process> StartWithScriptAsync(string scriptText, Func<string, string> commandFor, Action<string> onLine,
        bool allowCurrentUser = false, CancellationToken ct = default)
    {
        var pipeName = $"HyperVManage-{Guid.NewGuid():N}";
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        if (allowCurrentUser)
            security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.ReadWrite, AccessControlType.Allow));
        using var server = NamedPipeServerStreamAcl.Create(pipeName, PipeDirection.Out, 1, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance, 0, 0, security);

        var psi = new ProcessStartInfo(SystemTools.PowerShell)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-OutputFormat", "Text",
                                  "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(commandFor(pipeName))) })
            psi.ArgumentList.Add(a);

        var process = new Process { StartInfo = psi };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) onLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) foreach (var line in CliXml.Lines(e.Data)) onLine(line); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        // If PowerShell ends before it connects, its own error says why; don't wait for it.
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var connect = server.WaitForConnectionAsync(stop.Token);
        var exited = process.WaitForExitAsync(stop.Token);
        if (await Task.WhenAny(connect, exited, Task.Delay(TimeSpan.FromSeconds(60), stop.Token)).ConfigureAwait(false) == connect
            && connect.IsCompletedSuccessfully)
        {
            await server.WriteAsync(new UTF8Encoding(false).GetBytes(scriptText), ct).ConfigureAwait(false);
            await server.FlushAsync(ct).ConfigureAwait(false);
            server.WaitForPipeDrain();
        }
        stop.Cancel();
        return process;
    }
    /// <summary>The embedded script's bytes, exactly as in the repository.</summary>
    public static byte[] ScriptBytes()
    {
        using var resource = typeof(NewVmScript).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"{ResourceName} isn't embedded in this build.");
        using var copy = new MemoryStream();
        resource.CopyTo(copy);
        return copy.ToArray();
    }

    /// <summary>The embedded script as text. It is pure ASCII, as Windows PowerShell 5.1 needs.</summary>
    public static string ScriptText() => Encoding.UTF8.GetString(ScriptBytes());

    /// <summary>The script's own lines that turn $VMName into $ComputerName, from the embedded
    /// script, so anything else that needs a VM's computer name gets exactly the script's answer.</summary>
    public static string ComputerNameRule()
    {
        var script = ScriptText();
        var start = script.IndexOf("$ComputerName = ($VMName", StringComparison.Ordinal);
        var end = start < 0 ? -1 : script.IndexOf("if (-not $ComputerName)", start, StringComparison.Ordinal);
        if (start < 0 || end < 0) throw new InvalidOperationException("The computer-name lines weren't found in the embedded script.");
        return script[start..end];
    }
}

/// <summary>
/// What New VM runs in demo mode instead of the script: a few of its lines, a second apart,
/// produced in-process. No process starts and nothing typed into the form is run, so demo mode
/// can never build a real VM.
/// </summary>
public static class DemoNewVmScript
{
    public static TimeSpan Pace { get; set; } = TimeSpan.FromSeconds(1);

    public static async Task<BuildOutcome> RunAsync(NewVmOptions options, Action<string> onLine, CancellationToken ct)
    {
        string[] lines =
        [
            $"Creating the virtual machine {options.VMName}. (Demo: nothing is really being built.)",
            "Step 1 of 5: Reading the ISO.",
            "Step 2 of 5: Creating a virtual disk and copying Windows onto it.",
            "Step 3 of 5: Making the disk bootable and adding the answer file.",
            "Step 4 of 5: Creating the virtual machine and starting it.",
            "Step 5 of 5: Waiting for Windows to finish setting up.",
            "All done.",
        ];
        try
        {
            foreach (var line in lines)
            {
                onLine(line);
                await Task.Delay(Pace, ct).ConfigureAwait(false);
            }
            return BuildOutcome.Succeeded;
        }
        catch (OperationCanceledException)
        {
            onLine("Stopped. (Demo: there was nothing to clean up.)");
            return BuildOutcome.Stopped;
        }
    }
}

/// <summary>Finds the ISO the New VM form suggests: the newest one in Downloads with "win" in its
/// name that isn't marked for the other kind of processor. The app always passes the ISO to the
/// script, so the script's own search (its folder first, then Downloads) doesn't come into it.</summary>
public static class IsoFinder
{
    public static string? FindNewest(string folder, bool hostIsArm64)
    {
        if (!Directory.Exists(folder)) return null;
        var other = hostIsArm64 ? new[] { "x64", "amd64" } : new[] { "arm64", "aarch64" };
        return new DirectoryInfo(folder).EnumerateFiles("*.iso")
            .Where(f => f.Name.Contains("win", StringComparison.OrdinalIgnoreCase)
                        && !other.Any(o => f.Name.Contains(o, StringComparison.OrdinalIgnoreCase)))
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(f => f.FullName)
            .FirstOrDefault();
    }

    public static string DownloadsFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");

    public static bool HostIsArm64 => RuntimeInformation.OSArchitecture == Architecture.Arm64;
}
