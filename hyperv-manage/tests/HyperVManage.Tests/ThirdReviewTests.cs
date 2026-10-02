// Guards for the findings of the third independent review of the Hyper-V Manage branch.

using System.IO;
using HyperVManage.Services;
using HyperVManage.ViewModels;
using Xunit;

namespace HyperVManage.Tests;

public class ThirdReviewTests
{
    [Fact]
    public void Delete_WorksOutTheComputerNameWithTheScriptsOwnLines()
    {
        // Delete had its own copy of the old rule, so for a long name it looked for the wrong
        // computer name and left the script's connection file and saved sign-in behind.
        var delete = PowerShellHyperVService.BuildDeleteScript("id");
        Assert.Contains(NewVmScript.ComputerNameRule(), delete);
        Assert.Contains("$computer = $ComputerName", delete);
        Assert.DoesNotContain("$computer.Substring(0, 15)", delete);
    }

    [Theory]
    [InlineData("SURFACEPRO7-Win11")]
    [InlineData("DESKTOP-ABC1234-Win11-2")]
    [InlineData("Win11-RDP")]
    public async Task Delete_GetsTheSameComputerNameAsTheApp(string vmName)
    {
        var lines = $"$vm = [pscustomobject]@{{ Name = {Ps.Quote(vmName)} }}\n$VMName = $vm.Name\n" + NewVmScript.ComputerNameRule() + "\n$ComputerName";
        var fromScript = (await PowerShellRunner.RunAsync(lines, TestContext.Current.CancellationToken)).Trim();
        Assert.Equal(RemoteDesktop.ComputerName(vmName), fromScript);
    }

    [Fact]
    public void Delete_RemovesOnlyEmptyFoldersNamedAfterTheVm()
    {
        var delete = PowerShellHyperVService.BuildDeleteScript("id");
        Assert.Contains("Join-Path $vmHost.VirtualMachinePath $name", delete);
        Assert.Contains("Join-Path $vmHost.VirtualHardDiskPath $name", delete);
        Assert.Contains("-Recurse -File -Force", delete); // nothing is removed while a file is left
    }

    [Fact]
    public void StoppingABuild_LeavesAnIsoTheUserHadOpenAlone()
    {
        var keep = NewVmScript.BuildCleanupScript("A", @"C:\ISOs\a.iso", @"C:\VHD\A.vhdx", isoWasMounted: true);
        Assert.Contains("$iso = ''", keep);
        var unmount = NewVmScript.BuildCleanupScript("A", @"C:\ISOs\a.iso", @"C:\VHD\A.vhdx", isoWasMounted: false);
        Assert.Contains(@"$iso = 'C:\ISOs\a.iso'", unmount);
    }

    [Fact]
    public void ProgramsAreStartedByFullPath()
    {
        // A bare name is looked up in the elevated app's own folder first.
        foreach (var path in new[] { SystemTools.PowerShell, SystemTools.RemoteDesktop, SystemTools.Console })
            Assert.True(Path.IsPathFullyQualified(path), path);
        Assert.True(File.Exists(SystemTools.PowerShell), SystemTools.PowerShell);
        Assert.True(File.Exists(SystemTools.RemoteDesktop), SystemTools.RemoteDesktop);
    }

    [Theory]
    [InlineData("2025", "vmuser", "pw", "made only of digits")]
    [InlineData("Lab", "a/b", "pw", "user name")]
    [InlineData("Lab", "averyveryverylongusername", "pw", "user name")]
    [InlineData("Lab", "vmuser", "pa\"ss", "double quote")]
    public void NewVm_RefusesWhatWindowsWouldOnlyRefuseInsideTheVm(string name, string user, string password, string expected)
    {
        var iso = Path.Combine(Path.GetTempPath(), "hvm-test-win.iso");
        if (!File.Exists(iso)) File.WriteAllText(iso, "");
        var n = new NewVmViewModel([]) { VmName = name, UserName = user, Password = password, IsoPath = iso, Processors = "1", MemoryGB = "2", DiskGB = "64" };
        Assert.Null(n.Validate());
        Assert.Contains(expected, n.Error);
    }

    [Fact]
    public void NewVm_MemoryAboveTheScriptsLimit_IsRefusedInTheForm()
    {
        var iso = Path.Combine(Path.GetTempPath(), "hvm-test-win.iso");
        if (!File.Exists(iso)) File.WriteAllText(iso, "");
        var n = new NewVmViewModel([]) { VmName = "Lab", IsoPath = iso, Processors = "1", MemoryGB = "600", DiskGB = "64" };
        Assert.Null(n.Validate());
        Assert.Contains("512", n.Error);
    }

    public static bool IsAdmin => new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent())
        .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);

    [Fact(Skip = "Needs administrator rights, as the app has.", SkipUnless = nameof(IsAdmin))]
    public void TheScriptsFolder_OnlyAdministratorsAndSystemCanChange()
    {
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var top = Path.Combine(programData, $"HyperVManage-test-{Guid.NewGuid():N}");
        var run = Path.Combine(top, "Run");
        try
        {
            // Made first with the ordinary inherited permissions, as someone else could have.
            Directory.CreateDirectory(run);
            AdminOnlyFolder.Ensure(programData, run);
            foreach (var folder in new[] { top, run })
            {
                var acl = new DirectoryInfo(folder).GetAccessControl();
                Assert.True(acl.AreAccessRulesProtected, $"{folder} still inherits");
                var who = acl.GetAccessRules(true, true, typeof(System.Security.Principal.SecurityIdentifier))
                    .Cast<System.Security.AccessControl.FileSystemAccessRule>()
                    .Select(r => ((System.Security.Principal.SecurityIdentifier)r.IdentityReference).Value).Distinct().OrderBy(s => s);
                Assert.Equal(["S-1-5-18", "S-1-5-32-544"], who); // SYSTEM, Administrators
            }
        }
        finally { Directory.Delete(top, recursive: true); }
    }

    [Fact]
    public void TheScript_RefusesTheSameInputsBeforeBuildingAnything()
    {
        var script = File.ReadAllText(Path.Combine(ScriptBuildingTests.RepoRoot(), "hyperv-rdp-vm", "New-HyperVRdpVM.ps1"));
        Assert.Contains("can't use a computer name made only of digits", script);
        Assert.Contains("as a user name", script);
        Assert.Contains("must not contain a double quote", script);
        Assert.Contains("hasn't been given a network address", script);
    }
}
