using System.IO;
using System.Diagnostics;
using HyperVManage.Models;
using HyperVManage.Services;
using HyperVManage.ViewModels;
using Xunit;

namespace HyperVManage.Tests;

public class MainViewModelTests
{
    private static (MainViewModel vm, DemoHyperVService demo) Make()
    {
        var demo = new DemoHyperVService { Delay = TimeSpan.Zero };
        return (new MainViewModel(demo), demo);
    }

    [Fact]
    public async Task Refresh_UpdatesRowsInPlace_SoTheSelectionAndScreenReaderPositionSurvive()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        var row = vm.Vms[1];
        vm.Selected = row;

        await vm.RefreshAsync();

        Assert.Same(row, vm.Vms[1]);
        Assert.Same(row, vm.Selected);
    }

    [Fact]
    public void Merge_AddsAndRemoves_ByIdNotName()
    {
        var (vm, _) = Make();
        vm.Merge([new VmInfo("a") { Name = "One" }, new VmInfo("b") { Name = "Two" }]);
        var two = vm.Vms[1];

        // "a" goes, "b" is renamed, "c" arrives.
        vm.Merge([new VmInfo("b") { Name = "Two renamed" }, new VmInfo("c") { Name = "Three" }]);

        Assert.Equal(["Two renamed", "Three"], vm.Vms.Select(v => v.Name));
        Assert.Same(two, vm.Vms[0]);
        Assert.False(vm.IsEmpty);

        vm.Merge([]);
        Assert.True(vm.IsEmpty);
    }

    [Fact]
    public async Task Commands_FollowTheSelectedVmsState()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        vm.Selected = vm.Vms.Single(v => v.State == "Off");
        Assert.True(vm.StartCommand.CanExecute(null));
        Assert.False(vm.ShutDownCommand.CanExecute(null));
        Assert.False(vm.ConnectCommand.CanExecute(null));

        vm.Selected = vm.Vms.Single(v => v.State == "Running");
        Assert.False(vm.StartCommand.CanExecute(null));
        Assert.True(vm.ShutDownCommand.CanExecute(null));
        Assert.True(vm.ConnectCommand.CanExecute(null));

        // A busy VM takes no second operation.
        vm.Selected.IsBusy = true;
        Assert.False(vm.ShutDownCommand.CanExecute(null));
    }

    [Fact]
    public async Task AnAction_SaysWhatItIsDoing_AndHowItEnded()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        vm.Selected = vm.Vms.Single(v => v.Name == "Test2");
        var said = new List<string>();
        vm.Announce += said.Add;

        await vm.StartCommand.ExecuteAsync(null);

        Assert.Equal(["Starting Test2.", "Test2 is running."], said);
        Assert.Equal("Running", vm.Selected!.State);
        Assert.False(vm.Selected.IsBusy);
    }

    [Fact]
    public async Task AFailure_IsSpoken_WithHyperVsMessage()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        var target = vm.Vms[0];
        var said = new List<string>();
        vm.Announce += said.Add;

        await vm.RunAsync(target, "Doing it.", _ => throw new HyperVException("The device is not ready."), _ => "done");

        Assert.Contains(said, s => s.Contains("The device is not ready."));
        Assert.False(target.IsBusy);
    }

    [Fact]
    public async Task Delete_AsksFirst_NamingTheFiles_AndDoesNothingOnNo()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        vm.Selected = vm.Vms[0];
        IReadOnlyList<string>? shown = null;
        vm.ConfirmDelete = (_, disks) => { shown = disks; return false; };

        await vm.DeleteCommand.ExecuteAsync(null);
        Assert.Equal(3, vm.Vms.Count);
        Assert.NotNull(shown);
        Assert.Contains(shown, d => d.EndsWith("Win11-RDP.vhdx", StringComparison.Ordinal));

        vm.ConfirmDelete = (_, _) => true;
        await vm.DeleteCommand.ExecuteAsync(null);
        Assert.Equal(2, vm.Vms.Count);
    }

    [Fact]
    public async Task DeletingTheSelectedVm_SelectsItsNeighbour_AndAsksForFocusThere()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        vm.Selected = vm.Vms[1];
        var replaced = 0;
        vm.SelectionReplaced += () => replaced++;
        vm.ConfirmDelete = (_, _) => true;

        await vm.DeleteCommand.ExecuteAsync(null);

        Assert.Equal(1, replaced);
        Assert.Same(vm.Vms[1], vm.Selected); // the row that moved up into its place
    }

    [Fact]
    public void DescribeDelete_SaysWhatWasKeptAndWhatFailed()
    {
        Assert.Equal("A is deleted.", MainViewModel.DescribeDelete("A", new DeleteResult(["x"], [], [])));
        var text = MainViewModel.DescribeDelete("A", new DeleteResult([], ["base.vhdx, which B uses"], ["c.vhdx (in use)"]));
        Assert.Contains("Kept base.vhdx, which B uses.", text);
        Assert.Contains("Couldn't delete c.vhdx (in use).", text);
    }

    [Fact]
    public async Task Clone_OnlyFromOffOrSaved()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        vm.Selected = vm.Vms.Single(v => v.State == "Running");
        Assert.False(vm.CloneCommand.CanExecute(null));
        vm.Selected = vm.Vms.Single(v => v.State == "Saved");
        Assert.True(vm.CloneCommand.CanExecute(null));
    }

    [Fact]
    public async Task Demo_ConnectAndConsole_NeverReachARealVm()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        vm.Selected = vm.Vms.Single(v => v.Name == "Win11-RDP");
        var said = new List<string>();
        vm.Announce += said.Add;

        await vm.ConnectCommand.ExecuteAsync(null);
        vm.OpenConsoleCommand.Execute(null);

        Assert.Equal(2, said.Count(s => s.Contains("demo", StringComparison.OrdinalIgnoreCase)));
    }

    [Fact]
    public async Task Clone_UsesTheNameGiven_AndCancelDoesNothing()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        vm.Selected = vm.Vms.Single(v => v.State == "Off");

        vm.RequestCloneName = _ => null;
        await vm.CloneCommand.ExecuteAsync(null);
        Assert.Equal(3, vm.Vms.Count);

        vm.RequestCloneName = _ => "  Copy One ";
        await vm.CloneCommand.ExecuteAsync(null);
        Assert.Contains(vm.Vms, v => v.Name == "Copy One");
    }
}

