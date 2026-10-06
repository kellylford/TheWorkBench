using System.Windows;
using System.Windows.Automation;
using HyperVManage.Models;
using HyperVManage.Services;

namespace HyperVManage.Views;

/// <summary>
/// Asks for the sign-in for Windows inside a VM, which Screenshot needs to see the session someone
/// is working in. Cancelling takes Hyper-V's picture of the VM's own screen instead.
/// </summary>
public partial class GuestSignInWindow : Window
{
    internal GuestSignInWindow() => InitializeComponent();

    internal const string Note =
        "Over Remote Desktop, you work in a session of your own that the VM's own screen doesn't show. " +
        "To take a picture of that session and say what's in front, Hyper-V Manage signs in to Windows " +
        "in the VM with an account that is an administrator there.";

    internal static GuestSignInWindow Create(VmInfo vm, string? why, string userName)
    {
        var w = new GuestSignInWindow { Title = $"Sign in to {vm.Name} for screenshots" };
        w.WhyText.Text = why ?? "";
        w.WhyText.Visibility = why is null ? Visibility.Collapsed : Visibility.Visible;
        w.NoteText.Text = Note;
        w.UserBox.Text = userName;
        // Focus goes straight to a box, so what the window says is given as the box's description,
        // which screen readers speak after its name.
        var help = (why is null ? "" : why + " ") + Note;
        AutomationProperties.SetHelpText(w.UserBox, help);
        AutomationProperties.SetHelpText(w.PasswordBox, help);
        w.Loaded += (_, _) =>
        {
            // Asked again after a wait, the user may be elsewhere in the app; come to the front.
            w.Activate();
            // The user name is usually right; the password is what's needed.
            if (w.UserBox.Text.Length > 0) w.PasswordBox.Focus();
            else w.UserBox.Focus();
        };
        return w;
    }

    public static SignInAnswer? Ask(Window owner, VmInfo vm, string? why, string userName)
    {
        var w = Create(vm, why, userName);
        w.Owner = owner;
        return w.ShowDialog() == true ? w.Answer : null;
    }

    internal SignInAnswer Answer =>
        new(new GuestCredential(UserBox.Text.Trim(), PasswordBox.Password), RememberBox.IsChecked == true);

    private void SignIn_Click(object sender, RoutedEventArgs e)
    {
        if (UserBox.Text.Trim().Length == 0) { UserBox.Focus(); return; }
        DialogResult = true;
    }
}
