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

    private static string Ok(string info, string sessionName = "rdp-tcp#0", string? png = null) =>
        $$"""{"Status":"ok","Message":"","User":"vmuser","SessionName":"{{sessionName}}","Info":{{System.Text.Json.JsonSerializer.Serialize(info)}}}""" +
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
        var s = SessionCapture.Parse(Ok("﻿" + """{"Width":2,"Height":2,"Foreground":"Settings","Windows":"Settings"}""", "console"), DateTime.Now);
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
    public void Parse_NothingAtAll_IsUnreachable() =>
        Assert.Equal(SessionFailure.Unreachable, Assert.Throws<SessionScreenshotException>(() => SessionCapture.Parse("", DateTime.Now)).Reason);

    [Fact]
    public async Task TheScripts_AreValidPowerShell()
    {
        foreach (var script in new[] { SessionCapture.BuildScript("$vm = Get-VM -Id 'x'\n"), SessionCapture.GuestScript })
        {
            var check = $"$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput({Ps.Quote(script)}, [ref]$null, [ref]$errors); $errors.Count";
            Assert.Equal("0", (await PowerShellRunner.RunAsync(check, TestContext.Current.CancellationToken)).Trim());
        }
    }

    [Fact]
    public void TheSignIn_IsNeverOnTheCommandLine()
    {
        var script = SessionCapture.BuildScript("$vm = Get-VM -Id 'x'\n");
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
    private static async Task<(ScreenshotTaker taker, InMemoryCredentialStore store, VmInfo vm, List<string?> asked)> Setup(params SignInAnswer?[] answers)
    {
        var demo = new DemoHyperVService { Delay = TimeSpan.Zero };
        var vm = (await demo.GetVmsAsync(TestContext.Current.CancellationToken)).First(v => v.State == "Running");
        var store = new InMemoryCredentialStore();
        var asked = new List<string?>();
        var queue = new Queue<SignInAnswer?>(answers);
        var taker = new ScreenshotTaker(demo, store) { AskSignIn = (_, why) => { asked.Add(why); return queue.Count > 0 ? queue.Dequeue() : null; } };
        return (taker, store, vm, asked);
    }

    private static SignInAnswer Good(bool remember = true) => new(new GuestCredential("vmuser", "vmadmin"), remember);
    private static SignInAnswer Bad => new(new GuestCredential("vmuser", ""), true);

    [Fact]
    public async Task TheFirstTime_ItAsks_TakesTheSession_AndKeepsTheSignIn()
    {
        var (taker, store, vm, asked) = await Setup(Good());
        var picture = await taker.TakeAsync(vm);
        Assert.Equal([null], asked);
        Assert.Equal("Untitled - Notepad", picture.Info?.Foreground);
        Assert.Equal("vmadmin", store.Get(vm.Id)?.Password);

        await taker.TakeAsync(vm);
        Assert.Single(asked); // kept, so not asked again
    }

    [Fact]
    public async Task NotRemembered_IsUsedOnce_AndAskedForNextTime()
    {
        var (taker, store, vm, asked) = await Setup(Good(remember: false), Good(remember: false));
        Assert.NotNull((await taker.TakeAsync(vm)).Info);
        Assert.Null(store.Get(vm.Id));
        await taker.TakeAsync(vm);
        Assert.Equal(2, asked.Count);
    }

    [Fact]
    public async Task Declined_GivesTheVmsOwnScreen_SaysWhy_AndDoesntAskAgainThisTime()
    {
        var (taker, _, vm, asked) = await Setup();
        var picture = await taker.TakeAsync(vm);
        Assert.Null(picture.Info);
        Assert.Contains("Remote Desktop session in it can't be seen", picture.Note);
        await taker.TakeAsync(vm);
        Assert.Single(asked);
    }

    [Fact]
    public async Task ARefusedSignIn_IsForgotten_AndAskedForAgain_SayingWhy()
    {
        var (taker, store, vm, asked) = await Setup(Good());
        store.Save(vm.Id, new GuestCredential("vmuser", "")); // kept from before, now wrong
        var picture = await taker.TakeAsync(vm);
        Assert.NotNull(picture.Info);
        var why = Assert.Single(asked);
        Assert.Contains("didn't accept that sign-in", why);
        Assert.Equal("vmadmin", store.Get(vm.Id)?.Password);
    }

    [Fact]
    public async Task ARefusedSignIn_ThenDeclined_GivesTheVmsOwnScreen()
    {
        var (taker, store, vm, asked) = await Setup(Bad);
        var picture = await taker.TakeAsync(vm);
        Assert.Null(picture.Info);
        Assert.Equal("Windows in the VM didn't accept the sign-in.", picture.Note);
        Assert.Equal(2, asked.Count);
        Assert.Null(store.Get(vm.Id));
    }

    [Fact]
    public async Task AVmWithNoScreen_StillFails_WithHyperVsReason()
    {
        var demo = new DemoHyperVService { Delay = TimeSpan.Zero };
        var vm = (await demo.GetVmsAsync(TestContext.Current.CancellationToken)).First(v => v.State == "Off");
        var store = new InMemoryCredentialStore();
        store.Save(vm.Id, new GuestCredential("vmuser", "vmadmin"));
        var taker = new ScreenshotTaker(demo, store);
        await Assert.ThrowsAsync<HyperVException>(() => taker.TakeAsync(vm));
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
            "Open windows: *notes - Notepad; Settings"), ScreenshotViewModel.Describe(picture));
        var s = new ScreenshotViewModel(new DemoHyperVService(), new VmInfo("a") { Name = "vm2" }, picture);
        Assert.EndsWith(", *notes - Notepad in front", s.PictureName);
    }

    [Fact]
    public void WhatsOnScreen_ForTheVmsOwnScreen_SaysSo_AndWhy()
    {
        var picture = ScreenshotViewModelTests.Picture(DateTime.Now) with { Note = "Nobody is signed in to Windows in the VM." };
        var text = ScreenshotViewModel.Describe(picture);
        Assert.StartsWith("The VM's own screen, from Hyper-V.", text);
        Assert.EndsWith("Nobody is signed in to Windows in the VM.", text);
    }
}

[Collection("Wpf")]
public class GuestSignInWindowTests
{
    [StaFact]
    public void ItSaysWhyItAsks_OnTheBoxes_AndGivesWhatWasTyped()
    {
        TestApp.Ensure();
        var w = Views.GuestSignInWindow.Create(new VmInfo("a") { Name = "vm2" }, "Windows in vm2 didn't accept that sign-in: no.", "vmuser");
        Assert.Equal("Sign in to vm2 for screenshots", w.Title);
        var password = (System.Windows.Controls.PasswordBox)w.FindName("PasswordBox");
        var help = System.Windows.Automation.AutomationProperties.GetHelpText(password);
        Assert.StartsWith("Windows in vm2 didn't accept that sign-in", help);
        Assert.Contains("Remote Desktop", help);
        password.Password = "vmadmin";
        Assert.Equal(new SignInAnswer(new GuestCredential("vmuser", "vmadmin"), true), w.Answer);
        w.Close();
    }
}
