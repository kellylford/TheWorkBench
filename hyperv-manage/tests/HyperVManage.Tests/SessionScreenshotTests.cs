using HyperVManage.Models;
using HyperVManage.ViewModels;
using System.IO;
using HyperVManage.Services;
using Xunit;

namespace HyperVManage.Tests;

/// <summary>Reading what the session-screenshot script writes, and the script itself.</summary>
public class SessionCaptureTests
{
    private static readonly string Png = Convert.ToBase64String(ScreenshotViewModelTests.Picture(DateTime.Now).Png);

    private static string Ok(string info, bool remote = true, string? png = null) =>
        $$"""{"Status":"ok","Message":"","User":"vmuser","Remote":{{(remote ? "true" : "false")}},"Info":{{System.Text.Json.JsonSerializer.Serialize(info)}}}""" +
        "\r\n" + (png ?? Png) + "\r\n";

    [Fact]
    public void Parse_ReadsThePictureAndWhatIsOnScreen()
    {
        var taken = new DateTime(2026, 10, 6, 9, 0, 0);
        var s = SessionCapture.Parse(Ok("""
            {"Width":1920,"Height":1080,"Foreground":"*notes - Notepad","FocusName":"Text editor","FocusType":"document","Windows":["*notes - Notepad","Settings"]}
            """), taken);
        Assert.Equal((1920, 1080), (s.Picture.Width, s.Picture.Height));
        Assert.Equal(taken, s.Picture.Taken);
        Assert.Equal("vmuser", s.Info.User);
        Assert.True(s.Info.RemoteDesktop);
        Assert.Equal("*notes - Notepad", s.Info.Foreground);
        Assert.Equal("Text editor, document", s.Info.FocusText);
        Assert.Equal(["*notes - Notepad", "Settings"], s.Info.Windows);
    }

    [Fact]
    public void Parse_TheConsoleSession_IsNotRemoteDesktop_AndAOneWindowListIsStillAList()
    {
        // Windows PowerShell writes a one-item array as a bare string, and UTF-8 files from
        // Set-Content start with a byte order mark.
        var s = SessionCapture.Parse(Ok("﻿" + """{"Width":2,"Height":2,"Foreground":"Settings","Windows":"Settings"}""", remote: false), DateTime.Now);
        Assert.False(s.Info.RemoteDesktop);
        Assert.Equal(["Settings"], s.Info.Windows);
        Assert.Equal("", s.Info.FocusText);
    }

    [Theory]
    [InlineData("signin", SessionFailure.SignInRefused)]
    [InlineData("unreachable", SessionFailure.Unreachable)]
    [InlineData("nobody", SessionFailure.NobodySignedIn)]
    [InlineData("failed", SessionFailure.NotDrawn)]
    public void Parse_EachFailure_SaysWhichAndCarriesTheMessage(string status, SessionFailure reason)
    {
        var ex = Assert.Throws<SessionScreenshotException>(() =>
            SessionCapture.Parse($$"""{"Status":"{{status}}","Message":"why"}""", DateTime.Now));
        Assert.Equal(reason, ex.Reason);
        Assert.Equal("why", ex.Message);
    }

    [Fact]
    public void Parse_ASessionWindowsIsntDrawing_SaysSo_AndWhyItUsuallyIs()
    {
        var ex = Assert.Throws<SessionScreenshotException>(() => SessionCapture.Parse(
            Ok("""{"ShotError":"The handle is invalid","Foreground":"","Windows":[]}""").Split('\n')[0], DateTime.Now));
        Assert.Equal(SessionFailure.NotDrawn, ex.Reason);
        Assert.Contains("Remote Desktop session, most often because its window is minimized", ex.Message);
        Assert.Contains("The handle is invalid", ex.Message);
    }

    [Fact]
    public void Parse_AWarningBeforeTheAnswer_IsSkipped()
    {
        var s = SessionCapture.Parse("WARNING: something PowerShell wanted to say\r\n" +
            Ok("""{"Width":2,"Height":2,"Foreground":"Settings"}"""), DateTime.Now);
        Assert.Equal("Settings", s.Info.Foreground);
    }

