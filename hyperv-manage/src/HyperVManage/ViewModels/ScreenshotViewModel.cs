using System.IO;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperVManage.Models;
using HyperVManage.Services;

namespace HyperVManage.ViewModels;

/// <summary>
/// The screenshot viewer: one VM's latest picture, and taking another. Copying and saving need
/// the clipboard and a file dialog, so they are the window's; this gives them the picture and
/// a file name.
/// </summary>
public sealed partial class ScreenshotViewModel : ObservableObject
{
    private readonly IHyperVService _hyperV;

    public ScreenshotViewModel(IHyperVService hyperV, VmInfo vm, ScreenPicture picture)
    {
        _hyperV = hyperV;
        Vm = vm;
        _picture = picture;
        _image = picture.ToBitmap();
    }

    /// <summary>The list's own row, updated in place by its refresh, so the name stays current.</summary>
    public VmInfo Vm { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PictureName), nameof(SuggestedFileName))]
    private ScreenPicture _picture;

    [ObservableProperty] private BitmapSource _image;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(TakeAgainCommand))]
    private bool _isTaking;

    [ObservableProperty] private string _statusText = "";

    public string Title => $"Screen of {Vm.Name}";

    /// <summary>
    /// What a screen reader says for the picture when it gets focus: whose screen, when, and its
    /// size. The time has seconds, so a new picture is heard to be new.
    /// </summary>
    public string PictureName => $"Screen of {Vm.Name}, taken {Picture.Taken:T}, {Picture.Width} by {Picture.Height}" +
        (Picture.IsBlank ? $", {ScreenPicture.BlankNote}" : "");

    /// <summary>"Win11-RDP screen 2026-10-06 15.42.10.png", with anything Windows doesn't allow
    /// in a file name replaced.</summary>
    public string SuggestedFileName
    {
        get
        {
            var name = $"{Vm.Name} screen {Picture.Taken:yyyy-MM-dd HH.mm.ss}.png";
            var invalid = Path.GetInvalidFileNameChars();
            return new string(name.Select(c => invalid.Contains(c) ? '_' : c).ToArray());
        }
    }

    /// <summary>Raised with text a screen reader should speak.</summary>
    public event Action<string>? Announce;

    /// <summary>Raised when a new picture has replaced the old one; the window puts focus back
    /// on it, so it is read out and ready to be described.</summary>
    public event Action? PictureReplaced;

    /// <summary>Shows a picture taken elsewhere: the main window's command, for a VM whose viewer
    /// is already open.</summary>
    public void Show(ScreenPicture picture)
    {
        Picture = picture;
        Image = picture.ToBitmap();
        StatusText = $"New picture taken at {picture.Taken:T}." + (picture.IsBlank ? $" It's {ScreenPicture.BlankNote}." : "");
        PictureReplaced?.Invoke();
    }

    [RelayCommand(CanExecute = nameof(CanTakeAgain))]
    private async Task TakeAgain()
    {
        IsTaking = true;
        StatusText = $"Taking a new picture of {Vm.Name}'s screen.";
        try
        {
            Show(await _hyperV.TakeScreenshotAsync(Vm.Id));
        }
        catch (Exception ex)
        {
            // The old picture stays; say it is the old one.
            StatusText = $"Couldn't take a new picture of {Vm.Name}'s screen. {ex.Message} This is still the one from {Picture.Taken:T}.";
            Announce?.Invoke(StatusText);
        }
        finally { IsTaking = false; }
    }

    private bool CanTakeAgain() => !IsTaking;
}
