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
        vm.ConfirmDelete = AskDelete;
        vm.SelectionReplaced += () =>
        {
            // Only if focus was in the list (on the row that just went) or nowhere at all.
            if (IsActive && (VmList.IsKeyboardFocusWithin || Keyboard.FocusedElement is null || ReferenceEquals(Keyboard.FocusedElement, this)))
                FocusSelectedRow();
        };
        vm.OpenSettings = ShowSettings;
        vm.OpenNewVm = ShowNewVm;

        Loaded += async (_, _) =>
        {
            await vm.StartAsync();
            FocusSelectedRow();
        };
        Closed += (_, _) => vm.Dispose();
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
            "A checkpoint saves the VM as it is now, so you can return to it from Hyper-V Manager.");

    private bool AskDelete(VmInfo vm, IReadOnlyList<string> disks)
    {
        var files = disks.Count == 0 ? "It has no disks attached." : "Its disk files:\n" + string.Join("\n", disks);
        var answer = MessageBox.Show(this,
            $"Delete {vm.Name}?\n\nThis turns it off and permanently deletes the virtual machine and its checkpoints. " +
            $"{files}\n\nA disk another VM uses is kept. The desktop connection file {vm.Name}.rdp and its saved sign-in " +
            "are deleted too, if they connect to this VM. It can't be undone.",
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
        // Modeless, so the list stays usable during the 15 to 30 minutes a build takes.
        _newVmWindow = new NewVmWindow(newVm) { Owner = this };
        _newVmWindow.Closed += (_, _) => { _newVmWindow = null; FocusSelectedRow(); };
        _newVmWindow.Show();
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

    private void About_Click(object sender, RoutedEventArgs e) =>
        MessageBox.Show(this,
            "Hyper-V Manage 1.0\n\nManages Hyper-V virtual machines, and builds new Windows VMs ready for Remote Desktop " +
            "with New-HyperVRdpVM.ps1. Everything it does goes through Hyper-V's own PowerShell commands.",
            "About Hyper-V Manage", MessageBoxButton.OK, MessageBoxImage.Information);
}
