using System.Windows;
using QuickMail.ViewModels;

namespace QuickMail.Views;

public partial class ComposeWindow : Window
{
    public ComposeWindow(ComposeViewModel vm)
    {
        InitializeComponent();
        DataContext = vm;
    }
}
