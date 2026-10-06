using System.IO;
using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using HyperVManage.Models;
using HyperVManage.Services;
using HyperVManage.ViewModels;
using HyperVManage.Views;
using Xunit;

namespace HyperVManage.Tests;

/// <summary>Turning what Hyper-V gives into a picture.</summary>
public class ScreenPictureTests
{
    // Red, green, blue and white, as RGB565 in little-endian order, one row of two above another.
    private static readonly byte[] TwoByTwo = [0x00, 0xF8, 0xE0, 0x07, 0x1F, 0x00, 0xFF, 0xFF];

    private static byte[] WithHeader(byte[] pixels)
    {
        var data = new byte[pixels.Length + 4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(data, (uint)data.Length);
        pixels.CopyTo(data, 4);
        return data;
    }

    /// <summary>Each pixel of the PNG as (red, green, blue).</summary>
    internal static (byte R, byte G, byte B)[] Pixels(ScreenPicture picture)
    {
        var bitmap = new FormatConvertedBitmap(picture.ToBitmap(), PixelFormats.Bgr24, null, 0);
        var bytes = new byte[bitmap.PixelWidth * bitmap.PixelHeight * 3];
        bitmap.CopyPixels(bytes, bitmap.PixelWidth * 3, 0);
        return Enumerable.Range(0, bytes.Length / 3).Select(i => (bytes[i * 3 + 2], bytes[i * 3 + 1], bytes[i * 3])).ToArray();
    }

    [Fact]
    public void HyperVsLengthHeader_IsDropped_AndTheColorsComeThrough()
    {
        var picture = ScreenPicture.FromRgb565(WithHeader(TwoByTwo), 2, 2, DateTime.Now);
        Assert.Equal((2, 2), (picture.Width, picture.Height));
        Assert.Equal([(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255)], Pixels(picture));
    }

    [Fact]
    public void PixelsWithoutAHeader_AreUsedAsTheyAre()
    {
        var picture = ScreenPicture.FromRgb565(TwoByTwo, 2, 2, DateTime.Now);
        Assert.Equal([(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255)], Pixels(picture));
    }

    [Fact]
    public void FourExtraBytesThatAreNotTheLength_AreRefused_RatherThanShiftingThePicture()
    {
        var data = WithHeader(TwoByTwo);
        data[3] ^= 1;
        Assert.Throws<HyperVException>(() => ScreenPicture.FromRgb565(data, 2, 2, DateTime.Now));
    }

    [Theory]
    [InlineData(2, 3)]
    [InlineData(3, 2)]
    [InlineData(0, 2)]
    [InlineData(2, -1)]
    public void ASizeThePixelsDontFit_IsRefused(int width, int height) =>
        Assert.Throws<HyperVException>(() => ScreenPicture.FromRgb565(TwoByTwo, width, height, DateTime.Now));

    [Fact]
    public void APictureOfOneColor_IsBlank_AndOneWithAnyOtherPixel_IsNot()
    {
        byte[] black = [0, 0, 0, 0, 0, 0, 0, 0];
        Assert.True(ScreenPicture.FromRgb565(WithHeader(black), 2, 2, DateTime.Now).IsBlank);
        Assert.True(ScreenPicture.FromRgb565([0x1F, 0x00], 1, 1, DateTime.Now).IsBlank);
        black[7] = 1; // the very last pixel differs
        Assert.False(ScreenPicture.FromRgb565(black, 2, 2, DateTime.Now).IsBlank);
        Assert.False(ScreenPicture.FromRgb565(TwoByTwo, 2, 2, DateTime.Now).IsBlank);
    }

    [Fact]
    public void ABlankPicture_IsSaidToBeBlank_InItsNameAndTheStatus()
    {
        var vm = new VmInfo("a") { Name = "Win11-RDP", State = "Running" };
        var blank = ScreenPicture.FromRgb565(new byte[8], 2, 2, new DateTime(2026, 10, 6, 15, 42, 10));
        var s = new ScreenshotViewModel(new DemoHyperVService(), vm, blank);
        Assert.EndsWith(", 2 by 2, the VM's own screen, blank, the whole screen is one color", s.PictureName);
        s.Show(blank);
        Assert.EndsWith("It's blank, the whole screen is one color.", s.StatusText);
    }

    [Fact]
    public void ThePng_IsARealPngFile()
    {
        var png = ScreenPicture.FromRgb565(TwoByTwo, 2, 2, DateTime.Now).Png;
        Assert.Equal(new byte[] { 0x89, (byte)'P', (byte)'N', (byte)'G' }, png[..4]);
    }

    [Fact]
    public async Task Conversion_WorksOffTheUiThread_AsTheServiceDoesIt()
    {
        var picture = await Task.Run(() => ScreenPicture.FromRgb565(WithHeader(TwoByTwo), 2, 2, DateTime.Now));
        Assert.Equal(4, Pixels(picture).Length);
    }

    [Fact]
    public void Parse_ReadsTheScriptsJson()
    {
        var json = $$"""{"Width":2,"Height":2,"Data":"{{Convert.ToBase64String(WithHeader(TwoByTwo))}}"}""" + "\r\n";
        var taken = new DateTime(2026, 10, 6, 15, 42, 10);
        var picture = ScreenPicture.Parse(json, taken);
        Assert.Equal(taken, picture.Taken);
        Assert.Equal((255, 0, 0), Pixels(picture)[0]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("[]")]
    [InlineData("""{"Width":2,"Height":2}""")]
    public void Parse_WithNoPicture_SaysSo(string json) =>
        Assert.Throws<HyperVException>(() => ScreenPicture.Parse(json, DateTime.Now));

    [Theory]
    [InlineData("Running", true)]
    [InlineData("Paused", true)]
    [InlineData("Off", false)]
    [InlineData("Saved", false)]
    [InlineData("Starting", false)]
    public void OnlyARunningOrPausedVm_HasAScreen(string state, bool expected) =>
        Assert.Equal(expected, VmStates.CanScreenshot(state));

    /// <summary>
    /// Runs the real script with Hyper-V's CIM calls replaced by functions that refuse any picture
    /// larger than maxW by maxH, as Hyper-V refuses one larger than the screen.
    /// </summary>
    private static Task<string> RunScriptAgainst(string head, int maxW, int maxH, bool empty = false) =>
        PowerShellRunner.RunAsync($$"""
            $vm = [pscustomobject]@{ Id = '61179975-5f1c-4ee0-a830-c0271cc52f50'; Name = 'Lab' }
            function Get-CimInstance { [CmdletBinding()] param($Namespace, $ClassName, $Filter) [pscustomobject]@{ Name = 'x' } }
            function Get-CimAssociatedInstance { [CmdletBinding()] param($InputObject, $ResultClassName)
                if ($ResultClassName -eq 'Msvm_VideoHead') { {{head}} }
                else { [pscustomobject]@{ VirtualSystemType = 'Microsoft:Hyper-V:System:Realized' } } }
            function Invoke-CimMethod { [CmdletBinding()] param($InputObject, $MethodName, $Arguments)
                $w = [int]$Arguments.WidthPixels; $h = [int]$Arguments.HeightPixels
                if ($w -le {{maxW}} -and $h -le {{maxH}}) {
                    [pscustomobject]@{ ReturnValue = 0; ImageData = $(if ({{(empty ? "$true" : "$false")}}) { $null } else { [byte[]]::new($w * $h * 2) }) }
                } else { [pscustomobject]@{ ReturnValue = 32775; ImageData = $null } } }

            """ + PowerShellHyperVService.ScreenshotScript, TestContext.Current.CancellationToken);

    private const string Head1920 = "[pscustomobject]@{ CurrentHorizontalResolution = 1920; CurrentVerticalResolution = 1080 }";

    [Theory]
    [InlineData(Head1920, 1920, 1080, 1920, 1080)] // the screen's own size
    [InlineData(Head1920, 1366, 768, 1024, 576)]   // refused: the same shape within 1024 by 768
    [InlineData("[pscustomobject]@{ CurrentHorizontalResolution = 800; CurrentVerticalResolution = 600 }", 800, 600, 800, 600)]
    [InlineData("$null", 800, 600, 640, 480)]       // no size to read, and 1024 by 768 refused
    [InlineData(Head1920, 700, 500, 640, 480)]
    public async Task TheScript_AsksForTheScreensSize_ThenSmaller(string head, int maxW, int maxH, int w, int h)
    {
        var picture = ScreenPicture.Parse(await RunScriptAgainst(head, maxW, maxH), DateTime.Now);
        Assert.Equal((w, h), (picture.Width, picture.Height));
    }

    [Fact]
    public async Task TheScript_RefusedAtEverySize_SaysWhichAndWhy()
    {
        var ex = await Assert.ThrowsAsync<HyperVException>(() => RunScriptAgainst(Head1920, 100, 100));
        Assert.Equal("Hyper-V wouldn't give a picture at any size it was asked for: 1920 by 1080 (error 32775), " +
                     "1024 by 576 (error 32775), 640 by 480 (error 32775).", ex.Message.Trim());
        ex = await Assert.ThrowsAsync<HyperVException>(() => RunScriptAgainst("$null", 5000, 5000, empty: true));
        Assert.Contains("1024 by 768 (an empty picture)", ex.Message);
    }

    [Fact]
    public async Task TheScreenshotScript_IsValidPowerShell()
    {
        var script = $"$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput({Ps.Quote(PowerShellHyperVService.ScreenshotScript)}, [ref]$null, [ref]$errors); $errors.Count";
        var result = await PowerShellRunner.RunAsync(script, TestContext.Current.CancellationToken);
        Assert.Equal("0", result.Trim());
    }

    public static string? RealVm => Environment.GetEnvironmentVariable("HYPERVMANAGE_SCREENSHOT_VM");
    public static bool HasRealVm => !string.IsNullOrEmpty(RealVm);

    /// <summary>Against a real running VM, named by HYPERVMANAGE_SCREENSHOT_VM. It only looks.</summary>
    [Fact(Skip = "Set HYPERVMANAGE_SCREENSHOT_VM to the name of a running VM to run it.", SkipUnless = nameof(HasRealVm))]
    public async Task ARealVm_GivesAPictureOfItsWholeScreen()
    {
        var ct = TestContext.Current.CancellationToken;
        var info = (await PowerShellRunner.RunAsync(
            $"$v = Get-VM -Name {Ps.Quote(RealVm!)}; $h = Get-CimAssociatedInstance -InputObject (Get-CimInstance -Namespace root\\virtualization\\v2 -ClassName Msvm_ComputerSystem -Filter \"Name='$($v.Id)'\") -ResultClassName Msvm_VideoHead | Select-Object -First 1; \"$($v.Id) $($h.CurrentHorizontalResolution) $($h.CurrentVerticalResolution)\"", ct)).Trim().Split(' ');
        var picture = await new PowerShellHyperVService().TakeScreenshotAsync(info[0], ct);
        Assert.Equal(int.Parse(info[1]), picture.Width);
        Assert.Equal(int.Parse(info[2]), picture.Height);
        // Blank exactly when every pixel is the same; a VM whose display is asleep is really blank.
        Assert.Equal(Pixels(picture).Distinct().Count() == 1, picture.IsBlank);
        // Left in the temp folder to look at.
        File.WriteAllBytes(Path.Combine(Path.GetTempPath(), "hyperv-manage-screenshot-test.png"), picture.Png);
    }
}

public class ScreenshotViewModelTests
{
    private static DemoHyperVService Demo() => new() { Delay = TimeSpan.Zero };

    private static async Task<(DemoHyperVService demo, MainViewModel main, VmInfo running)> Load()
    {
        var demo = Demo();
        var main = new MainViewModel(demo);
        await main.RefreshAsync();
        return (demo, main, main.Vms.First(v => v.State == "Running"));
    }

    [Fact]
    public async Task Screenshot_IsOnlyOfferedForARunningOrPausedVm_EvenWhileBusy()
    {
        var (_, main, running) = await Load();
        main.Selected = running;
        Assert.True(main.ScreenshotCommand.CanExecute(null));
        running.IsBusy = true;
        Assert.True(main.ScreenshotCommand.CanExecute(null));
        main.Selected = main.Vms.First(v => v.State == "Off");
        Assert.False(main.ScreenshotCommand.CanExecute(null));
        main.Selected = main.Vms.First(v => v.State == "Saved");
        Assert.False(main.ScreenshotCommand.CanExecute(null));
    }

    [Fact]
    public async Task Screenshot_HandsThePictureToTheWindow()
    {
        var (_, main, running) = await Load();
        main.Selected = running;
        (VmInfo vm, ScreenPicture picture)? shown = null;
        main.ShowScreenshot = (v, p) => shown = (v, p);
        await main.ScreenshotCommand.ExecuteAsync(null);
        Assert.Same(running, shown?.vm);
        Assert.Equal(1024, shown?.picture.Width);
        Assert.Contains("Took a picture", main.StatusText);
    }

    [Fact]
    public async Task Screenshot_ThatFails_IsSpoken_AndNoWindowOpens()
    {
        var (demo, main, running) = await Load();
        main.Selected = running;
        // Turned off behind the list's back, as if from Hyper-V Manager.
        await demo.RunActionAsync(VmAction.TurnOff, running.Id, TestContext.Current.CancellationToken);
        var spoken = new List<string>();
        main.Announce += spoken.Add;
        var opened = false;
        main.ShowScreenshot = (_, _) => opened = true;
        await main.ScreenshotCommand.ExecuteAsync(null);
        Assert.False(opened);
        Assert.Equal(2, spoken.Count);
        Assert.Equal($"Taking a picture of {running.Name}'s screen.", spoken[0]);
        Assert.StartsWith($"Couldn't take a picture of {running.Name}'s screen. Hyper-V wouldn't give a picture", spoken[1]);
    }

    [Fact]
    public void PictureName_SaysWhoseScreen_WhenToTheSecond_AndItsSize()
    {
        var vm = new VmInfo("a") { Name = "Win11-RDP", State = "Running" };
        var taken = new DateTime(2026, 10, 6, 15, 42, 10);
        var s = new ScreenshotViewModel(Demo(), vm, Picture(taken));
        Assert.Equal($"Screen of Win11-RDP, taken {taken:T}, 2 by 2, the VM's own screen", s.PictureName);
        Assert.Equal("Screen of Win11-RDP", s.Title);
    }

    [Fact]
    public void SuggestedFileName_HasTheTime_AndNothingWindowsRefuses()
    {
        var vm = new VmInfo("a") { Name = "Lab: \"A\"/B", State = "Running" };
        var s = new ScreenshotViewModel(Demo(), vm, Picture(new DateTime(2026, 10, 6, 15, 42, 10)));
        Assert.Equal("Lab_ _A__B screen 2026-10-06 15.42.10.png", s.SuggestedFileName);
    }

    [Fact]
    public async Task TakeAgain_ShowsTheNewPicture_AndSaysItIsNew()
    {
        var (demo, _, running) = await Load();
        var old = Picture(DateTime.Now.AddMinutes(-5));
        var s = new ScreenshotViewModel(demo, running, old);
        var replaced = 0;
        s.PictureReplaced += () => replaced++;
        var names = new List<string>();
        s.PropertyChanged += (_, e) => names.Add(e.PropertyName!);
        await s.TakeAgainCommand.ExecuteAsync(null);
        Assert.NotSame(old, s.Picture);
        Assert.Equal(1024, s.Image.PixelWidth);
        Assert.Equal(1, replaced);
        Assert.Contains(nameof(ScreenshotViewModel.PictureName), names);
        Assert.StartsWith("New picture taken at", s.StatusText);
        Assert.False(s.IsTaking);
    }

    [Fact]
    public async Task TakeAgain_ThatFails_KeepsTheOldPicture_AndSaysWhichOneItIs()
    {
        var (demo, _, running) = await Load();
        await demo.RunActionAsync(VmAction.TurnOff, running.Id, TestContext.Current.CancellationToken);
        var old = Picture(new DateTime(2026, 10, 6, 15, 42, 10));
        var s = new ScreenshotViewModel(demo, running, old);
        var spoken = new List<string>();
        s.Announce += spoken.Add;
        var replaced = false;
        s.PictureReplaced += () => replaced = true;
        await s.TakeAgainCommand.ExecuteAsync(null);
        Assert.Same(old, s.Picture);
        Assert.False(replaced);
        var said = Assert.Single(spoken);
        Assert.Contains("Couldn't take a new picture", said);
        Assert.EndsWith($"This is still the one from {old.Taken:T}.", said);
        Assert.True(s.TakeAgainCommand.CanExecute(null));
    }

    [Fact]
    public async Task TakeAgain_PressedAgainWhileTaking_DoesNothing_ButStaysEnabled()
    {
        // Disabling the button that has focus would drop keyboard focus onto the bare window.
        var demo = new DemoHyperVService { Delay = TimeSpan.FromMilliseconds(300) };
        var main = new MainViewModel(demo);
        await main.RefreshAsync();
        var s = new ScreenshotViewModel(demo, main.Vms.First(v => v.State == "Running"), Picture(DateTime.Now));
        var taking = s.TakeAgainCommand.ExecuteAsync(null);
        Assert.True(s.IsTaking);
        Assert.True(s.TakeAgainCommand.CanExecute(null));
        Assert.True(s.TakeAgainCommand.ExecuteAsync(null).IsCompleted);
        await taking;
        Assert.False(s.IsTaking);
    }

    [Fact]
    public async Task TakeAgain_AfterTheViewerCloses_ShowsNothing()
    {
        var demo = new DemoHyperVService { Delay = TimeSpan.FromMilliseconds(300) };
        var main = new MainViewModel(demo);
        await main.RefreshAsync();
        var old = Picture(DateTime.Now);
        var s = new ScreenshotViewModel(demo, main.Vms.First(v => v.State == "Running"), old);
        var spoken = new List<string>();
        s.Announce += spoken.Add;
        var replaced = false;
        s.PictureReplaced += () => replaced = true;
        var taking = s.TakeAgainCommand.ExecuteAsync(null);
        s.Dispose();
        await taking;
        Assert.Same(old, s.Picture);
        Assert.False(replaced);
        Assert.Empty(spoken);
    }

    [Fact]
    public void ARename_ReachesTheTitleAndPictureName_UntilTheViewerCloses()
    {
        var vm = new VmInfo("a") { Name = "Old", State = "Running" };
        var s = new ScreenshotViewModel(Demo(), vm, Picture(DateTime.Now));
        var changed = new List<string>();
        s.PropertyChanged += (_, e) => changed.Add(e.PropertyName!);
        vm.Name = "New";
        Assert.Equal("Screen of New", s.Title);
        Assert.StartsWith("Screen of New,", s.PictureName);
        Assert.Contains(nameof(ScreenshotViewModel.Title), changed);
        Assert.Contains(nameof(ScreenshotViewModel.PictureName), changed);
        s.Dispose();
        changed.Clear();
        vm.Name = "Newer";
        Assert.Empty(changed);
    }

    internal static ScreenPicture Picture(DateTime taken) =>
        ScreenPicture.FromRgb565([0x00, 0xF8, 0xE0, 0x07, 0x1F, 0x00, 0xFF, 0xFF], 2, 2, taken);
}

/// <summary>The viewer window itself, shown off-screen against the demo backend.</summary>
[Collection("Wpf")]
public class ScreenshotWindowTests
{
    private static void Pump()
    {
        var frame = new DispatcherFrame();
        Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ContextIdle, () => frame.Continue = false);
        Dispatcher.PushFrame(frame);
    }

    private static void ShowOffscreen(Window w)
    {
        w.ShowActivated = false;
        w.WindowStartupLocation = WindowStartupLocation.Manual;
        w.Left = -10000;
        w.Top = -10000;
        w.Show();
        Pump();
        Pump();
    }

    private static ScreenshotWindow Open(DateTime taken)
    {
        TestApp.Ensure();
        var vm = new VmInfo("a") { Name = "Win11-RDP", State = "Running" };
        return new ScreenshotWindow(new ScreenshotViewModel(new DemoHyperVService { Delay = TimeSpan.Zero }, vm, ScreenshotViewModelTests.Picture(taken)));
    }

    [StaFact]
    public void FocusStartsOnThePicture_WhichIsNamedAsAnImage()
    {
        var taken = new DateTime(2026, 10, 6, 15, 42, 10);
        var window = Open(taken);
        try
        {
            ShowOffscreen(window);
            var picture = (Image)window.FindName("Picture");
            Assert.True(window.PictureWaitingForFocus);
            var peer = UIElementAutomationPeer.CreatePeerForElement(picture);
            Assert.Equal(AutomationControlType.Image, peer.GetAutomationControlType());
            Assert.Equal($"Screen of Win11-RDP, taken {taken:T}, 2 by 2, the VM's own screen", peer.GetName());
            Assert.True(peer.IsKeyboardFocusable());
            Assert.Contains("picture description", peer.GetHelpText());
            Assert.Equal("Screen of Win11-RDP", window.Title);

            // A screen reader moving through the window meets the picture first, then what's on
            // screen in words, then the buttons.
            var types = new WindowAutomationPeer(window).GetChildren().Select(c => c.GetAutomationControlType()).ToList();
            Assert.Equal(AutomationControlType.Image, types[0]);
            Assert.True(types.IndexOf(AutomationControlType.Edit) is > 0 and var edit && edit < types.IndexOf(AutomationControlType.Button));
        }
        finally { window.Close(); }
    }

    [StaFact]
    public void AViewerInTheBackground_StaysThere_WithThePictureReadyForWhenItIsUsed()
    {
        // As when the picture arrives while the user is in Settings or another app: the viewer
        // must not take activation, or focus, from them.
        var window = Open(DateTime.Now);
        try
        {
            ShowOffscreen(window);
            Assert.False(window.IsActive);
            var picture = (Image)window.FindName("Picture");
            Assert.False(picture.IsKeyboardFocused);
            Assert.True(window.PictureWaitingForFocus);
            window.ViewModel.Show(ScreenshotViewModelTests.Picture(DateTime.Now.AddSeconds(1)));
            Pump();
            Assert.False(window.IsActive);
            Assert.False(picture.IsKeyboardFocused);
            Assert.True(window.PictureWaitingForFocus);
        }
        finally { window.Close(); }
    }

    /// <summary>Activates the window, so it only runs with the input tests.</summary>
    [StaFact(Skip = InputTests.SkipReason, SkipUnless = nameof(InputTests.Enabled), SkipType = typeof(InputTests))]
    public void InAnActiveViewer_ANewPictureTakesFocusBackToIt_AndAFailedOneLeavesFocusOnTheButton()
    {
        TestApp.Ensure();
        var demo = new DemoHyperVService { Delay = TimeSpan.Zero };
        var vm = new VmInfo("a") { Name = "Win11-RDP", State = "Running" };
        var window = new ScreenshotWindow(new ScreenshotViewModel(demo, vm, ScreenshotViewModelTests.Picture(DateTime.Now)))
            { WindowStartupLocation = WindowStartupLocation.Manual, Left = 0, Top = 0 };
        try
        {
            window.Show();
            window.Activate();
            Pump();
            var button = (Button)window.FindName("TakeAgainButton");
            button.Focus();
            Pump();
            window.ViewModel.Show(ScreenshotViewModelTests.Picture(DateTime.Now.AddSeconds(1)));
            Pump();
            Assert.True(((Image)window.FindName("Picture")).IsKeyboardFocused);

            // The VM id isn't one the demo knows, so taking it again fails.
            button.Focus();
            Pump();
            window.ViewModel.TakeAgainCommand.Execute(null);
            Pump();
            Pump();
            Assert.True(button.IsKeyboardFocused);
            Assert.Contains("Couldn't take a new picture", window.ViewModel.StatusText);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public void Buttons_HaveAccessKeys_AndSayTheirShortcuts()
    {
        var window = Open(DateTime.Now);
        try
        {
            ShowOffscreen(window);
            foreach (var (name, key) in new[] { ("TakeAgainButton", "F5"), ("CopyButton", "Ctrl+Shift+C"), ("SaveButton", "Ctrl+S") })
            {
                var peer = UIElementAutomationPeer.CreatePeerForElement((Button)window.FindName(name));
                Assert.Equal(key, peer.GetAcceleratorKey());
                Assert.NotEmpty(peer.GetAccessKey());
            }
            var keys = ShortcutsWindow.Sections.Single(s => s.Section == "In the screenshot window").Keys.Select(k => k.Key);
            Assert.Equal(["F5", "Ctrl+Shift+C", "Ctrl+S", "Escape"], keys);
        }
        finally { window.Close(); }
    }

    [Theory]
    [InlineData(Key.C, ModifierKeys.Control | ModifierKeys.Shift, true)]
    [InlineData(Key.S, ModifierKeys.Control, true)]
    [InlineData(Key.C, ModifierKeys.Control, false)]   // left to the text box: copies the selected text
    [InlineData(Key.A, ModifierKeys.Control, false)]   // select all, in the text box
    [InlineData(Key.S, ModifierKeys.Control | ModifierKeys.Shift, false)]
    public void TheViewersKeys_CopyThePictureWithCtrlShiftC_AndLeaveCtrlCToText(Key key, ModifierKeys modifiers, bool handled) =>
        Assert.Equal(handled, ScreenshotWindow.ShortcutFor(key, modifiers) is not null);

    [StaFact]
    public void Save_WritesThePng_AndSaysWhere()
    {
        var window = Open(DateTime.Now);
        var path = Path.Combine(Path.GetTempPath(), $"hvm-shot-{Guid.NewGuid():N}.png");
        try
        {
            ShowOffscreen(window);
            string? suggested = null;
            window.ChooseSavePath = s => { suggested = s; return path; };
            window.Save();
            Assert.Equal(window.ViewModel.SuggestedFileName, suggested);
            Assert.Equal(window.ViewModel.Picture.Png, File.ReadAllBytes(path));
            Assert.Equal($"Saved the picture as {path}.", window.ViewModel.StatusText);
        }
        finally { window.Close(); File.Delete(path); }
    }

    [StaFact]
    public void Save_Cancelled_DoesNothing()
    {
        var window = Open(DateTime.Now);
        try
        {
            ShowOffscreen(window);
            window.ChooseSavePath = _ => null;
            window.Save();
            Assert.Equal("", window.ViewModel.StatusText);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public void Save_ToAFolderThatIsntThere_SaysItCouldnt()
    {
        var window = Open(DateTime.Now);
        try
        {
            ShowOffscreen(window);
            window.ChooseSavePath = _ => Path.Combine(Path.GetTempPath(), $"no-such-folder-{Guid.NewGuid():N}", "x.png");
            window.Save();
            Assert.StartsWith("Couldn't save the picture:", window.ViewModel.StatusText);
        }
        finally { window.Close(); }
    }

    /// <summary>Uses the real clipboard, so it only runs with the input tests.</summary>
    [StaFact(Skip = InputTests.SkipReason, SkipUnless = nameof(InputTests.Enabled), SkipType = typeof(InputTests))]
    public void Copy_PutsThePictureOnTheClipboard_AsAnImageAndAsPng()
    {
        var window = Open(DateTime.Now);
        try
        {
            ShowOffscreen(window);
            window.Copy();
            Assert.True(Clipboard.ContainsImage());
            Assert.True(Clipboard.ContainsData("PNG"));
            Assert.StartsWith("Copied the picture", window.ViewModel.StatusText);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public async Task MainWindow_HasScreenshotOnTheVmMenu_AndCtrlShiftS()
    {
        TestApp.Ensure();
        var vm = new MainViewModel(new DemoHyperVService { Delay = TimeSpan.Zero });
        await vm.RefreshAsync();
        var window = new MainWindow(vm, demo: true);
        try
        {
            ShowOffscreen(window);
            var item = ((MenuItem)window.FindName("VmMenu")).Items.OfType<MenuItem>().Single(m => (string)m.Header == "Sc_reenshot…");
            Assert.Same(vm.ScreenshotCommand, item.Command);
            Assert.Equal("Ctrl+Shift+S", item.InputGestureText);
            var binding = window.InputBindings.OfType<KeyBinding>().Single(b => b.Key == Key.S && b.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift));
            Assert.Same(vm.ScreenshotCommand, binding.Command);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public async Task MainWindow_ASecondPictureOfTheSameVm_GoesToItsOpenViewer()
    {
        TestApp.Ensure();
        var vm = new MainViewModel(new DemoHyperVService { Delay = TimeSpan.Zero });
        await vm.RefreshAsync();
        var window = new MainWindow(vm, demo: true) { Placing = MoveOffscreen };
        vm.Screenshots.AskSignIn = (_, _, _) => null;
        try
        {
            ShowOffscreen(window);
            vm.Selected = vm.Vms.First(v => v.State == "Running");
            await vm.ScreenshotCommand.ExecuteAsync(null);
            Pump();
            var viewer = Assert.Single(window.OpenScreenshots);
            var first = viewer.ViewModel.Picture;
            await vm.ScreenshotCommand.ExecuteAsync(null);
            Pump();
            Assert.Same(viewer, Assert.Single(window.OpenScreenshots));
            Assert.NotSame(first, viewer.ViewModel.Picture);

            viewer.Close();
            Pump();
            await vm.ScreenshotCommand.ExecuteAsync(null);
            Pump();
            Assert.NotSame(viewer, Assert.Single(window.OpenScreenshots));
        }
        finally { window.Close(); }
    }

    [StaFact]
    public async Task MainWindow_ClosingAViewerTheUserWasntIn_LeavesTheListAsItWas()
    {
        TestApp.Ensure();
        var vm = new MainViewModel(new DemoHyperVService { Delay = TimeSpan.Zero });
        await vm.RefreshAsync();
        var window = new MainWindow(vm, demo: true) { Placing = MoveOffscreen };
        vm.Screenshots.AskSignIn = (_, _, _) => null;
        try
        {
            ShowOffscreen(window);
            vm.Selected = vm.Vms.First(v => v.State == "Running");
            await vm.ScreenshotCommand.ExecuteAsync(null);
            Pump();
            var viewer = Assert.Single(window.OpenScreenshots);
            // The user goes back to the list, leaving the viewer behind it.
            window.Activate();
            Pump();
            Assert.False(viewer.IsActive);
            var list = (ListView)window.FindName("VmList");
            // Move the list's selection, then close the viewer from outside it: the selection and
            // whatever had focus stay put.
            vm.Selected = vm.Vms.First(v => v.State == "Off");
            var focused = Keyboard.FocusedElement;
            var wasActive = window.IsActive;
            viewer.Close();
            Pump();
            Assert.Same(focused, Keyboard.FocusedElement);
            Assert.Equal(wasActive, window.IsActive);
            Assert.Equal("Off", vm.Selected!.State);
            Assert.Same(vm.Selected, list.SelectedItem);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public void NewVmWindow_OpenedInTheBackground_DoesntTakeFocus()
    {
        TestApp.Ensure();
        var window = new NewVmWindow(new NewVmViewModel([]));
        try
        {
            ShowOffscreen(window);
            Assert.False(window.IsActive);
            Assert.False(((TextBox)window.FindName("NameBox")).IsKeyboardFocused);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public async Task TakeAgain_PressedWhileTaking_SaysItIsStillTaking()
    {
        TestApp.Ensure();
        var demo = new DemoHyperVService { Delay = TimeSpan.FromMilliseconds(300) };
        var main = new MainViewModel(demo);
        await main.RefreshAsync();
        var s = new ScreenshotViewModel(demo, main.Vms.First(v => v.State == "Running"), ScreenshotViewModelTests.Picture(DateTime.Now));
        var spoken = new List<string>();
        s.Announce += spoken.Add;
        var taking = s.TakeAgainCommand.ExecuteAsync(null);
        await s.TakeAgainCommand.ExecuteAsync(null);
        Assert.Equal(["Still taking the picture."], spoken);
        await taking;
    }

    private static void MoveOffscreen(Window w)
    {
        w.WindowStartupLocation = WindowStartupLocation.Manual;
        w.Left = -10000;
        w.Top = -10000;
    }

    [StaFact]
    public async Task MainWindow_NewVmAndViewers_AreTheirOwnWindows_SoAltTabReachesTheList_AndCloseWithIt()
    {
        // An owned window stays in front of its owner and goes with it in Alt+Tab: with a build
        // running there was no way back to the list.
        TestApp.Ensure();
        var vm = new MainViewModel(new DemoHyperVService { Delay = TimeSpan.Zero });
        await vm.RefreshAsync();
        var window = new MainWindow(vm, demo: true) { Placing = MoveOffscreen };
        vm.Screenshots.AskSignIn = (_, _, _) => null;
        ShowOffscreen(window);
        vm.Selected = vm.Vms.First(v => v.State == "Running");
        await vm.ScreenshotCommand.ExecuteAsync(null);
        vm.NewVmCommand.Execute(null);
        Pump();
        var viewer = Assert.Single(window.OpenScreenshots);
        var newVm = window.OpenNewVmWindow!;
        foreach (var w in new Window[] { viewer, newVm })
        {
            Assert.Null(w.Owner);
            Assert.True(w.ShowInTaskbar);
            Assert.True(w.IsVisible);
        }
        Assert.Empty(window.OwnedWindows);

        window.Close();
        Pump();
        Assert.False(viewer.IsVisible);
        Assert.False(newVm.IsVisible);
        Assert.Null(window.OpenNewVmWindow);
        Assert.Empty(window.OpenScreenshots);
    }
}