public class VmSettingsViewModelTests
{
    private static VmInfo Vm(string state) => new("id") { Name = "Win11-RDP", State = state, ProcessorCount = 4,
        MemoryStartupMB = 4096, DynamicMemory = true, SwitchName = "Default Switch", AutomaticStartAction = "StartIfRunning" };

    [Theory]
    [InlineData("0", "4")]
    [InlineData("four", "4")]
    [InlineData("2", "0.1")]
    public void Validate_RefusesBadNumbers(string cpus, string gb)
    {
        var s = new VmSettingsViewModel(new DemoHyperVService(), Vm("Off")) { Processors = cpus, MemoryGB = gb };
        Assert.Null(s.Validate());
        Assert.True(s.HasError);
    }

    [Fact]
    public void Validate_RoundsMemoryToWhatHyperVAccepts()
    {
        var s = new VmSettingsViewModel(new DemoHyperVService(), Vm("Off")) { Processors = "2", MemoryGB = "3.3" };
        var result = s.Validate()!;
        Assert.Equal(0, result.MemoryStartupMB % 2);
        Assert.Equal(3380, result.MemoryStartupMB);
    }

    [Fact]
    public async Task RunningVm_SavesNetworkAndStartup_ButLeavesHardwareAlone()
    {
        var demo = new DemoHyperVService { Delay = TimeSpan.Zero };
        await demo.GetVmsAsync(TestContext.Current.CancellationToken);
        var running = (await demo.GetVmsAsync(TestContext.Current.CancellationToken)).Single(v => v.State == "Running");
        var s = new VmSettingsViewModel(demo, running);
        await s.LoadAsync();
        Assert.False(s.CanChangeHardware);

        s.Processors = "1"; // ignored: Hyper-V would refuse it while running
        s.StartOption = StartOption.All.Single(o => o.Value == "Nothing");
        var saved = false;
        s.Saved += () => saved = true;
        await s.SaveCommand.ExecuteAsync(null);

        Assert.True(saved, s.Error);
        var after = (await demo.GetVmsAsync(TestContext.Current.CancellationToken)).Single(v => v.Id == running.Id);
        Assert.Equal("Nothing", after.AutomaticStartAction);
        Assert.Equal(running.ProcessorCount, after.ProcessorCount);
    }

