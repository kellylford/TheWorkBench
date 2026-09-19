using System.Windows;

namespace UiaNotifyDemo;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    private void AnnounceQueued_Click(object sender, RoutedEventArgs e)
    {
        AccessibilityHelper.Announce(this, AnnounceTextBox.Text, interrupt: false);
    }

    private void AnnounceInterrupt_Click(object sender, RoutedEventArgs e)
    {
        AccessibilityHelper.Announce(this, AnnounceTextBox.Text, interrupt: true);
    }
}
