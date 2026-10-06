using CommunityToolkit.Mvvm.ComponentModel;

namespace HyperVManage.Models;

/// <summary>
/// One virtual machine as the list shows it. An ObservableObject updated in place on every
/// refresh, rather than replaced, so the selected row, and the screen reader's place in the
/// list, survive the ten-second auto-refresh.
/// </summary>
public sealed partial class VmInfo : ObservableObject
{
    public VmInfo(string id) => Id = id;

    /// <summary>Hyper-V's VM id. Stable across renames, so it is what a refresh matches on.</summary>
    public string Id { get; }

    [ObservableProperty] [NotifyPropertyChangedFor(nameof(AccessibleName))] private string _name = "";
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(AccessibleName), nameof(StateText))] private string _state = "Off";
    [ObservableProperty] private int _processorCount;
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(MemoryText))] private long _memoryStartupMB;
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(MemoryText))] private long _memoryAssignedMB;
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(MemoryText))] private bool _dynamicMemory;
    [ObservableProperty] private long _uptimeSeconds;
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(StartsWithPcText))] private string _automaticStartAction = "";
    [ObservableProperty] private bool _automaticCheckpoints;
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(AccessibleName))] private string _switchName = "";
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(AccessibleName), nameof(AddressText))] private string[] _ipAddresses = [];
    [ObservableProperty] private int _checkpointCount;
    [ObservableProperty] private int _generation;
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(AccessibleName))] private bool _isBusy;

    public string StateText => VmStates.Describe(State);

    public string AddressText => IpAddresses.Length > 0 ? string.Join(", ", IpAddresses) : "";

    public string MemoryText =>
        MemoryAssignedMB > 0 ? $"{FormatMB(MemoryAssignedMB)} in use" : FormatMB(MemoryStartupMB);

    public string StartsWithPcText => AutomaticStartAction switch
    {
        "Start" => "Always",
        "StartIfRunning" => "If it was running",
        "Nothing" => "No",
        _ => AutomaticStartAction,
    };

    /// <summary>
    /// What a screen reader says for the row: name and state first, then the address and
    /// network, which are what someone choosing a VM to connect to needs next. Set on the row
    /// container, and returned by ToString, which is where a list item's name comes from.
    /// </summary>
    public string AccessibleName
    {
        get
        {
            var parts = new List<string> { Name, StateText };
            if (IpAddresses.Length > 0) parts.Add(AddressText);
            if (SwitchName.Length > 0) parts.Add(SwitchName);
            if (IsBusy) parts.Add("busy");
            return string.Join(", ", parts);
        }
    }

    public override string ToString() => AccessibleName;

    /// <summary>Copies every field from a fresh read, raising change notifications only for
    /// those that changed.</summary>
    public void UpdateFrom(VmInfo other)
    {
        Name = other.Name;
        State = other.State;
        ProcessorCount = other.ProcessorCount;
        MemoryStartupMB = other.MemoryStartupMB;
        MemoryAssignedMB = other.MemoryAssignedMB;
        DynamicMemory = other.DynamicMemory;
        UptimeSeconds = other.UptimeSeconds;
        AutomaticStartAction = other.AutomaticStartAction;
        AutomaticCheckpoints = other.AutomaticCheckpoints;
        SwitchName = other.SwitchName;
        if (!IpAddresses.SequenceEqual(other.IpAddresses)) IpAddresses = other.IpAddresses;
        CheckpointCount = other.CheckpointCount;
        Generation = other.Generation;
    }

    internal static string FormatMB(long mb) =>
        mb >= 1024 && mb % 1024 == 0 ? $"{mb / 1024} GB"
        : mb >= 1024 ? $"{mb / 1024.0:0.#} GB"
        : $"{mb} MB";
}

/// <summary>Hyper-V VM states (the names of Microsoft.HyperV.PowerShell.VMState) and what each allows.</summary>
public static class VmStates
{
    public static string Describe(string state) => state switch
    {
        "Off" => "Off",
        "Running" => "Running",
        "Paused" => "Paused",
        "Saved" => "Saved",
        "Starting" => "Starting",
        "Stopping" => "Shutting down",
        "Saving" => "Saving",
        "Pausing" => "Pausing",
        "Resuming" => "Resuming",
        "Reset" => "Restarting",
        _ => state,
    };

    public static bool CanStart(string s) => s is "Off" or "Saved";
    public static bool CanShutDown(string s) => s is "Running";
    public static bool CanTurnOff(string s) => s is "Running" or "Paused";
    public static bool CanSave(string s) => s is "Running" or "Paused";
    public static bool CanPause(string s) => s is "Running";
    public static bool CanResume(string s) => s is "Paused";
    public static bool CanRestart(string s) => s is "Running";
    public static bool CanConnect(string s) => s is "Running";

    /// <summary>Hyper-V has a screen to show only while the VM is running or paused.</summary>
    public static bool CanScreenshot(string s) => s is "Running" or "Paused";

    /// <summary>Settled states, where configuration, checkpoints, cloning and deleting are safe.
    /// A VM partway through starting or saving is left alone until it gets there.</summary>
    public static bool IsSettled(string s) => s is "Off" or "Running" or "Paused" or "Saved";

    public static bool CanClone(string s) => s is "Off" or "Saved";

    /// <summary>Processor count, startup memory and dynamic memory can only change while off.</summary>
    public static bool CanChangeHardware(string s) => s is "Off";
}
