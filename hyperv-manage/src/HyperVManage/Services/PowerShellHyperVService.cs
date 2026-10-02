using System.Text.Json;
using HyperVManage.Models;

namespace HyperVManage.Services;

/// <summary>The real backend: Hyper-V's own PowerShell cmdlets, run through powershell.exe.</summary>
public sealed class PowerShellHyperVService : IHyperVService
{
    // Every field is reduced to a plain string, number or bool before ConvertTo-Json, so the
    // JSON never depends on how Windows PowerShell serialises Hyper-V's own types and enums.
    // -InputObject with @() keeps a single VM an array.
    internal const string ListScript = """
        $vms = @(Get-VM | ForEach-Object {
            $na = @($_.NetworkAdapters)
            [pscustomobject]@{
                Id = $_.Id.ToString()
                Name = $_.Name
                State = $_.State.ToString()
                ProcessorCount = [int]$_.ProcessorCount
                MemoryStartupMB = [int64]($_.MemoryStartup / 1MB)
                MemoryAssignedMB = [int64]($_.MemoryAssigned / 1MB)
                DynamicMemory = [bool]$_.DynamicMemoryEnabled
                UptimeSeconds = [int64]$_.Uptime.TotalSeconds
                AutomaticStartAction = $_.AutomaticStartAction.ToString()
                AutomaticCheckpoints = [bool]$_.AutomaticCheckpointsEnabled
                SwitchName = $(if ($na.Count) { [string]$na[0].SwitchName } else { '' })
                IPAddresses = @($na | ForEach-Object { $_.IPAddresses } | Where-Object { $_ -and $_ -notmatch ':' } | ForEach-Object { [string]$_ })
                CheckpointCount = @(Get-VMSnapshot -VM $_ -ErrorAction SilentlyContinue).Count
                Generation = [int]$_.Generation
            }
        })
        ConvertTo-Json -InputObject $vms -Depth 3 -Compress
        """;

    internal const string SwitchScript = """
        $switches = @(Get-VMSwitch | ForEach-Object {
            [pscustomobject]@{
                Name = $_.Name
                SwitchType = $_.SwitchType.ToString()
                AdapterDescription = [string]$_.NetAdapterInterfaceDescription
            }
        })
        ConvertTo-Json -InputObject $switches -Depth 2 -Compress
        """;

    public async Task<IReadOnlyList<VmInfo>> GetVmsAsync(CancellationToken ct = default) =>
        ParseVms(await PowerShellRunner.RunAsync(ListScript, ct).ConfigureAwait(false));

    public async Task<IReadOnlyList<SwitchInfo>> GetSwitchesAsync(CancellationToken ct = default) =>
        ParseSwitches(await PowerShellRunner.RunAsync(SwitchScript, ct).ConfigureAwait(false));

    public Task RunActionAsync(VmAction action, string vmId, CancellationToken ct = default)
    {
        var verb = action switch
        {
            VmAction.Start => "Start-VM -VM $vm",
            // Stop-VM without -TurnOff asks Windows inside the VM to shut down; -Force skips the
            // prompt it gives when someone is signed in.
            VmAction.ShutDown => "Stop-VM -VM $vm -Force",
            VmAction.TurnOff => "Stop-VM -VM $vm -TurnOff -Force",
            VmAction.Save => "Save-VM -VM $vm",
            VmAction.Pause => "Suspend-VM -VM $vm",
            VmAction.Resume => "Resume-VM -VM $vm",
            VmAction.Restart => "Restart-VM -VM $vm -Force",
            _ => throw new ArgumentOutOfRangeException(nameof(action)),
        };
        return PowerShellRunner.RunAsync(GetVm(vmId) + verb, ct);
    }

    public Task ApplySettingsAsync(string vmId, VmSettings current, VmSettings wanted, CancellationToken ct = default) =>
        PowerShellRunner.RunAsync(BuildSettingsScript(vmId, current, wanted), ct);

