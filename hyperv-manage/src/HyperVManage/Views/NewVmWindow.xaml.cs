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
    private bool _closeWhenStopped;

    public NewVmWindow(NewVmViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        DataContext = vm;
        vm.Announce += text => Announcer.Announce(this, text);
        vm.LineAppended += AppendLine;
        vm.PropertyChanged += OnVmPropertyChanged;
        vm.Finished += _ =>
        {
            // The user asked to close during the build; now that it has stopped and cleaned up, do.
            if (_closeWhenStopped) Close();
        };
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

    /// <summary>True while the script runs. The main window won't close until this window has.</summary>
    public bool IsBuilding => _vm.IsRunning;

    private void OnVmPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Once the script starts the form disappears; put focus on its output so the user is
        // somewhere they can read, rather than on a control that just vanished.
        if (e.PropertyName == nameof(NewVmViewModel.HasStarted) && _vm.HasStarted)
            Dispatcher.BeginInvoke(() => LogBox.Focus(), System.Windows.Threading.DispatcherPriority.Input);
    }

    /// <summary>
    /// Adds a line without disturbing the reader: AppendText leaves the caret where it is, and the
    /// view only follows the new text if the caret was already at the end.
    /// </summary>
    private void AppendLine(string line)
    {
        var atEnd = LogBox.CaretIndex >= LogBox.Text.Length;
        LogBox.AppendText(LogBox.Text.Length == 0 ? line : Environment.NewLine + line);
        if (atEnd)
        {
            LogBox.CaretIndex = LogBox.Text.Length;
            LogBox.ScrollToEnd();
        }
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

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_vm.IsRunning)
        {
            e.Cancel = true;
            if (_closeWhenStopped) return; // already stopping; it closes when the cleanup is done
            var answer = MessageBox.Show(this,
                "The virtual machine is still being built. Stop the build?\n\n" +
                "Whatever it has made so far is cleaned up. If it has already got as far as creating the VM, " +
                "that VM is left in the list for you to delete.",
                "Stop building the VM?", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
            if (answer != MessageBoxResult.Yes) return;
            _closeWhenStopped = true;
            _vm.Stop();
            return;
        }
        base.OnClosing(e);
    }
}
