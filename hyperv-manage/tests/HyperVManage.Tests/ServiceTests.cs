using System.IO;
using HyperVManage.Models;
using HyperVManage.Services;
using Xunit;

namespace HyperVManage.Tests;

public class VmStateTests
{
    [Theory]
    [InlineData("Off", true, false, false, false, false, false)]
    [InlineData("Saved", true, false, false, false, false, false)]
    [InlineData("Running", false, true, true, true, true, false)]
    [InlineData("Paused", false, false, true, true, false, true)]
    [InlineData("Starting", false, false, false, false, false, false)]
    public void EachStateAllowsOnlyWhatHyperVAccepts(string state, bool start, bool shutDown, bool turnOff, bool save, bool pause, bool resume)
    {
        Assert.Equal(start, VmStates.CanStart(state));
        Assert.Equal(shutDown, VmStates.CanShutDown(state));
        Assert.Equal(turnOff, VmStates.CanTurnOff(state));
        Assert.Equal(save, VmStates.CanSave(state));
        Assert.Equal(pause, VmStates.CanPause(state));
        Assert.Equal(resume, VmStates.CanResume(state));
    }

    [Fact]
    public void HardwareChangesOnlyWhileOff()
    {
        Assert.True(VmStates.CanChangeHardware("Off"));
        Assert.False(VmStates.CanChangeHardware("Running"));
        Assert.False(VmStates.CanChangeHardware("Saved"));
    }

    [Fact]
    public void TransitionalStatesAreNotSettled()
    {
        foreach (var s in new[] { "Starting", "Stopping", "Saving", "Pausing", "Resuming" })
            Assert.False(VmStates.IsSettled(s));
    }
}

public class VmInfoTests
{
    [Fact]
    public void AccessibleName_LeadsWithNameAndState_ThenAddressAndNetwork()
    {
        var vm = new VmInfo("1") { Name = "Win11-RDP", State = "Running", IpAddresses = ["10.0.0.41"], SwitchName = "External Wi-Fi" };
        Assert.Equal("Win11-RDP, Running, 10.0.0.41, External Wi-Fi", vm.AccessibleName);
        Assert.Equal(vm.AccessibleName, vm.ToString());

        vm.IsBusy = true;
        Assert.EndsWith(", busy", vm.AccessibleName);
    }

    [Fact]
    public void AccessibleName_SkipsWhatIsMissing()
    {
        var vm = new VmInfo("1") { Name = "Test2", State = "Stopping" };
        Assert.Equal("Test2, Shutting down", vm.AccessibleName);
    }

    [Fact]
    public void UpdateFrom_RaisesOnlyForWhatChanged()
    {
        var vm = new VmInfo("1") { Name = "A", State = "Off", IpAddresses = ["10.0.0.1"] };
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.UpdateFrom(new VmInfo("1") { Name = "A", State = "Running", IpAddresses = ["10.0.0.1"] });

        Assert.Contains(nameof(VmInfo.State), changed);
        Assert.DoesNotContain(nameof(VmInfo.Name), changed);
        Assert.DoesNotContain(nameof(VmInfo.IpAddresses), changed);
    }

    [Theory]
    [InlineData(4096, "4 GB")]
    [InlineData(3120, "3 GB")]
    [InlineData(1536, "1.5 GB")]
    [InlineData(512, "512 MB")]
    public void FormatMB(long mb, string expected) => Assert.Equal(expected, VmInfo.FormatMB(mb));
}

public class PsQuoteTests
{
    [Theory]
    [InlineData("Win11-RDP", "'Win11-RDP'")]
    [InlineData("Kelly's VM", "'Kelly''s VM'")]
    [InlineData("a\u2019b", "'a\u2019\u2019b'")]
    [InlineData("x'; Remove-Item C:\\ -Recurse; '", "'x''; Remove-Item C:\\ -Recurse; '''")]
    [InlineData("$(Get-Process) `n", "'$(Get-Process) `n'")]
    public void Quote_MakesALiteralPowerShellCanOnlyReadAsText(string value, string expected) =>
        Assert.Equal(expected, Ps.Quote(value));

