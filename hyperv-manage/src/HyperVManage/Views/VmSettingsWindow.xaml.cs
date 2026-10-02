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
        Loaded += async (_, _) =>
        {
            await vm.LoadAsync();
            // Start where a running VM's settings can actually be changed.
            if (vm.CanChangeHardware) ProcessorsBox.Focus();
            else SwitchBox.Focus();
        };
    }
}
