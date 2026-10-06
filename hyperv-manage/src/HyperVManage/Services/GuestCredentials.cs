using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace HyperVManage.Services;

/// <summary>The sign-in for Windows inside a VM: an account with administrator rights there.</summary>
public sealed record GuestCredential(string UserName, string Password)
{
    // Never in a log or a message by accident.
    public override string ToString() => $"GuestCredential {{ UserName = {UserName} }}";
}

/// <summary>Where each VM's sign-in is kept, by VM id.</summary>
public interface IGuestCredentialStore
{
    GuestCredential? Get(string vmId);
    void Save(string vmId, GuestCredential credential);
    void Forget(string vmId);
}

/// <summary>Kept in memory only: the demo, and the tests.</summary>
public sealed class InMemoryCredentialStore : IGuestCredentialStore
{
    private readonly Dictionary<string, GuestCredential> _saved = [];
    public GuestCredential? Get(string vmId) => _saved.GetValueOrDefault(vmId);
    public void Save(string vmId, GuestCredential credential) => _saved[vmId] = credential;
    public void Forget(string vmId) => _saved.Remove(vmId);
}

/// <summary>
/// Kept in Windows Credential Manager, as a generic credential named "HyperVManage:VM:&lt;id&gt;",
/// which Windows encrypts for this user. It shows under Windows Credentials, where it can also be
/// removed by hand.
/// </summary>
public sealed class WindowsCredentialStore : IGuestCredentialStore
{
    internal static string TargetFor(string vmId) => $"HyperVManage:VM:{vmId}";

    public GuestCredential? Get(string vmId)
    {
        if (!CredRead(TargetFor(vmId), CredTypeGeneric, 0, out var handle))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound) return null;
            throw new Win32Exception(error);
        }
        try
        {
            var c = Marshal.PtrToStructure<Credential>(handle);
            var password = c.CredentialBlobSize == 0 ? ""
                : Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2);
            return new GuestCredential(c.UserName ?? "", password);
        }
        finally { CredFree(handle); }
    }

    public void Save(string vmId, GuestCredential credential)
    {
        var blob = Encoding.Unicode.GetBytes(credential.Password);
        var buffer = Marshal.AllocHGlobal(Math.Max(blob.Length, 1));
        try
        {
            Marshal.Copy(blob, 0, buffer, blob.Length);
            var c = new Credential
            {
                Type = CredTypeGeneric,
                TargetName = TargetFor(vmId),
                Comment = "Hyper-V Manage: the sign-in for Windows inside this VM, for screenshots",
                CredentialBlobSize = (uint)blob.Length,
                CredentialBlob = buffer,
                Persist = CredPersistLocalMachine,
                UserName = credential.UserName,
            };
            if (!CredWrite(ref c, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            // The password's bytes don't outlive the call.
            Marshal.Copy(new byte[blob.Length], 0, buffer, blob.Length);
            Marshal.FreeHGlobal(buffer);
            Array.Clear(blob);
        }
    }

    public void Forget(string vmId)
    {
        if (!CredDelete(TargetFor(vmId), CredTypeGeneric, 0) && Marshal.GetLastWin32Error() != ErrorNotFound)
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    private const uint CredTypeGeneric = 1;
    private const uint CredPersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);
}