    [Fact]
    public async Task ADisconnectedVm_StaysDisconnected_WhenSomethingElseIsSaved()
    {
        var info = Vm("Off");
        info.SwitchName = "";
        var s = new VmSettingsViewModel(new DemoHyperVService { Delay = TimeSpan.Zero }, info);
        await s.LoadAsync();
        Assert.Same(SwitchInfo.NotConnected, s.SelectedSwitch);
        Assert.Equal("Not connected", s.SelectedSwitch!.ToString());
        Assert.Equal("", s.Validate()!.SwitchName);
    }

    [Fact]
    public async Task ASwitchThatNoLongerExists_IsShownAsItIs_AndKept()
    {
        var info = Vm("Off");
        info.SwitchName = "Old Dock";
        var s = new VmSettingsViewModel(new DemoHyperVService { Delay = TimeSpan.Zero }, info);
        await s.LoadAsync();
        Assert.Equal("Old Dock, which no longer exists", s.SelectedSwitch!.ToString());
        Assert.Equal("Old Dock", s.Validate()!.SwitchName);
    }

    [Fact]
    public void MemoryNotEdited_IsKeptExactly()
    {
        // 1500 MB shows as "1.46"; saving that back would quietly become 1496 MB.
        var info = Vm("Off");
        info.MemoryStartupMB = 1500;
        var s = new VmSettingsViewModel(new DemoHyperVService(), info);
        Assert.Equal(1500, s.Validate()!.MemoryStartupMB);
        s.MemoryGB = "2";
        Assert.Equal(2048, s.Validate()!.MemoryStartupMB);
    }

    [Fact]
    public void AnUnknownStartSetting_IsKept()
    {
        var info = Vm("Off");
        info.AutomaticStartAction = "Delayed";
        var s = new VmSettingsViewModel(new DemoHyperVService(), info);
        Assert.Equal("Delayed", s.Validate()!.AutomaticStartAction);
    }

    [Fact]
    public async Task OffersToCreateAnExternalSwitch_OnlyWhenThereIsNone()
    {
        var s = new VmSettingsViewModel(new DemoHyperVService { Delay = TimeSpan.Zero }, Vm("Off"));
        await s.LoadAsync();
        Assert.False(s.HasNoExternalSwitch); // the demo has External Wi-Fi
    }

    [Fact]
    public void StartOptions_SpeakAsWords()
    {
        Assert.Equal(["Always", "Only if it was running when the PC shut down", "Never"], StartOption.All.Select(o => o.ToString()));
    }
}

public class NewVmViewModelTests
{
    [Fact]
    public void SuggestName_SkipsNamesInUse()
    {
        Assert.Equal("Win11-RDP", NewVmViewModel.SuggestName("Win11-RDP", new HashSet<string>()));
        Assert.Equal("Win11-RDP-3", NewVmViewModel.SuggestName("Win11-RDP",
            new HashSet<string>(["win11-rdp", "Win11-RDP-2"], StringComparer.OrdinalIgnoreCase)));
    }

    [Theory]
    [InlineData("", "4", "4", "128", "Windows 11 Pro")]
    [InlineData("!!!", "4", "4", "128", "Windows 11 Pro")]
    [InlineData("A", "0", "4", "128", "Windows 11 Pro")]
    [InlineData("A", "4", "1", "128", "Windows 11 Pro")]
    [InlineData("A", "4", "4", "32", "Windows 11 Pro")]
    [InlineData("A", "4", "4", "128", "Windows 11 Home")]
    public void Validate_RefusesWhatTheScriptWouldFailOn(string name, string cpus, string mem, string disk, string edition)
    {
        var n = new NewVmViewModel([]) { VmName = name, IsoPath = "", Processors = cpus, MemoryGB = mem, DiskGB = disk, Edition = edition };
        Assert.Null(n.Validate());
        Assert.True(n.HasError);
    }

    [Fact]
    public void NetworkChoice_IsOneOrTheOther()
    {
        var n = new NewVmViewModel([]);
        Assert.True(n.OnYourNetwork);
        Assert.False(n.HostOnly);
        n.HostOnly = true;
        Assert.False(n.OnYourNetwork);
    }

    private static string AnIso()
    {
        var path = Path.Combine(Path.GetTempPath(), "hvm-test-win.iso");
        if (!File.Exists(path)) File.WriteAllText(path, "");
        return path;
    }

    private static NewVmViewModel Ready(string name) =>
        new([]) { VmName = name, IsoPath = AnIso(), Processors = "2", MemoryGB = "4", DiskGB = "128" };

