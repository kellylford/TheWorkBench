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
        Assert.EndsWith(", 2 by 2, blank, the whole screen is one color", s.PictureName);
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
        var said = Assert.Single(spoken);
        Assert.StartsWith($"Couldn't take a picture of {running.Name}'s screen. Hyper-V returned error 32775", said);
    }

    [Fact]
    public void PictureName_SaysWhoseScreen_WhenToTheSecond_AndItsSize()
    {
        var vm = new VmInfo("a") { Name = "Win11-RDP", State = "Running" };
        var taken = new DateTime(2026, 10, 6, 15, 42, 10);
        var s = new ScreenshotViewModel(Demo(), vm, Picture(taken));
        Assert.Equal($"Screen of Win11-RDP, taken {taken:T}, 2 by 2", s.PictureName);
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
    public async Task TakeAgain_CantBePressedAgainWhileItIsTaking()
    {
        var demo = new DemoHyperVService { Delay = TimeSpan.FromMilliseconds(300) };
        var main = new MainViewModel(demo);
        await main.RefreshAsync();
        var s = new ScreenshotViewModel(demo, main.Vms.First(v => v.State == "Running"), Picture(DateTime.Now));
        var taking = s.TakeAgainCommand.ExecuteAsync(null);
        Assert.True(s.IsTaking);
        Assert.False(s.TakeAgainCommand.CanExecute(null));
        await taking;
        Assert.True(s.TakeAgainCommand.CanExecute(null));
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
            Assert.True(picture.IsKeyboardFocused);
            var peer = UIElementAutomationPeer.CreatePeerForElement(picture);
            Assert.Equal(AutomationControlType.Image, peer.GetAutomationControlType());
            Assert.Equal($"Screen of Win11-RDP, taken {taken:T}, 2 by 2", peer.GetName());
            Assert.True(peer.IsKeyboardFocusable());
            Assert.Contains("picture description", peer.GetHelpText());
            Assert.Equal("Screen of Win11-RDP", window.Title);

            // A screen reader moving through the window meets the picture first, then the buttons.
            var children = new WindowAutomationPeer(window).GetChildren();
            Assert.Equal(AutomationControlType.Image, children[0].GetAutomationControlType());
            Assert.True(picture.MoveFocus(new TraversalRequest(FocusNavigationDirection.Next)));
            Assert.True(((Button)window.FindName("TakeAgainButton")).IsKeyboardFocused);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public void ANewPicture_TakesFocusBackToThePicture()
    {
        var window = Open(DateTime.Now);
        try
        {
            ShowOffscreen(window);
            var button = (Button)window.FindName("SaveButton");
            button.Focus();
            Pump();
            window.ViewModel.Show(ScreenshotViewModelTests.Picture(DateTime.Now.AddSeconds(1)));
            Pump();
            Assert.True(((Image)window.FindName("Picture")).IsKeyboardFocused);
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
            foreach (var (name, key) in new[] { ("TakeAgainButton", "F5"), ("CopyButton", "Ctrl+C"), ("SaveButton", "Ctrl+S") })
            {
                var peer = UIElementAutomationPeer.CreatePeerForElement((Button)window.FindName(name));
                Assert.Equal(key, peer.GetAcceleratorKey());
                Assert.NotEmpty(peer.GetAccessKey());
            }
            var keys = ShortcutsWindow.Sections.Single(s => s.Section == "In the screenshot window").Keys.Select(k => k.Key);
            Assert.Equal(["F5", "Ctrl+C", "Ctrl+S", "Escape"], keys);
        }
        finally { window.Close(); }
    }

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
        var window = new MainWindow(vm, demo: true);
        try
        {
            ShowOffscreen(window);
            vm.Selected = vm.Vms.First(v => v.State == "Running");
            await vm.ScreenshotCommand.ExecuteAsync(null);
            Pump();
            var viewer = Assert.Single(window.OwnedWindows.OfType<ScreenshotWindow>());
            var first = viewer.ViewModel.Picture;
            await vm.ScreenshotCommand.ExecuteAsync(null);
            Pump();
            Assert.Same(viewer, Assert.Single(window.OwnedWindows.OfType<ScreenshotWindow>()));
            Assert.NotSame(first, viewer.ViewModel.Picture);

            viewer.Close();
            Pump();
            await vm.ScreenshotCommand.ExecuteAsync(null);
            Pump();
            Assert.NotSame(viewer, Assert.Single(window.OwnedWindows.OfType<ScreenshotWindow>()));
        }
        finally { window.Close(); }
    }
}
