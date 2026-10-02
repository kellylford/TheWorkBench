using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;

namespace HyperVManage.Services;

/// <summary>
/// A folder only Administrators and SYSTEM can change, for files the elevated app runs. Its
/// permissions are set, without inheriting from above, every time it is used, so a folder of
/// that name made earlier by someone else is taken back. A link or junction is refused: it could
/// point the app's files at a folder someone else controls.
/// </summary>
public static class AdminOnlyFolder
{
    /// <summary>Secures <paramref name="path"/> and every folder between it and
    /// <paramref name="under"/>, which must already exist and is left as it is.</summary>
    public static void Ensure(string under, string path)
    {
        var full = Path.GetFullPath(path);
        var root = Path.GetFullPath(under).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException($"{full} isn't inside {root}.", nameof(path));

        var current = root.TrimEnd(Path.DirectorySeparatorChar);
        foreach (var part in full[root.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            Secure(current);
        }
    }

    private static void Secure(string path)
    {
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        foreach (var sid in new[] { WellKnownSidType.BuiltinAdministratorsSid, WellKnownSidType.LocalSystemSid })
        {
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid, null), FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        }
        security.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));

        var dir = new DirectoryInfo(path);
        if (!dir.Exists)
        {
            dir.Create(security);
            return;
        }
        if (dir.Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new HyperVException($"{path} is a link to another folder, so Hyper-V Manage won't run files from it. Delete it and try again.");
        dir.SetAccessControl(security);
    }
}
