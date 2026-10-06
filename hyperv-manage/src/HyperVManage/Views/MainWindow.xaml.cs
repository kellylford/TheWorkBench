using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using HyperVManage.Helpers;
using HyperVManage.Models;
using HyperVManage.Services;
using HyperVManage.ViewModels;

namespace HyperVManage.Views;

public partial class MainWindow : Window
{
    private readonly MainViewModel _vm;
    private readonly bool _demo;
    private NewVmWindow? _newVmWindow;
    /// <summary>The open screenshot viewers, one per VM id.</summary>
    private readonly Dictionary<string, ScreenshotWindow> _screenshots = [];

    public MainWindow(MainViewModel vm, bool demo)
    {
        InitializeComponent();
        _vm = vm;
        _demo = demo;

        // Access keys D and W: Help already uses K and A.
        var downloads = IsoDownloads.ForThisPcFirst(IsoFinder.HostIsArm64);
        IsoMenuThisPc.Header = "_" + downloads[0].Text;
        IsoMenuThisPc.Tag = downloads[0].Page;
        IsoMenuOther.Header = downloads[1].Text.Replace("Download Windows", "Download _Windows");
        IsoMenuOther.Tag = downloads[1].Page;
        DataContext = vm;
        if (demo) Title = "Hyper-V Manage (demo, pretend VMs)";

        vm.Announce += text => Announcer.Announce(this, text);
        vm.RequestCloneName = AskCloneName;
        vm.RequestCheckpointName = AskCheckpointName;
        vm.RequestCheckpointToApply = (v, checkpoints) => ApplyCheckpointWindow.Ask(this, v, checkpoints);
        vm.ConfirmDelete = AskDelete;
        vm.SelectionReplaced += () =>
        {
            // Only if focus was in the list (on the row that just went) or nowhere at all.
            if (IsActive && (VmList.IsKeyboardFocusWithin || Keyboard.FocusedElement is null || ReferenceEquals(Keyboard.FocusedElement, this)))
                FocusSelectedRow();
        };
        vm.OpenSettings = ShowSettings;
        vm.OpenNewVm = ShowNewVm;
        vm.ShowScreenshot = ShowScreenshot;

        Loaded += async (_, _) =>
        {
            await vm.StartAsync();
            FocusSelectedRow();
        };
        Closed += (_, _) =>
        {
            // They have no owner, so they don't go with this window by themselves.
            foreach (var viewer in _screenshots.Values.ToList()) viewer.Close();
            _newVmWindow?.Close();
            vm.Dispose();
        };
    }

    /// <summary>Called with each New VM and screenshot window just before it is shown. The tests
    /// move them off-screen.</summary>
    internal Action<Window>? Placing { get; set; }

    internal IReadOnlyCollection<ScreenshotWindow> OpenScreenshots => _screenshots.Values;

    internal NewVmWindow? OpenNewVmWindow => _newVmWindow;

    /// <summary>
    /// Shows a window that works alongside this one: New Virtual Machine and the screenshot
    /// viewers. They have no owner, so each is its own window in Alt+Tab and on the taskbar and
    /// this one can come in front of them; an owned window stays in front of its owner and goes
    /// with it in Alt+Tab, which left no way back to the list while a build ran. Closing one
    /// brings the list back, but only if the user was in it: not if they'd moved on.
    /// </summary>
    private void ShowAlongside(Window window)
    {
        window.ShowActivated = IsActive;
        var wasActive = false;
        window.Closing += (_, e) => { if (!e.Cancel) wasActive = window.IsActive; };
        window.Closed += (_, _) =>
        {
            if (!wasActive || !IsLoaded) return;
            Activate();
            FocusSelectedRow();
        };
        if (IsLoaded && WindowState == WindowState.Normal && !double.IsNaN(window.Width) && !double.IsNaN(window.Height))
        {
            // Centred on this window, so it opens on the same monitor; CenterScreen means the
            // primary one. Kept on screen when this window is near an edge.
            window.WindowStartupLocation = WindowStartupLocation.Manual;
            window.Left = Math.Max(SystemParameters.VirtualScreenLeft, Left + (ActualWidth - window.Width) / 2);
            window.Top = Math.Max(SystemParameters.VirtualScreenTop, Top + (ActualHeight - window.Height) / 2);
        }
        Placing?.Invoke(window);
        window.Show();
    }

    /// <summary>Puts keyboard focus on the selected row itself, not just the list, so arrowing
    /// starts from there and a screen reader reads the VM.</summary>
    private void FocusSelectedRow()
    {
        if (_vm.Selected is null) { VmList.Focus(); return; }
        VmList.ScrollIntoView(_vm.Selected);
        Dispatcher.BeginInvoke(() =>
        {
            if (VmList.ItemContainerGenerator.ContainerFromItem(_vm.Selected) is ListViewItem row) row.Focus();
            else VmList.Focus();
        }, DispatcherPriority.Input);
    }