    [Fact]
    public async Task Quote_RoundTripsThroughThePowerShellParser()
    {
        // The real check: PowerShell's own parser reads the quoted text back as exactly the value,
        // as a single string token. Skipped where Windows PowerShell's parser isn't loadable.
        foreach (var value in new[] { "Kelly's VM", "a\u2018b\u2019c", "x'; Remove-Item C:\\; '", "$env:TEMP" })
        {
            var script = $"[System.Management.Automation.Language.Parser]::ParseInput({Ps.Quote("$v = " + Ps.Quote(value))}, [ref]$null, [ref]$null).EndBlock.Statements[0].Right.Expression.Value";
            var result = await PowerShellRunner.RunAsync(script, TestContext.Current.CancellationToken);
            Assert.Equal(value, result.TrimEnd('\r', '\n'));
        }
    }
}

public class ParsingTests
{
    [Fact]
    public void ParseVms_ReadsEveryField()
    {
        const string json = """
            [{"Id":"8d1c","Name":"Win11-RDP","State":"Running","ProcessorCount":4,"MemoryStartupMB":4096,
              "MemoryAssignedMB":3120,"DynamicMemory":true,"UptimeSeconds":120,"AutomaticStartAction":"Start",
              "AutomaticCheckpoints":false,"SwitchName":"External Wi-Fi","IPAddresses":["10.0.0.41"],
              "CheckpointCount":2,"Generation":2}]
            """;
        var vm = Assert.Single(PowerShellHyperVService.ParseVms(json));
        Assert.Equal("8d1c", vm.Id);
        Assert.Equal("Win11-RDP", vm.Name);
        Assert.Equal("Running", vm.State);
        Assert.Equal(4, vm.ProcessorCount);
        Assert.Equal(4096, vm.MemoryStartupMB);
        Assert.Equal(3120, vm.MemoryAssignedMB);
        Assert.True(vm.DynamicMemory);
        Assert.Equal("Start", vm.AutomaticStartAction);
        Assert.False(vm.AutomaticCheckpoints);
        Assert.Equal("External Wi-Fi", vm.SwitchName);
        Assert.Equal(["10.0.0.41"], vm.IpAddresses);
        Assert.Equal(2, vm.CheckpointCount);
    }

    [Fact]
    public void ParseVms_AcceptsABareObject_AStringAddress_AndNoOutput()
    {
        var vm = Assert.Single(PowerShellHyperVService.ParseVms("""{"Id":"1","Name":"A","State":"Off","IPAddresses":"10.0.0.2"}"""));
        Assert.Equal(["10.0.0.2"], vm.IpAddresses);
        Assert.Empty(PowerShellHyperVService.ParseVms(""));
        Assert.Empty(PowerShellHyperVService.ParseVms("[]"));
    }

    [Fact]
    public void ParseSwitches_AndTheirSpokenNames()
    {
        var switches = PowerShellHyperVService.ParseSwitches(
            """[{"Name":"Default Switch","SwitchType":"Internal","AdapterDescription":""},{"Name":"External Wi-Fi","SwitchType":"External","AdapterDescription":"Qualcomm"}]""");
        Assert.Equal("Default Switch, this PC only", switches[0].ToString());
        Assert.Equal("External Wi-Fi, your network: other computers can reach the VM", switches[1].ToString());
    }
}

public class ScriptBuildingTests
{
    private static readonly VmSettings Current = new(4, 4096, true, "Default Switch", "StartIfRunning", false);

    [Fact]
    public void Settings_SendOnlyWhatChanged()
    {
        var script = PowerShellHyperVService.BuildSettingsScript("id-1", Current, Current with { SwitchName = "External Wi-Fi" });
        Assert.Contains("Get-VM -Id 'id-1'", script);
        Assert.Contains("Connect-VMNetworkAdapter -SwitchName 'External Wi-Fi'", script);
        Assert.DoesNotContain("Set-VMProcessor", script);
        Assert.DoesNotContain("Set-VMMemory", script);
        Assert.DoesNotContain("AutomaticStartAction", script);
    }

