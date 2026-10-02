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
            NewVmScript.BuildCommand(@"C:\x\New-HyperVRdpVM.ps1", Options()),
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
        var extracted = File.ReadAllBytes(NewVmScript.ExtractScript());
        var repo = File.ReadAllBytes(Path.Combine(RepoRoot(), "hyperv-rdp-vm", "New-HyperVRdpVM.ps1"));
        Assert.Equal(repo, extracted);
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

    [Theory]
    [InlineData("Win11-RDP", "Win11-RDP")]
    [InlineData("Build Agent (old)", "BuildAgentold")]
    [InlineData("AVeryLongVirtualMachineName", "AVeryLongVirtua")]
    public void ComputerName_MatchesTheScript(string vmName, string expected) =>
        Assert.Equal(expected, RemoteDesktop.ComputerName(vmName));

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
