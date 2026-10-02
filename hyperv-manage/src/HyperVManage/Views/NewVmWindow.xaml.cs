using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using HyperVManage.Helpers;
using HyperVManage.Services;
using HyperVManage.ViewModels;
using Microsoft.Win32;

namespace HyperVManage.Views;

/// <summary>
/// Modeless, so the VM list stays usable while a build runs. It has no editable text over a live
/// browser control, so the modal-dialog hazards of a WebView2 host don't apply; modeless is simply
/// friendlier for something that runs half an hour.
/// </summary>
public partial class NewVmWindow : Window
{
    private readonly NewVmViewModel _vm;

    public NewVmWindow(NewVmViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        DataContext = vm;
        vm.Announce += text => Announcer.Announce(this, text);
        vm.PropertyChanged += OnVmPropertyChanged;
        Loaded += (_, _) => { NameBox.Focus(); NameBox.SelectAll(); };

        PreviewKeyDown += (_, e) =>
        {
            // Escape closes, as Cancel does; modeless windows don't get that from IsCancel.
            if (e.Key == Key.Escape && Keyboard.Modifiers == ModifierKeys.None)
            {
                e.Handled = true;
                Close();
            }
        };
    }

    private void OnVmPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Once the script starts the form disappears; put focus on its output so the user is
        // somewhere they can read, rather than on a control that just vanished.
        if (e.PropertyName == nameof(NewVmViewModel.HasStarted) && _vm.HasStarted)
            Dispatcher.BeginInvoke(() => LogBox.Focus(), System.Windows.Threading.DispatcherPriority.Input);
    }

    // Selection follows focus in the radio group, as in any Windows radio group: arrowing to a
    // choice chooses it.
    private void Radio_GotKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (sender is RadioButton rb && rb.IsChecked != true) rb.IsChecked = true;
    }

    private void Browse_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Choose a Windows ISO",
            Filter = "Disc images (*.iso)|*.iso",
            InitialDirectory = IsoFinder.DownloadsFolder,
        };
        if (dialog.ShowDialog(this) == true) _vm.IsoPath = dialog.FileName;
        IsoBox.Focus();
    }

    private void LogBox_TextChanged(object sender, TextChangedEventArgs e) => LogBox.ScrollToEnd();

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_vm.IsRunning)
        {
            var answer = MessageBox.Show(this,
                "The VM is still being built. Closing this window stops the build partway, and leaves a half-made VM " +
                "for you to delete from the list.\n\nStop building it?",
                "Stop building the VM?", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
            if (answer != MessageBoxResult.Yes) { e.Cancel = true; return; }
            _vm.Stop();
        }
        base.OnClosing(e);
    }
}
