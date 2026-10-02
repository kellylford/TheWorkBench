using System.Diagnostics;
using System.Text;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperVManage.Models;
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
    private Process? _process;

    /// <summary>Starts the script. Swapped in tests so nothing real runs.</summary>
    internal Func<NewVmOptions, Action<string>, Process?> StartScript { get; set; } = NewVmScript.Start;

    public NewVmViewModel(IEnumerable<string> existingNames)
    {
        var taken = new HashSet<string>(existingNames, StringComparer.OrdinalIgnoreCase);
        _vmName = SuggestName("Win11-RDP", taken);
        _isoPath = IsoFinder.FindNewest(IsoFinder.DownloadsFolder, IsoFinder.HostIsArm64) ?? "";
    }

    /// <summary>Win11-RDP, or Win11-RDP-2, -3 ... if that is taken. Kept within the 15
    /// characters Windows allows a computer name, since the script names the computer after the VM.</summary>
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
    [ObservableProperty] private string _logText = "";
    [ObservableProperty] private string _outcome = "";

    public bool HasError => Error.Length > 0;
    public bool ShowForm => !HasStarted;
    public bool ShowProgress => HasStarted;

    /// <summary>Text for a screen reader: each line the script prints, and how it ended.</summary>
    public event Action<string>? Announce;

    /// <summary>Raised when the script ends: true if it succeeded. The main list refreshes on it.</summary>
    public event Action<bool>? Finished;

    internal NewVmOptions? Validate()
    {
        string? problem = null;
        var name = VmName.Trim();
        if (name.Length == 0) problem = "Give the VM a name.";
        else if (RemoteDesktop.ComputerName(name).Length == 0) problem = "The name needs at least one letter or digit, since Windows names the computer after it.";
        else if (IsoPath.Trim().Length > 0 && !System.IO.File.Exists(IsoPath.Trim())) problem = $"Can't find the ISO {IsoPath.Trim()}.";
        else if (!int.TryParse(Processors.Trim(), out var c) || c < 1 || c > Environment.ProcessorCount)
            problem = $"Processors must be a whole number from 1 to {Environment.ProcessorCount}.";
        else if (!int.TryParse(MemoryGB.Trim(), out var m) || m < 2) problem = "Memory must be a whole number of gigabytes, at least 2.";
        else if (!int.TryParse(DiskGB.Trim(), out var d) || d < 64) problem = "Disk size must be a whole number of gigabytes, at least 64. Windows 11 needs that much.";
        else if (Edition.Contains("Home", StringComparison.OrdinalIgnoreCase)) problem = "Home editions can't accept Remote Desktop connections. Use Pro, Enterprise or Education.";

        Error = problem ?? "";
        if (problem is not null) return null;
        return new NewVmOptions(name, IsoPath.Trim(), Edition.Trim(), UserName.Trim(), Password,
            int.Parse(Processors.Trim()), int.Parse(MemoryGB.Trim()), int.Parse(DiskGB.Trim()),
            HostOnly, AutoStart, ConnectWhenDone);
    }

    [RelayCommand(CanExecute = nameof(CanCreate))]
    private void Create()
    {
        var options = Validate();
        if (options is null) { Announce?.Invoke(Error); return; }

        HasStarted = true;
        IsRunning = true;
        Append("Starting New-HyperVRdpVM.ps1.");
        try
        {
            _process = StartScript(options, line => Post(() => Append(line)));
            if (_process is null) { End(false); return; }
            _process.Exited += (_, _) =>
            {
                // Exited can arrive before the last output lines; WaitForExit drains them.
                _process.WaitForExit();
                var ok = _process.ExitCode == 0;
                Post(() => End(ok));
            };
            if (_process.HasExited) { _process.WaitForExit(); End(_process.ExitCode == 0); }
        }
        catch (Exception ex)
        {
            Append($"Couldn't start the script: {ex.Message}");
            End(false);
        }
    }
    private bool CanCreate() => !HasStarted && !IsRunning;

    /// <summary>Stops the script partway. The VM it was building is left half made, for the
    /// user to delete; the window says so before asking.</summary>
    public void Stop()
    {
        try { _process?.Kill(entireProcessTree: true); } catch { }
    }

    private bool _ended;

    private void End(bool ok)
    {
        if (_ended) return;
        _ended = true;
        IsRunning = false;
        Outcome = ok
            ? $"Finished. {VmName.Trim()} is ready."
            : "The script stopped with an error. The lines above say what went wrong.";
        Append(Outcome);
        Finished?.Invoke(ok);
    }

    internal void Append(string line)
    {
        if (_log.Length > 0) _log.AppendLine();
        _log.Append(line);
        LogText = _log.ToString();
        if (!string.IsNullOrWhiteSpace(line)) Announce?.Invoke(line);
    }

    private void Post(Action a)
    {
        if (_ui is null) a();
        else _ui.Post(_ => a(), null);
    }
}