    [Fact]
    public void Settings_HardwareAndStartup()
    {
        var script = PowerShellHyperVService.BuildSettingsScript("id-1", Current,
            Current with { ProcessorCount = 2, MemoryStartupMB = 8192, AutomaticStartAction = "Start", AutomaticCheckpoints = true });
        Assert.Contains("Set-VMProcessor -VM $vm -Count 2", script);
        Assert.Contains($"-StartupBytes {8192L * 1024 * 1024}", script);
        Assert.Contains($"-MaximumBytes {16384L * 1024 * 1024}", script);
        Assert.Contains("Set-VM -VM $vm -AutomaticStartAction Start", script);
        Assert.Contains("-AutomaticCheckpointsEnabled $true", script);
    }

    [Fact]
    public void Settings_NotConnected_Disconnects()
    {
        var script = PowerShellHyperVService.BuildSettingsScript("id-1", Current, Current with { SwitchName = "" });
        Assert.Contains("Disconnect-VMNetworkAdapter", script);
        Assert.DoesNotContain("Connect-VMNetworkAdapter -SwitchName", script);
    }

    [Fact]
    public void Restart_AsksWindowsToReboot_RatherThanResetting()
    {
        // Without -Type Reboot, Restart-VM resets: the power-cord pull that loses unsaved work.
        Assert.Contains("Restart-VM", ServiceScriptFor(VmAction.Restart));
        Assert.Contains("-Type Reboot", ServiceScriptFor(VmAction.Restart));
    }

    private static string ServiceScriptFor(VmAction action)
    {
        // RunActionAsync builds and runs in one go; read its verb table through the source instead.
        var src = File.ReadAllText(Path.Combine(RepoRoot(), "hyperv-manage", "src", "HyperVManage", "Services", "PowerShellHyperVService.cs"));
        var line = src.Split('\n').First(l => l.Contains($"VmAction.{action} =>"));
        return line;
    }

    [Fact]
    public void Delete_KeepsWhatOtherVmsUse_AndOnlyItsOwnConnectionFile()
    {
        var delete = PowerShellHyperVService.BuildDeleteScript("id-1");
        Assert.Contains("ParentPath", delete);          // walks other VMs' differencing chains
        Assert.Contains("$inUse.ContainsKey", delete);
        Assert.Contains("$ours -contains $address", delete);
        Assert.Contains("-ErrorAction Stop", delete);   // a disk that can't go is reported, not hidden
    }

    [Fact]
    public void Clone_RefusesRunningVms_AndCleansUpAfterAFailure()
    {
        var clone = PowerShellHyperVService.BuildCloneScript("id-1", "Copy");
        Assert.Contains("$vm.State -notin 'Off', 'Saved'", clone);
        Assert.Contains("Where-Object Name -eq $newName", clone);   // not Get-VM -Name, a wildcard
        Assert.Contains("Remove-VM -VM $copy", clone);
        Assert.DoesNotContain("$env:TEMP", clone);
    }

    [Fact]
    public void ParseDeleteResult_ReadsAllThreeLists()
    {
        var r = PowerShellHyperVService.ParseDeleteResult(
            """{"Deleted":["C:\\a.vhdx"],"Kept":["C:\\base.vhdx, which Other uses"],"Failed":[]}""");
        Assert.Equal([@"C:\a.vhdx"], r.Deleted);
        Assert.Single(r.Kept);
        Assert.Empty(r.Failed);
        Assert.Equal(["x"], PowerShellHyperVService.ParseStringList("\"x\""));
        Assert.Equal(["x", "y"], PowerShellHyperVService.ParseStringList("[\"x\",\"y\"]"));
    }

    [Theory]
    [InlineData("Win11-RDP", false)]
    [InlineData("Build Agent (old)", false)]
    [InlineData("W*", true)]
    [InlineData("a[1]", true)]
    [InlineData("x/y", true)]
    [InlineData("C:", true)]
    public void VmNames_WithPathOrWildcardCharacters_AreRefused(string name, bool refused) =>
        Assert.Equal(refused, NewVmScript.HasForbiddenCharacters(name));

    [Fact]
    public void TheScriptRefusesThem_Too()
    {
        var script = File.ReadAllText(Path.Combine(RepoRoot(), "hyperv-rdp-vm", "New-HyperVRdpVM.ps1"));
        Assert.Contains("can't contain any of these", script);
    }

