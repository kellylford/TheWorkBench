using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace HyperVManage.Services;

/// <summary>What was on screen in the session, in words: who, how they're connected, what is in
/// front and what has keyboard focus.</summary>
public sealed record ScreenInfo(
    string User,
    bool RemoteDesktop,
    string Foreground,
    string FocusName,
    string FocusType,
    IReadOnlyList<string> Windows)
{
    /// <summary>The focused control as a screen reader would put it, "Text editor, document",
    /// or empty.</summary>
    public string FocusText =>
        FocusName.Length > 0 && FocusType.Length > 0 ? $"{FocusName}, {FocusType}" : FocusName + FocusType;
}

/// <summary>A picture of the session someone is signed in to inside the VM, and what was on it.</summary>
public sealed record SessionScreenshot(ScreenPicture Picture, ScreenInfo Info);

public enum SessionFailure
{
    /// <summary>Windows in the VM refused the sign-in.</summary>
    SignInRefused,
    /// <summary>Couldn't reach Windows inside the VM: not Windows, still starting, or no PowerShell Direct.</summary>
    Unreachable,
    /// <summary>Nobody is signed in, or their session is disconnected.</summary>
    NobodySignedIn,
    /// <summary>Reached the session but couldn't take its picture, usually because Windows isn't
    /// drawing it: a minimized Remote Desktop window, or a locked screen.</summary>
    NotDrawn,
}

public sealed class SessionScreenshotException(SessionFailure reason, string message) : Exception(message)
{
    public SessionFailure Reason { get; } = reason;
}

/// <summary>
/// Takes the picture from inside the VM. Hyper-V's own picture is of the VM's monitor, but
/// someone working in a VM over Remote Desktop is in a session of their own that the monitor
/// doesn't show: it sits at the lock screen. So this reaches Windows inside the VM over PowerShell
/// Direct, which needs no network, finds the active session, and runs a one-off scheduled task as
/// that user, in that session, which takes the picture and reads what's in front with UI
/// Automation. vmtest captures its pictures the same way.
/// </summary>
/// <remarks>
/// The guest side runs with administrator rights, and the task runs as whoever is signed in, who
/// may not be an administrator, so nothing is left where that user could turn it to their
/// advantage. Each run has its own task and its own folder under the Windows temp folder, with a
/// random name, created with an ACL of its own: the user can add files to it and change the files
/// they made, but not delete, rename or replace the folder, nor make folders or links in it. The
/// script isn't a file at all; it goes in the task's command line. Everything is removed before
/// the run ends.
/// </remarks>
public static class SessionCapture
{
    /// <summary>
    /// Runs in the VM as the signed-in user, in their session, with $Out set first to its folder.
    /// Writes screen.png (the whole desktop, every monitor, at full resolution), then shot.json
    /// with its size and the window in front, then info.json with that and what has focus and
    /// which windows are open. UI Automation can hang on a hung app, so shot.json is written
    /// first: the picture isn't lost waiting for it. Each file is written under another name and
    /// renamed, so it's never read half-written. Kept to plain ASCII, though it now travels encoded
    /// in the task's command line rather than as a file Windows PowerShell would read as ANSI.
    /// </summary>
    internal const string GuestScript = """
        $ErrorActionPreference = 'Stop'
        function Save-Json($info, $name) {
            $tmp = Join-Path $Out "$name.tmp"
            $info | ConvertTo-Json -Compress | Set-Content -LiteralPath $tmp -Encoding UTF8
            [System.IO.File]::Move($tmp, (Join-Path $Out $name))
        }
        $info = [ordered]@{}
        try {
            Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
            Add-Type @'
        using System; using System.Runtime.InteropServices; using System.Text;
        public static class HvmNative {
            [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
            [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
        }
        '@
            # Without this, a scaled display is captured at a fraction of its size.
            [void][HvmNative]::SetProcessDPIAware()
            try {
                $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
                $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                try { $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size) } finally { $g.Dispose() }
                $bmp.Save((Join-Path $Out 'screen.png'), [System.Drawing.Imaging.ImageFormat]::Png)
                $bmp.Dispose()
                $info.Width = $b.Width
                $info.Height = $b.Height
            } catch { $info.ShotError = $_.Exception.Message }
            $title = New-Object System.Text.StringBuilder 512
            [void][HvmNative]::GetWindowText([HvmNative]::GetForegroundWindow(), $title, 512)
            $info.Foreground = $title.ToString()
        } catch { $info.Error = $_.Exception.Message }
        Save-Json $info 'shot.json'
        try {
            $focus = [System.Windows.Automation.AutomationElement]::FocusedElement
            $info.FocusName = [string]$focus.Current.Name
            $info.FocusType = [string]$focus.Current.LocalizedControlType
            $root = [System.Windows.Automation.AutomationElement]::RootElement
            $info.Windows = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
                ForEach-Object { [string]$_.Current.Name } | Where-Object { $_ -and $_ -ne 'Program Manager' })
        } catch { }
        Save-Json $info 'info.json'
        """;

