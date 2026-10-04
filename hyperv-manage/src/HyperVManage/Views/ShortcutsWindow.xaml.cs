using System.Windows;
using System.Windows.Controls;

namespace HyperVManage.Views;

/// <summary>One line of the shortcuts list: a section heading, or a key and what it does.</summary>
public sealed record ShortcutLine(string Text, bool IsHeading);

/// <summary>
/// The keyboard shortcuts as a list, one per line, with each section's heading a line of its
/// own: a screen reader user arrows through them one at a time, rather than hearing a message
/// box read as one block with no way to move back through it.
/// </summary>
public partial class ShortcutsWindow : Window
{
    /// <summary>Every shortcut, by section. The README's keyboard tables list the same.</summary>
    public static IReadOnlyList<(string Section, (string Key, string Action)[] Keys)> Sections { get; } =
    [
        ("In the list of virtual machines",
        [
            ("Enter", "connect with Remote Desktop"),
            ("Delete", "delete the VM (asks first)"),
            ("Shift+F10 or the Applications key", "every action for the VM"),
        ]),
        ("Anywhere in the main window",
        [
            ("Ctrl+N", "new virtual machine"),
            ("F5", "refresh the list"),
            ("Ctrl+Enter", "start"),
            ("Ctrl+Period", "shut down"),
            ("Ctrl+Shift+Period", "turn off"),
            ("Ctrl+U", "save"),
            ("Ctrl+P", "pause"),
            ("Ctrl+Shift+P", "resume"),
            ("Ctrl+R", "restart"),
            ("Alt+Enter", "settings"),
            ("Ctrl+K", "checkpoint"),
            ("Ctrl+Shift+K", "apply a checkpoint"),
            ("Ctrl+D", "clone"),
            ("Alt or F10", "the menu bar"),
        ]),
        ("In the Hyper-V console window (Open Console)",
        [
            ("Ctrl+Alt+Left Arrow", "take the keyboard back from the VM"),
            ("Ctrl+Alt+End", "send Ctrl+Alt+Delete to the VM"),
            ("Ctrl+Alt+Pause", "switch between full screen and a window"),
            ("View menu, Enhanced Session", "a session that can carry sound once Windows is up"),
        ]),
    ];

    public static IReadOnlyList<ShortcutLine> Lines { get; } =
        Sections.SelectMany(s => new[] { new ShortcutLine(s.Section, true) }
            .Concat(s.Keys.Select(k => new ShortcutLine($"{k.Key}: {k.Action}", false)))).ToList();

    public ShortcutsWindow()
    {
        InitializeComponent();
        DataContext = Lines;
        Loaded += (_, _) =>
        {
            ShortcutList.SelectedIndex = 0;
            ShortcutList.UpdateLayout();
            (ShortcutList.ItemContainerGenerator.ContainerFromIndex(0) as ListBoxItem)?.Focus();
        };
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