    [Fact]
    public void Parse_AnErrorInsideTheSession_IsSaid_NotPassedOffAsALockedScreen()
    {
        var ex = Assert.Throws<SessionScreenshotException>(() => SessionCapture.Parse(
            Ok("""{"Error":"Cannot add type. Compilation is not allowed.","Windows":[]}""", remote: false), DateTime.Now));
        Assert.Equal(SessionFailure.NotDrawn, ex.Reason);
        Assert.Contains("Compilation is not allowed", ex.Message);
    }

    [Fact]
    public void Parse_AOneColorPicture_IsASessionWindowsIsntDrawing()
    {
        var black = Convert.ToBase64String(ScreenPicture.FromRgb565(new byte[8], 2, 2, DateTime.Now).Png);
        var ex = Assert.Throws<SessionScreenshotException>(() => SessionCapture.Parse(
            Ok("""{"Width":2,"Height":2}""", png: black), DateTime.Now));
        Assert.Equal(SessionFailure.NotDrawn, ex.Reason);
        Assert.Contains("most often because its window is minimized", ex.Message);
    }

    [Theory]
    [InlineData("{not json")]
    [InlineData("{\"Width\":2,")]
    public void Parse_ADamagedDescription_IsNotDrawn_NotACrash(string info) =>
        Assert.Equal(SessionFailure.NotDrawn, Assert.Throws<SessionScreenshotException>(() => SessionCapture.Parse(Ok(info), DateTime.Now)).Reason);

    [Fact]
    public void TheGuestScripts_ArePlainAscii_AndNeverDeleteRecursively()
    {
        // Windows PowerShell reads a script without a byte order mark as ANSI.
        Assert.All(SessionCapture.GuestScript + SessionCapture.GuestAdminScript + SessionCapture.HostScript, c => Assert.True(c < 128, $"'{c}'"));
        Assert.DoesNotContain("-Recurse", SessionCapture.GuestAdminScript);
        Assert.DoesNotContain("icacls", SessionCapture.GuestAdminScript);
        Assert.DoesNotContain("ProgramData", SessionCapture.GuestAdminScript);
        // Files the user could have put there are checked before they're read.
        Assert.Contains("ReparsePoint", SessionCapture.GuestAdminScript);
    }

    [Fact]
    public void Parse_NothingAtAll_IsUnreachable() =>
        Assert.Equal(SessionFailure.Unreachable, Assert.Throws<SessionScreenshotException>(() => SessionCapture.Parse("", DateTime.Now)).Reason);

    [Fact]
    public async Task TheScripts_AreValidPowerShell()
    {
        foreach (var script in new[] { SessionCapture.BuildScript("$vm = Get-VM -Id 'x'\n", "0123"), SessionCapture.GuestScript, SessionCapture.GuestAdminScript })
        {
            var check = $"$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput({Ps.Quote(script)}, [ref]$null, [ref]$errors); $errors.Count";
            Assert.Equal("0", (await PowerShellRunner.RunAsync(check, TestContext.Current.CancellationToken)).Trim());
        }
    }

    [Fact]
    public void TheSignIn_IsNeverOnTheCommandLine()
    {
        var script = SessionCapture.BuildScript("$vm = Get-VM -Id 'x'\n", "0123");
        Assert.Contains("$env:HVM_GUEST_PASSWORD", script);
        Assert.Contains("Remove-Item Env:HVM_GUEST_PASSWORD", script);
        Assert.DoesNotContain("GuestCredential", new GuestCredential("vmuser", "secret").ToString().Replace("GuestCredential {", ""));
        Assert.DoesNotContain("secret", new GuestCredential("vmuser", "secret").ToString());
    }

    public static string? RealVm => Environment.GetEnvironmentVariable("HYPERVMANAGE_SESSION_VM");
    public static bool HasRealVm => !string.IsNullOrEmpty(RealVm);

