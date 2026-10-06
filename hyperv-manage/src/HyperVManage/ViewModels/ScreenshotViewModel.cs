using System.ComponentModel;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperVManage.Models;
using HyperVManage.Services;

namespace HyperVManage.ViewModels;

/// <summary>
/// The screenshot viewer: one VM's latest picture, and taking another. Copying and saving need
/// the clipboard and a file dialog, so they are the window's; this gives them the picture and
/// a file name. Dispose when the window closes: it stops a picture still being taken and stops
/// following the VM's row.
/// </summary>
public sealed partial class ScreenshotViewModel : ObservableObject, IDisposable
{
    private readonly ScreenshotTaker _taker;
    private readonly CancellationTokenSource _lifetime = new();

    /// <summary>For a viewer whose Take Again never asks for a sign-in: Hyper-V's picture only,
    /// unless the VM's sign-in is already kept.</summary>
    public ScreenshotViewModel(IHyperVService hyperV, VmInfo vm, ScreenPicture picture)
        : this(new ScreenshotTaker(hyperV, new InMemoryCredentialStore()), vm, picture) { }

    public ScreenshotViewModel(ScreenshotTaker taker, VmInfo vm, ScreenPicture picture)
    {
        _taker = taker;
        Vm = vm;
        _picture = picture;
        _image = picture.ToBitmap();
        vm.PropertyChanged += OnVmPropertyChanged;
    }

    /// <summary>The list's own row, updated in place by its refresh, so a rename shows here too.</summary>
    public VmInfo Vm { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PictureName), nameof(SuggestedFileName), nameof(OnScreenText))]
    private ScreenPicture _picture;

    [ObservableProperty] private BitmapSource _image;

    /// <summary>True while a new picture is being taken. Take Again stays enabled meanwhile, and
    /// a second press does nothing: disabling the button would drop keyboard focus from it.</summary>
    [ObservableProperty] private bool _isTaking;

    [ObservableProperty] private string _statusText = "";

    public string Title => $"Screen of {Vm.Name}";

    /// <summary>
    /// What a screen reader says for the picture when it gets focus: whose screen, when, its size,
    /// and what's in front, or that it is the VM's own screen. The time has seconds, so a new
    /// picture is heard to be new.
    /// </summary>
    public string PictureName =>
        $"Screen of {Vm.Name}, taken {Picture.Taken:T}, {Picture.Width} by {Picture.Height}" +
        (Picture.Info is { Foreground.Length: > 0 } info ? $", {info.Foreground} in front"
            : Picture.Info is null ? ", the VM's own screen" : "") +
        (Picture.IsBlank ? $", {ScreenPicture.BlankNote}" : "");

    /// <summary>What was on screen, a line at a time, for the box under the picture.</summary>
    public string OnScreenText => Describe(Picture);

    internal static string Describe(ScreenPicture picture)
    {
        if (picture.Info is not { } info)
            return "The VM's own screen, from Hyper-V. Someone working in it over Remote Desktop is in a " +
                   "session of their own that this doesn't show." + (picture.Note.Length > 0 ? " " + picture.Note : "");
        var lines = new List<string>
        {
            info.RemoteDesktop ? $"{info.User}'s Remote Desktop session." : $"{info.User}'s session, on the VM's own screen.",
        };
        if (info.Foreground.Length > 0) lines.Add($"In front: {info.Foreground}");
        if (info.FocusText.Length > 0) lines.Add($"Focus: {info.FocusText}");
        if (info.Windows.Count > 0) lines.Add($"Open windows: {string.Join("; ", info.Windows)}");
        return string.Join(Environment.NewLine, lines);
    }

    /// <summary>"Win11-RDP screen 2026-10-06 15.42.10.png", with anything Windows doesn't allow
    /// in a file name replaced.</summary>
    public string SuggestedFileName => RemoteDesktop.SafeFileName($"{Vm.Name} screen {Picture.Taken:yyyy-MM-dd HH.mm.ss}") + ".png";

    /// <summary>Raised with text a screen reader should speak.</summary>
    public event Action<string>? Announce;

    /// <summary>Raised when a new picture has replaced the old one; the window puts focus back
    /// on it, so it is read out and ready to be described.</summary>
    public event Action? PictureReplaced;

    private void OnVmPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(VmInfo.Name)) return;
        OnPropertyChanged(nameof(Title));
        OnPropertyChanged(nameof(PictureName));
        OnPropertyChanged(nameof(SuggestedFileName));
    }

    /// <summary>Shows a picture taken elsewhere: the main window's command, for a VM whose viewer
    /// is already open.</summary>
    public void Show(ScreenPicture picture)
    {
        Picture = picture;
        Image = picture.ToBitmap();
        StatusText = $"New picture taken at {picture.Taken:T}." + (picture.IsBlank ? $" It's {ScreenPicture.BlankNote}." : "");
        PictureReplaced?.Invoke();
    }

    [RelayCommand(AllowConcurrentExecutions = true)]
    private async Task TakeAgain()
    {
        if (IsTaking) { Announce?.Invoke("Still taking the picture."); return; }
        IsTaking = true;
        StatusText = $"Taking a new picture of {Vm.Name}'s screen.";
        try
        {
            var picture = await _taker.TakeAsync(Vm, _lifetime.Token, askEvenIfDeclined: true);
            if (!_lifetime.IsCancellationRequested) Show(picture);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            // The old picture stays; say it is the old one.
            StatusText = $"Couldn't take a new picture of {Vm.Name}'s screen. {ex.Message} This is still the one from {Picture.Taken:T}.";
            Announce?.Invoke(StatusText);
        }
        finally { IsTaking = false; }
    }

    public void Dispose()
    {
        Vm.PropertyChanged -= OnVmPropertyChanged;
        _lifetime.Cancel();
        _lifetime.Dispose();
    }
}
