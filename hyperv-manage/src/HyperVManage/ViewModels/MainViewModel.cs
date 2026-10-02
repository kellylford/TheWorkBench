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
    private bool _refreshing;

    public MainViewModel(IHyperVService hyperV) => _hyperV = hyperV;

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
    /// <summary>Asked before deleting, with the disk files that would go.</summary>
    public Func<VmInfo, IReadOnlyList<string>, bool>? ConfirmDelete { get; set; }
    public Action<VmInfo>? OpenSettings { get; set; }
    public Action? OpenNewVm { get; set; }

    public IHyperVService HyperV => _hyperV;

    partial void OnSelectedChanged(VmInfo? oldValue, VmInfo? newValue)
    {
        if (oldValue is not null) oldValue.PropertyChanged -= OnSelectedPropertyChanged;
        if (newValue is not null) newValue.PropertyChanged += OnSelectedPropertyChanged;
        RefreshCommandStates();
    }

    private void OnSelectedPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(VmInfo.State) or nameof(VmInfo.IsBusy) or nameof(VmInfo.IpAddresses))
            RefreshCommandStates();
    }

    private void RefreshCommandStates()
    {
        foreach (var c in new IRelayCommand[] { StartCommand, ShutDownCommand, TurnOffCommand, SaveCommand,
                     PauseCommand, ResumeCommand, RestartCommand, ConnectCommand, OpenConsoleCommand,
                     SettingsCommand, CheckpointCommand, CloneCommand, DeleteCommand })
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
    public async Task RefreshAsync(bool quiet = false)
    {
        if (_refreshing) return;
        _refreshing = true;
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
            _refreshing = false;
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
            await RefreshAsync(quiet: true);
            var text = finished(vm);
            StatusText = text;
            Announce?.Invoke(text);
        }
        catch (Exception ex)
        {
            vm.IsBusy = false;
            Fail(vm, $"{vm.Name}: that didn't work", ex);
            await RefreshAsync(quiet: true);
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