    /// <summary>
    /// Against a real running VM with someone signed in: HYPERVMANAGE_SESSION_VM is its name, and
    /// HYPERVMANAGE_SESSION_USER and HYPERVMANAGE_SESSION_PASSWORD its administrator sign-in.
    /// It leaves the picture in the temp folder to look at.
    /// </summary>
    [Fact(Skip = "Set HYPERVMANAGE_SESSION_VM, _USER and _PASSWORD to run it against a real VM.", SkipUnless = nameof(HasRealVm))]
    public async Task ARealVm_GivesThePictureOfItsSignedInSession()
    {
        var ct = TestContext.Current.CancellationToken;
        var id = (await PowerShellRunner.RunAsync($"(Get-VM -Name {Ps.Quote(RealVm!)}).Id.ToString()", ct)).Trim();
        var credential = new GuestCredential(Environment.GetEnvironmentVariable("HYPERVMANAGE_SESSION_USER")!,
            Environment.GetEnvironmentVariable("HYPERVMANAGE_SESSION_PASSWORD")!);
        var shot = await new PowerShellHyperVService().TakeSessionScreenshotAsync(id, credential, ct);
        File.WriteAllBytes(Path.Combine(Path.GetTempPath(), "hyperv-manage-session-test.png"), shot.Picture.Png);
        Assert.True(shot.Picture.Width > 0);
        Assert.Equal(shot.Picture.Width, shot.Picture.ToBitmap().PixelWidth);
        Assert.NotEmpty(shot.Info.User);

        var wrong = await Assert.ThrowsAsync<SessionScreenshotException>(() =>
            new PowerShellHyperVService().TakeSessionScreenshotAsync(id, credential with { Password = credential.Password + "-wrong" }, ct));
        Assert.Equal(SessionFailure.SignInRefused, wrong.Reason);
    }
}

