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

        var accountService    = new AccountService();
        var credentialService = new CredentialService();
        var imapService       = new ImapService();
        var smtpService       = new SmtpService();

        var localStore = new LocalStoreService();
        localStore.Initialize();

        var syncService = new SyncService(imapService, localStore);

        var mainVm = new MainViewModel(
            imapService, accountService, credentialService, localStore, syncService);
        mainVm.LoadAccountList();

        var mainWindow = new MainWindow(mainVm, smtpService, accountService, credentialService, imapService);
        mainWindow.Show();
    }
}
