using System;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using QuickMail.Models;
using QuickMail.Services;
using QuickMail.ViewModels;

namespace QuickMail.Views;

/// <summary>
/// Converts IsRead (bool) to FontWeight: false (unread) = Bold, true (read) = Normal.
/// </summary>
public class BoolToFontWeightConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
        value is true ? FontWeights.Normal : FontWeights.Bold;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

public partial class MainWindow : Window
{
    private readonly MainViewModel _vm;
    private readonly ISmtpService _smtp;
    private readonly IAccountService _accountService;
    private readonly ICredentialService _credentials;
    private readonly IImapService _imap;
    private bool _webViewReady;

    public MainWindow(
        MainViewModel vm,
        ISmtpService smtp,
        IAccountService accountService,
        ICredentialService credentials,
        IImapService imap)
    {
        _vm = vm;
        _smtp = smtp;
        _accountService = accountService;
        _credentials = credentials;
        _imap = imap;

        InitializeComponent();
        DataContext = vm;

        vm.ComposeRequested += OpenComposeWindow;
        vm.ManageAccountsRequested += OpenAccountManager;
        vm.MessageListFocusRequested += ReturnFocusToMessageList;

        KeyDown += OnWindowKeyDown;
        Loaded += OnLoaded;
    }

    // On startup: initialise WebView2, connect to first account, open INBOX, focus message list
    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Initialise the embedded browser.  Wire Escape before doing anything else.
        try
        {
            await MessageBody.EnsureCoreWebView2Async();
            _webViewReady = true;

            // Disable unnecessary browser chrome / context menus
            MessageBody.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            MessageBody.CoreWebView2.Settings.AreDevToolsEnabled = false;
            MessageBody.CoreWebView2.Settings.IsStatusBarEnabled = false;

            // Inject Escape relay into every page at the host level — runs before any CSP.
            await MessageBody.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.addEventListener('keydown',function(e){" +
                "if(e.key==='Escape'){window.chrome.webview.postMessage('escape');e.preventDefault();}});");

            // JavaScript in every page posts a message when Escape is pressed,
            // which we relay back to WPF to return focus to the message list.
            MessageBody.CoreWebView2.WebMessageReceived += (_, args) =>
            {
                if (args.TryGetWebMessageAsString() == "escape")
                    Dispatcher.InvokeAsync(ReturnFocusToMessageList, DispatcherPriority.Input);
            };
        }
        catch (Exception ex)
        {
            LogService.Log("WebView2 init failed", ex);
            // Continue — message body just won't show
        }

        var firstAccount = _vm.Accounts.FirstOrDefault();
        if (firstAccount == null)
        {
            OpenAccountManager();
            return;
        }

        await _vm.ConnectAllAccountsAsync();

        // Open All Mail by default so messages from all connected accounts are visible
        await _vm.SelectFolderCommand.ExecuteAsync(MainViewModel.AllMailFolder);

        FocusMessageListFirstItem();
    }

    // Ctrl+0 = toolbar; Ctrl+1/2/3 jump directly to any pane; Ctrl+Y opens the folder picker
    private void OnWindowKeyDown(object sender, KeyEventArgs e)
    {
        if (e.KeyboardDevice.Modifiers == ModifierKeys.Control)
        {
            switch (e.Key)
            {
                case Key.D0: ToolbarFirstButton.Focus(); e.Handled = true; break;
                case Key.D1: AccountList.Focus(); e.Handled = true; break;
                case Key.D2: FolderList.Focus();  e.Handled = true; break;
                case Key.D3: MessageList.Focus(); e.Handled = true; break;
                case Key.Y:  OpenFolderPicker();  e.Handled = true; break;
            }
        }
    }

