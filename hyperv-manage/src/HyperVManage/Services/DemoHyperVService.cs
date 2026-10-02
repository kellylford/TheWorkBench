using HyperVManage.Models;

namespace HyperVManage.Services;

/// <summary>
/// Pretend VMs, for <c>--demo</c> and the tests: the whole UI runs without Hyper-V, without
/// administrator rights, and without touching a real VM.
/// </summary>
public sealed class DemoHyperVService : IHyperVService
{
    private readonly object _gate = new();
    private readonly List<VmInfo> _vms =
    [
        Make("Win11-RDP", "Running", "External Wi-Fi", ["10.0.0.41"], 4, 4096, 3120),
        Make("Test2", "Off", "Default Switch", [], 2, 4096, 0),
        Make("Build Agent", "Saved", "External Wi-Fi", [], 4, 8192, 0),
    ];
    private readonly List<SwitchInfo> _switches =
    [
        new("Default Switch", "Internal", ""),
        new("External Wi-Fi", "External", "Qualcomm FastConnect 7800"),
    ];

    /// <summary>How long each pretend operation takes. Zero in tests.</summary>
    public TimeSpan Delay { get; init; } = TimeSpan.FromMilliseconds(600);

    private static VmInfo Make(string name, string state, string sw, string[] ips, int cpus, long mb, long assigned) =>
        new(Guid.NewGuid().ToString()) // demo ids
        {
            Name = name, State = state, SwitchName = sw, IpAddresses = ips, ProcessorCount = cpus,
            MemoryStartupMB = mb, MemoryAssignedMB = assigned, DynamicMemory = true, Generation = 2,
            AutomaticStartAction = "Start",
        };

    public Task<IReadOnlyList<VmInfo>> GetVmsAsync(CancellationToken ct = default)
    {
        lock (_gate)
            return Task.FromResult<IReadOnlyList<VmInfo>>(_vms.Select(Copy).ToList());
    }

    public Task<IReadOnlyList<SwitchInfo>> GetSwitchesAsync(CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult<IReadOnlyList<SwitchInfo>>(_switches.ToList());
    }

    public async Task RunActionAsync(VmAction action, string vmId, CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate)
        {
            var vm = Find(vmId);
            vm.State = action switch
            {
                VmAction.Start or VmAction.Resume or VmAction.Restart => "Running",
                VmAction.ShutDown or VmAction.TurnOff => "Off",
                VmAction.Save => "Saved",
                VmAction.Pause => "Paused",
                _ => vm.State,
            };
            var on = vm.State is "Running" or "Paused";
            vm.IpAddresses = on && vm.SwitchName != "" ? ["10.0.0.5" + _vms.IndexOf(vm)] : [];
            vm.MemoryAssignedMB = on ? vm.MemoryStartupMB : 0;
        }
    }

    public async Task ApplySettingsAsync(string vmId, VmSettings current, VmSettings wanted, CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate)
        {
            var vm = Find(vmId);
            if (wanted.ProcessorCount != current.ProcessorCount || wanted.MemoryStartupMB != current.MemoryStartupMB
                || wanted.DynamicMemory != current.DynamicMemory)
            {
                if (vm.State != "Off")
                    throw new HyperVException("The operation cannot be performed while the virtual machine is in its current state.");
                vm.ProcessorCount = wanted.ProcessorCount;
                vm.MemoryStartupMB = wanted.MemoryStartupMB;
                vm.DynamicMemory = wanted.DynamicMemory;
            }
            vm.SwitchName = wanted.SwitchName;
            vm.AutomaticStartAction = wanted.AutomaticStartAction;
            vm.AutomaticCheckpoints = wanted.AutomaticCheckpoints;
        }
    }

    public async Task CreateCheckpointAsync(string vmId, string checkpointName, CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate) Find(vmId).CheckpointCount++;
    }

    public async Task CloneAsync(string vmId, string newName, CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate)
        {
            if (_vms.Any(v => v.Name.Equals(newName, StringComparison.OrdinalIgnoreCase)))
                throw new HyperVException($"There is already a VM named {newName}.");
            var copy = Copy(Find(vmId), Guid.NewGuid().ToString());
            copy.Name = newName;
            copy.State = "Off";
            copy.IpAddresses = [];
            copy.MemoryAssignedMB = 0;
            _vms.Add(copy);
        }
    }

    public async Task DeleteAsync(string vmId, CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate) _vms.Remove(Find(vmId));
    }

    public async Task<string> CreateExternalSwitchAsync(CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate)
        {
            var existing = _switches.FirstOrDefault(s => s.SwitchType == "External");
            if (existing is not null) return existing.Name;
            _switches.Add(new SwitchInfo("External Network", "External", "Demo adapter"));
            return "External Network";
        }
    }

    private VmInfo Find(string id) =>
        _vms.FirstOrDefault(v => v.Id == id) ?? throw new HyperVException("Hyper-V was unable to find a virtual machine with that id.");

    private static VmInfo Copy(VmInfo v) => Copy(v, v.Id);

    private static VmInfo Copy(VmInfo v, string id)
    {
        var c = new VmInfo(id);
        c.UpdateFrom(v);
        return c;
    }
}