    [Fact]
    public void TheScript_MakesTheSwitchOnlyAfterTheDiskIsBuilt()
    {
        // A wrong ISO or a full disk must never change this PC's networking.
        var script = File.ReadAllText(Path.Combine(RepoRoot(), "hyperv-rdp-vm", "New-HyperVRdpVM.ps1"));
        var newSwitch = script.IndexOf("New-VMSwitch -Name $SwitchName", StringComparison.Ordinal);
        Assert.True(newSwitch > script.IndexOf("Expand-WindowsImage", StringComparison.Ordinal));
        Assert.True(newSwitch > script.IndexOf("Get-WindowsImage -ImagePath $wim -Index", StringComparison.Ordinal));
        Assert.True(newSwitch < script.IndexOf("New-VM -Name $VMName", StringComparison.Ordinal));
    }

    [Fact]
    public void CloneAndDelete_QuoteWhatTheyAreGiven()
    {
        var clone = PowerShellHyperVService.BuildCloneScript("id-1", "Kelly's copy");
        Assert.Contains("$newName = 'Kelly''s copy'", clone);
        Assert.Contains("Import-VM -Path $config.FullName -Copy -GenerateNewId", clone);
        Assert.Contains("Remove-Item -LiteralPath $export", clone);

        var delete = PowerShellHyperVService.BuildDeleteScript("id-1");
        Assert.Contains("Get-VM -Id 'id-1'", delete);
        Assert.Contains("Remove-VM -VM $vm -Force", delete);
    }

    [Fact]
    public async Task GeneratedScripts_Parse()
    {
        // Every script the service can send parses as PowerShell, so a typo can't hide until
        // someone with Hyper-V presses the button.
        var scripts = new[]
        {
            PowerShellHyperVService.ListScript,
            PowerShellHyperVService.SwitchScript,
            PowerShellHyperVService.CreateSwitchScript,
            PowerShellHyperVService.BuildCloneScript("id", "copy"),
            PowerShellHyperVService.BuildDeleteScript("id"),
            PowerShellHyperVService.BuildSettingsScript("id", Current, new VmSettings(2, 2048, false, "X", "Start", true)),
            PowerShellHyperVService.BuildSettingsScript("id", Current, Current with { SwitchName = "" }),
            NewVmScript.BuildCommand(@"C:\x\New-HyperVRdpVM.ps1", Options()),
            NewVmScript.BuildPrecheckScript("Kelly's VM", @"C:\ISOs\Kelly's.iso"),
            NewVmScript.BuildCleanupScript("Kelly's VM", @"C:\ISOs\a.iso", @"C:\VHD\Kelly's VM.vhdx"),
        };
        foreach (var s in scripts)
        {
            var check = $"$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput({Ps.Quote(s)}, [ref]$null, [ref]$e); $e.Count";
            var errors = (await PowerShellRunner.RunAsync(check, TestContext.Current.CancellationToken)).Trim();
            Assert.True(errors == "0", $"Parse errors ({errors}) in:\n{s}");
        }
    }

    private static NewVmOptions Options(bool hostOnly = false, bool autoStart = true, bool connect = true) =>
        new("Kelly's VM", @"C:\ISOs\Win11 Arm64.iso", "Windows 11 Pro", "vmuser", "pa'ss", 4, 8, 128, hostOnly, autoStart, connect);

    [Fact]
    public void NewVmCommand_QuotesEveryValue_AndPassesSwitchesOnlyWhenSet()
    {
        var cmd = NewVmScript.BuildCommand(@"C:\x\New-HyperVRdpVM.ps1", Options());
        Assert.Contains("& 'C:\\x\\New-HyperVRdpVM.ps1' -VMName 'Kelly''s VM'", cmd);
        Assert.Contains("-IsoPath 'C:\\ISOs\\Win11 Arm64.iso'", cmd);
        Assert.Contains("-Password 'pa''ss'", cmd);
        Assert.Contains("-MemoryGB 8", cmd);
        Assert.DoesNotContain("-HostOnly", cmd);
        Assert.DoesNotContain("-NoAutoStart", cmd);
        Assert.DoesNotContain("-NoConnect", cmd);

        var other = NewVmScript.BuildCommand("s.ps1", Options(hostOnly: true, autoStart: false, connect: false));
        Assert.Contains("-HostOnly", other);
        Assert.Contains("-NoAutoStart", other);
        Assert.Contains("-NoConnect", other);
    }

