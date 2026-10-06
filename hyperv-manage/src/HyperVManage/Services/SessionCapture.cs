using System.Text.Json;

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
/// Direct, which needs no network, finds the signed-in session, and runs a one-off scheduled task
/// as that user, in that session, which takes the picture and reads what's in front with UI
/// Automation. vmtest captures its pictures the same way.
/// </summary>
public static class SessionCapture
{
    /// <summary>The scheduled task, and the folder in the VM it works in. Each picture is deleted
    /// from the VM as soon as it has been copied out.</summary>
    internal const string TaskName = "HyperVManage-Screenshot";

    /// <summary>
    /// Runs in the VM as the signed-in user, in their session: writes screen.png (the whole
    /// desktop, every monitor, at full resolution) and info.json. A picture that can't be taken
    /// is reported in info.json as ShotError, with the rest still filled in.
    /// </summary>
    internal const string GuestScript = """
        param([Parameter(Mandatory)][string]$Out)
        $ErrorActionPreference = 'Stop'
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
            try {
                $focus = [System.Windows.Automation.AutomationElement]::FocusedElement
                $info.FocusName = [string]$focus.Current.Name
                $info.FocusType = [string]$focus.Current.LocalizedControlType
            } catch { }
            $root = [System.Windows.Automation.AutomationElement]::RootElement
            $info.Windows = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
                ForEach-Object { [string]$_.Current.Name } | Where-Object { $_ -and $_ -ne 'Program Manager' })
        } catch { $info.Error = $_.Exception.Message }
        $info | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $Out 'info.json') -Encoding UTF8
        """;

    /// <summary>
    /// Runs on this PC, after the line that finds $vm. The sign-in comes in environment variables,
    /// never on a command line, which Windows can log. It writes one line of JSON (Status,
    /// Message, User, SessionName, Info) and, when there's a picture, a second line with it in
    /// base64.
    /// </summary>
    internal static string HostScript => """
        $password = if ($env:HVM_GUEST_PASSWORD) { ConvertTo-SecureString $env:HVM_GUEST_PASSWORD -AsPlainText -Force } else { New-Object System.Security.SecureString }
        $cred = New-Object System.Management.Automation.PSCredential($env:HVM_GUEST_USER, $password)
        Remove-Item Env:HVM_GUEST_PASSWORD -ErrorAction SilentlyContinue
        try { $s = New-PSSession -VMId $vm.Id -Credential $cred -ErrorAction Stop }
        catch {
            $m = $_.Exception.Message
            $status = if ($m -match 'credential|user name or password|logon failure|access is denied|password is incorrect') { 'signin' } else { 'unreachable' }
            ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ Status = $status; Message = $m })
            return
        }
        try {
            $r = Invoke-Command -Session $s -ArgumentList $guestScript, $taskName -ScriptBlock {
                param($guestScript, $taskName)
                $ErrorActionPreference = 'Stop'
                $root = Join-Path $env:ProgramData 'HyperVManage'
                $quser = @(quser.exe 2>&1 | ForEach-Object { [string]$_ })
                $sessions = @(foreach ($line in $quser) {
                    if ($line -match '^\s*>?(\S+)\s+(?:(\S+)\s+)?(\d+)\s+(Active|Disc)\b') {
                        [pscustomobject]@{ User = $Matches[1]; Name = [string]$Matches[2]; State = $Matches[4] }
                    }
                })
                $who = $sessions | Where-Object State -eq 'Active' | Select-Object -First 1
                if (-not $who) {
                    $away = $sessions | Select-Object -First 1
                    $m = if ($away) { "$($away.User)'s session is disconnected: nobody is connected to it, so Windows isn't drawing it." } else { 'Nobody is signed in to Windows in the VM.' }
                    return [pscustomobject]@{ Status = 'nobody'; Message = $m }
                }
                New-Item $root -ItemType Directory -Force | Out-Null
                icacls.exe $root /grant "$($who.User):(OI)(CI)M" /Q | Out-Null
                Set-Content -LiteralPath "$root\capture.ps1" -Value $guestScript -Encoding UTF8
                Remove-Item "$root\screen.png", "$root\info.json" -ErrorAction SilentlyContinue
                # conhost --headless: no console window flashes up in the user's session.
                $action = New-ScheduledTaskAction -Execute 'conhost.exe' `
                    -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$root\capture.ps1`" -Out `"$root`""
                $principal = New-ScheduledTaskPrincipal -UserId $who.User -LogonType Interactive -RunLevel Limited
                Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force | Out-Null
                try {
                    Start-ScheduledTask -TaskName $taskName
                    $deadline = (Get-Date).AddSeconds(30)
                    while (-not (Test-Path "$root\info.json") -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
                    # info.json is written last; give its writer a moment to close it.
                    Start-Sleep -Milliseconds 100
                } finally { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue }
                try {
                    if (-not (Test-Path "$root\info.json")) {
                        return [pscustomobject]@{ Status = 'failed'; Message = "The picture didn't come back from $($who.User)'s session within 30 seconds." }
                    }
                    [pscustomobject]@{
                        Status = 'ok'; User = $who.User; SessionName = $who.Name
                        Info = Get-Content -Raw -LiteralPath "$root\info.json"
                        Png = if (Test-Path "$root\screen.png") { [Convert]::ToBase64String([IO.File]::ReadAllBytes("$root\screen.png")) } else { '' }
                    }
                } finally { Remove-Item "$root\screen.png", "$root\info.json" -ErrorAction SilentlyContinue }
            }
        } finally { Remove-PSSession $s }
        ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ Status = $r.Status; Message = [string]$r.Message; User = [string]$r.User; SessionName = [string]$r.SessionName; Info = [string]$r.Info })
        if ($r.Png) { $r.Png }
        """;

