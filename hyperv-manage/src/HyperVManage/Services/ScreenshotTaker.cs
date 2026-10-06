using HyperVManage.Models;

namespace HyperVManage.Services;

/// <summary>A sign-in someone typed, and whether to keep it for next time.</summary>
public sealed record SignInAnswer(GuestCredential Credential, bool Remember);

/// <summary>
/// Takes the picture Screenshot shows. The session someone is signed in to inside the VM comes
/// first, since that is where they work, Remote Desktop included; it needs the VM's sign-in, which
/// is asked for once and kept. When there's no session picture to take, Hyper-V's picture of the
/// VM's own screen is taken instead, with a note saying why.
/// </summary>
public sealed class ScreenshotTaker(IHyperVService hyperV, IGuestCredentialStore credentials)
{
    /// <summary>VMs whose sign-in was declined this time the app is running: not asked again until
    /// it restarts.</summary>
    private readonly HashSet<string> _declined = [];

    /// <summary>
    /// Asks for a VM's sign-in. The text, when there is one, says why it is being asked again.
    /// Null means the user would rather have the VM's own screen.
    /// </summary>
    public Func<VmInfo, string?, SignInAnswer?>? AskSignIn { get; set; }

    public IGuestCredentialStore Credentials => credentials;

    public async Task<ScreenPicture> TakeAsync(VmInfo vm, CancellationToken ct = default)
    {
        string note;
        var credential = Stored(vm);
        var remember = false;
        if (credential is null && !_declined.Contains(vm.Id))
            (credential, remember) = Ask(vm, null);
        if (credential is null)
            note = "Without the VM's sign-in, a Remote Desktop session in it can't be seen.";
        else
        {
            while (true)
            {
                try
                {
                    var session = await hyperV.TakeSessionScreenshotAsync(vm.Id, credential, ct);
                    if (remember)
                    {
                        try { credentials.Save(vm.Id, credential); }
                        catch (System.ComponentModel.Win32Exception) { } // the picture still counts
                    }
                    return session.Picture with { Info = session.Info };
                }
                catch (SessionScreenshotException ex) when (ex.Reason == SessionFailure.SignInRefused)
                {
                    try { credentials.Forget(vm.Id); } catch (System.ComponentModel.Win32Exception) { }
                    (credential, remember) = Ask(vm, $"Windows in {vm.Name} didn't accept that sign-in: {ex.Message}");
                    if (credential is null) { note = "Windows in the VM didn't accept the sign-in."; break; }
                }
                catch (SessionScreenshotException ex) when (ex.Reason == SessionFailure.Unreachable)
                {
                    note = $"Couldn't reach Windows inside the VM: {ex.Message}";
                    break;
                }
                catch (SessionScreenshotException ex)
                {
                    note = ex.Message;
                    break;
                }
            }
        }
        var screen = await hyperV.TakeScreenshotAsync(vm.Id, ct);
        return screen with { Note = note };
    }

    private GuestCredential? Stored(VmInfo vm)
    {
        try { return credentials.Get(vm.Id); }
        catch (System.ComponentModel.Win32Exception) { return null; }
    }

    private (GuestCredential?, bool) Ask(VmInfo vm, string? why)
    {
        if (AskSignIn?.Invoke(vm, why) is { } answer) return (answer.Credential, answer.Remember);
        _declined.Add(vm.Id);
        return (null, false);
    }
}