    [Fact]
    public void TheEmbeddedScript_IsTheOneInTheRepository()
    {
        var folder = Directory.CreateTempSubdirectory("hvm-script-").FullName;
        var path = NewVmScript.ExtractScript(folder);
        try
        {
            var repo = File.ReadAllBytes(Path.Combine(RepoRoot(), "hyperv-rdp-vm", "New-HyperVRdpVM.ps1"));
            Assert.Equal(repo, File.ReadAllBytes(path));
            // A fresh name each time, so nothing can be waiting at a known path.
            var second = NewVmScript.ExtractScript(folder);
            Assert.NotEqual(path, second);
            File.Delete(second);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void TheAppManifest_IsValidXml()
    {
        // Windows refuses to start an exe whose manifest isn't well-formed XML, with nothing but a
        // "side-by-side configuration" error. A "--" in a comment did exactly that once.
        var path = Path.Combine(RepoRoot(), "hyperv-manage", "src", "HyperVManage", "app.manifest");
        System.Xml.Linq.XDocument.Load(path);
    }

    internal static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (Directory.Exists(Path.Combine(dir.FullName, "hyperv-rdp-vm"))) return dir.FullName;
        throw new InvalidOperationException("Repository root not found.");
    }
}

public class RemoteDesktopTests
{
    private static Func<string, Task<string[]>> Dns(Dictionary<string, string[]> map) =>
        name => map.TryGetValue(name, out var a) ? Task.FromResult(a) : Task.FromException<string[]>(new Exception("no such host"));

    [Fact]
    public async Task PrefersTheLocalName_WhenItPointsAtTheVm()
    {
        var target = await RemoteDesktop.ChooseTargetAsync("Win11-RDP", ["10.0.0.41"],
            Dns(new() { ["Win11-RDP.local"] = ["10.0.0.41"], ["Win11-RDP"] = ["10.0.0.41"] }));
        Assert.Equal("Win11-RDP.local", target);
    }

    [Fact]
    public async Task IgnoresANameThatPointsSomewhereElse()
    {
        // The stale case seen for real: mshome.net still pointed at the Default Switch address
        // after the VM moved to the external switch.
        var target = await RemoteDesktop.ChooseTargetAsync("Win11-RDP", ["10.0.0.41"],
            Dns(new() { ["Win11-RDP.mshome.net"] = ["172.27.83.73"] }));
        Assert.Equal("10.0.0.41", target);
    }

    [Fact]
    public async Task NoAddress_NoTarget()
    {
        Assert.Null(await RemoteDesktop.ChooseTargetAsync("A", [], Dns(new())));
    }

    [Fact]
    public async Task IgnoresANameAnotherComputerAnswersToAsWell()
    {
        // Seen for real: VMs with the same name made on two PCs on one network. Win11-RDP.local
        // answered with both, and Remote Desktop connected to the other PC's VM.
        var target = await RemoteDesktop.ChooseTargetAsync("Win11-RDP", ["10.1.1.44"],
            Dns(new() { ["Win11-RDP.local"] = ["10.0.0.41", "10.1.1.44"], ["Win11-RDP"] = ["10.0.0.41"] }));
        Assert.Equal("10.1.1.44", target);
    }

    [Theory]
    [InlineData("10.1.1.44", true)]
    [InlineData("10.0.0.41", false)]
    [InlineData("Win11-RDP.local", false)] // answers with both VMs
    [InlineData("Mine.local", true)]
    [InlineData("Nobody.local", false)]
    public async Task LeadsOnlyTo_TheVmAndNothingElse(string address, bool expected)
    {
        var dns = Dns(new() { ["Win11-RDP.local"] = ["10.0.0.41", "10.1.1.44"], ["Mine.local"] = ["10.1.1.44"] });
        Assert.Equal(expected, await RemoteDesktop.LeadsOnlyToAsync(address, ["10.1.1.44"], dns));
    }

    private static readonly (string VmName, string Expected)[] NamePairs =
    [
        ("Win11-RDP", "Win11-RDP"),
        ("Build Agent (old)", "BuildAgentold"),
        ("AVeryLongVirtualMachineName", "AVeryLongViiies"),
        ("SURFACEPRO7-Win11", "SURFAebkv-Win11"),
        ("SURFACEPRO7-Win11-2", "SURwt9e-Win11-2"),
        // Windows-default host names begin alike; their VMs must still get different names.
        ("DESKTOP-ABC1234-Win11", "DESKT44eq-Win11"),
        ("DESKTOP-ABC9876-Win11", "DESKT2mbp-Win11"),
        ("-Edge-", "Edge"),
    ];

