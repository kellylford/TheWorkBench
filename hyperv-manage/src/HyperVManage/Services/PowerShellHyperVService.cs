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
                CheckpointCount = @(Get-VMSnapshot -VM $_ -ErrorAction SilentlyContinue | Where-Object { "$($_.SnapshotType)" -notmatch 'Recovery|Replica' }).Count
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
            // -Type Reboot asks Windows inside the VM to restart, like Shut Down does. Without
            // it Restart-VM resets the VM, which is pulling the power and loses unsaved work.
            VmAction.Restart => "Restart-VM -VM $vm -Type Reboot -Force",
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
            lines.Add(wanted.SwitchName.Length == 0
                ? "Get-VMNetworkAdapter -VM $vm | Select-Object -First 1 | Disconnect-VMNetworkAdapter"
                : $"Get-VMNetworkAdapter -VM $vm | Select-Object -First 1 | Connect-VMNetworkAdapter -SwitchName {Ps.Quote(wanted.SwitchName)}");
        if (wanted.AutomaticStartAction != current.AutomaticStartAction)
            lines.Add($"Set-VM -VM $vm -AutomaticStartAction {wanted.AutomaticStartAction}");
        if (wanted.AutomaticCheckpoints != current.AutomaticCheckpoints)
            lines.Add($"Set-VM -VM $vm -AutomaticCheckpointsEnabled {Ps.Bool(wanted.AutomaticCheckpoints)}");
        return string.Join("\n", lines);
    }

    public Task CreateCheckpointAsync(string vmId, string checkpointName, CancellationToken ct = default) =>
        PowerShellRunner.RunAsync(GetVm(vmId) + $"Checkpoint-VM -VM $vm -SnapshotName {Ps.Quote(checkpointName)}", ct);

    // The time goes as ISO 8601 text with its offset, so it never depends on how Windows
    // PowerShell serialises a DateTime. Backup (Recovery) and Replica checkpoints are left out,
    // as Hyper-V Manager leaves them out: they aren't the user's to go back to. The list's
    // CheckpointCount leaves out the same ones.
    internal const string CheckpointsScript = """
        $checkpoints = @(Get-VMSnapshot -VM $vm -ErrorAction SilentlyContinue |
            Where-Object { "$($_.SnapshotType)" -notmatch 'Recovery|Replica' } | Sort-Object CreationTime -Descending | ForEach-Object {
            [pscustomobject]@{
                Id = $_.Id.ToString()
                Name = $_.Name
                Created = $_.CreationTime.ToString('o')
                IsCurrent = [bool]($vm.ParentSnapshotId -and $_.Id -eq $vm.ParentSnapshotId)
            }
        })
        ConvertTo-Json -InputObject $checkpoints -Depth 2 -Compress
        """;

    public async Task<IReadOnlyList<CheckpointInfo>> GetCheckpointsAsync(string vmId, CancellationToken ct = default) =>
        ParseCheckpoints(await PowerShellRunner.RunAsync(GetVm(vmId) + CheckpointsScript, ct).ConfigureAwait(false));

    public Task ApplyCheckpointAsync(string vmId, string checkpointId, string? saveCurrentAs, CancellationToken ct = default) =>
        PowerShellRunner.RunAsync(BuildApplyCheckpointScript(vmId, checkpointId, saveCurrentAs), ct);

    /// <summary>
    /// A VM that is running or paused is turned off first, as Hyper-V Manager's Apply does. The
    /// checkpoint is found by id, since two can share a name, and before anything changes, so a
    /// checkpoint deleted meanwhile changes nothing.
    /// </summary>
    internal static string BuildApplyCheckpointScript(string vmId, string checkpointId, string? saveCurrentAs)
    {
        var lines = new List<string>
        {
            GetVm(vmId).TrimEnd(),
            $"$checkpoint = Get-VMSnapshot -VM $vm | Where-Object {{ $_.Id.ToString() -eq {Ps.Quote(checkpointId)} }}",
            "if (-not $checkpoint) { throw 'That checkpoint no longer exists.' }",
        };
        if (saveCurrentAs is not null)
            lines.Add($"Checkpoint-VM -VM $vm -SnapshotName {Ps.Quote(saveCurrentAs)}");
        lines.Add("if ($vm.State -in 'Running', 'Paused') { Stop-VM -VM $vm -TurnOff -Force }");
        lines.Add("Restore-VMSnapshot -VMSnapshot $checkpoint -Confirm:$false");
        return string.Join("\n", lines);
    }

    public Task CloneAsync(string vmId, string newName, CancellationToken ct = default) =>
        PowerShellRunner.RunAsync(BuildCloneScript(vmId, newName), ct);

    /// <summary>
    /// Hyper-V has no clone command. Export the VM, import that as a copy with a new id into the
    /// usual VM and disk folders under the new name, then delete the export. The export goes beside
    /// the VM disks, not into TEMP, since it is a full copy of the disk and the system drive may be
    /// the small one. Anything made before a failure is removed again.
    /// </summary>
    internal static string BuildCloneScript(string vmId, string newName) => GetVm(vmId) + $$"""
        $newName = {{Ps.Quote(newName)}}
        # Where-Object, not Get-VM -Name, which would read [ ] * ? in a name as wildcards.
        if (Get-VM | Where-Object Name -eq $newName) { throw "There is already a VM named $newName." }
        if ($vm.State -notin 'Off', 'Saved') { throw "Shut down or save $($vm.Name) first, so the copy is taken from a VM that isn't changing." }
        $vmHost = Get-VMHost
        $vmFolder = Join-Path $vmHost.VirtualMachinePath $newName
        $diskFolder = Join-Path $vmHost.VirtualHardDiskPath $newName
        foreach ($f in $vmFolder, $diskFolder) { if (Test-Path -LiteralPath $f) { throw "The folder $f already exists. Pick another name, or remove the folder." } }
        $export = Join-Path $vmHost.VirtualHardDiskPath ('.HyperVManage-clone-' + [guid]::NewGuid().ToString('N'))
        $copy = $null
        try {
            Export-VM -VM $vm -Path $export
            $config = Get-ChildItem -LiteralPath $export -Recurse -Filter *.vmcx | Where-Object { $_.Directory.Name -eq 'Virtual Machines' } | Select-Object -First 1
            if (-not $config) { throw "The export of $($vm.Name) has no VM configuration in it." }
            $copy = Import-VM -Path $config.FullName -Copy -GenerateNewId `
                -VirtualMachinePath $vmFolder -SnapshotFilePath $vmFolder -SmartPagingFilePath $vmFolder `
                -VhdDestinationPath $diskFolder
            Rename-VM -VM $copy -NewName $newName
        } catch {
            if ($copy) { Remove-VM -VM $copy -Force -ErrorAction SilentlyContinue }
            foreach ($f in $vmFolder, $diskFolder) { Remove-Item -LiteralPath $f -Recurse -Force -ErrorAction SilentlyContinue }
            throw
        } finally {
            Remove-Item -LiteralPath $export -Recurse -Force -ErrorAction SilentlyContinue
        }
        """;

    public async Task<IReadOnlyList<string>> GetDiskPathsAsync(string vmId, CancellationToken ct = default)
    {
        var output = await PowerShellRunner.RunAsync(GetVm(vmId) + DiskPathsScript, ct).ConfigureAwait(false);
        return ParseStringList(output);
    }

    // With checkpoints, a VM's attached disk is a checkpoint's .avhdx. Delete merges checkpoints
    // first, so the file that actually goes is the .vhdx at the end of that chain: name that one.
    internal const string DiskPathsScript = """
        $paths = @(Get-VMHardDiskDrive -VM $vm | ForEach-Object {
            $p = [string]$_.Path
            while ($p -and $p -like '*.avhdx') {
                $parent = (Get-VHD -Path $p -ErrorAction SilentlyContinue).ParentPath
                if (-not $parent) { break }
                $p = $parent
            }
            $p
        } | Where-Object { $_ })
        ConvertTo-Json -InputObject $paths -Compress
        """;

    internal static IReadOnlyList<string> ParseStringList(string json)
    {
        using var doc = JsonDocument.Parse(NonEmpty(json));
        var root = doc.RootElement;
        return root.ValueKind switch
        {
            JsonValueKind.Array => root.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!).ToList(),
            JsonValueKind.String => [root.GetString()!],
            _ => [],
        };
    }

    public async Task<DeleteResult> DeleteAsync(string vmId, CancellationToken ct = default) =>
        ParseDeleteResult(await PowerShellRunner.RunAsync(BuildDeleteScript(vmId), ct).ConfigureAwait(false));

    /// <summary>
    /// Matches New-HyperVRdpVM.ps1 -Remove. Checkpoints go first so their changes merge into the
    /// disks rather than leaving .avhdx files behind. A disk another VM relies on is kept: one it
    /// has attached, or the parent of one of its differencing disks. The desktop connection file
    /// and its saved sign-in go only when the file connects to this VM, by its name or address;
    /// a file that merely shares the VM's name belongs to something else. The VM's computer name
    /// is worked out by the script's own lines, taken from the embedded script, so the file the
    /// script made is always recognised, as is one an earlier version made (its computer name was
    /// the first 15 characters). The folders Clone makes, named after the VM under Hyper-V's VM and
    /// disk folders, go too once nothing is left in them, but only when this VM's configuration or
    /// one of its disks was in them, so an unrelated folder that happens to share the name stays.
    /// </summary>
    internal static string BuildDeleteScript(string vmId) => GetVm(vmId) + "$VMName = $vm.Name\n" + NewVmScript.ComputerNameRule() + """

        $name = $vm.Name
        $names = @($ComputerName, $LegacyComputerName) | Select-Object -Unique
        $ips = @(Get-VMNetworkAdapter -VM $vm | ForEach-Object { $_.IPAddresses })
        if ($vm.State -ne 'Off') { Stop-VM -VM $vm -TurnOff -Force }
        Get-VMSnapshot -VM $vm -ErrorAction SilentlyContinue | Remove-VMSnapshot -IncludeAllChildSnapshots -ErrorAction SilentlyContinue
        $deadline = (Get-Date).AddMinutes(5)
        while ((Get-VM -Id $vm.Id).Status -match 'Merging' -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
        $disks = @(Get-VMHardDiskDrive -VM $vm | Select-Object -ExpandProperty Path)
        $inUse = @{}
        foreach ($other in @(Get-VM | Where-Object { $_.Id -ne $vm.Id })) {
            foreach ($path in @(Get-VMHardDiskDrive -VM $other | Select-Object -ExpandProperty Path)) {
                $current = $path
                while ($current) {
                    $inUse[$current.ToLowerInvariant()] = $other.Name
                    $current = (Get-VHD -Path $current -ErrorAction SilentlyContinue).ParentPath
                }
            }
        }
        $deleted = @(); $kept = @(); $failed = @()
        $vmHost = Get-VMHost
        function Test-Inside([string]$child, [string]$parent) {
            $child -and $child.TrimEnd('\').StartsWith($parent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
        }
        $nameFolders = @()
        $vmFolder = Join-Path $vmHost.VirtualMachinePath $name
        if (Test-Inside $vm.ConfigurationLocation $vmFolder) { $nameFolders += $vmFolder }
        $diskFolder = Join-Path $vmHost.VirtualHardDiskPath $name
        if ($disks | Where-Object { Test-Inside $_ $diskFolder }) { $nameFolders += $diskFolder }
        Remove-VM -VM $vm -Force
        foreach ($d in $disks) {
            if (-not $d) { continue }
            if ($inUse.ContainsKey($d.ToLowerInvariant())) { $kept += "$d, which $($inUse[$d.ToLowerInvariant()]) uses"; continue }
            try { Remove-Item -LiteralPath $d -Force -ErrorAction Stop; $deleted += $d }
            catch { $failed += "$d ($($_.Exception.Message))" }
        }
        $rdp = Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.rdp"
        if (Test-Path -LiteralPath $rdp) {
            $address = Get-Content -LiteralPath $rdp | Where-Object { $_ -like 'full address:s:*' } |
                Select-Object -First 1 | ForEach-Object { $_.Substring(15) }
            $ours = @($names | ForEach-Object { "$_.local"; $_; "$_.mshome.net" }) + $ips
            # The script writes "username:s:<computer>\<user>". That identifies its file even when
            # the VM is off, has no address to compare, or its address has changed since.
            $madeForIt = [bool](Get-Content -LiteralPath $rdp | Where-Object { $line = $_; $names | Where-Object { $line -like "username:s:$_\*" } })
            if ($address -and (($ours -contains $address) -or $madeForIt)) {
                cmdkey /delete:"TERMSRV/$address" | Out-Null
                try { Remove-Item -LiteralPath $rdp -Force -ErrorAction Stop; $deleted += $rdp }
                catch { $failed += "$rdp ($($_.Exception.Message))" }
            } else {
                $kept += "$rdp, which connects to $address rather than this VM"
            }
        }
        # Only a folder with no files left anywhere in it: Hyper-V's shared folders themselves,
        # and anything another VM keeps there, are never touched.
        foreach ($folder in $nameFolders) {
            if ((Test-Path -LiteralPath $folder -PathType Container) -and
                -not (Get-ChildItem -LiteralPath $folder -Recurse -File -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
                try { Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction Stop; $deleted += $folder }
                catch { $failed += "$folder ($($_.Exception.Message))" }
            }
        }
        ConvertTo-Json -InputObject ([pscustomobject]@{ Deleted = @($deleted); Kept = @($kept); Failed = @($failed) }) -Depth 3 -Compress
        """;

    internal static DeleteResult ParseDeleteResult(string json)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
        var root = doc.RootElement;
        return new DeleteResult(Strings(root, "Deleted"), Strings(root, "Kept"), Strings(root, "Failed"));
    }

    public async Task<string> CreateExternalSwitchAsync(CancellationToken ct = default) =>
        (await PowerShellRunner.RunAsync(CreateSwitchScript, ct).ConfigureAwait(false)).Trim();

    // The same choices as New-HyperVRdpVM.ps1: reuse an external switch whose adapter is up;
    // otherwise create one on the adapter Windows prefers for the internet (route metric plus
    // interface metric, on a physical adapter that is up), then wait for this PC's own
    // connection to come back through it.
    internal const string CreateSwitchScript = """
        $existing = Get-VMSwitch -SwitchType External -ErrorAction SilentlyContinue | Where-Object {
            @(Get-NetAdapter -InterfaceDescription $_.NetAdapterInterfaceDescription -ErrorAction SilentlyContinue |
                Where-Object Status -eq 'Up').Count -gt 0
        } | Select-Object -First 1
        if ($existing) { $existing.Name; return }
        $routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object {
            $interface = Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
            [pscustomobject]@{ Index = $_.ifIndex; Metric = [int]$_.RouteMetric + [int]$interface.InterfaceMetric }
        } | Sort-Object Metric
        $adapter = $null
        foreach ($route in $routes) {
            $a = Get-NetAdapter -InterfaceIndex $route.Index -ErrorAction SilentlyContinue
            if ($a -and $a.Status -eq 'Up' -and -not $a.Virtual) { $adapter = $a; break }
        }
        if (-not $adapter) { throw "Can't find the network adapter this PC uses for the internet. Connect to a network first." }
        $name = 'External Network'
        if (Get-VMSwitch -Name $name -ErrorAction SilentlyContinue) { throw "A switch named '$name' already exists but isn't an external switch whose adapter is connected. Remove it in Hyper-V Manager, then try again." }
        try {
            New-VMSwitch -Name $name -NetAdapterName $adapter.Name -AllowManagementOS $true -ErrorAction Stop | Out-Null
        } catch {
            throw "Couldn't create the switch on $($adapter.Name): $($_.Exception.Message) If this PC has lost its network connection, remove what was made by running Remove-VMSwitch -Name '$name' -Force in an administrator PowerShell window."
        }
        $deadline = (Get-Date).AddSeconds(90)
        while (-not (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -InterfaceAlias "vEthernet ($name)" -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
        if (-not (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -InterfaceAlias "vEthernet ($name)" -ErrorAction SilentlyContinue)) {
            throw "The switch $name was created, but this PC hasn't got its network connection back through it after 90 seconds. If it doesn't return, remove the switch by running Remove-VMSwitch -Name '$name' -Force in an administrator PowerShell window."
        }
        $name
        """;

    public async Task ConnectAsync(VmInfo vm, CancellationToken ct = default) =>
        await RemoteDesktop.ConnectAsync(vm.Name, await CurrentAddressesAsync(vm, ct).ConfigureAwait(false)).ConfigureAwait(false);

    public void OpenConsole(VmInfo vm) => RemoteDesktop.OpenConsole(vm.Id);

    public async Task<SavedConnection> SaveConnectionFileAsync(VmInfo vm, CancellationToken ct = default) =>
        await RemoteDesktop.SaveDesktopFileAsync(vm.Name, await CurrentAddressesAsync(vm, ct).ConfigureAwait(false)).ConfigureAwait(false);

    /// <summary>
    /// The VM's IPv4 addresses as Hyper-V reports them now. The list's copy can be up to ten
    /// seconds old, and Windows inside a VM that has just started or resumed reports its address
    /// only once it is up, so a connection made from the list's copy can find none yet.
    /// </summary>
    private static async Task<IReadOnlyList<string>> CurrentAddressesAsync(VmInfo vm, CancellationToken ct)
    {
        try
        {
            var output = await PowerShellRunner.RunAsync(GetVm(vm.Id) + AddressesScript, ct).ConfigureAwait(false);
            var fresh = ParseStringList(output);
            return fresh.Count > 0 ? fresh : vm.IpAddresses;
        }
        catch (HyperVException) { return vm.IpAddresses; }
    }

    internal const string AddressesScript = """
        $addresses = @(Get-VMNetworkAdapter -VM $vm | ForEach-Object { $_.IPAddresses } |
            Where-Object { $_ -and $_ -notmatch ':' } | ForEach-Object { [string]$_ })
        ConvertTo-Json -InputObject $addresses -Compress
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

    internal static IReadOnlyList<CheckpointInfo> ParseCheckpoints(string json)
    {
        using var doc = JsonDocument.Parse(NonEmpty(json));
        return AsArray(doc.RootElement)
            .Select(e => new CheckpointInfo(Str(e, "Id"), Str(e, "Name"),
                DateTimeOffset.TryParse(Str(e, "Created"), System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var created) ? created.LocalDateTime : default,
                Flag(e, "IsCurrent")))
            .ToList();
    }

    internal static string NonEmpty(string json) => string.IsNullOrWhiteSpace(json) ? "[]" : json;

    // Windows PowerShell can still unwrap a one-item array in some paths; accept a bare object too.
    internal static IEnumerable<JsonElement> AsArray(JsonElement root) =>
        root.ValueKind == JsonValueKind.Array ? root.EnumerateArray()
        : root.ValueKind == JsonValueKind.Object ? [root]
        : [];

    internal static string Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static long Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : 0;

    private static bool Flag(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    internal static string[] Strings(JsonElement e, string name)
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
