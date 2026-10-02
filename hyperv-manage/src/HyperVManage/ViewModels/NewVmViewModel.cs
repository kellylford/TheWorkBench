using System.Text;
using System.Text.RegularExpressions;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperVManage.Services;

namespace HyperVManage.ViewModels;

/// <summary>
/// The New VM window: the options of New-HyperVRdpVM.ps1, then the script's own output as it runs.
/// Each line the script prints is also spoken, which is how its console reads with a screen reader.
/// </summary>
public sealed partial class NewVmViewModel : ObservableObject
{
    private readonly SynchronizationContext? _ui = SynchronizationContext.Current;
    private readonly StringBuilder _log = new();
    private CancellationTokenSource? _stop;

    /// <summary>Runs the build. Swapped for the demo, and in tests, so nothing real runs.</summary>
    internal Func<NewVmOptions, Action<string>, CancellationToken, Task<BuildOutcome>> RunScript { get; set; } = NewVmScript.RunAsync;

    public NewVmViewModel(IEnumerable<string> existingNames)
    {
        var taken = new HashSet<string>(existingNames, StringComparer.OrdinalIgnoreCase);
        _vmName = SuggestName("Win11-RDP", taken);
        _isoPath = IsoFinder.FindNewest(IsoFinder.DownloadsFolder, IsoFinder.HostIsArm64) ?? "";
    }

    /// <summary>Win11-RDP, or Win11-RDP-2, -3 ... if that is taken.</summary>
    internal static string SuggestName(string baseName, ISet<string> taken)
    {
        if (!taken.Contains(baseName)) return baseName;
        for (var i = 2; ; i++)
        {
            var candidate = $"{baseName}-{i}";
            if (!taken.Contains(candidate)) return candidate;
        }
    }