    /// <summary>
    /// Runs in the VM with administrator rights, over PowerShell Direct: finds the active session
    /// with Windows' own session list (quser's columns and words differ by language), and takes
    /// the picture in it. Returns Status, Message, User, Remote, Info and Png.
    /// </summary>
    internal const string GuestAdminScript = """
        param($captureScript, $runId)
        $ErrorActionPreference = 'Stop'
        Add-Type -TypeDefinition @'
        using System; using System.Collections.Generic; using System.Runtime.InteropServices;
        public static class HvmWts {
            [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
            struct SessionInfo { public int SessionId; public string WinStationName; public int State; }
            [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
            static extern bool WTSEnumerateSessionsW(IntPtr server, int reserved, int version, out IntPtr info, out int count);
            [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
            static extern bool WTSQuerySessionInformationW(IntPtr server, int session, int infoClass, out IntPtr buffer, out int bytes);
            [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);
            static string Query(int session, int infoClass) {
                IntPtr buffer; int bytes;
                if (!WTSQuerySessionInformationW(IntPtr.Zero, session, infoClass, out buffer, out bytes)) return "";
                try { return Marshal.PtrToStringUni(buffer) ?? ""; } finally { WTSFreeMemory(buffer); }
            }
            // Each session someone is signed in to: id, state (0 active, 4 disconnected), station, domain, user.
            public static List<string[]> Sessions() {
                var list = new List<string[]>();
                IntPtr info; int count;
                if (!WTSEnumerateSessionsW(IntPtr.Zero, 0, 1, out info, out count)) return list;
                try {
                    int size = Marshal.SizeOf(typeof(SessionInfo));
                    for (int i = 0; i < count; i++) {
                        var s = (SessionInfo)Marshal.PtrToStructure(new IntPtr(info.ToInt64() + i * size), typeof(SessionInfo));
                        string user = Query(s.SessionId, 5);
                        if (user.Length == 0) continue;
                        list.Add(new[] { s.SessionId.ToString(), s.State.ToString(), s.WinStationName ?? "", Query(s.SessionId, 7), user });
                    }
                } finally { WTSFreeMemory(info); }
                return list;
            }
        }
        '@
        $sessions = @([HvmWts]::Sessions())
        # Windows Server can have the console and Remote Desktop sessions active at once; the
        # Remote Desktop one is where someone is working.
        $active = @($sessions | Where-Object { $_[1] -eq '0' } | Sort-Object { $_[2] -like 'console' }) | Select-Object -First 1
        if (-not $active) {
            $away = $sessions | Where-Object { $_[1] -eq '4' } | Select-Object -First 1
            $m = if ($away) { "$($away[4])'s session is disconnected: nobody is connected to it, so Windows isn't drawing it." } else { 'Nobody is signed in to Windows in the VM.' }
            return [pscustomobject]@{ Status = 'nobody'; Message = $m }
        }
        $account = "$($active[3])\$($active[4])"
        $remote = $active[2] -notlike 'console'
        $sid = (New-Object System.Security.Principal.NTAccount($account)).Translate([System.Security.Principal.SecurityIdentifier])
        $dir = Join-Path $env:windir "Temp\HyperVManage-$runId"
        if (Test-Path -LiteralPath $dir) { throw "The folder $dir is already there; nothing was run." }
        $acl = New-Object System.Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($admin in 'S-1-5-18', 'S-1-5-32-544') {
            $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
                (New-Object System.Security.Principal.SecurityIdentifier $admin), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
        }
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'CreateFiles, ReadAndExecute', 'None', 'None', 'Allow')))
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'Modify', 'ObjectInherit', 'InheritOnly', 'Allow')))
        [void][System.IO.Directory]::CreateDirectory($dir, $acl)
        try {
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("`$Out = '$dir'`n" + $captureScript))
            # conhost --headless: no console window flashes up in the user's session.
            $action = New-ScheduledTaskAction -Execute "$env:windir\System32\conhost.exe" `
                -Argument "--headless $env:windir\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"
            $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
            $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
            $task = "HyperVManage-Screenshot-$runId"
            Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings | Out-Null
            try {
                Start-ScheduledTask -TaskName $task
                $deadline = (Get-Date).AddSeconds(30)
                $shotAt = $null
                while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath "$dir\info.json")) {
                    # Once the picture is in, what has focus gets a few seconds more, not the full wait.
                    if (-not $shotAt -and (Test-Path -LiteralPath "$dir\shot.json")) { $shotAt = Get-Date }
                    if ($shotAt -and ((Get-Date) - $shotAt).TotalSeconds -gt 8) { break }
                    Start-Sleep -Milliseconds 200
                }
            } finally {
                Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
                Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
            }
            # The user can put files here, so only plain files of a sensible size are read: not a
            # link, which would be followed, and not something big enough to stall this PC.
            function Get-Plain($path, $limit) {
                $f = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
                if ($f -and -not ($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $f.Length -le $limit) { $f.FullName }
            }
            $infoFile = @("$dir\info.json", "$dir\shot.json") | ForEach-Object { Get-Plain $_ 1MB } | Select-Object -First 1
            if (-not $infoFile) {
                return [pscustomobject]@{ Status = 'failed'; Message = "The picture didn't come back from $($active[4])'s session within 30 seconds." }
            }
            [pscustomobject]@{
                Status = 'ok'; User = $active[4]; Remote = $remote
                Info = [IO.File]::ReadAllText($infoFile)
                Png = if ($png = Get-Plain "$dir\screen.png" 200MB) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($png)) } else { '' }
            }
        } finally {
            # File by file, then the empty folder: never a recursive delete.
            Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
            try { [System.IO.Directory]::Delete($dir, $false) } catch { }
        }
        """;