    private async void OpenFolderPicker()
    {
        if (_vm.CachedFolders.Count == 0) return;
        var picker = new FolderPickerWindow(_vm.Accounts, _vm.CachedFolders, MainViewModel.AllMailFolder) { Owner = this };
        if (picker.ShowDialog() == true && picker.SelectedFolder is MailFolderModel folder)
        {
            // Switch accounts if needed (AllMail has no specific account)
            if (picker.SelectedAccount != null && picker.SelectedAccount.Id != _vm.SelectedAccount?.Id)
                await _vm.SelectAccountCommand.ExecuteAsync(picker.SelectedAccount);

            // Resolve to the live instance from the folder list
            var target = _vm.Folders.FirstOrDefault(f =>
                             !f.IsHeader &&
                             f.FullName.Equals(folder.FullName, StringComparison.OrdinalIgnoreCase) &&
                             (folder.AccountId == Guid.Empty || f.AccountId == folder.AccountId))
                         ?? folder;
            await _vm.SelectFolderCommand.ExecuteAsync(target);
            FocusMessageListFirstItem();
        }
    }

    // When Tab moves keyboard focus into a list that has items but no prior selection,
    // auto-select the first item so Enter works immediately without needing an arrow key first.
    private void List_GotKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (sender is ListBox lb && lb.SelectedIndex < 0 && lb.Items.Count > 0)
            lb.SelectedIndex = 0;
    }

    // Enter on an account: connect and load folders; focus stays here
    private async void AccountList_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && AccountList.SelectedItem is AccountModel account)
        {
            e.Handled = true;
            await _vm.SelectAccountCommand.ExecuteAsync(account);
        }
    }

    // Enter on a folder: load messages then move focus to the message list
    private async void FolderList_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter &&
            FolderList.SelectedItem is MailFolderModel folder &&
            !folder.IsHeader)
        {
            e.Handled = true;
            await _vm.SelectFolderCommand.ExecuteAsync(folder);
            FocusMessageListFirstItem();
        }
    }

    // Focuses the first (or currently selected) ListViewItem so Up/Down arrow work
    // immediately after loading a folder.
    //
    // Why the two-step approach:
    //   After an async data load, WPF has queued DataBind (8), Render (7), and
    //   Loaded (6) dispatcher items to update the ListView.  Calling this method
    //   synchronously would run before those items, so ContainerFromIndex returns
    //   null and the fallback MessageList.Focus() gives the *control* focus — not
    //   any row — causing Down arrow to exit to the next tab stop (the toolbar).
    //
    //   Queuing at DispatcherPriority.Input (5) defers execution until all of those
    //   higher-priority items have been processed.  If the VirtualizingStackPanel
    //   still hasn't generated the container (rare first-load scenario), the
    //   ItemContainerGenerator.StatusChanged event covers the remaining gap.
    private void FocusMessageListFirstItem()
    {
        if (MessageList.Items.Count == 0) { MessageList.Focus(); return; }
        if (MessageList.SelectedIndex < 0) MessageList.SelectedIndex = 0;

        var idx = MessageList.SelectedIndex;
        MessageList.ScrollIntoView(MessageList.Items[idx]);

        Dispatcher.InvokeAsync(() => FocusItemAt(idx), DispatcherPriority.Input);
    }

    private void FocusItemAt(int idx)
    {
        if (idx >= MessageList.Items.Count) { MessageList.Focus(); return; }

        if (MessageList.ItemContainerGenerator.ContainerFromIndex(idx) is ListViewItem row)
        {
            row.Focus();
            return;
        }

        // VirtualizingStackPanel hasn't realized the container yet.
        // Wait for generation to complete, then focus.
        void OnStatusChanged(object? s, EventArgs e)
        {
            if (MessageList.ItemContainerGenerator.Status != GeneratorStatus.ContainersGenerated)
                return;
            MessageList.ItemContainerGenerator.StatusChanged -= OnStatusChanged;
            Dispatcher.InvokeAsync(() =>
            {
                if (MessageList.ItemContainerGenerator.ContainerFromIndex(idx) is ListViewItem r)
                    r.Focus();
                else
                    MessageList.Focus();
            }, DispatcherPriority.Input);
        }
        MessageList.ItemContainerGenerator.StatusChanged += OnStatusChanged;
    }

    // Enter on a message: load body; Delete: delete all selected messages
    private async void MessageList_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && MessageList.SelectedItem is MailMessageSummary summary)
        {
            e.Handled = true;
            await _vm.SelectMessageCommand.ExecuteAsync(summary);
            if (_vm.IsMessageOpen && _vm.MessageDetail != null)
                await ShowMessageBodyAsync(_vm.MessageDetail);
        }
        else if (e.Key == Key.Delete && MessageList.SelectedItems.Count > 0)
        {
            e.Handled = true;
            var toDelete = MessageList.SelectedItems
                .OfType<MailMessageSummary>()
                .ToList();
            await _vm.DeleteMessagesAsync(toDelete);
            FocusMessageListFirstItem();
        }
    }

    // Render the message body in the browser and move focus into it
    private async Task ShowMessageBodyAsync(MailMessageDetail detail)
    {
        if (!_webViewReady) return;

        string html;
        if (!string.IsNullOrWhiteSpace(detail.HtmlBody))
        {
            // Render the sender's HTML directly.
            // Inject a tight CSP that blocks email-embedded scripts; our Escape relay
            // was added via AddScriptToExecuteOnDocumentCreatedAsync and is unaffected by CSP.
            const string cspTag =
                "<meta http-equiv=\"Content-Security-Policy\" " +
                "content=\"script-src 'none'; object-src 'none'; frame-src 'none';\">";
            var body = detail.HtmlBody;
            var headIdx = body.IndexOf("<head>", StringComparison.OrdinalIgnoreCase);
            html = headIdx >= 0
                ? body.Insert(headIdx + 6, cspTag)
                : cspTag + body;
        }
        else
        {
            // Plain-text fallback: HTML-encode so tags/special chars are safe
            var encoded = WebUtility.HtmlEncode(detail.PlainTextBody ?? string.Empty);
            html =
                "<!DOCTYPE html>\n" +
                "<html lang=\"en\">\n" +
                "<head><meta charset=\"utf-8\"><style>\n" +
                "html,body{margin:0;padding:8px 12px;font-family:Segoe UI,Arial,sans-serif;" +
                "font-size:13px;white-space:pre-wrap;word-break:break-word;" +
                "background:Window;color:WindowText;outline:none;}\n" +
                "</style></head>\n" +
                "<body tabindex=\"0\">" + encoded + "</body>\n" +
                "</html>";
        }

        // Wait for navigation to finish before focusing so the screen reader
        // gets the fully rendered document, not a blank page.
        var tcs = new TaskCompletionSource<bool>();
        void OnNavigated(object? s, CoreWebView2NavigationCompletedEventArgs ev)
        {
            MessageBody.CoreWebView2.NavigationCompleted -= OnNavigated;
            tcs.TrySetResult(ev.IsSuccess);
        }
        MessageBody.CoreWebView2.NavigationCompleted += OnNavigated;
        MessageBody.CoreWebView2.NavigateToString(html);

        await tcs.Task;

        // Give focus to the browser control and push keyboard focus into <body>
        MessageBody.Focus();
        await MessageBody.CoreWebView2.ExecuteScriptAsync("document.body.focus()");
    }

    // Return keyboard focus to the selected ListViewItem after reading a message.
    private void ReturnFocusToMessageList()
    {
        if (MessageList.Items.Count == 0) { MessageList.Focus(); return; }
        var idx = MessageList.SelectedIndex >= 0 ? MessageList.SelectedIndex : 0;
        MessageList.ScrollIntoView(MessageList.Items[idx]);
        Dispatcher.InvokeAsync(() => FocusItemAt(idx), DispatcherPriority.Input);
    }

    private void OpenComposeWindow(ComposeModel composeModel)
    {
        var composeVm = new ComposeViewModel(_smtp, _accountService, _credentials);
        composeVm.Seed(composeModel);
        var window = new ComposeWindow(composeVm) { Owner = this };
        composeVm.CloseRequested += window.Close;
        window.Show();
    }

    private void OpenAccountManager()
    {
        var accountVm = new AccountManagerViewModel(_accountService, _credentials, _imap);
        var dialog = new AccountManagerDialog(accountVm) { Owner = this };
        if (dialog.ShowDialog() == true)
            _vm.RefreshAccountList();
    }
}