    /// <summary>Only what changed is sent, so a running VM's settings can be saved without
    /// touching the hardware ones Hyper-V refuses to change while it runs.</summary>
    internal static string BuildSettingsScript(string vmId, VmSettings current, VmSettings wanted)
    {
        var lines = new List<string> { GetVm(vmId).TrimEnd() };
        if (wanted.ProcessorCount != current.ProcessorCount)
            lines.Add($"Set-VMProcessor -VM $vm -Count {wanted.ProcessorCount}");
        if (wanted.MemoryStartupMB != current.MemoryStartupMB || wanted.DynamicMemory != current.DynamicMemory)
        {
            var startup = wanted.MemoryStartupMB * 1024L * 1024L;
            lines.Add(wanted.DynamicMemory
                // Keep the range the script sets up: from 2 GB (or less, if startup is smaller)
                // to twice startup, at least 8 GB.
                ? $"Set-VMMemory -VM $vm -DynamicMemoryEnabled $true -StartupBytes {startup} " +
                  $"-MinimumBytes {Math.Min(startup, 2048L * 1024 * 1024)} -MaximumBytes {Math.Max(startup * 2, 8192L * 1024 * 1024)}"
                : $"Set-VMMemory -VM $vm -DynamicMemoryEnabled $false -StartupBytes {startup}");
        }
        if (wanted.SwitchName != current.SwitchName)
            lines.Add($"Get-VMNetworkAdapter -VM $vm | Select-Object -First 1 | Connect-VMNetworkAdapter -SwitchName {Ps.Quote(wanted.SwitchName)}");
        if (wanted.AutomaticStartAction != current.AutomaticStartAction)
            lines.Add($"Set-VM -VM $vm -AutomaticStartAction {wanted.AutomaticStartAction}");
        if (wanted.AutomaticCheckpoints != current.AutomaticCheckpoints)
            lines.Add($"Set-VM -VM $vm -AutomaticCheckpointsEnabled {Ps.Bool(wanted.AutomaticCheckpoints)}");
        return string.Join("\n", lines);
    }

    public Task CreateCheckpointAsync(string vmId, string checkpointName, CancellationToken ct = default) =>
        PowerShellRunner.RunAsync(GetVm(vmId) + $"Checkpoint-VM -VM $vm -SnapshotName {Ps.Quote(checkpointName)}", ct);

    public Task CloneAsync(string vmId, string newName, CancellationToken ct = default) =>
        PowerShellRunner.RunAsync(BuildCloneScript(vmId, newName), ct);

    /// <summary>
    /// Hyper-V has no clone command. Export the VM to a temporary folder, import that as a copy
    /// with a new id into the usual VM and disk folders under the new name, then delete the export.
    /// </summary>
    internal static string BuildCloneScript(string vmId, string newName) => GetVm(vmId) + $$"""
        $newName = {{Ps.Quote(newName)}}
        if (Get-VM -Name $newName -ErrorAction SilentlyContinue) { throw "There is already a VM named $newName." }
        $vmHost = Get-VMHost
        $export = Join-Path $env:TEMP ('HyperVManage-clone-' + [guid]::NewGuid().ToString('N'))
        try {
            Export-VM -VM $vm -Path $export
            $config = Get-ChildItem -Path $export -Recurse -Filter *.vmcx | Where-Object { $_.Directory.Name -eq 'Virtual Machines' } | Select-Object -First 1
            if (-not $config) { throw "The export of $($vm.Name) has no VM configuration in it." }
            $vmFolder = Join-Path $vmHost.VirtualMachinePath $newName
            $copy = Import-VM -Path $config.FullName -Copy -GenerateNewId `
                -VirtualMachinePath $vmFolder -SnapshotFilePath $vmFolder -SmartPagingFilePath $vmFolder `
                -VhdDestinationPath (Join-Path $vmHost.VirtualHardDiskPath $newName)
            Rename-VM -VM $copy -NewName $newName
        } finally {
            Remove-Item -LiteralPath $export -Recurse -Force -ErrorAction SilentlyContinue
        }
        """;

    public Task DeleteAsync(string vmId, CancellationToken ct = default) =>
        PowerShellRunner.RunAsync(BuildDeleteScript(vmId), ct);

    /// <summary>
    /// Matches New-HyperVRdpVM.ps1 -Remove: the VM, its disks, the desktop connection file the
    /// script made and the sign-in it saved. Checkpoints are removed first so their changes merge
    /// into the disks being deleted rather than leaving .avhdx files behind.
    /// </summary>
    internal static string BuildDeleteScript(string vmId) => GetVm(vmId) + """
        if ($vm.State -ne 'Off') { Stop-VM -VM $vm -TurnOff -Force }
        Get-VMSnapshot -VM $vm -ErrorAction SilentlyContinue | Remove-VMSnapshot -IncludeAllChildSnapshots -ErrorAction SilentlyContinue
        $deadline = (Get-Date).AddMinutes(5)
        while ((Get-VM -Id $vm.Id).Status -match 'Merging' -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
        $disks = @(Get-VMHardDiskDrive -VM $vm | Select-Object -ExpandProperty Path)
        $name = $vm.Name
        Remove-VM -VM $vm -Force
        foreach ($d in $disks) { if ($d) { Remove-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue } }
        $rdp = Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.rdp"
        if (Test-Path -LiteralPath $rdp) {
            foreach ($line in Get-Content -LiteralPath $rdp) {
                if ($line -like 'full address:s:*') { cmdkey /delete:"TERMSRV/$($line.Substring(15))" | Out-Null }
            }
            Remove-Item -LiteralPath $rdp -Force
        }
        """;

