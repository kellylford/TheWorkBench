using System.Collections.ObjectModel;
using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperVManage.Models;
using HyperVManage.Services;

namespace HyperVManage.ViewModels;

/// <summary>
/// The VM list and everything that can be done to the selected VM. Dialogs are the window's job:
/// this asks for them through the Request* callbacks and gets plain answers back.
/// </summary>
public sealed partial class MainViewModel : ObservableObject, IDisposable
{
    private readonly IHyperVService _hyperV;
    private readonly CancellationTokenSource _lifetime = new();
    private Task? _reading;

    /// <param name="credentials">Where VMs' sign-ins for screenshots are kept; in memory if not given.</param>
    public MainViewModel(IHyperVService hyperV, IGuestCredentialStore? credentials = null)
    {
        _hyperV = hyperV;
        Screenshots = new ScreenshotTaker(hyperV, credentials ?? new InMemoryCredentialStore());
    }

    /// <summary>Takes Screenshot's pictures, asking for a VM's sign-in through its AskSignIn.</summary>
    public ScreenshotTaker Screenshots { get; }

    public ObservableCollection<VmInfo> Vms { get; } = [];

    [ObservableProperty] private VmInfo? _selected;
    [ObservableProperty] private string _statusText = "";
    [ObservableProperty] private bool _hasLoaded;
    [ObservableProperty] private bool _isEmpty;

    /// <summary>Raised with text a screen reader should speak: an operation finishing or failing.</summary>
    public event Action<string>? Announce;

    /// <summary>Raised when the selected VM left the list (deleted here or elsewhere) and another
    /// was selected in its place. Keyboard focus was on the row that went, so the window moves it
    /// to the new one rather than leaving it nowhere.</summary>
    public event Action? SelectionReplaced;

    // The window answers these. Null means the user cancelled.
    public Func<VmInfo, string?>? RequestCloneName { get; set; }
    public Func<VmInfo, string?>? RequestCheckpointName { get; set; }
    /// <summary>Asked which of the VM's checkpoints to apply, newest first.</summary>
    public Func<VmInfo, IReadOnlyList<CheckpointInfo>, CheckpointChoice?>? RequestCheckpointToApply { get; set; }
    /// <summary>Asked before deleting, with the disk files that would go.</summary>
    public Func<VmInfo, IReadOnlyList<string>, bool>? ConfirmDelete { get; set; }
    public Action<VmInfo>? OpenSettings { get; set; }
    public Action? OpenNewVm { get; set; }
    /// <summary>Shows a picture just taken of the VM's screen.</summary>
    public Action<VmInfo, ScreenPicture>? ShowScreenshot { get; set; }

    public IHyperVService HyperV => _hyperV;

    partial void OnSelectedChanged(VmInfo? oldValue, VmInfo? newValue)
    {
        if (oldValue is not null) oldValue.PropertyChanged -= OnSelectedPropertyChanged;
        if (newValue is not null) newValue.PropertyChanged += OnSelectedPropertyChanged;
        RefreshCommandStates();
    }