    [Fact]
    public async Task Create_ShowsAndSpeaksEachLine_ThenTheOutcome()
    {
        var n = Ready("Test3");
        NewVmOptions? passed = null;
        n.RunScript = (options, onLine, _) =>
        {
            passed = options;
            onLine("Step 1 of 5: Reading the ISO.");
            onLine("All done.");
            return Task.FromResult(BuildOutcome.Succeeded);
        };
        var said = new List<string>();
        var appended = new List<string>();
        var finished = new TaskCompletionSource<BuildOutcome>();
        n.Announce += said.Add;
        n.LineAppended += appended.Add;
        n.Finished += r => finished.TrySetResult(r);

        await n.CreateCommand.ExecuteAsync(null);

        Assert.Equal(BuildOutcome.Succeeded, await finished.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken));
        Assert.Equal("Test3", passed!.VMName);
        Assert.Equal(AnIso(), passed.IsoPath);
        Assert.False(passed.HostOnly);
        Assert.Contains("Step 1 of 5: Reading the ISO.", n.LogText);
        Assert.Contains("All done.", appended);
        Assert.Contains(said, s => s == "All done.");
        Assert.Contains(said, s => s.StartsWith("Finished.", StringComparison.Ordinal));
        Assert.False(n.IsRunning);
        Assert.False(n.CreateCommand.CanExecute(null));
    }

    [Fact]
    public async Task Create_ReportsAFailure_WithoutSpeakingPowerShellsErrorClutter()
    {
        var n = Ready("Test4");
        n.RunScript = (_, onLine, _) =>
        {
            onLine("A virtual machine named Test4 already exists.");
            onLine(@"At C:\Temp\New-HyperVRdpVM.ps1:158 char:5");
            onLine("+     throw \"A virtual machine named Test4 already exists.\"");
            onLine("    + CategoryInfo          : OperationStopped");
            return Task.FromResult(BuildOutcome.Failed);
        };
        var said = new List<string>();
        n.Announce += said.Add;

        await n.CreateCommand.ExecuteAsync(null);

        Assert.Contains("stopped with an error", n.Outcome);
        Assert.Contains("CategoryInfo", n.LogText);                  // in the log
        Assert.DoesNotContain(said, s => s.Contains("CategoryInfo")); // not spoken
        Assert.DoesNotContain(said, s => s.StartsWith("At C:", StringComparison.Ordinal));
        Assert.Contains(said, s => s == "A virtual machine named Test4 already exists.");
    }

    [Fact]
    public async Task Stop_CancelsTheRun_AndEndsAsStopped()
    {
        var n = Ready("Test5");
        n.RunScript = async (_, onLine, ct) =>
        {
            try { await Task.Delay(Timeout.Infinite, ct); }
            catch (OperationCanceledException) { onLine("Stopped. Cleaning up."); }
            return BuildOutcome.Stopped;
        };
        var finished = new TaskCompletionSource<BuildOutcome>();
        n.Finished += r => finished.TrySetResult(r);

        var running = n.CreateCommand.ExecuteAsync(null);
        Assert.True(n.IsRunning);
        n.Stop();
        await running;

        Assert.Equal(BuildOutcome.Stopped, await finished.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken));
        Assert.Equal("Stopped.", n.Outcome);
        Assert.Contains("Cleaning up", n.LogText);
    }

    [Fact]
    public async Task DemoScript_RunsNoProcess_AndNothingTypedIsExecuted()
    {
        DemoNewVmScript.Pace = TimeSpan.Zero;
        var lines = new List<string>();
        var before = System.Diagnostics.Process.GetProcessesByName("cmd").Length;
        var result = await DemoNewVmScript.RunAsync(
            new NewVmOptions("x & calc", "", "", "", "", 1, 2, 64, false, true, true), lines.Add, TestContext.Current.CancellationToken);
        Assert.Equal(BuildOutcome.Succeeded, result);
        Assert.Contains(lines, l => l.Contains("x & calc"));   // shown as text, nothing more
        Assert.True(System.Diagnostics.Process.GetProcessesByName("cmd").Length <= before);
    }

    [Fact]
    public void Validate_RefusesPathAndWildcardCharactersInTheName()
    {
        var n = Ready("Win*");
        Assert.Null(n.Validate());
        Assert.Contains("can't contain", n.Error);
    }
}
