using System.Windows;
using System.Windows.Input;
using QuickMail.ViewModels;

namespace QuickMail.Views;

public partial class ComposeWindow : Window
{
    public ComposeWindow(ComposeViewModel vm)
    {
        InitializeComponent();
        DataContext = vm;
    }

    // Alt+U → Subject field; Alt+M → From combo.
    // Alt+S is handled by Window.InputBindings (SendCommand).
    // The body TextBox has AcceptsTab so we can't use Tab to escape it —
    // these Alt shortcuts are the only way out without reaching for the mouse.
    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.SystemKey == Key.U && (Keyboard.Modifiers & ModifierKeys.Alt) != 0)
        {
            SubjectBox.Focus();
            SubjectBox.SelectAll();
            e.Handled = true;
        }
        else if (e.SystemKey == Key.M && (Keyboard.Modifiers & ModifierKeys.Alt) != 0)
        {
            FromCombo.Focus();
            FromCombo.IsDropDownOpen = true;
            e.Handled = true;
        }
    }
}
