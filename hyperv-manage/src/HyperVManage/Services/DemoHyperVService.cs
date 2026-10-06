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

    public DemoHyperVService()
    {
        // One VM with a checkpoint, so Apply Checkpoint has something to show.
        AddCheckpoint(_vms[1], "Clean install");
    }

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

    // Each pretend checkpoint keeps the state it was taken in, to return to.
    private readonly Dictionary<string, List<(CheckpointInfo Info, string State)>> _checkpoints = [];
    private readonly Dictionary<string, string> _currentCheckpoint = [];

    public async Task CreateCheckpointAsync(string vmId, string checkpointName, CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate) AddCheckpoint(Find(vmId), checkpointName);
    }

    private void AddCheckpoint(VmInfo vm, string name)
    {
        if (!_checkpoints.TryGetValue(vm.Id, out var list)) _checkpoints[vm.Id] = list = [];
        var id = Guid.NewGuid().ToString();
        list.Add((new CheckpointInfo(id, name, DateTime.Now, false), vm.State));
        _currentCheckpoint[vm.Id] = id;
        vm.CheckpointCount = list.Count;
    }

    public Task<IReadOnlyList<CheckpointInfo>> GetCheckpointsAsync(string vmId, CancellationToken ct = default)
    {
        lock (_gate)
        {
            Find(vmId);
            var current = _currentCheckpoint.GetValueOrDefault(vmId);
            var list = _checkpoints.GetValueOrDefault(vmId) ?? [];
            return Task.FromResult<IReadOnlyList<CheckpointInfo>>(list.Select(c => c.Info with { IsCurrent = c.Info.Id == current })
                .Reverse().ToList());
        }
    }

    public async Task ApplyCheckpointAsync(string vmId, string checkpointId, string? saveCurrentAs, CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate)
        {
            var vm = Find(vmId);
            var list = _checkpoints.GetValueOrDefault(vmId) ?? [];
            var target = list.FirstOrDefault(c => c.Info.Id == checkpointId);
            if (target.Info is null) throw new HyperVException("That checkpoint no longer exists.");
            if (saveCurrentAs is not null) AddCheckpoint(vm, saveCurrentAs);
            // Like a standard checkpoint: one taken while running comes back saved, memory and all.
            vm.State = target.State is "Running" or "Paused" ? "Saved" : target.State;
            vm.IpAddresses = [];
            vm.MemoryAssignedMB = 0;
            _currentCheckpoint[vmId] = checkpointId;
        }
    }

    public async Task CloneAsync(string vmId, string newName, CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate)
        {
            if (_vms.Any(v => v.Name.Equals(newName, StringComparison.OrdinalIgnoreCase)))
                throw new HyperVException($"There is already a VM named {newName}.");
            var source = Find(vmId);
            if (source.State is not ("Off" or "Saved"))
                throw new HyperVException($"Shut down or save {source.Name} first.");
            var copy = Copy(source, Guid.NewGuid().ToString());
            copy.Name = newName;
            copy.State = "Off";
            copy.IpAddresses = [];
            copy.MemoryAssignedMB = 0;
            copy.CheckpointCount = 0;
            _vms.Add(copy);
        }
    }

    public Task<IReadOnlyList<string>> GetDiskPathsAsync(string vmId, CancellationToken ct = default)
    {
        lock (_gate)
            return Task.FromResult<IReadOnlyList<string>>([$@"C:\ProgramData\Microsoft\Windows\Virtual Hard Disks\{Find(vmId).Name}.vhdx"]);
    }

    public async Task<DeleteResult> DeleteAsync(string vmId, CancellationToken ct = default)
    {
        var disks = await GetDiskPathsAsync(vmId, ct);
        await Task.Delay(Delay, ct);
        lock (_gate)
        {
            _vms.Remove(Find(vmId));
            _checkpoints.Remove(vmId);
            _currentCheckpoint.Remove(vmId);
        }
        return new DeleteResult(disks, [], []);
    }

    // Demo mode never reaches a real VM, even one whose name matches a demo VM.
    public Task ConnectAsync(VmInfo vm, CancellationToken ct = default) =>
        throw new HyperVException("This is the demo, so there's no real VM to connect to.");

    public void OpenConsole(VmInfo vm) =>
        throw new HyperVException("This is the demo, so there's no real VM to open.");

    public Task<SavedConnection> SaveConnectionFileAsync(VmInfo vm, CancellationToken ct = default) =>
        throw new HyperVException("This is the demo, so no connection file was saved.");

    /// <summary>A made-up screen, so the viewer can be tried: a blue desktop with a window on
    /// it and a taskbar, in the RGB565 pixels Hyper-V gives, through the same conversion.</summary>
    public async Task<ScreenPicture> TakeScreenshotAsync(string vmId, CancellationToken ct = default)
    {
        await Task.Delay(Delay, ct);
        lock (_gate)
        {
            var vm = Find(vmId);
            if (!VmStates.CanScreenshot(vm.State)) throw new HyperVException(
                "Hyper-V wouldn't give a picture at any size it was asked for: 1024 by 768 (error 32775), 640 by 480 (error 32775).");
        }
        const int width = 1024, height = 768;
        var pixels = new byte[width * height * 2];
        for (var y = 0; y < height; y++)
            for (var x = 0; x < width; x++)
            {
                ushort color =
                    y >= height - 48 ? Rgb565(32, 32, 32) // taskbar
                    : x is >= 262 and < 762 && y is >= 200 and < 232 ? Rgb565(240, 240, 240) // title bar
                    : x is >= 262 and < 762 && y is >= 232 and < 520 ? Rgb565(255, 255, 255) // window
                    : Rgb565(0, 90, 158); // desktop
                pixels[(y * width + x) * 2] = (byte)color;
                pixels[(y * width + x) * 2 + 1] = (byte)(color >> 8);
            }
        return ScreenPicture.FromRgb565(pixels, width, height, DateTime.Now);
    }

    private static ushort Rgb565(int r, int g, int b) => (ushort)((r >> 3) << 11 | (g >> 2) << 5 | b >> 3);

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