    public static TheoryData<string, string> ComputerNames()
    {
        var data = new TheoryData<string, string>();
        foreach (var (vmName, expected) in NamePairs) data.Add(vmName, expected);
        return data;
    }

    [Theory]
    [MemberData(nameof(ComputerNames))]
    public void ComputerName_ShortensToFifteenKeepingTheEnding(string vmName, string expected) =>
        Assert.Equal(expected, RemoteDesktop.ComputerName(vmName));

    [Fact]
    public void ComputerName_IsWhatTheScriptItselfComputes()
    {
        // Runs the script's own lines for the name, so the app and the script can't drift apart:
        // the app finds a VM on the network by this name.
        var script = File.ReadAllText(Path.Combine(ScriptBuildingTests.RepoRoot(), "hyperv-rdp-vm", "New-HyperVRdpVM.ps1"));
        var start = script.IndexOf("$ComputerName = ($VMName", StringComparison.Ordinal);
        var end = script.IndexOf("if (-not $ComputerName)", start, StringComparison.Ordinal);
        Assert.True(start > 0 && end > start, "the script's computer-name lines weren't found");
        var rule = script[start..end];

        var names = NamePairs.Select(p => p.VmName).ToList();
        var command = string.Join("\n", names.Select(n => $"$VMName = {Ps.Quote(n)}\n{rule}\n$ComputerName"));
        var psi = new System.Diagnostics.ProcessStartInfo("powershell.exe")
        {
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-EncodedCommand", Convert.ToBase64String(System.Text.Encoding.Unicode.GetBytes(command)) })
            psi.ArgumentList.Add(a);
        using var p = System.Diagnostics.Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        p.WaitForExit();

        Assert.Equal(names.Select(RemoteDesktop.ComputerName), output);
    }

    [Theory]
    [InlineData("full address:s:Win11-RDP.local", true)]
    [InlineData("full address:s:WIN11-RDP", true)]
    [InlineData("full address:s:10.0.0.41", true)]
    [InlineData("full address:s:Win11-RDP.mshome.net", true)]
    [InlineData("full address:s:office-pc.example.com", false)]
    [InlineData("username:s:x", false)]
    public void ADesktopFile_IsTheVmsOnlyIfItConnectsToTheVm(string line, bool expected) =>
        Assert.Equal(expected, RemoteDesktop.FileConnectsTo(["screen mode id:i:2", line], "Win11-RDP", ["10.0.0.41"]));

    [Fact]
    public void RdpFile_PlaysSoundHere_AndSendsTheMicrophone()
    {
        var file = RemoteDesktop.BuildRdpFile("Win11-RDP.local");
        Assert.Contains("full address:s:Win11-RDP.local", file);
        Assert.Contains("audiomode:i:0", file);
        Assert.Contains("audiocapturemode:i:1", file);
    }
}

public class IsoFinderTests
{
    [Fact]
    public void PicksTheNewestIsoForThisProcessor()
    {
        var dir = Directory.CreateTempSubdirectory("hvm-iso-").FullName;
        try
        {
            foreach (var (name, age) in new[] { ("Win11_25H2_English_Arm64.iso", 5), ("Win11_25H2_English_x64.iso", 1), ("Win11_24H2_English_Arm64.iso", 50), ("ubuntu.iso", 0) })
            {
                File.WriteAllText(Path.Combine(dir, name), "");
                File.SetLastWriteTimeUtc(Path.Combine(dir, name), DateTime.UtcNow.AddMinutes(-age));
            }
            Assert.EndsWith("Win11_25H2_English_Arm64.iso", IsoFinder.FindNewest(dir, hostIsArm64: true));
            Assert.EndsWith("Win11_25H2_English_x64.iso", IsoFinder.FindNewest(dir, hostIsArm64: false));
            Assert.Null(IsoFinder.FindNewest(Path.Combine(dir, "missing"), true));
        }
        finally { Directory.Delete(dir, true); }
    }
}
