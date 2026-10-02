using System.Windows;
using HyperVManage.Helpers;
using HyperVManage.ViewModels;

namespace HyperVManage.Views;

public partial class VmSettingsWindow : Window
{
    public VmSettingsWindow(VmSettingsViewModel vm)
    {
        InitializeComponent();
        DataContext = vm;
        vm.Announce += text => Announcer.Announce(this, text);
        vm.Saved += () => DialogResult = true;
        // While Save or Create a switch runs, its button is disabled, and WPF drops keyboard focus
        // out of the window altogether; creating a switch also hides its button for good. Put
        // focus back on the network choice, which is what either one changes, so a screen
        // reader user isn't left nowhere.
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName != nameof(VmSettingsViewModel.IsWorking)) return;
            Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Input, () =>
            {
                if (IsLoaded && !IsKeyboardFocusWithin) SwitchBox.Focus();
            });
        };
        Loaded += async (_, _) =>
        {
            await vm.LoadAsync();
            // Start where a running VM's settings can actually be changed.
            if (vm.CanChangeHardware) ProcessorsBox.Focus();
            else SwitchBox.Focus();
        };
    }
}