    /// <summary>
    /// Runs on this PC, after the lines that set $vm, $guestScript, $guestAdminScript and $runId.
    /// The sign-in comes in environment variables, never on a command line, which Windows can log.
    /// Writes one line of JSON and, when there's a picture, a second line with it in base64.
    /// A refused sign-in is told apart by the error PowerShell Direct gives, in any language,
    /// and by its English text as well.
    /// </summary>
    internal const string HostScript = """
        $password = if ($env:HVM_GUEST_PASSWORD) { ConvertTo-SecureString $env:HVM_GUEST_PASSWORD -AsPlainText -Force } else { New-Object System.Security.SecureString }
        $cred = New-Object System.Management.Automation.PSCredential($env:HVM_GUEST_USER, $password)
        Remove-Item Env:HVM_GUEST_PASSWORD -ErrorAction SilentlyContinue
        try { $s = New-PSSession -VMId $vm.Id -Credential $cred -ErrorAction Stop }
        catch {
            $m = $_.Exception.Message
            $refused = "$($_.FullyQualifiedErrorId)" -match 'Credential|Logon|AccessDenied|Authenticat' -or
                $m -match 'credential|user name or password|logon failure|access is denied|password is incorrect'
            ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ Status = $(if ($refused) { 'signin' } else { 'unreachable' }); Message = $m; Id = "$($_.FullyQualifiedErrorId)" })
            return
        }
        try { $r = Invoke-Command -Session $s -ArgumentList $guestScript, $runId -ScriptBlock ([scriptblock]::Create($guestAdminScript)) }
        finally { Remove-PSSession $s }
        ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ Status = [string]$r.Status; Message = [string]$r.Message; User = [string]$r.User; Remote = [bool]$r.Remote; Info = [string]$r.Info })
        if ($r.Png) { $r.Png }
        """;

    /// <summary>The whole script for one VM and one run.</summary>
    internal static string BuildScript(string getVm, string runId) =>
        getVm +
        $"$guestScript = {Ps.Quote(GuestScript)}\n" +
        $"$guestAdminScript = {Ps.Quote(GuestAdminScript)}\n" +
        $"$runId = {Ps.Quote(runId)}\n" +
        HostScript;

