using System.Windows;
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

    /// <summary>Shown in the window, where a screen reader's "read window" command (JAWS
    /// Insert+B, NVDA+B) reads it; not hung on the boxes, which then say only what they are.</summary>
    internal const string Note =
        "To show the session you're working in, Remote Desktop included, Hyper-V Manage signs in to " +
        "Windows in the VM. Use an account that is an administrator there.";

    internal static TimeSpan AnnouncementDelay { get; } = TimeSpan.FromMilliseconds(700);

    /// <summary>What is spoken as the window opens, after its title and the focused box: only why
    /// it is asking again, when it is.</summary>
    internal string? OpeningAnnouncement { get; private set; }

    internal static GuestSignInWindow Create(VmInfo vm, string? why, string userName)
    {
        var w = new GuestSignInWindow { Title = $"Sign in to {vm.Name} for screenshots" };
        w.WhyText.Text = why ?? "";
        w.WhyText.Visibility = why is null ? Visibility.Collapsed : Visibility.Visible;
        w.NoteText.Text = Note;
        w.UserBox.Text = userName;
        w.OpeningAnnouncement = why;
        w.Loaded += (_, _) =>
        {
            // Asked again after a wait, the user may be elsewhere in the app; come to the front.
            w.Activate();
            // The user name is usually right; the password is what's needed.
            if (w.UserBox.Text.Length > 0) w.PasswordBox.Focus();
            else w.UserBox.Focus();
        };
        // The reason, once the screen reader has had time to read the title and the focused box:
        // spoken with them, it would cut them off or be cut off.
        w.ContentRendered += (_, _) =>
        {
            if (w.OpeningAnnouncement is not { } text) return;
            var wait = new System.Windows.Threading.DispatcherTimer { Interval = AnnouncementDelay };
            wait.Tick += (_, _) =>
            {
                wait.Stop();
                if (w.IsVisible) Helpers.Announcer.Announce(w, text);
            };
            wait.Start();
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