/// <summary>Which picture Screenshot takes, and when it asks for the VM's sign-in.</summary>
public class ScreenshotTakerTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static async Task<(ScreenshotTaker taker, InMemoryCredentialStore store, VmInfo vm, List<string?> asked)> Setup(params SignInAnswer?[] answers)
    {
        var demo = new DemoHyperVService { Delay = TimeSpan.Zero };
        var vm = (await demo.GetVmsAsync(TestContext.Current.CancellationToken)).First(v => v.State == "Running");
        var store = new InMemoryCredentialStore();
        var asked = new List<string?>();
        var queue = new Queue<SignInAnswer?>(answers);
        var taker = new ScreenshotTaker(demo, store)
        {
            AskSignIn = (_, why, user) => { asked.Add(why); Users.Add(user); return queue.Count > 0 ? queue.Dequeue() : null; },
        };
        return (taker, store, vm, asked);
    }

    private static readonly System.Threading.ThreadLocal<List<string?>> UsersLocal = new(() => []);
    private static List<string?> Users => UsersLocal.Value!;

    private static SignInAnswer Good(bool remember = true) => new(new GuestCredential("vmuser", "vmadmin"), remember);
    private static SignInAnswer Bad => new(new GuestCredential("vmuser", ""), true);

    [Fact]
    public async Task TheFirstTime_ItAsks_TakesTheSession_AndKeepsTheSignIn()
    {
        var (taker, store, vm, asked) = await Setup(Good());
        var picture = await taker.TakeAsync(vm, Ct);
        Assert.Equal([null], asked);
        Assert.Equal("Untitled - Notepad", picture.Info?.Foreground);
        Assert.Equal("vmadmin", store.Get(vm.Id)?.Password);

        await taker.TakeAsync(vm, Ct);
        Assert.Single(asked); // kept, so not asked again
    }

    [Fact]
    public async Task NotRemembered_IsUsedOnce_AndAskedForNextTime()
    {
        var (taker, store, vm, asked) = await Setup(Good(remember: false), Good(remember: false));
        Assert.NotNull((await taker.TakeAsync(vm, Ct)).Info);
        Assert.Null(store.Get(vm.Id));
        await taker.TakeAsync(vm, Ct);
        Assert.Equal(2, asked.Count);
    }

    [Fact]
    public async Task Declined_GivesTheVmsOwnScreen_SaysWhy_AndDoesntAskAgainThisTime()
    {
        var (taker, _, vm, asked) = await Setup();
        var picture = await taker.TakeAsync(vm, Ct);
        Assert.Null(picture.Info);
        Assert.Contains("Remote Desktop session in it can't be seen", picture.Note);
        await taker.TakeAsync(vm, Ct);
        Assert.Single(asked);
    }

    [Fact]
    public async Task ARefusedSignIn_IsReplaced_ByOneThatWorks_AfterAskingAgainSayingWhy()
    {
        var (taker, store, vm, asked) = await Setup(Good());
        store.Save(vm.Id, new GuestCredential("vmuser", "")); // kept from before, now wrong
        var picture = await taker.TakeAsync(vm, Ct);
        Assert.NotNull(picture.Info);
        var why = Assert.Single(asked);
        Assert.Contains("didn't accept that sign-in", why);
        Assert.Equal("vmadmin", store.Get(vm.Id)?.Password);
    }

    [Fact]
    public async Task ARefusedSignIn_ThenEscape_KeepsTheSavedOne()
    {
        // Refused can mean the VM is still starting: Escape mustn't lose a sign-in that may be right.
        var (taker, store, vm, _) = await Setup();
        store.Save(vm.Id, new GuestCredential("vmuser", ""));
        Assert.Null((await taker.TakeAsync(vm, Ct)).Info);
        Assert.NotNull(store.Get(vm.Id));
    }

    [Fact]
    public async Task ARefusedSignIn_ReplacedByOneNotToBeKept_IsForgotten()
    {
        var (taker, store, vm, _) = await Setup(Good(remember: false));
        store.Save(vm.Id, new GuestCredential("vmuser", ""));
        Assert.NotNull((await taker.TakeAsync(vm, Ct)).Info);
        Assert.Null(store.Get(vm.Id));
    }

    [Fact]
    public async Task ARefusedSignIn_ThenDeclined_GivesTheVmsOwnScreen()
    {
        var (taker, store, vm, asked) = await Setup(Bad);
        var picture = await taker.TakeAsync(vm, Ct);
        Assert.Null(picture.Info);
        Assert.Equal("Windows in the VM didn't accept the sign-in.", picture.Note);
        Assert.Equal(2, asked.Count);
        Assert.Null(store.Get(vm.Id));
    }

    [Fact]
    public async Task AskedAgain_KeepsTheUserNameThatWasTyped()
    {
        Users.Clear();
        var (taker, _, vm, _) = await Setup(new SignInAnswer(new GuestCredential("admin", ""), true), null);
        await taker.TakeAsync(vm, Ct);
        Assert.Equal([null, "admin"], Users);
    }

    [Fact]
    public async Task Declined_ThenTakeAgain_AsksAgain()
    {
        var (taker, _, vm, asked) = await Setup(null, Good());
        Assert.Null((await taker.TakeAsync(vm, Ct)).Info);
        Assert.NotNull((await taker.TakeAsync(vm, Ct, askEvenIfDeclined: true)).Info);
        Assert.Equal(2, asked.Count);
    }

    [Theory]
    [InlineData(SessionFailure.NotDrawn, true)]
    [InlineData(SessionFailure.NobodySignedIn, true)]
    [InlineData(SessionFailure.Unreachable, false)]
    public async Task ASignInWindowsAccepted_IsKept_EvenWhenThereWasNoPictureToTake(SessionFailure failure, bool kept)
    {
        var flaky = new Flaky(new SessionScreenshotException(failure, "no picture"));
        var vm = (await flaky.GetVmsAsync(Ct)).First(v => v.State == "Running");
        var store = new InMemoryCredentialStore();
        var taker = new ScreenshotTaker(flaky, store) { AskSignIn = (_, _, _) => Good() };
        var picture = await taker.TakeAsync(vm, Ct);
        Assert.Null(picture.Info);
        Assert.Contains("no picture", picture.Note);
        Assert.Equal(kept, store.Get(vm.Id) is not null);
    }

    [Fact]
    public async Task AnythingElseGoingWrongInsideTheVm_StillGivesTheVmsOwnScreen()
    {
        var flaky = new Flaky(new HyperVException("Register-ScheduledTask: Access is denied."));
        var vm = (await flaky.GetVmsAsync(Ct)).First(v => v.State == "Running");
        var store = new InMemoryCredentialStore();
        store.Save(vm.Id, new GuestCredential("vmuser", "vmadmin"));
        var picture = await new ScreenshotTaker(flaky, store).TakeAsync(vm, Ct);
        Assert.Null(picture.Info);
        Assert.Equal("Couldn't take a picture inside the VM: Register-ScheduledTask: Access is denied.", picture.Note);
    }

    [Fact]
    public async Task Cancelled_IsNotTurnedIntoAPicture()
    {
        var flaky = new Flaky(new OperationCanceledException());
        var vm = (await flaky.GetVmsAsync(Ct)).First(v => v.State == "Running");
        var store = new InMemoryCredentialStore();
        store.Save(vm.Id, new GuestCredential("vmuser", "vmadmin"));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new ScreenshotTaker(flaky, store).TakeAsync(vm, Ct));
    }

    /// <summary>The demo, except that a picture from inside the VM always fails as given.</summary>
    private sealed class Flaky(Exception failure) : IHyperVService
    {
        private readonly DemoHyperVService _demo = new() { Delay = TimeSpan.Zero };
        public Task<SessionScreenshot> TakeSessionScreenshotAsync(string vmId, GuestCredential credential, CancellationToken ct = default) => Task.FromException<SessionScreenshot>(failure);
        public Task<IReadOnlyList<VmInfo>> GetVmsAsync(CancellationToken ct = default) => _demo.GetVmsAsync(ct);
        public Task<IReadOnlyList<SwitchInfo>> GetSwitchesAsync(CancellationToken ct = default) => _demo.GetSwitchesAsync(ct);
        public Task RunActionAsync(VmAction action, string vmId, CancellationToken ct = default) => _demo.RunActionAsync(action, vmId, ct);
        public Task ApplySettingsAsync(string vmId, VmSettings current, VmSettings wanted, CancellationToken ct = default) => _demo.ApplySettingsAsync(vmId, current, wanted, ct);
        public Task CreateCheckpointAsync(string vmId, string checkpointName, CancellationToken ct = default) => _demo.CreateCheckpointAsync(vmId, checkpointName, ct);
        public Task<IReadOnlyList<CheckpointInfo>> GetCheckpointsAsync(string vmId, CancellationToken ct = default) => _demo.GetCheckpointsAsync(vmId, ct);
        public Task ApplyCheckpointAsync(string vmId, string checkpointId, string? saveCurrentAs, CancellationToken ct = default) => _demo.ApplyCheckpointAsync(vmId, checkpointId, saveCurrentAs, ct);
        public Task CloneAsync(string vmId, string newName, CancellationToken ct = default) => _demo.CloneAsync(vmId, newName, ct);
        public Task<IReadOnlyList<string>> GetDiskPathsAsync(string vmId, CancellationToken ct = default) => _demo.GetDiskPathsAsync(vmId, ct);
        public Task<DeleteResult> DeleteAsync(string vmId, CancellationToken ct = default) => _demo.DeleteAsync(vmId, ct);
        public Task<string> CreateExternalSwitchAsync(CancellationToken ct = default) => _demo.CreateExternalSwitchAsync(ct);
        public Task ConnectAsync(VmInfo vm, CancellationToken ct = default) => _demo.ConnectAsync(vm, ct);
        public void OpenConsole(VmInfo vm) => _demo.OpenConsole(vm);
        public Task<SavedConnection> SaveConnectionFileAsync(VmInfo vm, CancellationToken ct = default) => _demo.SaveConnectionFileAsync(vm, ct);
        public Task<ScreenPicture> TakeScreenshotAsync(string vmId, CancellationToken ct = default) => _demo.TakeScreenshotAsync(vmId, ct);
    }

    [Fact]
    public void WindowsCredentialManager_KeepsReturnsAndForgetsASignIn()
    {
        var store = new WindowsCredentialStore();
        var id = "test-" + Guid.NewGuid().ToString("N");
        try
        {
            Assert.Null(store.Get(id));
            store.Save(id, new GuestCredential("vmuser", "p\u00e4ss w\u00f6rd \"'$"));
            Assert.Equal(new GuestCredential("vmuser", "p\u00e4ss w\u00f6rd \"'$"), store.Get(id));
            store.Save(id, new GuestCredential("admin", ""));
            Assert.Equal(new GuestCredential("admin", ""), store.Get(id));
        }
        finally { store.Forget(id); }
        Assert.Null(store.Get(id));
        store.Forget(id); // forgetting what isn't there is fine
    }

    [Fact]
    public async Task AVmWithNoScreen_StillFails_WithHyperVsReason()
    {
        var demo = new DemoHyperVService { Delay = TimeSpan.Zero };
        var vm = (await demo.GetVmsAsync(TestContext.Current.CancellationToken)).First(v => v.State == "Off");
        var store = new InMemoryCredentialStore();
        store.Save(vm.Id, new GuestCredential("vmuser", "vmadmin"));
        var taker = new ScreenshotTaker(demo, store);
        await Assert.ThrowsAsync<HyperVException>(() => taker.TakeAsync(vm, Ct));
    }

    [Fact]
    public void WhatsOnScreen_ForASession_SaysWhoseItIs_WhatsInFront_AndWhatHasFocus()
    {
        var picture = ScreenshotViewModelTests.Picture(DateTime.Now) with
        {
            Info = new ScreenInfo("vmuser", true, "*notes - Notepad", "Text editor", "document", ["*notes - Notepad", "Settings"]),
        };
        Assert.Equal(string.Join(Environment.NewLine,
            "vmuser's Remote Desktop session.", "In front: *notes - Notepad", "Focus: Text editor, document",
            "Open windows: *notes - Notepad; Settings", ScreenshotViewModel.FromAccessibilityTree), ScreenshotViewModel.Describe(picture));
        Assert.Contains("accessibility tree", ScreenshotViewModel.FromAccessibilityTree);
        var s = new ScreenshotViewModel(new DemoHyperVService(), new VmInfo("a") { Name = "vm2" }, picture);
        Assert.EndsWith(", *notes - Notepad in front", s.PictureName);
    }

    [Fact]
    public void WhatsOnScreen_ForTheVmsOwnScreen_SaysSo_AndWhy()
    {
        var picture = ScreenshotViewModelTests.Picture(DateTime.Now) with { Note = "Nobody is signed in to Windows in the VM." };
        var text = ScreenshotViewModel.Describe(picture);
        Assert.StartsWith("The VM's own screen, from Hyper-V.", text);
        Assert.DoesNotContain("accessibility tree", text); // nothing was read from it
        Assert.EndsWith("Nobody is signed in to Windows in the VM.", text);
    }

    [Fact]
    public void WhatsOnScreen_WhenTheTreeCouldntBeRead_DoesntClaimItWas()
    {
        // A hung app can stop UI Automation; then only the window title came back.
        var picture = ScreenshotViewModelTests.Picture(DateTime.Now) with
        {
            Info = new ScreenInfo("vmuser", true, "*notes - Notepad", "", "", []),
        };
        var text = ScreenshotViewModel.Describe(picture);
        Assert.Contains("In front: *notes - Notepad", text);
        Assert.DoesNotContain("accessibility tree", text);
    }
}