    /// <summary>Reads what the script wrote. Anything but a picture becomes a SessionScreenshotException.</summary>
    internal static SessionScreenshot Parse(string output, DateTime taken)
    {
        // PowerShell's warnings go to the same output, so the JSON is the first line that is JSON.
        var lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var at = Array.FindIndex(lines, l => l.StartsWith('{'));
        if (at < 0) throw new SessionScreenshotException(SessionFailure.Unreachable, "Windows in the VM didn't answer.");
        JsonDocument answer;
        try { answer = JsonDocument.Parse(lines[at]); }
        catch (JsonException) { throw new SessionScreenshotException(SessionFailure.NotDrawn, "The answer from the VM was damaged."); }
        using var answerDoc = answer;
        var e = answer.RootElement;
        var message = PowerShellHyperVService.Str(e, "Message");
        switch (PowerShellHyperVService.Str(e, "Status"))
        {
            case "ok": break;
            case "signin": throw new SessionScreenshotException(SessionFailure.SignInRefused, message);
            case "unreachable": throw new SessionScreenshotException(SessionFailure.Unreachable, message);
            case "nobody": throw new SessionScreenshotException(SessionFailure.NobodySignedIn, message);
            default: throw new SessionScreenshotException(SessionFailure.NotDrawn, message.Length > 0 ? message : "The picture didn't come back.");
        }

        JsonDocument described;
        try { described = JsonDocument.Parse(PowerShellHyperVService.Str(e, "Info") is { Length: > 0 } json ? json.Trim().Trim('\uFEFF') : "{}"); }
        catch (JsonException) { throw new SessionScreenshotException(SessionFailure.NotDrawn, "The picture's description came back damaged."); }
        using var describedDoc = described;
        var i = described.RootElement;
        var remote = e.TryGetProperty("Remote", out var r) && r.ValueKind == JsonValueKind.True;
        var info = new ScreenInfo(
            PowerShellHyperVService.Str(e, "User"),
            remote,
            PowerShellHyperVService.Str(i, "Foreground"),
            PowerShellHyperVService.Str(i, "FocusName"),
            PowerShellHyperVService.Str(i, "FocusType"),
            PowerShellHyperVService.Strings(i, "Windows"));

        var problem = string.Join(" ", new[] { PowerShellHyperVService.Str(i, "ShotError"), PowerShellHyperVService.Str(i, "Error") }
            .Select(s => s.Trim()).Where(s => s.Length > 0));
        var notDrawn = remote
            ? $"Windows isn't drawing {info.User}'s Remote Desktop session, most often because its window is minimized."
            : $"Windows isn't drawing {info.User}'s session; it may be locked or asleep.";
        if (at + 1 >= lines.Length || problem.Length > 0)
            throw new SessionScreenshotException(SessionFailure.NotDrawn, notDrawn + (problem.Length > 0 ? $" ({problem})" : ""));

        byte[] png;
        try { png = Convert.FromBase64String(lines[at + 1]); }
        catch (FormatException) { throw new SessionScreenshotException(SessionFailure.NotDrawn, "The picture came back damaged."); }
        var picture = new ScreenPicture(png, (int)PowerShellHyperVService.Num(i, "Width"), (int)PowerShellHyperVService.Num(i, "Height"), taken);
        // A session Windows has stopped drawing can come back as one flat color rather than an error.
        if (IsOneColor(picture)) throw new SessionScreenshotException(SessionFailure.NotDrawn, notDrawn);
        return new SessionScreenshot(picture, info);
    }

    internal static bool IsOneColor(ScreenPicture picture)
    {
        BitmapSource bitmap;
        try { bitmap = new FormatConvertedBitmap(picture.ToBitmap(), PixelFormats.Bgr32, null, 0); }
        catch (Exception ex) when (ex is NotSupportedException or System.IO.FileFormatException or ArgumentException)
        {
            throw new SessionScreenshotException(SessionFailure.NotDrawn, "The picture came back damaged.");
        }
        var pixels = new int[bitmap.PixelWidth * bitmap.PixelHeight];
        bitmap.CopyPixels(pixels, bitmap.PixelWidth * 4, 0);
        return pixels.Length == 0 || pixels.AsSpan(1).IndexOfAnyExcept(pixels[0]) < 0;
    }
}
