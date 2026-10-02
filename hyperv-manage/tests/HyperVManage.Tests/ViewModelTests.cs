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
    public async Task Delete_AsksFirst_AndDoesNothingOnNo()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        vm.Selected = vm.Vms[0];
        vm.ConfirmDelete = _ => false;

        await vm.DeleteCommand.ExecuteAsync(null);
        Assert.Equal(3, vm.Vms.Count);

        vm.ConfirmDelete = _ => true;
        await vm.DeleteCommand.ExecuteAsync(null);
        Assert.Equal(2, vm.Vms.Count);
    }

    [Fact]
    public async Task Clone_UsesTheNameGiven_AndCancelDoesNothing()
    {
        var (vm, _) = Make();
        await vm.RefreshAsync();
        vm.Selected = vm.Vms[0];

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

    [Fact]
    public async Task Create_ShowsAndSpeaksEachLine_ThenTheOutcome()
    {
        var n = new NewVmViewModel([]) { VmName = "Test3", IsoPath = "", Processors = "2", MemoryGB = "4", DiskGB = "128" };
        NewVmOptions? passed = null;
        n.StartScript = (options, onLine) =>
        {
            passed = options;
            onLine("Step 1 of 5: Reading the ISO.");
            onLine("All done.");
            // A real process that exits at once with code 0 stands in for powershell.exe.
            return Process.Start(new ProcessStartInfo("cmd.exe", "/c exit 0") { CreateNoWindow = true, UseShellExecute = false, })!.WithRaisingEvents();
        };
        var said = new List<string>();
        var finished = new TaskCompletionSource<bool>();
        n.Announce += said.Add;
        n.Finished += ok => finished.TrySetResult(ok);

        n.CreateCommand.Execute(null);

        Assert.True(await finished.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken));
        Assert.Equal("Test3", passed!.VMName);
        Assert.False(passed.HostOnly);
        Assert.Contains("Step 1 of 5: Reading the ISO.", n.LogText);
        Assert.Contains(said, s => s == "All done.");
        Assert.Contains(said, s => s.StartsWith("Finished.", StringComparison.Ordinal));
        Assert.False(n.IsRunning);
        Assert.False(n.CreateCommand.CanExecute(null));
    }

    [Fact]
    public async Task Create_ReportsAFailure()
    {
        var n = new NewVmViewModel([]) { VmName = "Test4", IsoPath = "", Processors = "2", MemoryGB = "4", DiskGB = "128" };
        n.StartScript = (_, onLine) =>
        {
            onLine("A virtual machine named Test4 already exists.");
            return Process.Start(new ProcessStartInfo("cmd.exe", "/c exit 1") { CreateNoWindow = true, UseShellExecute = false })!.WithRaisingEvents();
        };
        var finished = new TaskCompletionSource<bool>();
        n.Finished += ok => finished.TrySetResult(ok);

        n.CreateCommand.Execute(null);

        Assert.False(await finished.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken));
        Assert.Contains("stopped with an error", n.Outcome);
    }
}

internal static class ProcessTestExtensions
{
    public static Process WithRaisingEvents(this Process p)
    {
        p.EnableRaisingEvents = true;
        return p;
    }
}
