using HyperVManage.Models;

namespace HyperVManage.Services;

/// <summary>A sign-in someone typed, and whether to keep it for next time.</summary>
public sealed record SignInAnswer(GuestCredential Credential, bool Remember);

/// <summary>
/// Takes the picture Screenshot shows. The session someone is signed in to inside the VM comes
/// first, since that is where they work, Remote Desktop included; it needs the VM's sign-in, which
/// is asked for once and kept. Whenever there's no session picture to take, for whatever reason,
/// Hyper-V's picture of the VM's own screen is taken instead, with a note saying why.
/// </summary>
public sealed class ScreenshotTaker(IHyperVService hyperV, IGuestCredentialStore credentials)
{
    /// <summary>VMs whose sign-in was declined this time the app is running. Screenshot from the
    /// list doesn't ask again for them; the viewer's Take Again does.</summary>
    private readonly HashSet<string> _declined = [];

    /// <summary>
    /// Asks for a VM's sign-in: the VM, why it is being asked again (null the first time), and the
    /// user name to fill in. Null means the user would rather have the VM's own screen.
    /// </summary>
    public Func<VmInfo, string?, string?, SignInAnswer?>? AskSignIn { get; set; }

    public IGuestCredentialStore Credentials => credentials;

    /// <param name="askEvenIfDeclined">Ask for the sign-in even if it was declined before: someone
    /// pressing Take Again may have pressed Escape by mistake the first time.</param>
    public async Task<ScreenPicture> TakeAsync(VmInfo vm, CancellationToken ct = default, bool askEvenIfDeclined = false)
    {
        string note;
        var credential = Stored(vm);
        var remember = false;
        if (credential is null && (askEvenIfDeclined || !_declined.Contains(vm.Id)))
            (credential, remember) = Ask(vm, null, null);
        if (credential is null)
            note = "Without the VM's sign-in, a Remote Desktop session in it can't be seen. Take Again asks for it.";
        else
        {
            while (true)
            {
                try
                {
                    var session = await hyperV.TakeSessionScreenshotAsync(vm.Id, credential, ct);
                    if (remember) Keep(vm, credential);
                    return session.Picture with { Info = session.Info };
                }
                catch (SessionScreenshotException ex) when (ex.Reason == SessionFailure.SignInRefused)
                {
                    Forget(vm);
                    (credential, remember) = Ask(vm, $"Windows in {vm.Name} didn't accept that sign-in: {ex.Message}", credential.UserName);
                    if (credential is null) { note = "Windows in the VM didn't accept the sign-in."; break; }
                }
                catch (SessionScreenshotException ex) when (ex.Reason == SessionFailure.Unreachable)
                {
                    note = $"Couldn't reach Windows inside the VM: {ex.Message}";
                    break;
                }
                catch (SessionScreenshotException ex)
                {
                    // Windows accepted the sign-in; there was just no picture to take this time.
                    if (remember) Keep(vm, credential);
                    note = ex.Message;
                    break;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Anything else that went wrong inside the VM: still show what can be seen.
                    note = $"Couldn't take a picture inside the VM: {ex.Message}";
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

    private void Keep(VmInfo vm, GuestCredential credential)
    {
        try { credentials.Save(vm.Id, credential); }
        catch (System.ComponentModel.Win32Exception) { } // the picture still counts; it's asked for again next time
    }

    private void Forget(VmInfo vm)
    {
        try { credentials.Forget(vm.Id); }
        catch (System.ComponentModel.Win32Exception) { }
    }

    private (GuestCredential?, bool) Ask(VmInfo vm, string? why, string? userName)
    {
        if (AskSignIn?.Invoke(vm, why, userName) is { } answer)
        {
            _declined.Remove(vm.Id);
            return (answer.Credential, answer.Remember);
        }
        _declined.Add(vm.Id);
        return (null, false);
    }
}
