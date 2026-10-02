using HyperVManage.Models;

namespace HyperVManage.Services;

public enum VmAction { Start, ShutDown, TurnOff, Save, Pause, Resume, Restart }

/// <summary>A Hyper-V virtual switch. ToString is what the Network list shows and speaks.</summary>
public sealed record SwitchInfo(string Name, string SwitchType, string AdapterDescription)
{
    /// <summary>The "no switch" choice: a VM whose network adapter isn't connected.</summary>
    public static SwitchInfo NotConnected { get; } = new("", "None", "");

    public string Description => SwitchType switch
    {
        "External" => "your network: other computers can reach the VM",
        "Internal" => "this PC only",
        "Private" => "other VMs only",
        "Missing" => "which no longer exists",
        _ => SwitchType,
    };

    public override string ToString() =>
        Name.Length == 0 ? "Not connected"
        : Name == "Default Switch" ? "Default Switch, this PC only"
        : $"{Name}, {Description}";
}

/// <summary>The settings the Settings window can change. Hardware fields only apply while the VM
/// is off. An empty SwitchName means the network adapter is not connected.</summary>
public sealed record VmSettings(
    int ProcessorCount,
    long MemoryStartupMB,
    bool DynamicMemory,
    string SwitchName,
    string AutomaticStartAction,
    bool AutomaticCheckpoints);

/// <summary>What Delete did with each file: removed, kept because something else uses it, or
/// couldn't remove.</summary>
public sealed record DeleteResult(IReadOnlyList<string> Deleted, IReadOnlyList<string> Kept, IReadOnlyList<string> Failed);

/// <summary>Everything Hyper-V Manage asks of Hyper-V. VMs are addressed by id, never by name:
/// Hyper-V allows two VMs with the same name.</summary>
public interface IHyperVService
{
    Task<IReadOnlyList<VmInfo>> GetVmsAsync(CancellationToken ct = default);
    Task<IReadOnlyList<SwitchInfo>> GetSwitchesAsync(CancellationToken ct = default);
    Task RunActionAsync(VmAction action, string vmId, CancellationToken ct = default);
    Task ApplySettingsAsync(string vmId, VmSettings current, VmSettings wanted, CancellationToken ct = default);
    Task CreateCheckpointAsync(string vmId, string checkpointName, CancellationToken ct = default);
    Task CloneAsync(string vmId, string newName, CancellationToken ct = default);

    /// <summary>The disk files attached to a VM, for the Delete confirmation to name.</summary>
    Task<IReadOnlyList<string>> GetDiskPathsAsync(string vmId, CancellationToken ct = default);
    Task<DeleteResult> DeleteAsync(string vmId, CancellationToken ct = default);

    /// <summary>Creates an external switch on the adapter this PC uses for the internet and
    /// returns its name. This PC's connection drops for a few seconds while Windows does it.</summary>
    Task<string> CreateExternalSwitchAsync(CancellationToken ct = default);

    /// <summary>Opens Remote Desktop to the VM.</summary>
    Task ConnectAsync(VmInfo vm, CancellationToken ct = default);

    /// <summary>Opens the Hyper-V console window for the VM.</summary>
    void OpenConsole(VmInfo vm);

    /// <summary>Saves a Remote Desktop connection file for the VM on the desktop and returns
    /// its path.</summary>
    Task<string> SaveConnectionFileAsync(VmInfo vm, CancellationToken ct = default);
}
