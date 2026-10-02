using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using HyperVManage.ViewModels;
using HyperVManage.Views;
using Xunit;

namespace HyperVManage.Tests;

/// <summary>
/// Real keystrokes, through WPF's own input pipeline, at a real window. They need the window to be
/// active, which takes focus from whatever else is on screen, so they only run when
/// HYPERVMANAGE_RUN_INPUT_TESTS=1 is set.
/// </summary>
public static class InputTests
{
    public const string SkipReason = "Keyboard tests take focus; set HYPERVMANAGE_RUN_INPUT_TESTS=1 to run them.";
    public static bool Enabled => Environment.GetEnvironmentVariable("HYPERVMANAGE_RUN_INPUT_TESTS") == "1";
}

[Collection("Wpf")]
public class KeyboardTests
{
    private static void Pump()
    {
        var frame = new DispatcherFrame();
        Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ContextIdle, () => frame.Continue = false);
        Dispatcher.PushFrame(frame);
    }

    private static void Press(Window window, Key key, ModifierKeys modifiers = ModifierKeys.None)
    {
        var source = PresentationSource.FromVisual(window)!;
        // Shift+Tab: WPF reads the modifier state from the keyboard device, so it can't be faked
        // here; Shift+Tab is covered by moving focus backwards from the element after the group.
        // One event: the input manager raises the preview and bubbling halves itself. Sending
        // both would press the key twice, and a two-item radio group would cycle straight back.
        InputManager.Current.ProcessInput(new KeyEventArgs(Keyboard.PrimaryDevice, source, 0, key) { RoutedEvent = Keyboard.KeyDownEvent });
        Pump();
        Pump();
    }

    private static (NewVmWindow window, NewVmViewModel vm) Open()
    {
        TestApp.Ensure();
        var vm = new NewVmViewModel([]);
        var window = new NewVmWindow(vm) { WindowStartupLocation = WindowStartupLocation.Manual, Left = 0, Top = 0 };
        window.Show();
        window.Activate();
        Pump();
        return (window, vm);
    }

    [StaFact(Skip = InputTests.SkipReason, SkipUnless = nameof(InputTests.Enabled), SkipType = typeof(InputTests))]
    public void NetworkChoice_ArrowsMoveAndChoose_TabLandsOnTheChoiceWithoutChangingIt()
    {
        var (window, vm) = Open();
        try
        {
            var yours = (RadioButton)window.FindName("YourNetworkRadio");
            var hostOnly = (RadioButton)window.FindName("HostOnlyRadio");
            yours.Focus();
            Pump();
            Assert.True(yours.IsKeyboardFocused, "couldn't put focus on the first choice");

            Press(window, Key.Down);
            Assert.True(hostOnly.IsKeyboardFocused, "Down didn't reach the second choice");
            Assert.True(vm.HostOnly);

            Press(window, Key.Up);
            Assert.True(yours.IsKeyboardFocused);
            Assert.True(vm.OnYourNetwork);

            // Tab into the group must land on the choice made and never change it. One test with
            // the arrows above: WPF's Application belongs to the thread that made it, and each
            // StaFact runs on a thread of its own that ends with it.
            vm.HostOnly = true; // the second choice is the one made

            // Forwards, from the field before the group.
            ((TextBox)window.FindName("DiskBox")).Focus();
            Pump();
            Press(window, Key.Tab);
            Assert.True(hostOnly.IsKeyboardFocused, "Tab didn't land on the chosen radio");
            Assert.True(vm.HostOnly, "Tabbing in changed the choice");

            // Backwards: focus moving in from the check box after the group.
            var after = (CheckBox)((Panel)((GroupBox)LogicalTreeHelper.GetParent(LogicalTreeHelper.GetParent(hostOnly))).Parent)
                .Children.OfType<CheckBox>().First();
            after.Focus();
            Pump();
            after.MoveFocus(new TraversalRequest(FocusNavigationDirection.Previous));
            Pump();
            Pump();
            Assert.True(hostOnly.IsKeyboardFocused, "Shift+Tab didn't land on the chosen radio");
            Assert.True(vm.HostOnly, "Shift+Tab in changed the choice");
        }
        finally { window.Close(); }
    }

    [StaFact(Skip = InputTests.SkipReason, SkipUnless = nameof(InputTests.Enabled), SkipType = typeof(InputTests))]
    public async Task MainWindow_TabNeverLandsOnTheMenuBar()
    {
        // The menu bar is reached with Alt or F10, as in any Windows app. Tab stopping on
        // File, VM and Help puts three extra stops between the user and the list.
        TestApp.Ensure();
        var vm = new MainViewModel(new HyperVManage.Services.DemoHyperVService { Delay = TimeSpan.Zero });
        await vm.RefreshAsync();
        var window = new MainWindow(vm, demo: true) { WindowStartupLocation = WindowStartupLocation.Manual, Left = 0, Top = 0 };
        window.Show();
        window.Activate();
        Pump();
        try
        {
            var list = (ListView)window.FindName("VmList");
            list.SelectedIndex = 0;
            Pump();
            ((ListViewItem)list.ItemContainerGenerator.ContainerFromIndex(0)).Focus();
            Pump();
            Assert.True(list.IsKeyboardFocusWithin, "couldn't put focus on the list");

            for (var i = 0; i < 6; i++)
            {
                Press(window, Key.Tab);
                var focused = Keyboard.FocusedElement as DependencyObject;
                for (var d = focused; d is not null; d = System.Windows.Media.VisualTreeHelper.GetParent(d) ?? LogicalTreeHelper.GetParent(d))
                {
                    Assert.False(d is Menu, $"Tab {i + 1} landed on the menu bar ({focused})");
                }
            }
        }
        finally { window.Close(); }
    }
}
