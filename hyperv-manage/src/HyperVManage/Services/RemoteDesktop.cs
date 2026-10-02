using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;

namespace HyperVManage.Services;

/// <summary>A connection file on the desktop, and whether it was already there and left as it was.</summary>
public sealed record SavedConnection(string Path, bool AlreadyThere);

/// <summary>Opens a Remote Desktop connection to a VM, the way to get its sound to a screen reader.</summary>
public static class RemoteDesktop
{
    /// <summary>
    /// The address to connect to. A name keeps working when the VM's address changes, so one is
    /// preferred when it points at this VM and nothing else: &lt;name&gt;.local on your own
    /// network (other PCs and Macs can look it up too), the bare name, or &lt;name&gt;.mshome.net
    /// behind the Default Switch. A name that also reaches another computer, such as a VM with
    /// the same name made on another PC, could connect there instead. Otherwise the first address.
    /// </summary>
    public static async Task<string?> ChooseTargetAsync(
        string vmName, IReadOnlyList<string> addresses, Func<string, Task<string[]>> resolve)
    {
        if (addresses.Count == 0) return null;
        var computer = ComputerName(vmName);
        if (computer.Length > 0)
        {
            foreach (var candidate in new[] { $"{computer}.local", computer, $"{computer}.mshome.net" })
            {
                string[] resolved;
                try { resolved = await resolve(candidate).ConfigureAwait(false); }
                catch { continue; }
                if (resolved.Length > 0 && resolved.All(addresses.Contains)) return candidate;
            }
        }
        return addresses[0];
    }

    /// <summary>
    /// The Windows computer name New-HyperVRdpVM.ps1 gives a VM: letters, digits and hyphens from
    /// its name, at most 15 characters. A longer name keeps its ending from the earliest hyphen
    /// that leaves room, since the ending tells a PC's VMs apart; the start (usually the host's
    /// name) is cut short and followed by four characters from a hash of the whole name, so hosts
    /// whose names begin alike still give their VMs different names. Must match the script
    /// exactly; a test runs the script's own lines and compares.
    /// </summary>
    public static string ComputerName(string vmName)
    {
        var s = new string(vmName.Where(c => char.IsAsciiLetterOrDigit(c) || c == '-').ToArray()).Trim('-');
        if (s.Length <= 15) return s;

        var hash = System.Security.Cryptography.SHA1.HashData(Encoding.UTF8.GetBytes(s.ToUpperInvariant()));
        var n = (((ulong)hash[0] * 256 + hash[1]) * 256 + hash[2]) * 256 + hash[3];
        n %= 1679616; // 36^4
        const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
        var tag = new char[4];
        for (var i = 3; i >= 0; i--) { tag[i] = digits[(int)(n % 36)]; n /= 36; }

        for (var i = 1; i < s.Length; i++)
        {
            if (s[i] == '-' && s.Length - i <= 10)
                return s[..(11 - (s.Length - i))] + new string(tag) + s[i..];
        }
        return s[..11] + new string(tag);
    }