[Collection("Wpf")]
public class GuestSignInWindowTests
{
    [StaFact]
    public void TheBoxesSayLittle_TheWindowExplains_AndAReAskHasItsReasonToSpeak()
    {
        TestApp.Ensure();
        var why = "Windows in vm2 didn't accept that sign-in: no.";
        var w = Views.GuestSignInWindow.Create(new VmInfo("a") { Name = "vm2" }, why, "vmuser");
        Assert.Equal("Sign in to vm2 for screenshots", w.Title);
        var user = (System.Windows.Controls.TextBox)w.FindName("UserBox");
        var password = (System.Windows.Controls.PasswordBox)w.FindName("PasswordBox");
        foreach (var box in new System.Windows.Controls.Control[] { user, password })
        {
            var peer = System.Windows.Automation.Peers.UIElementAutomationPeer.CreatePeerForElement(box);
            Assert.InRange(peer.GetHelpText().Length, 1, 40); // a hint, not the explanation
        }
        Assert.Equal("User name", System.Windows.Automation.Peers.UIElementAutomationPeer.CreatePeerForElement(user).GetName());
        Assert.Equal("Password", System.Windows.Automation.Peers.UIElementAutomationPeer.CreatePeerForElement(password).GetName());
        Assert.Equal(why, ((System.Windows.Controls.TextBlock)w.FindName("WhyText")).Text);
        Assert.Contains("Remote Desktop", ((System.Windows.Controls.TextBlock)w.FindName("NoteText")).Text);
        Assert.Equal(why, w.OpeningAnnouncement);
        Assert.Null(Views.GuestSignInWindow.Create(new VmInfo("a") { Name = "vm2" }, null, "vmuser").OpeningAnnouncement);
        password.Password = "vmadmin";
        Assert.Equal(new SignInAnswer(new GuestCredential("vmuser", "vmadmin"), true), w.Answer);
        w.Close();
    }
}
