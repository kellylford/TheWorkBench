using System.Diagnostics;
using System.IO;
using System.Text;

namespace HyperVManage.Services;

/// <summary>A PowerShell command failed; the message is PowerShell's own error text.</summary>
public sealed class HyperVException(string message) : Exception(message);

/// <summary>
/// Full paths to the Windows programs the app starts. The app runs elevated, and a bare name is
/// looked up in the app's own folder first: a powershell.exe dropped beside HyperVManage.exe in
/// Downloads would otherwise run as administrator.
/// </summary>
public static class SystemTools
{
    public static string PowerShell { get; } = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
    public static string RemoteDesktop { get; } = Path.Combine(Environment.SystemDirectory, "mstsc.exe");
    public static string Console { get; } = Path.Combine(Environment.SystemDirectory, "vmconnect.exe");
    public static string CredentialManager { get; } = Path.Combine(Environment.SystemDirectory, "cmdkey.exe");
}

/// <summary>
/// Runs Windows PowerShell (powershell.exe, where the Hyper-V module lives) and returns what the
/// script wrote. Hyper-V Manage does everything through the same cmdlets a person would type,
/// the way Parallels Manager goes through prlctl, so anything it does can be repeated by hand.
/// </summary>
public static class PowerShellRunner
{
    /// <summary>
    /// Runs <paramref name="script"/> and returns its standard output. Any error, from a cmdlet or
    /// a throw, comes back as a <see cref="HyperVException"/> carrying PowerShell's message.
    /// </summary>
    public static async Task<string> RunAsync(string script, CancellationToken ct = default)
    {
        // -EncodedCommand rather than -Command: no quoting of the script on the command line at
        // all. Values inside the script go through Ps.Quote.
        var wrapped =
            "$ErrorActionPreference = 'Stop'\n" +
            "$ProgressPreference = 'SilentlyContinue'\n" +
            "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false\n" +
            "try {\n" + script + "\n} catch {\n" +
            "  [Console]::Error.WriteLine($_.Exception.Message)\n" +
            "  exit 1\n}\n";
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(wrapped));

        var psi = new ProcessStartInfo(SystemTools.PowerShell)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                  "-OutputFormat", "Text", "-EncodedCommand", encoded })
            psi.ArgumentList.Add(a);

        using var process = Process.Start(psi) ?? throw new HyperVException("Couldn't start PowerShell.");
        using var reg = ct.Register(() => { try { process.Kill(entireProcessTree: true); } catch { } });
        var stdout = process.StandardOutput.ReadToEndAsync(ct);
        var stderr = process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct).ConfigureAwait(false);
        var output = await stdout.ConfigureAwait(false);
        // Plain text, not the XML Windows PowerShell wraps some of it in when its output is captured.
        var error = CliXml.Clean(await stderr.ConfigureAwait(false));

        if (process.ExitCode != 0)
            throw new HyperVException(error.Length > 0 ? error : $"PowerShell exited with code {process.ExitCode}.");
        return output;
    }
}

/// <summary>Turns values into PowerShell literals, so a VM name can never be read as code.</summary>
public static class Ps
{
    /// <summary>
    /// A single-quoted string literal. PowerShell treats the typographic quotes ‘ ’ ‚ ‛ as
    /// single quotes too, so they are doubled along with the plain one; inside single quotes
    /// nothing else is special.
    /// </summary>
    public static string Quote(string value)
    {
        var sb = new StringBuilder(value.Length + 2).Append('\'');
        foreach (var c in value)
        {
            sb.Append(c);
            if (c is '\'' or '‘' or '’' or '‚' or '‛') sb.Append(c);
        }
        return sb.Append('\'').ToString();
    }

    public static string Bool(bool value) => value ? "$true" : "$false";
}