    public static Task<string[]> ResolveAsync(string name) =>
        Dns.GetHostAddressesAsync(name).ContinueWith(t =>
            t.IsCompletedSuccessfully
                ? t.Result.Where(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                           .Select(a => a.ToString()).ToArray()
                : [], TaskScheduler.Default);

    /// <summary>
    /// A connection file: sound plays on this PC, the microphone goes to the VM, the clipboard is
    /// shared, and Windows asks who to sign in as. The saved sign-in New-HyperVRdpVM.ps1 stores
    /// is for the file it writes, so when that file is on the desktop it is used instead.
    /// </summary>
    public static string BuildRdpFile(string target) => string.Join("\r\n",
        $"full address:s:{target}",
        "prompt for credentials:i:1",
        "audiomode:i:0",
        "audiocapturemode:i:1",
        "redirectclipboard:i:1",
        "autoreconnection enabled:i:1",
        "screen mode id:i:2",
        "authentication level:i:2",
        "");

    /// <summary>Opens Remote Desktop to the VM: the script's own desktop file if there is one,
    /// otherwise a fresh one. Returns where it is connecting, for the announcement.</summary>
    public static async Task<string> ConnectAsync(string vmName, IReadOnlyList<string> addresses)
    {
        var desktopFile = DesktopFile(vmName);
        if (File.Exists(desktopFile))
        {
            var lines = await File.ReadAllLinesAsync(desktopFile).ConfigureAwait(false);
            // The script's file carries the saved sign-in, so it is the one to open, but only
            // while its address still leads to this VM alone: a name another computer answers
            // to as well could connect there, and with the same sign-in nothing would warn.
            if (FileConnectsTo(lines, vmName, addresses)
                && (addresses.Count == 0 || await LeadsOnlyToAsync(AddressIn(lines)!, addresses, ResolveAsync).ConfigureAwait(false)))
            {
                Launch(desktopFile);
                return desktopFile;
            }
        }

        var target = await ChooseTargetAsync(vmName, addresses, ResolveAsync).ConfigureAwait(false)
            ?? throw new HyperVException(NoAddress(vmName));
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                  "HyperVManage", "Connections");
        Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, SafeFileName(vmName) + ".rdp");
        await File.WriteAllTextAsync(file, BuildRdpFile(target), Encoding.Unicode).ConfigureAwait(false);
        Launch(file);
        return target;
    }

    /// <summary>
    /// Saves &lt;VM name&gt;.rdp on the desktop, for a VM made without one or whose file was lost.
    /// A desktop file of that name that belongs to something else is never overwritten, and one
    /// that already connects to this VM alone is left as it is: the script's own file carries the
    /// user name its saved sign-in is stored under. A file whose address has gone stale is
    /// rewritten, keeping its user name line so Windows asks only for the password, and the
    /// saved sign-in for the old address, which nothing will use again, is removed.
    /// </summary>
    public static async Task<SavedConnection> SaveDesktopFileAsync(string vmName, IReadOnlyList<string> addresses)
    {
        var file = DesktopFile(vmName);
        var existing = File.Exists(file) ? await File.ReadAllLinesAsync(file).ConfigureAwait(false) : null;
        if (existing is not null && !FileConnectsTo(existing, vmName, addresses))
            throw new HyperVException($"There's already a file called {Path.GetFileName(file)} on the desktop that connects somewhere else, so it was left alone. Rename it and try again.");
        if (addresses.Count == 0) throw new HyperVException(NoAddress(vmName));
        if (existing is not null && await LeadsOnlyToAsync(AddressIn(existing)!, addresses, ResolveAsync).ConfigureAwait(false))
            return new SavedConnection(file, AlreadyThere: true);

        var target = await ChooseTargetAsync(vmName, addresses, ResolveAsync).ConfigureAwait(false) ?? addresses[0];
        var content = BuildRdpFile(target);
        var userLine = existing?.FirstOrDefault(l => l.StartsWith("username:s:", StringComparison.OrdinalIgnoreCase));
        if (userLine is not null)
        {
            // The user name is known, so Windows asks only for the password, and can remember it.
            content = userLine + "\r\n" + content.Replace("prompt for credentials:i:1", "prompt for credentials:i:0");
            var oldTarget = AddressIn(existing!);
            if (!string.IsNullOrEmpty(oldTarget) && !string.Equals(oldTarget, target, StringComparison.OrdinalIgnoreCase))
                ForgetSignIn(oldTarget);
        }
        await File.WriteAllTextAsync(file, content, Encoding.Unicode).ConfigureAwait(false);
        return new SavedConnection(file, AlreadyThere: false);
    }

    /// <summary>Removes the sign-in Credential Manager holds for Remote Desktop to an address.</summary>
    private static void ForgetSignIn(string address)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(SystemTools.CredentialManager)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                ArgumentList = { $"/delete:TERMSRV/{address}" },
            });
            p?.WaitForExit(5000);
        }
        catch (Exception) { } // Only tidying: a sign-in left behind does no harm.
    }

    /// <summary>Why there's nothing to connect to yet, and what to do.</summary>
    public static string NoAddress(string vmName) =>
        $"{vmName} hasn't reported a network address. If it has just started or resumed, wait a minute for Windows inside it to finish starting, then try again.";

    /// <summary>Whether an address leads to this VM and nothing else: one of its addresses, or a
    /// name that resolves only to them.</summary>
    public static async Task<bool> LeadsOnlyToAsync(string address, IReadOnlyList<string> addresses, Func<string, Task<string[]>> resolve)
    {
        if (System.Net.IPAddress.TryParse(address, out _)) return addresses.Contains(address);
        string[] resolved;
        try { resolved = await resolve(address).ConfigureAwait(false); }
        catch { return false; }
        return resolved.Length > 0 && resolved.All(addresses.Contains);
    }

    private static string DesktopFile(string vmName) =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), SafeFileName(vmName) + ".rdp");

    private static string? AddressIn(IEnumerable<string> rdpLines) =>
        rdpLines.FirstOrDefault(l => l.StartsWith("full address:s:", StringComparison.OrdinalIgnoreCase))?[15..].Trim();

    /// <summary>
    /// Whether a connection file is the one New-HyperVRdpVM.ps1 made for this VM: its address is
    /// one of the VM's names or addresses. A desktop file that merely shares the VM's name, say
    /// Office.rdp for a real PC, belongs to something else and is never opened or deleted for it.
    /// </summary>
    public static bool FileConnectsTo(IEnumerable<string> rdpLines, string vmName, IReadOnlyList<string> addresses)
    {
        var lines = rdpLines.ToList();
        var address = AddressIn(lines);
        if (string.IsNullOrEmpty(address)) return false;
        // The computer name this version gives, and the one earlier versions gave, so a VM made by
        // one of those is still recognised.
        var computers = new[] { ComputerName(vmName), LegacyComputerName(vmName) }.Where(c => c.Length > 0).Distinct().ToList();
        // The script writes "username:s:<computer>\<user>", which marks its file even when the VM's
        // address has changed since.
        if (lines.Any(l => computers.Any(c => l.StartsWith($"username:s:{c}\\", StringComparison.OrdinalIgnoreCase))))
            return true;
        var ours = computers.SelectMany(c => new[] { $"{c}.local", c, $"{c}.mshome.net" }).Concat(addresses);
        return ours.Any(o => o.Length > 0 && string.Equals(o, address, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The computer name versions of the script before the hashed rule gave a VM: the
    /// first 15 letters, digits and hyphens of its name. The script's $LegacyComputerName.</summary>
    public static string LegacyComputerName(string vmName)
    {
        var s = new string(vmName.Where(c => char.IsAsciiLetterOrDigit(c) || c == '-').ToArray());
        return s.Length > 15 ? s[..15] : s;
    }

    /// <summary>The Hyper-V console window (VMConnect). No sound reaches a screen reader through
    /// it, but it shows the VM before Windows is up, which Remote Desktop can't.</summary>
    public static void OpenConsole(string vmId) =>
        Process.Start(new ProcessStartInfo(SystemTools.Console) { UseShellExecute = false, ArgumentList = { "localhost", "-G", vmId } });

    private static void Launch(string rdpFile) =>
        Process.Start(new ProcessStartInfo(SystemTools.RemoteDesktop) { UseShellExecute = false, ArgumentList = { rdpFile } });

    private static string SafeFileName(string name)
    {
        var bad = Path.GetInvalidFileNameChars();
        var s = new string(name.Select(c => bad.Contains(c) ? '_' : c).ToArray());
        return s.Length > 0 ? s : "vm";
    }
}
