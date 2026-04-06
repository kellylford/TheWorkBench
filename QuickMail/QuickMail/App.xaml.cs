using System.Windows;
using QuickMail.Services;
using QuickMail.ViewModels;
using QuickMail.Views;

namespace QuickMail;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Manual DI composition root
        var accountService = new AccountService();
        var credentialService = new CredentialService();
        var imapService = new ImapService();
        var smtpService = new SmtpService();

        var mainVm = new MainViewModel(imapService, accountService, credentialService);
        mainVm.LoadAccountList();

        var mainWindow = new MainWindow(mainVm, smtpService, accountService, credentialService, imapService);
        mainWindow.Show();
    }
}

