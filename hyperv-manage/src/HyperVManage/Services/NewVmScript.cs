using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
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
    /// out so the script's own defaults apply.
    /// </summary>
    public static string BuildCommand(string scriptPath, NewVmOptions o)
    {
        var sb = new StringBuilder();
        // Write-Host text arrives as UTF-8, so names and paths outside ASCII read correctly.
        sb.Append("[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false\n");
        sb.Append("& ").Append(Ps.Quote(scriptPath));
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
    internal static string BuildPrecheckScript(string vmName) => $$"""
        $name = {{Ps.Quote(vmName)}}
        $vhd = Join-Path (Get-VMHost).VirtualHardDiskPath "$name.vhdx"
        ConvertTo-Json -Compress -InputObject ([pscustomobject]@{
            Vhd = $vhd
            VhdExists = [bool](Test-Path -LiteralPath $vhd)
            VmExists = [bool](Get-VM | Where-Object Name -eq $name)
        })
        """;

    /// <summary>
    /// Undoes a build stopped partway. Killing powershell.exe skips the script's own finally
    /// block, which would have done this: dismount the ISO and the half-built disk, and delete
    /// the disk if no VM was made from it yet. The precheck established that the disk didn't
    /// exist before the build, so it is the build's own. A VM that already exists is left for
    /// the user to delete, since by then it is a real VM.
    /// </summary>
    internal static string BuildCleanupScript(string vmName, string isoPath, string vhdPath) => $$"""
        $name = {{Ps.Quote(vmName)}}
        $iso = {{Ps.Quote(isoPath)}}
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
        try
        {
            using var doc = JsonDocument.Parse(await PowerShellRunner.RunAsync(BuildPrecheckScript(options.VMName), ct).ConfigureAwait(false));
            var r = doc.RootElement;
            vhdPath = r.GetProperty("Vhd").GetString() ?? "";
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

        var script = ExtractScript();
        try
        {
            var psi = new ProcessStartInfo("powershell.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-OutputFormat", "Text",
                                      "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(BuildCommand(script, options))) })
                psi.ArgumentList.Add(a);

            using var process = new Process { StartInfo = psi };
            process.OutputDataReceived += (_, e) => { if (e.Data is not null) onLine(e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data is not null) onLine(e.Data); };
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

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
                    var report = await PowerShellRunner.RunAsync(BuildCleanupScript(options.VMName, options.IsoPath, vhdPath)).ConfigureAwait(false);
                    foreach (var line in report.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) onLine(line);
                }
                catch (Exception ex) { onLine($"Couldn't clean up: {ex.Message}"); }
                return BuildOutcome.Stopped;
            }
        }
        finally
        {
            try { File.Delete(script); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    /// <summary>
    /// Writes the embedded script where powershell.exe can run it, under a new random name each
    /// time, and deleted after the run: the app runs it elevated, so a fixed path another program
    /// could swap the file at would be a gift.
    /// </summary>
    public static string ExtractScript()
    {
        var path = Path.Combine(Path.GetTempPath(), $"HyperVManage-{Guid.NewGuid():N}.ps1");
        using var resource = typeof(NewVmScript).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"{ResourceName} isn't embedded in this build.");
        using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write);
        resource.CopyTo(file);
        return path;
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

/// <summary>Finds the Windows ISO the script would pick: the newest one in Downloads with "win"
/// in its name that isn't marked for the other kind of processor.</summary>
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