    public async Task<string> CreateExternalSwitchAsync(CancellationToken ct = default) =>
        (await PowerShellRunner.RunAsync(CreateSwitchScript, ct).ConfigureAwait(false)).Trim();

    // The same adapter choice as New-HyperVRdpVM.ps1: the lowest-metric default route on a
    // physical adapter that is up.
    internal const string CreateSwitchScript = """
        $existing = Get-VMSwitch -SwitchType External -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($existing) { $existing.Name; return }
        $adapter = $null
        foreach ($route in (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric)) {
            $a = Get-NetAdapter -InterfaceIndex $route.ifIndex -ErrorAction SilentlyContinue
            if ($a -and $a.Status -eq 'Up' -and -not $a.Virtual) { $adapter = $a; break }
        }
        if (-not $adapter) { throw "Can't find the network adapter this PC uses for the internet. Connect to a network first." }
        $name = 'External Network'
        if (Get-VMSwitch -Name $name -ErrorAction SilentlyContinue) { throw "A switch named '$name' already exists but isn't an external switch." }
        New-VMSwitch -Name $name -NetAdapterName $adapter.Name -AllowManagementOS $true | Out-Null
        $name
        """;

    private static string GetVm(string vmId) => $"$vm = Get-VM -Id {Ps.Quote(vmId)}\n";

    // ── Parsing ──────────────────────────────────────────────────────────────

    internal static IReadOnlyList<VmInfo> ParseVms(string json)
    {
        var list = new List<VmInfo>();
        using var doc = JsonDocument.Parse(NonEmpty(json));
        foreach (var e in AsArray(doc.RootElement))
        {
            var vm = new VmInfo(Str(e, "Id"))
            {
                Name = Str(e, "Name"),
                State = Str(e, "State"),
                ProcessorCount = (int)Num(e, "ProcessorCount"),
                MemoryStartupMB = Num(e, "MemoryStartupMB"),
                MemoryAssignedMB = Num(e, "MemoryAssignedMB"),
                DynamicMemory = Flag(e, "DynamicMemory"),
                UptimeSeconds = Num(e, "UptimeSeconds"),
                AutomaticStartAction = Str(e, "AutomaticStartAction"),
                AutomaticCheckpoints = Flag(e, "AutomaticCheckpoints"),
                SwitchName = Str(e, "SwitchName"),
                IpAddresses = Strings(e, "IPAddresses"),
                CheckpointCount = (int)Num(e, "CheckpointCount"),
                Generation = (int)Num(e, "Generation"),
            };
            list.Add(vm);
        }
        return list;
    }

    internal static IReadOnlyList<SwitchInfo> ParseSwitches(string json)
    {
        using var doc = JsonDocument.Parse(NonEmpty(json));
        return AsArray(doc.RootElement)
            .Select(e => new SwitchInfo(Str(e, "Name"), Str(e, "SwitchType"), Str(e, "AdapterDescription")))
            .ToList();
    }

    private static string NonEmpty(string json) => string.IsNullOrWhiteSpace(json) ? "[]" : json;

    // Windows PowerShell can still unwrap a one-item array in some paths; accept a bare object too.
    private static IEnumerable<JsonElement> AsArray(JsonElement root) =>
        root.ValueKind == JsonValueKind.Array ? root.EnumerateArray()
        : root.ValueKind == JsonValueKind.Object ? [root]
        : [];

    private static string Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static long Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : 0;

    private static bool Flag(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static string[] Strings(JsonElement e, string name)
    {
        if (!e.TryGetProperty(name, out var v)) return [];
        return v.ValueKind switch
        {
            JsonValueKind.Array => v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                                    .Select(x => x.GetString()!).Where(s => s.Length > 0).ToArray(),
            JsonValueKind.String when v.GetString() is { Length: > 0 } s => [s],
            _ => [],
        };
    }
}