    private void OnSelectedPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(VmInfo.State) or nameof(VmInfo.IsBusy) or nameof(VmInfo.IpAddresses) or nameof(VmInfo.CheckpointCount))
            RefreshCommandStates();
    }

    private void RefreshCommandStates()
    {
        foreach (var c in new IRelayCommand[] { StartCommand, ShutDownCommand, TurnOffCommand, SaveCommand,
                     PauseCommand, ResumeCommand, RestartCommand, ConnectCommand, OpenConsoleCommand, SaveConnectionFileCommand, ScreenshotCommand,
                     SettingsCommand, CheckpointCommand, ApplyCheckpointCommand, CloneCommand, DeleteCommand })
            c.NotifyCanExecuteChanged();
    }

    // ── Loading ──────────────────────────────────────────────────────────────

    /// <summary>Loads the list, then keeps it current every ten seconds until disposed.</summary>
    public async Task StartAsync()
    {
        await RefreshAsync();
        _ = AutoRefreshAsync(_lifetime.Token);
    }

    private async Task AutoRefreshAsync(CancellationToken ct)
    {
        // Started from the UI thread, so each tick resumes there; no dispatcher needed.
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
                await RefreshAsync(quiet: true);
        }
        catch (OperationCanceledException) { }
    }

    [RelayCommand]
    private Task Refresh() => RefreshAsync();

    /// <summary>
    /// Reads the VMs and merges them into the list: existing rows are updated in place, new ones
    /// added, gone ones removed. Replacing the list would reset the selection and move a screen
    /// reader back to the top every ten seconds.
    /// </summary>
    /// <param name="mustRead">If a read is already under way, wait for it and then read again,
    /// rather than skipping. After an action the list has to show its result, and a read that
    /// began before the action finished doesn't.</param>
    public async Task RefreshAsync(bool quiet = false, bool mustRead = false)
    {
        if (_reading is { IsCompleted: false })
        {
            if (!mustRead) return;
            await _reading;
        }
        _reading = ReadAsync(quiet);
        await _reading;
    }

    private async Task ReadAsync(bool quiet)
    {
        try
        {
            var fresh = await _hyperV.GetVmsAsync(_lifetime.Token);
            Merge(fresh);
            if (!quiet || StatusText.StartsWith("Couldn't read", StringComparison.Ordinal))
                StatusText = Vms.Count == 1 ? "1 virtual machine." : $"{Vms.Count} virtual machines.";
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            var text = $"Couldn't read the virtual machines: {ex.Message}";
            // Speak a failure once, not on every ten-second retry.
            if (text != StatusText) { StatusText = text; Announce?.Invoke(text); }
        }
        finally
        {
            HasLoaded = true;
        }
    }

    internal void Merge(IReadOnlyList<VmInfo> fresh)
    {
        var byId = fresh.ToDictionary(v => v.Id);
        var selectedIndex = Selected is null ? -1 : Vms.IndexOf(Selected);
        var selectedGone = Selected is not null && !byId.ContainsKey(Selected.Id);
        for (var i = Vms.Count - 1; i >= 0; i--)
            if (!byId.ContainsKey(Vms[i].Id)) Vms.RemoveAt(i);
        foreach (var vm in fresh)
        {
            var existing = Vms.FirstOrDefault(v => v.Id == vm.Id);
            if (existing is null) Vms.Add(vm);
            else existing.UpdateFrom(vm);
        }
        IsEmpty = Vms.Count == 0;
        if (selectedGone)
        {
            // The row that took its place, or the one before it at the end of the list.
            Selected = Vms.Count == 0 ? null : Vms[Math.Clamp(selectedIndex, 0, Vms.Count - 1)];
            SelectionReplaced?.Invoke();
        }
        Selected ??= Vms.FirstOrDefault();
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    private bool Can(Func<string, bool> stateAllows) => Selected is { IsBusy: false } vm && stateAllows(vm.State);

    [RelayCommand(CanExecute = nameof(CanStart))] private Task Start() => Act(VmAction.Start, "Starting", "is running");
    private bool CanStart() => Can(VmStates.CanStart);

    [RelayCommand(CanExecute = nameof(CanShutDown))] private Task ShutDown() => Act(VmAction.ShutDown, "Shutting down", "is off");
    private bool CanShutDown() => Can(VmStates.CanShutDown);

    [RelayCommand(CanExecute = nameof(CanTurnOff))] private Task TurnOff() => Act(VmAction.TurnOff, "Turning off", "is off");
    private bool CanTurnOff() => Can(VmStates.CanTurnOff);

    [RelayCommand(CanExecute = nameof(CanSave))] private Task Save() => Act(VmAction.Save, "Saving", "is saved");
    private bool CanSave() => Can(VmStates.CanSave);

    [RelayCommand(CanExecute = nameof(CanPause))] private Task Pause() => Act(VmAction.Pause, "Pausing", "is paused");
    private bool CanPause() => Can(VmStates.CanPause);

    [RelayCommand(CanExecute = nameof(CanResume))] private Task Resume() => Act(VmAction.Resume, "Resuming", "is running");
    private bool CanResume() => Can(VmStates.CanResume);

    [RelayCommand(CanExecute = nameof(CanRestart))] private Task Restart() => Act(VmAction.Restart, "Restarting", "has restarted");
    private bool CanRestart() => Can(VmStates.CanRestart);

    private Task Act(VmAction action, string doing, string done) =>
        RunAsync(Selected!, $"{doing} {Selected!.Name}.", vm => _hyperV.RunActionAsync(action, vm.Id), vm => $"{vm.Name} {done}.");

    [RelayCommand(CanExecute = nameof(CanConnect))]
    private async Task Connect()
    {
        var vm = Selected!;
        try
        {
            await _hyperV.ConnectAsync(vm);
            StatusText = $"Opening Remote Desktop to {vm.Name}.";
        }
        catch (Exception ex) { Fail(vm, "Couldn't open Remote Desktop", ex); }
    }
    private bool CanConnect() => Can(VmStates.CanConnect);

    [RelayCommand(CanExecute = nameof(CanOpenConsole))]
    private void OpenConsole()
    {
        var vm = Selected!;
        try { _hyperV.OpenConsole(vm); StatusText = $"Opening the console for {vm.Name}."; }
        catch (Exception ex) { Fail(vm, "Couldn't open the console", ex); }
    }
    private bool CanOpenConsole() => Selected is not null;

    [RelayCommand(CanExecute = nameof(CanConnect))]
    private async Task SaveConnectionFile()
    {
        var vm = Selected!;
        try
        {
            var saved = await _hyperV.SaveConnectionFileAsync(vm);
            var name = System.IO.Path.GetFileName(saved.Path);
            StatusText = saved.AlreadyThere
                ? $"{name} on the desktop already connects to {vm.Name}, so it was left as it is."
                : $"Saved {name} on the desktop. Opening it connects to {vm.Name}.";
            Announce?.Invoke(StatusText);
        }
        catch (Exception ex) { Fail(vm, "Couldn't save a connection file", ex); }
    }

    /// <summary>Allowed while the VM is busy: it only looks, and a VM partway through something
    /// is when its screen is most worth seeing.</summary>
    [RelayCommand(CanExecute = nameof(CanScreenshot))]
    private async Task Screenshot()
    {
        var vm = Selected!;
        // From inside the VM it takes a few seconds; say it has started.
        StatusText = $"Taking a picture of {vm.Name}'s screen.";
        Announce?.Invoke(StatusText);
        try
        {
            var picture = await Screenshots.TakeAsync(vm, _lifetime.Token);
            StatusText = (picture.Info is { } info
                    ? $"Took a picture of {info.User}'s {(info.RemoteDesktop ? "Remote Desktop session" : "session")} in {vm.Name}."
                    : $"Took a picture of {vm.Name}'s own screen." + (picture.Note.Length > 0 ? " " + picture.Note : "")) +
                (picture.IsBlank ? $" It's {ScreenPicture.BlankNote}, which usually means the VM's display is asleep or off." : "");
            ShowScreenshot?.Invoke(vm, picture);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Fail(vm, $"Couldn't take a picture of {vm.Name}'s screen", ex); }
    }
    private bool CanScreenshot() => Selected is { } vm && VmStates.CanScreenshot(vm.State);

    [RelayCommand(CanExecute = nameof(CanSettle))]
    private void Settings() => OpenSettings?.Invoke(Selected!);
    private bool CanSettle() => Can(VmStates.IsSettled);

    [RelayCommand(CanExecute = nameof(CanSettle))]
    private Task Checkpoint()
    {
        var vm = Selected!;
        var name = RequestCheckpointName?.Invoke(vm);
        if (string.IsNullOrWhiteSpace(name)) return Task.CompletedTask;
        return RunAsync(vm, $"Creating checkpoint {name} of {vm.Name}.",
            v => _hyperV.CreateCheckpointAsync(v.Id, name.Trim()), v => $"Checkpoint {name.Trim()} created for {v.Name}.");
    }

    [RelayCommand(CanExecute = nameof(CanApplyCheckpoint))]
    private async Task ApplyCheckpoint()
    {
        var vm = Selected!;
        IReadOnlyList<CheckpointInfo> checkpoints;
        // Reading them takes a moment; say so, rather than leaving the key press unanswered.
        StatusText = $"Reading {vm.Name}'s checkpoints.";
        try { checkpoints = await _hyperV.GetCheckpointsAsync(vm.Id, _lifetime.Token); }
        catch (OperationCanceledException) { return; }
        catch (Exception ex) { Fail(vm, $"Couldn't read {vm.Name}'s checkpoints", ex); return; }
        if (checkpoints.Count == 0)
        {
            StatusText = $"{vm.Name} has no checkpoints.";
            Announce?.Invoke(StatusText);
            return;
        }
        if (RequestCheckpointToApply?.Invoke(vm, checkpoints) is not { } choice) return;

        var name = choice.Checkpoint.Name;
        var savedAs = choice.SaveCurrentFirst ? $"Before applying {name}, {DateTime.Now:yyyy-MM-dd HH.mm}" : null;
        await RunAsync(vm, $"Applying checkpoint {name} to {vm.Name}.",
            async v =>
            {
                try { await _hyperV.ApplyCheckpointAsync(v.Id, choice.Checkpoint.Id, savedAs); }
                // It may have got partway: say what could already have happened, so nobody has
                // to work it out from the list.
                catch (Exception ex) when (savedAs is not null || VmStates.CanTurnOff(v.State))
                {
                    throw new HyperVException(ex.Message + PartwayNote(v, savedAs));
                }
            },
            v => $"{v.Name} is back at checkpoint {name}, and is {v.StateText.ToLowerInvariant()}." +
                 (savedAs is null ? "" : $" How it was before is kept as checkpoint {savedAs}."));
    }

    internal static string PartwayNote(VmInfo vm, string? savedAs) =>
        (savedAs is null ? "" : $" How it was may already be kept as checkpoint {savedAs}.") +
        (VmStates.CanTurnOff(vm.State) ? $" {vm.Name} may already have been turned off." : "");

    /// <summary>Only for a VM with checkpoints, in a settled state.</summary>
    private bool CanApplyCheckpoint() => Can(VmStates.IsSettled) && Selected!.CheckpointCount > 0;

    [RelayCommand(CanExecute = nameof(CanClone))]
    private Task Clone()
    {
        var vm = Selected!;
        var name = RequestCloneName?.Invoke(vm)?.Trim();
        if (string.IsNullOrEmpty(name)) return Task.CompletedTask;
        if (NewVmScript.NameProblem(name) is { } problem)
        {
            StatusText = problem;
            Announce?.Invoke(problem);
            return Task.CompletedTask;
        }
        return RunAsync(vm, $"Cloning {vm.Name} as {name}. This copies the whole disk and can take several minutes.",
            v => _hyperV.CloneAsync(v.Id, name), v => $"{name} is ready, a copy of {v.Name}.");
    }

    /// <summary>Only from off or saved: a copy of a running VM would join the network as a
    /// second machine with the same name.</summary>
    private bool CanClone() => Can(VmStates.CanClone);

    [RelayCommand(CanExecute = nameof(CanSettle))]
    private async Task Delete()
    {
        var vm = Selected!;
        IReadOnlyList<string> disks;
        try { disks = await _hyperV.GetDiskPathsAsync(vm.Id); }
        catch (Exception ex) { Fail(vm, $"Couldn't read {vm.Name}'s disks, so nothing was deleted", ex); return; }
        if (ConfirmDelete?.Invoke(vm, disks) != true) return;

        DeleteResult? result = null;
        await RunAsync(vm, $"Deleting {vm.Name}.", async v => result = await _hyperV.DeleteAsync(v.Id),
            v => DescribeDelete(v.Name, result!));
    }

    internal static string DescribeDelete(string name, DeleteResult r)
    {
        var text = new System.Text.StringBuilder($"{name} is deleted.");
        if (r.Kept.Count > 0) text.Append(" Kept ").Append(string.Join("; ", r.Kept)).Append('.');
        if (r.Failed.Count > 0) text.Append(" Couldn't delete ").Append(string.Join("; ", r.Failed)).Append('.');
        return text.ToString();
    }

    [RelayCommand]
    private void NewVm() => OpenNewVm?.Invoke();

    /// <summary>Runs one operation on a VM: marks it busy, says what is happening, then refreshes
    /// and says how it ended. Failures carry Hyper-V's own message.</summary>
    internal async Task RunAsync(VmInfo vm, string starting, Func<VmInfo, Task> op, Func<VmInfo, string> finished)
    {
        vm.IsBusy = true;
        StatusText = starting;
        Announce?.Invoke(starting);
        try
        {
            await op(vm);
            vm.IsBusy = false;
            await RefreshAsync(quiet: true, mustRead: true);
            var text = finished(vm);
            StatusText = text;
            Announce?.Invoke(text);
        }
        catch (Exception ex)
        {
            vm.IsBusy = false;
            Fail(vm, $"{vm.Name}: that didn't work", ex);
            await RefreshAsync(quiet: true, mustRead: true);
        }
    }

    private void Fail(VmInfo vm, string what, Exception ex)
    {
        var text = $"{what}. {ex.Message}";
        StatusText = text;
        Announce?.Invoke(text);
    }

    public void Dispose()
    {
        _lifetime.Cancel();
        _lifetime.Dispose();
    }
}

/// <summary>The checkpoint to apply, and whether to keep how the VM is now as a checkpoint first.</summary>
public sealed record CheckpointChoice(CheckpointInfo Checkpoint, bool SaveCurrentFirst);
