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

    /// <summary>The text Windows OCR found in this picture, once it has been run; null before.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(OnScreenText))]
    private IReadOnlyList<string>? _ocrLines;

    /// <summary>True while Windows OCR reads the picture. Like Take Again, the button stays enabled.</summary>
    [ObservableProperty] private bool _isReadingText;

    /// <summary>Reads the text in a picture; Windows OCR, or a stand-in in the tests.</summary>
    internal Func<byte[], CancellationToken, Task<IReadOnlyList<string>>> ReadText { get; set; } = WindowsOcr.ReadLinesAsync;

    /// <summary>Raised when OCR has added its text: the window moves focus to it.</summary>
    public event Action? TextRead;

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

    /// <summary>What was on screen, a line at a time, for the box under the picture, then the
    /// text OCR found, once it has been run.</summary>
    public string OnScreenText => Describe(Picture) + (OcrLines is { } lines ? Environment.NewLine + DescribeOcr(lines) : "");

    internal const string OcrFoundNothing = "Windows OCR found no text in the picture.";

    /// <summary>The OCR section's first line, which says how much it found: where focus lands, so
    /// it is what's heard.</summary>
    internal static string OcrHeading(int count) =>
        count == 0 ? OcrFoundNothing : $"Windows OCR found {count} {(count == 1 ? "line" : "lines")} of text in the picture:";

    internal static string DescribeOcr(IReadOnlyList<string> lines) =>
        string.Join(Environment.NewLine, new[] { OcrHeading(lines.Count) }.Concat(lines));

    public string OcrFirstLine => OcrHeading(OcrLines?.Count ?? 0);

    /// <summary>Where the OCR text starts in What's on screen, for the caret.</summary>
    public int OcrTextStart => OcrLines is { } lines ? OnScreenText.Length - DescribeOcr(lines).Length : 0;

    /// <summary>Where the words came from: not the picture, so they don't depend on a description
    /// of it. Only focus and the open windows are; the window in front is its title.</summary>
    internal const string FromAccessibilityTree =
        "Focus and open windows were read from the VM's accessibility tree (UI Automation), not from the picture.";

    internal static string Describe(ScreenPicture picture)
    {
        if (picture.Info is not { } info)
            return "The VM's own screen." + (picture.Note.Length > 0 ? " " + picture.Note : "");
        var lines = new List<string>
        {
            info.RemoteDesktop ? $"{info.User}'s Remote Desktop session." : $"{info.User}'s session, on the VM's own screen.",
        };
        if (info.Foreground.Length > 0) lines.Add($"In front: {info.Foreground}");
        if (info.FocusText.Length > 0) lines.Add($"Focus: {info.FocusText}");
        if (info.Windows.Count > 0) lines.Add($"Open windows: {string.Join("; ", info.Windows)}");
        // Only when the tree was read: a hung app can stop that, and then only the title came back.
        if (info.FocusText.Length > 0 || info.Windows.Count > 0) lines.Add(FromAccessibilityTree);
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
        OcrLines = null; // it was the old picture's text
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

    [RelayCommand(AllowConcurrentExecutions = true)]
    private async Task RunOcr()
    {
        if (IsReadingText) { Announce?.Invoke("Still reading the text."); return; }
        IsReadingText = true;
        StatusText = "Reading the text in the picture.";
        var picture = Picture;
        try
        {
            var lines = await ReadText(picture.Png, _lifetime.Token);
            if (_lifetime.IsCancellationRequested) return;
            if (!ReferenceEquals(picture, Picture))
            {
                // A new picture came in meanwhile; this text was the old one's.
                StatusText = "The picture changed while its text was being read. Run Windows OCR again.";
                Announce?.Invoke(StatusText);
                return;
            }
            OcrLines = lines;
            StatusText = lines.Count == 0 ? OcrFoundNothing : OcrHeading(lines.Count).TrimEnd(':') + ".";
            TextRead?.Invoke();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            StatusText = $"Windows OCR couldn't read the picture. {ex.Message}";
            Announce?.Invoke(StatusText);
        }
        finally { IsReadingText = false; }
    }

    public void Dispose()
    {
        Vm.PropertyChanged -= OnVmPropertyChanged;
        _lifetime.Cancel();
        _lifetime.Dispose();
    }
}