    [ObservableProperty] private string _vmName;
    [ObservableProperty] private string _isoPath;
    [ObservableProperty] private string _edition = "Windows 11 Pro";
    [ObservableProperty] private string _userName = "vmuser";
    [ObservableProperty] private string _password = "vmadmin";
    [ObservableProperty] private string _processors = "4";
    [ObservableProperty] private string _memoryGB = "4";
    [ObservableProperty] private string _diskGB = "128";
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(HostOnly))] private bool _onYourNetwork = true;
    [ObservableProperty] private bool _autoStart = true;
    [ObservableProperty] private bool _connectWhenDone = true;

    public bool HostOnly
    {
        get => !OnYourNetwork;
        set => OnYourNetwork = !value;
    }

    [ObservableProperty] [NotifyPropertyChangedFor(nameof(HasError))] private string _error = "";
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowForm), nameof(ShowProgress))]
    [NotifyCanExecuteChangedFor(nameof(CreateCommand))]
    private bool _hasStarted;
    [ObservableProperty] [NotifyCanExecuteChangedFor(nameof(CreateCommand))] private bool _isRunning;
    [ObservableProperty] private string _outcome = "";

    public bool HasError => Error.Length > 0;
    public bool ShowForm => !HasStarted;
    public bool ShowProgress => HasStarted;

    /// <summary>Everything printed so far. The window appends lines as they come (see
    /// <see cref="LineAppended"/>) rather than binding to this, so the caret isn't reset.</summary>
    public string LogText => _log.ToString();

    /// <summary>A new line for the progress box.</summary>
    public event Action<string>? LineAppended;

    /// <summary>Text for a screen reader: the script's lines, and how it ended.</summary>
    public event Action<string>? Announce;

    /// <summary>Raised when the build ends, however it ended.</summary>
    public event Action<BuildOutcome>? Finished;

    internal NewVmOptions? Validate()
    {
        string? problem = null;
        var name = VmName.Trim();
        var iso = IsoPath.Trim();
        // The ISO is always passed explicitly, so a stopped build knows which one to dismount.
        if (iso.Length == 0) iso = IsoFinder.FindNewest(IsoFinder.DownloadsFolder, IsoFinder.HostIsArm64) ?? "";

        // The script mounts the full path, so the cleanup after a stop must dismount that same path.
        if (iso.Length > 0) { try { iso = System.IO.Path.GetFullPath(iso); } catch (Exception) { } }

        if (NewVmScript.NameProblem(name) is { } nameProblem) problem = nameProblem;
        else if (RemoteDesktop.ComputerName(name).Length == 0) problem = "The name needs at least one letter or digit, since Windows names the computer after it.";
        else if (iso.Length == 0) problem = "There's no Windows ISO in your Downloads folder. Choose one with Browse.";
        else if (!System.IO.File.Exists(iso)) problem = $"Can't find the ISO {iso}.";
        else if (!int.TryParse(Processors.Trim(), out var c) || c < 1 || c > Environment.ProcessorCount)
            problem = $"Processors must be a whole number from 1 to {Environment.ProcessorCount}.";
        else if (!int.TryParse(MemoryGB.Trim(), out var m) || m < 2) problem = "Memory must be a whole number of gigabytes, at least 2.";
        else if (!int.TryParse(DiskGB.Trim(), out var d) || d < 64) problem = "Disk size must be a whole number of gigabytes, at least 64. Windows 11 needs that much.";
        else if (Edition.Contains("Home", StringComparison.OrdinalIgnoreCase)) problem = "Home editions can't accept Remote Desktop connections. Use Pro, Enterprise or Education.";

        Error = problem ?? "";
        if (problem is not null) return null;
        return new NewVmOptions(name, iso, Edition.Trim(), UserName.Trim(), Password,
            int.Parse(Processors.Trim()), int.Parse(MemoryGB.Trim()), int.Parse(DiskGB.Trim()),
            HostOnly, AutoStart, ConnectWhenDone);
    }

    [RelayCommand(CanExecute = nameof(CanCreate))]
    private async Task Create()
    {
        var options = Validate();
        if (options is null) { Announce?.Invoke(Error); return; }

        HasStarted = true;
        IsRunning = true;
        _stop = new CancellationTokenSource();
        Append("Starting New-HyperVRdpVM.ps1.");
        BuildOutcome result;
        try
        {
            result = await RunScript(options, line => Post(() => Append(line)), _stop.Token);
        }
        catch (Exception ex)
        {
            Append($"Couldn't run the script: {ex.Message}");
            result = BuildOutcome.Failed;
        }
        // Lines posted from the runner's thread land before this, which is posted after them.
        Post(() => End(result, options.VMName));
    }
    private bool CanCreate() => !HasStarted && !IsRunning;

    /// <summary>Stops the build. The runner cleans up what it had made, then Finished is raised.</summary>
    public void Stop() => _stop?.Cancel();

    private void End(BuildOutcome result, string name)
    {
        IsRunning = false;
        _stop?.Dispose();
        _stop = null;
        Outcome = result switch
        {
            BuildOutcome.Succeeded => $"Finished. {name} is ready.",
            BuildOutcome.Stopped => "Stopped.",
            _ => "The script stopped with an error. The lines above say what went wrong.",
        };
        Append(Outcome);
        Finished?.Invoke(result);
    }

    // PowerShell's error records add lines like "At C:\...ps1:123 char:5", "+ throw ..." and
    // "    + CategoryInfo ...". Useful in the log; noise when spoken one by one.
    private static readonly Regex ErrorRecordDetail = new(@"^\s*(At [A-Za-z]:\\|At line:|\+)", RegexOptions.Compiled);

    internal void Append(string line)
    {
        if (_log.Length > 0) _log.AppendLine();
        _log.Append(line);
        OnPropertyChanged(nameof(LogText));
        LineAppended?.Invoke(line);
        if (!string.IsNullOrWhiteSpace(line) && !ErrorRecordDetail.IsMatch(line)) Announce?.Invoke(line);
    }

    private void Post(Action a)
    {
        if (_ui is null) a();
        else _ui.Post(_ => a(), null);
    }
}
