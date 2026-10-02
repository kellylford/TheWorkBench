using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

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

/// <summary>
/// Runs New-HyperVRdpVM.ps1, which is embedded in the app, and hands back each line it prints.
/// The script is the single source of truth for building a VM; the app only fills in its options.
/// </summary>
public static class NewVmScript
{
    public const string ResourceName = "New-HyperVRdpVM.ps1";

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

    /// <summary>Writes the embedded script where powershell.exe can run it. Rewritten every time,
    /// so the copy that runs is always the one this build of the app carries.</summary>
    public static string ExtractScript()
    {
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HyperVManage");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, ResourceName);
        using var resource = typeof(NewVmScript).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"{ResourceName} isn't embedded in this build.");
        using var file = File.Create(path);
        resource.CopyTo(file);
        return path;
    }

    /// <summary>Starts the script. Each line it prints, output or error, goes to
    /// <paramref name="onLine"/> on a background thread. The returned process is the caller's to
    /// wait on, or to kill if the user stops it.</summary>
    public static Process Start(NewVmOptions options, Action<string> onLine)
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
        var command = BuildCommand(ExtractScript(), options);
        foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                  "-OutputFormat", "Text",
                                  "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(command)) })
            psi.ArgumentList.Add(a);

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) onLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) onLine(e.Data); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }
}

/// <summary>
/// What New VM runs in demo mode instead of the script: a few of its lines, a second apart, from a
/// process that does nothing else. Demo mode must never build a real VM.
/// </summary>
public static class DemoNewVmScript
{
    public static Process Start(NewVmOptions options, Action<string> onLine)
    {
        var lines = new[]
        {
            $"Creating the virtual machine {options.VMName}. (Demo: nothing is really being built.)",
            "Step 1 of 5: Reading the ISO.",
            "Step 2 of 5: Creating a virtual disk and copying Windows onto it.",
            "Step 3 of 5: Making the disk bootable and adding the answer file.",
            "Step 4 of 5: Creating the virtual machine and starting it.",
            "Step 5 of 5: Waiting for Windows to finish setting up.",
            "All done.",
        };
        // One "timeout" between lines; ping is the delay that works without a console.
        var script = string.Join(" & ", lines.Select(l => "echo " + l.Replace("(", "^(").Replace(")", "^)") + " & ping -n 2 127.0.0.1 >nul"));
        var psi = new ProcessStartInfo("cmd.exe")
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
        };
        psi.ArgumentList.Add("/c");
        psi.ArgumentList.Add(script);
        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (!string.IsNullOrEmpty(e.Data)) onLine(e.Data); };
        process.Start();
        process.BeginOutputReadLine();
        return process;
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