    private void VmList_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (Keyboard.Modifiers != ModifierKeys.None) return;
        // Enter connects, the thing you most often want to do with a VM; Delete deletes, after
        // asking. Both only while focus is in the list, so they never fire from a menu.
        if (e.Key == Key.Enter && _vm.ConnectCommand.CanExecute(null))
        {
            _vm.ConnectCommand.Execute(null);
            e.Handled = true;
        }
        else if (e.Key == Key.Delete && _vm.DeleteCommand.CanExecute(null))
        {
            _vm.DeleteCommand.Execute(null);
            e.Handled = true;
        }
    }

    private void VmList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (_vm.ConnectCommand.CanExecute(null)) _vm.ConnectCommand.Execute(null);
    }

    private string? AskCloneName(VmInfo vm) =>
        PromptWindow.Ask(this, $"Clone {vm.Name}",
            "Name for the copy:",
            $"{vm.Name}-copy",
            "The copy has its own disk, so this takes a few minutes and needs as much free space as the VM uses. " +
            "Windows inside it keeps the same computer name: rename it there before running both on your network.");

    private string? AskCheckpointName(VmInfo vm) =>
        PromptWindow.Ask(this, $"Checkpoint {vm.Name}",
            "Checkpoint name:",
            $"{vm.Name} {DateTime.Now:yyyy-MM-dd HH.mm}",
            "A checkpoint saves the VM as it is now, so you can go back to it later with Apply Checkpoint.");

    private bool AskDelete(VmInfo vm, IReadOnlyList<string> disks)
    {
        // Only what will happen to this VM. A disk another VM turns out to rely on is kept, and the
        // message after the delete says so; saying it here for every VM read as if it applied.
        var files = disks.Count == 0 ? "It has no disks attached." : "Its disk files are deleted with it:\n" + string.Join("\n", disks);
        var answer = MessageBox.Show(this,
            $"Delete {vm.Name}?\n\nThis turns it off and permanently deletes the virtual machine and its checkpoints. " +
            $"{files}\n\nThe desktop connection file {vm.Name}.rdp and its saved sign-in are deleted too, if they " +
            "connect to this VM. It can't be undone.",
            "Delete virtual machine", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
        return answer == MessageBoxResult.Yes;
    }

    private void ShowSettings(VmInfo vm)
    {
        var settingsVm = new VmSettingsViewModel(_vm.HyperV, vm);
        var dialog = new VmSettingsWindow(settingsVm) { Owner = this };
        var saved = dialog.ShowDialog() == true;
        if (saved) _ = _vm.RefreshAsync(quiet: true);
        FocusSelectedRow();
    }

    private void ShowNewVm()
    {
        // One at a time: the script works on disks and switches that a second run would trip over.
        if (_newVmWindow is not null) { _newVmWindow.Activate(); return; }
        var newVm = new NewVmViewModel(_vm.Vms.Select(v => v.Name));
        if (_demo) newVm.RunScript = Services.DemoNewVmScript.RunAsync;
        newVm.Finished += outcome => { _ = _vm.RefreshAsync(quiet: true); };
        // Modeless and unowned, so the list stays usable during the 15 to 30 minutes a build takes.
        _newVmWindow = new NewVmWindow(newVm);
        _newVmWindow.Closed += (_, _) => _newVmWindow = null;
        ShowAlongside(_newVmWindow);
    }

    /// <summary>
    /// Opens the viewer for the VM, or, if one is already open, shows the new picture there.
    /// Modeless, so the list stays usable: start a VM, then take its picture again as it boots.
    /// It comes to the front only if this window still is: someone who switched to another app
    /// while the picture was taken keeps their place there.
    /// </summary>
    private void ShowScreenshot(VmInfo vm, ScreenPicture picture)
    {
        if (_screenshots.TryGetValue(vm.Id, out var open))
        {
            open.ViewModel.Show(picture);
            if (IsActive) open.Activate();
            return;
        }
        var window = new ScreenshotWindow(new ScreenshotViewModel(_vm.HyperV, vm, picture));
        _screenshots[vm.Id] = window;
        window.Closed += (_, _) => _screenshots.Remove(vm.Id);
        ShowAlongside(window);
    }

    private void Exit_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        // Closing the app would end a build without its cleanup and without asking. Send the user
        // to the build's own window, which asks and then cleans up properly.
        if (_newVmWindow is { IsBuilding: true } building)
        {
            e.Cancel = true;
            building.Activate();
            Announcer.Announce(building, "A virtual machine is still being built. Close this window to stop it first, or wait for it to finish.");
            return;
        }
        base.OnClosing(e);
    }

    private void Shortcuts_Click(object sender, RoutedEventArgs e) => new ShortcutsWindow { Owner = this }.ShowDialog();

    private void IsoMenu_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not System.Windows.Controls.MenuItem { Tag: Uri page }) return;
        try
        {
            HyperVManage.Services.IsoDownloads.Open(page);
            Announcer.Announce(this, "Opening the download page in your browser.");
        }
        catch (Exception ex) { Announcer.Announce(this, $"Couldn't open the download page: {ex.Message}"); }
    }

    /// <summary>The build's version, from the project or the release tag; .NET adds "+commit"
    /// to the informational version, which isn't for people.</summary>
    internal static string AppVersion =>
        (System.Reflection.Assembly.GetExecutingAssembly()
            .GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
            .OfType<System.Reflection.AssemblyInformationalVersionAttribute>().FirstOrDefault()?.InformationalVersion ?? "")
        .Split('+')[0];

    private void About_Click(object sender, RoutedEventArgs e) =>
        MessageBox.Show(this,
            $"Hyper-V Manage {AppVersion}\n\nManages Hyper-V virtual machines, and builds new Windows VMs ready for Remote Desktop " +
            "with New-HyperVRdpVM.ps1. Everything it does goes through Hyper-V's own PowerShell commands.",
            "About Hyper-V Manage", MessageBoxButton.OK, MessageBoxImage.Information);
}
