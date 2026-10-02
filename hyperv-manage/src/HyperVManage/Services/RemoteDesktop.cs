using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;

namespace HyperVManage.Services;

/// <summary>Opens a Remote Desktop connection to a VM, the way to get its sound to a screen reader.</summary>
public static class RemoteDesktop
{
    /// <summary>
    /// The address to connect to. A name keeps working when the VM's address changes, so one is
    /// preferred when it really points at the VM: &lt;name&gt;.local on your own network (other
    /// PCs and Macs can look it up too), the bare name, or &lt;name&gt;.mshome.net behind the
    /// Default Switch. Otherwise the first address.
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
                if (resolved.Any(addresses.Contains)) return candidate;
            }
        }
        return addresses[0];
    }

    /// <summary>The Windows computer name New-HyperVRdpVM.ps1 gives a VM: letters, digits and
    /// hyphens from its name, at most 15 characters.</summary>
    public static string ComputerName(string vmName)
    {
        var s = new string(vmName.Where(c => char.IsAsciiLetterOrDigit(c) || c == '-').ToArray());
        return s.Length > 15 ? s[..15] : s;
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
        var desktopFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), $"{vmName}.rdp");
        if (File.Exists(desktopFile))
        {
            Launch(desktopFile);
            return desktopFile;
        }

        var target = await ChooseTargetAsync(vmName, addresses, ResolveAsync).ConfigureAwait(false)
            ?? throw new HyperVException($"{vmName} has no network address yet. Wait for it to finish starting, then try again.");
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                  "HyperVManage", "Connections");
        Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, SafeFileName(vmName) + ".rdp");
        await File.WriteAllTextAsync(file, BuildRdpFile(target), Encoding.Unicode).ConfigureAwait(false);
        Launch(file);
        return target;
    }

    /// <summary>The Hyper-V console window (VMConnect). No sound reaches a screen reader through
    /// it, but it shows the VM before Windows is up, which Remote Desktop can't.</summary>
    public static void OpenConsole(string vmId) =>
        Process.Start(new ProcessStartInfo("vmconnect.exe") { UseShellExecute = false, ArgumentList = { "localhost", "-G", vmId } });

    private static void Launch(string rdpFile) =>
        Process.Start(new ProcessStartInfo("mstsc.exe") { UseShellExecute = false, ArgumentList = { rdpFile } });

    private static string SafeFileName(string name)
    {
        var bad = Path.GetInvalidFileNameChars();
        var s = new string(name.Select(c => bad.Contains(c) ? '_' : c).ToArray());
        return s.Length > 0 ? s : "vm";
    }
}
