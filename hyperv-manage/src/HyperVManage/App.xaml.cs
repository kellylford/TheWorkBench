using System.ComponentModel;
using System.Diagnostics;
using System.Security.Principal;
using System.Windows;
using HyperVManage.Services;
using HyperVManage.ViewModels;
using HyperVManage.Views;

namespace HyperVManage;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // --demo: pretend VMs, no Hyper-V, no administrator rights. For trying the app out and
        // for checking the UI on a machine without Hyper-V.
        var demo = e.Args.Contains("--demo", StringComparer.OrdinalIgnoreCase);

        if (!demo)
        {
            if (!IsAdministrator())
            {
                // Hyper-V's cmdlets need administrator rights, and so does building a VM's disk.
                // Ask once, the way New-HyperVRdpVM.ps1 does, and carry on in the elevated copy.
                if (!RelaunchElevated(e.Args))
                {
                    MessageBox.Show(
                        "Hyper-V Manage needs administrator rights to manage virtual machines. " +
                        "Run it again and choose Yes when Windows asks.",
                        "Hyper-V Manage", MessageBoxButton.OK, MessageBoxImage.Information);
                }
                Shutdown();
                return;
            }
            if (!HyperVAvailable())
            {
                MessageBox.Show(
                    "Hyper-V isn't turned on on this PC, or this edition of Windows doesn't include it. " +
                    "On Windows Pro, Enterprise or Education, run this in an administrator PowerShell window and restart:\n\n" +
                    "Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All",
                    "Hyper-V Manage", MessageBoxButton.OK, MessageBoxImage.Information);
                Shutdown();
                return;
            }
        }

        IHyperVService service = demo ? new DemoHyperVService() : new PowerShellHyperVService();
        var vm = new MainViewModel(service, demo ? new InMemoryCredentialStore() : new WindowsCredentialStore());
        var window = new MainWindow(vm, demo);
        MainWindow = window;
        window.Show();
    }

    private static bool IsAdministrator() =>
        new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);

    private static bool RelaunchElevated(string[] args)
    {
        var exe = Environment.ProcessPath;
        if (exe is null) return false;
        var psi = new ProcessStartInfo(exe) { UseShellExecute = true, Verb = "runas" };
        foreach (var a in args) psi.ArgumentList.Add(a);
        try
        {
            Process.Start(psi);
            return true;
        }
        catch (Win32Exception)
        {
            // The user chose No at the permission prompt.
            return false;
        }
    }

    // The Hyper-V PowerShell module ships with the Hyper-V feature; its folder is the cheapest check.
    private static bool HyperVAvailable() =>
        System.IO.Directory.Exists(System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "Modules", "Hyper-V"));
}
