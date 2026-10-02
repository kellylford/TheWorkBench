using HyperVManage.Models;

namespace HyperVManage.Services;

public enum VmAction { Start, ShutDown, TurnOff, Save, Pause, Resume, Restart }

/// <summary>A Hyper-V virtual switch. ToString is what the Network list shows and speaks.</summary>
public sealed record SwitchInfo(string Name, string SwitchType, string AdapterDescription)
{
    public string Description => SwitchType switch
    {
        "External" => "your network: other computers can reach the VM",
        "Internal" => "this PC only",
        "Private" => "other VMs only",
        _ => SwitchType,
    };

    public override string ToString() =>
        Name == "Default Switch" ? "Default Switch, this PC only" : $"{Name}, {Description}";
}

/// <summary>The settings the Settings window can change. Hardware fields only apply while the VM is off.</summary>
public sealed record VmSettings(
    int ProcessorCount,
    long MemoryStartupMB,
    bool DynamicMemory,
    string SwitchName,
    string AutomaticStartAction,
    bool AutomaticCheckpoints);

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
    Task DeleteAsync(string vmId, CancellationToken ct = default);

    /// <summary>Creates an external switch on the adapter this PC uses for the internet and
    /// returns its name. This PC's connection drops for a few seconds while Windows does it.</summary>
    Task<string> CreateExternalSwitchAsync(CancellationToken ct = default);
}
