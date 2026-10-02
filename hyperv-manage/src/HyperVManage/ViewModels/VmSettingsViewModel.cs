using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperVManage.Models;
using HyperVManage.Services;

namespace HyperVManage.ViewModels;

/// <summary>A choice in the "Start with this PC" list. ToString is what a screen reader speaks.</summary>
public sealed record StartOption(string Value, string Text)
{
    public override string ToString() => Text;

    public static IReadOnlyList<StartOption> All { get; } =
    [
        new("Start", "Always"),
        new("StartIfRunning", "Only if it was running when the PC shut down"),
        new("Nothing", "Never"),
    ];
}

/// <summary>The Settings window for one VM.</summary>
public sealed partial class VmSettingsViewModel : ObservableObject
{
    private readonly IHyperVService _hyperV;
    private readonly VmSettings _current;

    public VmSettingsViewModel(IHyperVService hyperV, VmInfo vm)
    {
        _hyperV = hyperV;
        VmId = vm.Id;
        VmName = vm.Name;
        CanChangeHardware = VmStates.CanChangeHardware(vm.State);
        _current = new VmSettings(vm.ProcessorCount, vm.MemoryStartupMB, vm.DynamicMemory, vm.SwitchName,
                                  vm.AutomaticStartAction, vm.AutomaticCheckpoints);

        _processors = vm.ProcessorCount.ToString();
        _memoryGB = (vm.MemoryStartupMB / 1024.0).ToString("0.##");
        _dynamicMemory = vm.DynamicMemory;
        _automaticCheckpoints = vm.AutomaticCheckpoints;
        _startOption = StartOption.All.FirstOrDefault(o => o.Value == vm.AutomaticStartAction) ?? StartOption.All[1];
    }

    public string VmId { get; }
    public string VmName { get; }
    public string Title => $"Settings for {VmName}";

    /// <summary>Hyper-V refuses processor and startup-memory changes unless the VM is off.</summary>
    public bool CanChangeHardware { get; }
    public string HardwareNote => CanChangeHardware ? ""
        : "Processors and memory can only be changed while the VM is off. Shut it down first to change them.";
    public bool HasHardwareNote => !CanChangeHardware;
    public bool HardwareIsReadOnly => !CanChangeHardware;

    [ObservableProperty] private string _processors;
    [ObservableProperty] private string _memoryGB;
    [ObservableProperty] private bool _dynamicMemory;
    [ObservableProperty] private bool _automaticCheckpoints;
    [ObservableProperty] private StartOption _startOption;
    [ObservableProperty] private SwitchInfo? _selectedSwitch;
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(HasError))] private string _error = "";
    [ObservableProperty] [NotifyCanExecuteChangedFor(nameof(SaveCommand), nameof(CreateExternalSwitchCommand))] private bool _isWorking;

    public bool HasError => Error.Length > 0;

    public ObservableCollection<SwitchInfo> Switches { get; } = [];
    public IReadOnlyList<StartOption> StartOptions => StartOption.All;

    /// <summary>Offered when no switch reaches the PC's own network.</summary>
    public bool HasNoExternalSwitch => Switches.All(s => s.SwitchType != "External");

    /// <summary>Raised with text to speak, and when the window should close after a save.</summary>
    public event Action<string>? Announce;
    public event Action? Saved;

    public async Task LoadAsync()
    {
        try
        {
            Switches.Clear();
            foreach (var s in await _hyperV.GetSwitchesAsync()) Switches.Add(s);
            SelectedSwitch = Switches.FirstOrDefault(s => s.Name == _current.SwitchName) ?? Switches.FirstOrDefault();
        }
        catch (Exception ex) { Error = $"Couldn't read the network switches: {ex.Message}"; }
        OnPropertyChanged(nameof(HasNoExternalSwitch));
    }

    /// <summary>Checks the typed values. Returns the settings to apply, or null with Error set.</summary>
    internal VmSettings? Validate()
    {
        if (!int.TryParse(Processors.Trim(), out var cpus) || cpus < 1 || cpus > Environment.ProcessorCount)
        {
            Error = $"Processors must be a whole number from 1 to {Environment.ProcessorCount}, the number this PC has.";
            return null;
        }
        if (!double.TryParse(MemoryGB.Trim(), out var gb) || gb < 0.5 || gb > 1024)
        {
            Error = "Memory must be a number of gigabytes, at least 0.5.";
            return null;
        }
        // Hyper-V wants startup memory in whole multiples of 2 MB.
        var mb = (long)Math.Round(gb * 1024 / 2) * 2;
        Error = "";
        return new VmSettings(cpus, mb, DynamicMemory, SelectedSwitch?.Name ?? _current.SwitchName,
                              StartOption.Value, AutomaticCheckpoints);
    }

    [RelayCommand(CanExecute = nameof(NotWorking))]
    private async Task Save()
    {
        var wanted = Validate();
        if (wanted is null) { Announce?.Invoke(Error); return; }
        if (!CanChangeHardware)
            wanted = wanted with { ProcessorCount = _current.ProcessorCount, MemoryStartupMB = _current.MemoryStartupMB,
                                   DynamicMemory = _current.DynamicMemory };
        IsWorking = true;
        try
        {
            await _hyperV.ApplySettingsAsync(VmId, _current, wanted);
            Announce?.Invoke($"Settings saved for {VmName}.");
            Saved?.Invoke();
        }
        catch (Exception ex)
        {
            Error = $"Couldn't save the settings. {ex.Message}";
            Announce?.Invoke(Error);
        }
        finally { IsWorking = false; }
    }

    [RelayCommand(CanExecute = nameof(NotWorking))]
    private async Task CreateExternalSwitch()
    {
        IsWorking = true;
        Announce?.Invoke("Creating a switch on your network. This PC's connection drops for a few seconds.");
        try
        {
            var name = await _hyperV.CreateExternalSwitchAsync();
            await LoadAsync();
            SelectedSwitch = Switches.FirstOrDefault(s => s.Name == name) ?? SelectedSwitch;
            Announce?.Invoke($"Created {name}, and chose it for this VM. Save to apply.");
        }
        catch (Exception ex)
        {
            Error = $"Couldn't create the switch. {ex.Message}";
            Announce?.Invoke(Error);
        }
        finally { IsWorking = false; }
    }

    private bool NotWorking() => !IsWorking;
}