    /// <summary>The whole script for one VM: the guest script and task name as literals, then the host part.</summary>
    internal static string BuildScript(string getVm) =>
        getVm + $"$guestScript = {Ps.Quote(GuestScript)}\n$taskName = {Ps.Quote(TaskName)}\n" + HostScript;

    /// <summary>Reads what the script wrote. Anything but a picture becomes a SessionScreenshotException.</summary>
    internal static SessionScreenshot Parse(string output, DateTime taken)
    {
        var lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (lines.Length == 0) throw new SessionScreenshotException(SessionFailure.Unreachable, "Windows in the VM didn't answer.");
        using var doc = JsonDocument.Parse(lines[0]);
        var e = doc.RootElement;
        var message = PowerShellHyperVService.Str(e, "Message");
        switch (PowerShellHyperVService.Str(e, "Status"))
        {
            case "ok": break;
            case "signin": throw new SessionScreenshotException(SessionFailure.SignInRefused, message);
            case "unreachable": throw new SessionScreenshotException(SessionFailure.Unreachable, message);
            case "nobody": throw new SessionScreenshotException(SessionFailure.NobodySignedIn, message);
            default: throw new SessionScreenshotException(SessionFailure.NotDrawn, message.Length > 0 ? message : "The picture didn't come back.");
        }

        using var infoDoc = JsonDocument.Parse(PowerShellHyperVService.Str(e, "Info") is { Length: > 0 } json ? json.Trim('﻿') : "{}");
        var i = infoDoc.RootElement;
        var info = new ScreenInfo(
            PowerShellHyperVService.Str(e, "User"),
            !string.Equals(PowerShellHyperVService.Str(e, "SessionName"), "console", StringComparison.OrdinalIgnoreCase),
            PowerShellHyperVService.Str(i, "Foreground"),
            PowerShellHyperVService.Str(i, "FocusName"),
            PowerShellHyperVService.Str(i, "FocusType"),
            PowerShellHyperVService.Strings(i, "Windows"));

        var shotError = PowerShellHyperVService.Str(i, "ShotError");
        if (lines.Length < 2 || shotError.Length > 0)
            throw new SessionScreenshotException(SessionFailure.NotDrawn,
                (info.RemoteDesktop
                    ? $"Windows isn't drawing {info.User}'s Remote Desktop session, most often because its window is minimized."
                    : $"Windows isn't drawing {info.User}'s session; it may be locked.")
                + (shotError.Length > 0 ? $" ({shotError.Trim()})" : ""));

        var width = (int)PowerShellHyperVService.Num(i, "Width");
        var height = (int)PowerShellHyperVService.Num(i, "Height");
        byte[] png;
        try { png = Convert.FromBase64String(lines[1]); }
        catch (FormatException) { throw new SessionScreenshotException(SessionFailure.NotDrawn, "The picture came back damaged."); }
        return new SessionScreenshot(new ScreenPicture(png, width, height, taken), info);
    }
}
