// Guards for the findings of the second independent review of the Hyper-V Manage branch.

using System.IO;
using HyperVManage.Models;
using HyperVManage.Services;
using HyperVManage.ViewModels;
using Xunit;

namespace HyperVManage.Tests;

public class SecondReviewTests
{
    [Fact]
    public void TheScriptsConnectionFile_IsRecognised_WhenTheVmIsOffAndHasNoAddress()
    {
        // The script writes the IP when the VM's name didn't resolve in time, and a VM that is off
        // reports no addresses: only the user name it writes still ties the file to the VM.
        string[] file = ["full address:s:192.168.1.77", @"username:s:Win11-RDP\vmuser"];
        Assert.True(RemoteDesktop.FileConnectsTo(file, "Win11-RDP", []));
        Assert.False(RemoteDesktop.FileConnectsTo(["full address:s:192.168.1.77", @"username:s:OFFICE\kelly"], "Win11-RDP", []));
    }

    [Fact]
    public void Delete_RecognisesTheScriptsFileTheSameWay_AndReportsAFailedRemoval()
    {
        var delete = PowerShellHyperVService.BuildDeleteScript("id");
        Assert.Contains(@"-like ""username:s:$computer\*""", delete);
        Assert.Contains("$failed += \"$rdp", delete);
        var script = File.ReadAllText(Path.Combine(ScriptBuildingTests.RepoRoot(), "hyperv-rdp-vm", "New-HyperVRdpVM.ps1"));
        Assert.Contains(@"-like ""username:s:$ComputerName\*""", script);
    }

    [Fact]
    public void TheDeleteConfirmation_NamesTheBaseDisk_NotACheckpointsFile()
    {
        Assert.Contains("*.avhdx", PowerShellHyperVService.DiskPathsScript);
        Assert.Contains("ParentPath", PowerShellHyperVService.DiskPathsScript);
    }

    [Fact]
    public async Task TheDiskListScript_Parses()
    {
        var check = $"$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput({Ps.Quote("$vm = $null\n" + PowerShellHyperVService.DiskPathsScript)}, [ref]$null, [ref]$e); $e.Count";
        Assert.Equal("0", (await PowerShellRunner.RunAsync(check, TestContext.Current.CancellationToken)).Trim());
    }

    [Theory]
    [InlineData("Win11-RDP", null)]
    [InlineData("", "Give the VM a name.")]
    [InlineData("..", "The name can't end with a dot or a space.")]
    [InlineData("copy.", "The name can't end with a dot or a space.")]
    [InlineData("copy ", "The name can't end with a dot or a space.")]
    [InlineData(@"..\Windows", "The name can't contain any of these: \\ / : * ? \" < > | [ ]")]
    public void NameProblem(string name, string? expected) => Assert.Equal(expected, NewVmScript.NameProblem(name));

    [Fact]
    public async Task Clone_RefusesANameThatCantBeAFolder_WithoutCloning()
    {
        var demo = new DemoHyperVService { Delay = TimeSpan.Zero };
        var vm = new MainViewModel(demo);
        await vm.RefreshAsync();
        vm.Selected = vm.Vms.Single(v => v.State == "Off");
        var said = new List<string>();
        vm.Announce += said.Add;
        vm.RequestCloneName = _ => "..";

        await vm.CloneCommand.ExecuteAsync(null);

        Assert.Equal(3, vm.Vms.Count);
        Assert.Contains(said, s => s.Contains("can't end with a dot"));
    }

    [Fact]
    public void ASmallMemoryVm_CanStillSaveOtherSettings()
    {
        // 256 MB reads "0.25", below what may be typed; left alone it must not block a save.
        var info = new VmInfo("id") { Name = "Tiny", State = "Off", ProcessorCount = 1, MemoryStartupMB = 256,
            SwitchName = "", AutomaticStartAction = "Start" };
        var s = new VmSettingsViewModel(new DemoHyperVService(), info);
        var result = s.Validate();
        Assert.NotNull(result);
        Assert.Equal(256, result!.MemoryStartupMB);

        s.MemoryGB = "0.3"; // typed: now it is checked, and is below the minimum
        Assert.Null(s.Validate());
    }

    [Fact]
    public void TheIsoPassedToTheScript_IsAFullPath()
    {
        var iso = Path.Combine(Path.GetTempPath(), "hvm-test-win.iso");
        if (!File.Exists(iso)) File.WriteAllText(iso, "");
        var cwd = Environment.CurrentDirectory;
        try
        {
            Environment.CurrentDirectory = Path.GetTempPath();
            var n = new NewVmViewModel([]) { VmName = "A", IsoPath = "hvm-test-win.iso", Processors = "1", MemoryGB = "2", DiskGB = "64" };
            Assert.Equal(iso, n.Validate()!.IsoPath);
        }
        finally { Environment.CurrentDirectory = cwd; }
    }
}
