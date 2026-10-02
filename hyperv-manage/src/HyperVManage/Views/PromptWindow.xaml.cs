using System.Windows;

namespace HyperVManage.Views;

/// <summary>Asks for one line of text. The label names the box, and is wired to it, so the box is
/// announced by what it asks for; the note under it explains the consequences.</summary>
public partial class PromptWindow : Window
{
    private PromptWindow() => InitializeComponent();

    public static string? Ask(Window owner, string title, string label, string initial, string note)
    {
        var w = new PromptWindow { Owner = owner, Title = title };
        w.PromptLabel.Content = label;
        w.AnswerBox.Text = initial;
        // A label's Target moves focus on its access key but doesn't name the box; name it here.
        System.Windows.Automation.AutomationProperties.SetName(w.AnswerBox, label.TrimEnd(':'));
        w.NoteText.Text = note;
        w.OkButton.Content = title.Split(' ')[0]; // "Clone", "Checkpoint"
        w.Loaded += (_, _) => { w.AnswerBox.Focus(); w.AnswerBox.SelectAll(); };
        return w.ShowDialog() == true ? w.AnswerBox.Text.Trim() : null;
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        if (AnswerBox.Text.Trim().Length == 0) { AnswerBox.Focus(); return; }
        DialogResult = true;
    }
}
