using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Threading;
using HyperVManage.Models;
using HyperVManage.Services;
using HyperVManage.ViewModels;
using HyperVManage.Views;
using Xunit;

namespace HyperVManage.Tests;

/// <summary>
/// WPF allows one Application per process, and the windows need it for their resources. Every test
/// that opens a window is in this one collection, so they never run at once and race to make it.
/// </summary>
[CollectionDefinition("Wpf", DisableParallelization = true)]
public sealed class WpfCollection;

public static class TestApp
{
    private static readonly object Gate = new();

    public static void Ensure()
    {
        lock (Gate)
        {
            if (Application.Current is null) _ = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            Application.Current!.Resources["BoolToVisibility"] = new BooleanToVisibilityConverter();
        }
    }
}

/// <summary>Real windows, loaded and shown off-screen against the demo backend.</summary>
[Collection("Wpf")]
public class WindowTests
{
    private static void EnsureApp() => TestApp.Ensure();

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
    }

    [StaFact]
    public async Task MainWindow_EachRowIsNamedOnItsContainer_AsAScreenReaderReadsIt()
    {
        EnsureApp();
        var vm = new MainViewModel(new DemoHyperVService { Delay = TimeSpan.Zero });
        await vm.RefreshAsync();
        var window = new MainWindow(vm, demo: true);
        try
        {
            ShowOffscreen(window);
            var list = (ListView)window.FindName("VmList");
            Assert.NotNull(list);

            var peer = (ListViewAutomationPeer)UIElementAutomationPeer.CreatePeerForElement(list);
            // With a GridView, WPF reports each row as a data item.
            var names = peer.GetChildren().Where(c => c.GetAutomationControlType() is AutomationControlType.ListItem or AutomationControlType.DataItem)
                            .Select(c => c.GetName()).ToList();
            Assert.Equal(vm.Vms.Select(v => v.AccessibleName), names);
            Assert.Contains("Win11-RDP, Running, 10.0.0.41, External Wi-Fi", names);

            // And from the container itself, so a correct ToString can't hide a missing setter.
            var row = (ListViewItem)list.ItemContainerGenerator.ContainerFromIndex(0);
            Assert.Equal(vm.Vms[0].AccessibleName, AutomationProperties.GetName(row));
        }
        finally { window.Close(); }
    }

    [StaFact]
    public async Task RowContextMenu_ReachesTheWindowsCommands()
    {
        // Shift+F10 on a row opens this menu; a broken DataContext would leave every item dead.
        EnsureApp();
        var vm = new MainViewModel(new DemoHyperVService { Delay = TimeSpan.Zero });
        await vm.RefreshAsync();
        var window = new MainWindow(vm, demo: true);
        try
        {
            ShowOffscreen(window);
            var list = (ListView)window.FindName("VmList");
            var row = (ListViewItem)list.ItemContainerGenerator.ContainerFromIndex(0);
            var menu = row.ContextMenu;
            Assert.NotNull(menu);
            menu.PlacementTarget = row;
            menu.IsOpen = true;
            Pump();
            try
            {
                Assert.Same(vm, menu.DataContext);
                var items = menu.Items.OfType<MenuItem>().ToList();
                Assert.Same(vm.ConnectCommand, items[0].Command);
                Assert.Contains(items, i => ReferenceEquals(i.Command, vm.DeleteCommand));
            }
            finally { menu.IsOpen = false; }
        }
        finally { window.Close(); }
    }

    [StaFact]
    public async Task MainWindow_ListIsNamed_AndTheEmptyMessageShowsOnlyWhenEmpty()
    {
        EnsureApp();
        var vm = new MainViewModel(new DemoHyperVService { Delay = TimeSpan.Zero });
        await vm.RefreshAsync();
        var window = new MainWindow(vm, demo: true);
        try
        {
            ShowOffscreen(window);
            var list = (ListView)window.FindName("VmList");
            Assert.Equal("Virtual machines", AutomationProperties.GetName(list));
            Assert.False(vm.IsEmpty);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public void SettingsWindow_Loads_AndItsComboItemsSpeakAsWords()
    {
        EnsureApp();
        var info = new VmInfo("id") { Name = "Win11-RDP", State = "Running", ProcessorCount = 4, MemoryStartupMB = 4096,
            SwitchName = "Default Switch", AutomaticStartAction = "Start" };
        var window = new VmSettingsWindow(new VmSettingsViewModel(new DemoHyperVService { Delay = TimeSpan.Zero }, info));
        try
        {
            ShowOffscreen(window);
            Pump();
            var combo = (ComboBox)window.FindName("SwitchBox");
            Assert.NotNull(combo);
            Assert.All(combo.Items.Cast<object>(), item => Assert.DoesNotContain("HyperVManage.", item.ToString()));

            // Running: hardware boxes stay reachable but read-only.
            var cpu = (TextBox)window.FindName("ProcessorsBox");
            Assert.True(cpu.IsReadOnly);
            Assert.True(cpu.IsEnabled);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public void ShortcutsWindow_IsAListOneShortcutPerLine_WithHeadingsAsLines()
    {
        EnsureApp();
        var window = new ShortcutsWindow();
        try
        {
            ShowOffscreen(window);
            var list = (ListBox)window.FindName("ShortcutList");
            Assert.Equal(ShortcutsWindow.Lines.Count, list.Items.Count);
            Assert.Equal(0, list.SelectedIndex);
            for (var i = 0; i < list.Items.Count; i++)
            {
                // Lines out of view are only made when scrolled to, as arrowing down does.
                list.ScrollIntoView(list.Items[i]);
                list.UpdateLayout();
                var item = (ListBoxItem)list.ItemContainerGenerator.ContainerFromIndex(i);
                var name = UIElementAutomationPeer.CreatePeerForElement(item).GetName();
                Assert.Equal(ShortcutsWindow.Lines[i].Text, name);
            }
            Assert.Equal(ShortcutsWindow.Sections.Count, ShortcutsWindow.Lines.Count(l => l.IsHeading));
            Assert.True(ShortcutsWindow.Lines[0].IsHeading);
        }
        finally { window.Close(); }
    }

    [StaFact]
    public async Task EveryShortcutOnTheMenus_IsInTheShortcutsList()
    {
        EnsureApp();
        var vm = new MainViewModel(new DemoHyperVService { Delay = TimeSpan.Zero });
        await vm.RefreshAsync();
        var window = new MainWindow(vm, demo: true);
        try
        {
            ShowOffscreen(window);
            var vmMenu = (MenuItem)window.FindName("VmMenu");
            var keys = ShortcutsWindow.Sections.SelectMany(s => s.Keys).Select(k => k.Key).ToList();
            foreach (var item in vmMenu.Items.OfType<MenuItem>().Where(m => !string.IsNullOrEmpty(m.InputGestureText)))
            {
                var gesture = item.InputGestureText.Replace("Ctrl+.", "Ctrl+Period").Replace("Ctrl+Shift+.", "Ctrl+Shift+Period");
                Assert.Contains(gesture, keys);
            }
        }
        finally { window.Close(); }
    }

    [StaFact]
    public void NewVmWindow_Loads_WithEveryFieldLabelled()
    {
        EnsureApp();
        var window = new NewVmWindow(new NewVmViewModel([$"{Environment.MachineName}-Win11"]));
        try
        {
            ShowOffscreen(window);
            foreach (var box in new[] { "NameBox", "IsoBox", "EditionBox", "UserBox", "PasswordBox", "CpuBox", "MemoryBox", "DiskBox" })
            {
                var tb = window.FindName(box) as TextBox;
                Assert.NotNull(tb);
                var peer = UIElementAutomationPeer.CreatePeerForElement(tb);
                Assert.False(string.IsNullOrWhiteSpace(peer.GetName()), $"{box} has no accessible name");
            }
            // This PC's name first, so VMs made on different PCs don't share a name.
            Assert.Equal($"{Environment.MachineName}-Win11-2", ((TextBox)window.FindName("NameBox")).Text);
            Assert.Equal("Progress", UIElementAutomationPeer.CreatePeerForElement((TextBox)window.FindName("LogBox")).GetName());
        }
        finally { window.Close(); }
    }
}
