using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using HyperVManage.Helpers;
using HyperVManage.ViewModels;

namespace HyperVManage.Views;

/// <summary>
/// A picture of a VM's screen, for the screen reader to describe. Focus goes to the picture,
/// which is named with the VM and the time, and comes back to it with each new picture.
/// </summary>
public partial class ScreenshotWindow : Window
{
    public ScreenshotWindow(ScreenshotViewModel vm)
    {
        InitializeComponent();
        // As big as the screen comfortably allows, never past it: the buttons are along the bottom.
        var screen = SystemParameters.WorkArea;
        Width = Math.Min(Width, screen.Width * 0.9);
        Height = Math.Min(Height, screen.Height * 0.9);
        ViewModel = vm;
        DataContext = vm;
        vm.Announce += text => Announcer.Announce(this, text);
        vm.PictureReplaced += OnPictureReplaced;
        Loaded += (_, _) => FocusPicture();
        Activated += (_, _) =>
        {
            if (!_pictureWaiting) return;
            _pictureWaiting = false;
            // After WPF has put back whatever had focus when the window was last used.
            Dispatcher.BeginInvoke(() => { if (IsActive) Keyboard.Focus(Picture); }, DispatcherPriority.Input);
        };
        Closed += (_, _) => vm.Dispose();
        PreviewKeyDown += OnPreviewKeyDown;
    }

    public ScreenshotViewModel ViewModel { get; }

    /// <summary>Saves pictures without a dialog, for the tests. Null shows the Save As dialog.</summary>
    internal Func<string, string?>? ChooseSavePath { get; set; }

    private bool _pictureWaiting = true;

    /// <summary>True when the picture is to get focus the next time the window is activated.</summary>
    internal bool PictureWaitingForFocus => _pictureWaiting;

    /// <summary>
    /// Puts focus on the picture now if the window is active, or else the next time it is.
    /// Focusing anything in a window in the background would bring it to the front (WPF does that
    /// even for FocusManager.SetFocusedElement), pulling someone out of whatever they had moved on
    /// to while the picture was being taken, a dialog included.
    /// </summary>
    private void FocusPicture()
    {
        if (!IsActive) { _pictureWaiting = true; return; }
        _pictureWaiting = false;
        Dispatcher.BeginInvoke(() => { if (IsActive) Keyboard.Focus(Picture); }, DispatcherPriority.Input);
    }

    private void OnPictureReplaced()
    {
        // Moving focus to it reads its new name. If it already has focus, nothing would be read,
        // so say it. A window in the background says nothing; its picture is read when it's next used.
        if (IsActive && Picture.IsKeyboardFocused) Announcer.Announce(this, ViewModel.StatusText);
        else FocusPicture();
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (Keyboard.Modifiers != ModifierKeys.Control) return;
        if (e.Key == Key.C) { Copy(); e.Handled = true; }
        else if (e.Key == Key.S) { Save(); e.Handled = true; }
    }

    private void Copy_Click(object sender, RoutedEventArgs e) => Copy();

    private void Save_Click(object sender, RoutedEventArgs e) => Save();

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    /// <summary>Puts the picture on the clipboard as an image and as PNG, which is what web pages
    /// such as Be My AI, ChatGPT and Claude take when it is pasted.</summary>
    internal void Copy()
    {
        try
        {
            var data = new DataObject();
            data.SetImage(ViewModel.Image);
            data.SetData("PNG", new MemoryStream(ViewModel.Picture.Png));
            Clipboard.SetDataObject(data, copy: true);
            Report("Copied the picture. Paste it into any app that takes pictures.");
        }
        catch (ExternalException ex)
        {
            // Another program has the clipboard open.
            Report($"Couldn't copy the picture: {ex.Message}");
        }
    }

    internal void Save()
    {
        var path = ChooseSavePath is { } choose ? choose(ViewModel.SuggestedFileName) : AskSavePath();
        if (path is null) return;
        try
        {
            File.WriteAllBytes(path, ViewModel.Picture.Png);
            Report($"Saved the picture as {path}.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Report($"Couldn't save the picture: {ex.Message}");
        }
    }

    private string? AskSavePath()
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Save the picture",
            FileName = ViewModel.SuggestedFileName,
            DefaultExt = ".png",
            Filter = "PNG picture (*.png)|*.png",
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
        };
        return dialog.ShowDialog(this) == true ? dialog.FileName : null;
    }

    private void Report(string text)
    {
        ViewModel.StatusText = text;
        Announcer.Announce(this, text);
    }
}
