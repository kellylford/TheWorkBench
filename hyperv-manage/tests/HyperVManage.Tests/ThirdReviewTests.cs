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
        Assert.Contains("$names = @($ComputerName, $LegacyComputerName)", delete);
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
    public void Delete_RemovesOnlyEmptyFoldersThatHeldThisVm()
    {
        var delete = PowerShellHyperVService.BuildDeleteScript("id");
        Assert.Contains("Join-Path $vmHost.VirtualMachinePath $name", delete);
        Assert.Contains("Join-Path $vmHost.VirtualHardDiskPath $name", delete);
        Assert.Contains("Test-Inside $vm.ConfigurationLocation $vmFolder", delete); // only if this VM lived there
        Assert.Contains("Test-Inside $_ $diskFolder", delete);                     // or one of its disks did
        Assert.Contains("-Recurse -File -Force", delete);                          // and nothing is left in it
    }

    [Fact]
    public void AVmMadeByAnEarlierVersion_IsStillRecognisedByItsFile()
    {
        // Earlier versions took the first 15 characters: SURFACEPRO7-Win11 became SURFACEPRO7-Win.
        Assert.Equal("SURFACEPRO7-Win", RemoteDesktop.LegacyComputerName("SURFACEPRO7-Win11"));
        Assert.True(RemoteDesktop.FileConnectsTo(["full address:s:SURFACEPRO7-Win.local", @"username:s:SURFACEPRO7-Win\vmuser"], "SURFACEPRO7-Win11", []));
        var script = File.ReadAllText(Path.Combine(ScriptBuildingTests.RepoRoot(), "hyperv-rdp-vm", "New-HyperVRdpVM.ps1"));
        Assert.Contains("$LegacyComputerName", script);
        Assert.Contains("$LegacyComputerName", PowerShellHyperVService.BuildDeleteScript("id"));
    }

    [Theory]
    [InlineData("...")]
    [InlineData(" . ")]
    public void NewVm_RefusesAUserNameOfOnlyDotsAndSpaces(string user)
    {
        var iso = Path.Combine(Path.GetTempPath(), "hvm-test-win.iso");
        if (!File.Exists(iso)) File.WriteAllText(iso, "");
        var n = new NewVmViewModel([]) { VmName = "Lab", UserName = user, IsoPath = iso, Processors = "1", MemoryGB = "2", DiskGB = "64" };
        Assert.Null(n.Validate());
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
    public async Task TheAdministratorsOnlyPipe_DeliversTheScriptToElevatedPowerShell()
    {
        // As the app runs it: no allowance for the current user, so only an elevated PowerShell
        // can open the pipe.
        var lines = new List<string>();
        using var p = await NewVmScript.StartWithScriptAsync("Write-Host 'arrived through the pipe'",
            pipe => NewVmScript.ReadScriptFromPipe(pipe) + "& ([scriptblock]::Create($scriptText))",
            lines.Add, ct: TestContext.Current.CancellationToken);
        await p.WaitForExitAsync(TestContext.Current.CancellationToken);
        p.WaitForExit();
        Assert.Equal(0, p.ExitCode);
        Assert.Equal(["arrived through the pipe"], lines.Where(l => l.Trim().Length > 0));
    }

    [Fact]
    public void PowerShellsXmlErrorStream_BecomesPlainLines()
    {
        // Captured from Windows PowerShell 5.1 with its output redirected: a progress record that
        // must not be read out, and an error that must be, as plain text.
        const string progress = """<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T><T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC><T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj></Objs>""";
        const string error = """<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">The VM name &apos;a&lt;b&apos; can't contain any of these_x000D__x000A_</S><S S="Error">At line:3 char:1_x000D__x000A_</S></Objs>""";
        Assert.Empty(CliXml.Lines("#< CLIXML"));
        Assert.Empty(CliXml.Lines(progress));
        Assert.Equal(["The VM name 'a<b' can't contain any of these", "At line:3 char:1"], CliXml.Lines(error));
        Assert.Equal(["Step 1 of 5: Reading the ISO."], CliXml.Lines("Step 1 of 5: Reading the ISO."));
        Assert.Equal("The VM name 'a<b' can't contain any of these\nAt line:3 char:1", CliXml.Clean("#< CLIXML\r\n" + progress + "\r\n" + error));
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
