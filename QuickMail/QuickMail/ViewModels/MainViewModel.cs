using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using QuickMail.Models;
using QuickMail.Services;

namespace QuickMail.ViewModels;

public partial class MainViewModel : ObservableObject
{
    private readonly IImapService _imap;
    private readonly IAccountService _accountService;
    private readonly ICredentialService _credentials;
    // Separate CTS per operation type so they can't cancel each other accidentally
    private CancellationTokenSource? _connectCts;
    private CancellationTokenSource? _folderCts;
    private CancellationTokenSource? _messageCts;
    // How many messages to fetch; increased by LoadMoreMessagesCommand
    private int _messageLimit = 100;
    // Retains folder lists for every account that has been connected this session
    private readonly Dictionary<Guid, List<MailFolderModel>> _cachedFolders = new();
    public IReadOnlyDictionary<Guid, List<MailFolderModel>> CachedFolders => _cachedFolders;

    /// <summary>Sentinel that represents the cross-account virtual All Mail view.</summary>
    public static readonly MailFolderModel AllMailFolder = new()
    {
        FullName  = "\x00AllMail",
        DisplayName = "All Mail"
    };
    private bool IsAllMailSelected => SelectedFolder?.FullName == AllMailFolder.FullName;

    [ObservableProperty]
    private ObservableCollection<AccountModel> _accounts = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSelectedAccount))]
    private AccountModel? _selectedAccount;

    [ObservableProperty]
    private ObservableCollection<MailFolderModel> _folders = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSelectedFolder))]
    private MailFolderModel? _selectedFolder;

    [ObservableProperty]
    private ObservableCollection<MailMessageSummary> _messages = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSelectedMessage))]
    private MailMessageSummary? _selectedMessage;

    [ObservableProperty]
    private MailMessageDetail? _messageDetail;

    /// <summary>True when a message body has been loaded and the reading pane should be shown.</summary>
    [ObservableProperty]
    private bool _isMessageOpen;

    [ObservableProperty]
    private string _statusText = "Ready";

    [ObservableProperty]
    private bool _isBusy;

    public bool HasSelectedAccount => SelectedAccount != null;
    public bool HasSelectedFolder => SelectedFolder != null;
    public bool HasSelectedMessage => SelectedMessage != null;

    public MainViewModel(IImapService imap, IAccountService accountService, ICredentialService credentials)
    {
        _imap = imap;
        _accountService = accountService;
        _credentials = credentials;
    }

    public void LoadAccountList()
    {
        Accounts = new ObservableCollection<AccountModel>(_accountService.LoadAccounts());
    }

    /// <summary>
    /// Connects every configured account in sequence, populates the cache, then
    /// rebuilds the unified folder list.  Called once from MainWindow.OnLoaded.
    /// </summary>
    public async Task ConnectAllAccountsAsync()
    {
        foreach (var account in Accounts)
        {
            var password = _credentials.GetPassword(account.Id);
            if (string.IsNullOrEmpty(password)) continue;

            StatusText = $"Connecting to {account.DisplayName}\u2026";
            IsBusy = true;
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                await _imap.ConnectAsync(account, password, cts.Token);
                var folderList = await _imap.GetFoldersAsync(account.Id, cts.Token);
                _cachedFolders[account.Id] = folderList;
            }
            catch (OperationCanceledException) { /* skip timed-out account */ }
            catch (Exception ex)
            {
                StatusText = $"Failed to connect {account.DisplayName}: {ex.Message}";
                LogService.Log($"ConnectAll/{account.DisplayName}", ex);
            }
        }
        IsBusy = false;
        RebuildFolderListFromCache();
        StatusText = _cachedFolders.Count > 0
            ? $"{_cachedFolders.Count} of {Accounts.Count} account(s) connected."
            : "No accounts could be connected.";
    }

    /// <summary>
    /// Rebuilds Folders from the full cache: AllMail at top, then each account
    /// header followed by that account's folders.
    /// </summary>
    private void RebuildFolderListFromCache()
    {
        var saved = SelectedFolder;
        var items = new List<MailFolderModel> { AllMailFolder };

        foreach (var account in Accounts)
        {
            if (!_cachedFolders.TryGetValue(account.Id, out var folders)) continue;

            items.Add(new MailFolderModel
            {
                IsHeader = true,
                DisplayName = account.DisplayName,
                FullName = $"\x00Header:{account.Id}",
                AccountId = account.Id
            });
            items.AddRange(folders);
        }

        Folders = new ObservableCollection<MailFolderModel>(items);

        // Restore selection if the folder still exists
        if (saved != null && !saved.IsHeader)
        {
            var restored = items.FirstOrDefault(f =>
                f.FullName == saved.FullName && f.AccountId == saved.AccountId);
            if (restored != null)
                SelectedFolder = restored;
        }
    }

    [RelayCommand]
    private async Task SelectAccountAsync(AccountModel? account)
    {
        if (account == null) return;
        SelectedAccount = account;
        StatusText = $"Connecting to {account.DisplayName}\u2026";
        IsBusy = true;
        try
        {
            var password = _credentials.GetPassword(account.Id);
            if (string.IsNullOrEmpty(password))
            {
                StatusText = $"No password stored for {account.DisplayName}.";
                return;
            }
            _connectCts?.Cancel();
            _connectCts = new CancellationTokenSource();
            await _imap.ConnectAsync(account, password, _connectCts.Token);
            var folderList = await _imap.GetFoldersAsync(account.Id, _connectCts.Token);
            _cachedFolders[account.Id] = folderList;
            RebuildFolderListFromCache();
            StatusText = $"Connected to {account.DisplayName}. Press Enter on a folder to load messages.";
        }
        catch (OperationCanceledException)
        {
            StatusText = "Connection cancelled.";
        }
        catch (Exception ex)
        {
            StatusText = $"Connection failed: {ex.Message}";
            LogService.Log("SelectAccount", ex);
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task SelectFolderAsync(MailFolderModel? folder)
    {
        if (folder == null || folder.IsHeader) return;
        _messageLimit = 100;
        SelectedFolder = folder;
        MessageDetail = null;
        IsMessageOpen = false;
        if (folder.FullName == AllMailFolder.FullName)
            await FetchAllMailAsync();
        else
        {
            if (folder.AccountId != Guid.Empty)
                SelectedAccount = Accounts.FirstOrDefault(a => a.Id == folder.AccountId) ?? SelectedAccount;
            await FetchFolderAsync();
        }
    }

    [RelayCommand]
    private async Task LoadMoreMessagesAsync()
    {
        _messageLimit += 100;
        if (IsAllMailSelected)
            await FetchAllMailAsync();
        else if (SelectedFolder != null && SelectedFolder.AccountId != Guid.Empty)
            await FetchFolderAsync();
    }

    private async Task FetchFolderAsync()
    {
        if (SelectedFolder == null) return;
        var accountId = SelectedFolder.AccountId;
        if (accountId == Guid.Empty) return;
        var folder = SelectedFolder;
        Messages.Clear();
        StatusText = $"Loading {folder.DisplayName}\u2026";
        IsBusy = true;
        try
        {
            _folderCts?.Cancel();
            _folderCts = new CancellationTokenSource();
            var list = await _imap.GetMessageSummariesAsync(accountId, folder.FullName, _messageLimit, _folderCts.Token);
            Messages = new ObservableCollection<MailMessageSummary>(list);
            StatusText = list.Count == 0
                ? "No messages"
                : $"{list.Count} messages loaded.";
        }
        catch (OperationCanceledException)
        {
            StatusText = "Message list load cancelled.";
        }
        catch (Exception ex)
        {
            StatusText = $"Failed to load messages: {ex.Message}";
            LogService.Log("SelectFolder", ex);
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task SelectMessageAsync(MailMessageSummary? summary)
    {
        if (summary == null) return;
        // When reading a message (e.g. from All Mail), ensure the correct account is
        // active so that Reply/Forward/Delete operate on the right account.
        if (SelectedAccount?.Id != summary.AccountId)
            SelectedAccount = Accounts.FirstOrDefault(a => a.Id == summary.AccountId) ?? SelectedAccount;
        if (SelectedAccount == null) return;
        SelectedMessage = summary;
        MessageDetail = null;
        IsMessageOpen = false;
        StatusText = "Loading message\u2026";
        IsBusy = true;
        try
        {
            _messageCts?.Cancel();
            _messageCts = new CancellationTokenSource();
            var detail = await _imap.GetMessageDetailAsync(
                summary.AccountId, summary.FolderName, summary.UniqueId, _messageCts.Token);
            MessageDetail = detail;
            IsMessageOpen = true;
            summary.IsRead = true;
            StatusText = "Message loaded. Press Escape to return to message list.";
        }
        catch (OperationCanceledException)
        {
            StatusText = "Message load cancelled.";
        }
        catch (Exception ex)
        {
            StatusText = $"Failed to load message: {ex.Message}";
            LogService.Log("SelectMessage", ex);
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task RefreshAsync()
    {
        if (IsAllMailSelected)
            await FetchAllMailAsync();
        else if (SelectedFolder != null && SelectedFolder.AccountId != Guid.Empty)
            await FetchFolderAsync();
    }

    /// <summary>
    /// Fetches messages from every folder of every connected account,
    /// merges the results, and sorts them newest-first.
    /// </summary>
    private async Task FetchAllMailAsync()
    {
        Messages.Clear();
        StatusText = "Loading All Mail\u2026";
        IsBusy = true;

        _folderCts?.Cancel();
        _folderCts = new CancellationTokenSource();
        var ct = _folderCts.Token;

        var all = new List<MailMessageSummary>();

        try
        {
            // Fetch each account's folders sequentially within that account
            // (MailKit ImapClient is not thread-safe); run accounts in parallel.
            var perAccountTasks = Accounts
                .Where(a => _cachedFolders.ContainsKey(a.Id))
                .Select(account => FetchAccountAllFoldersAsync(account, ct));

            var accountResults = await Task.WhenAll(perAccountTasks);
            foreach (var batch in accountResults)
                all.AddRange(batch);

            var sorted = all.OrderByDescending(m => m.Date).ToList();
            Messages = new ObservableCollection<MailMessageSummary>(sorted);
            StatusText = sorted.Count == 0
                ? "No messages across connected accounts."
                : $"{sorted.Count} messages across all accounts.";
        }
        catch (OperationCanceledException)
        {
            StatusText = "All Mail load cancelled.";
        }
        catch (Exception ex)
        {
            StatusText = $"Failed to load All Mail: {ex.Message}";
            LogService.Log("FetchAllMail", ex);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task<List<MailMessageSummary>> FetchAccountAllFoldersAsync(
        AccountModel account, CancellationToken ct)
    {
        var result = new List<MailMessageSummary>();
        if (!_cachedFolders.TryGetValue(account.Id, out var folders)) return result;

        foreach (var folder in folders)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var msgs = await _imap.GetMessageSummariesAsync(
                    account.Id, folder.FullName, _messageLimit, ct);
                result.AddRange(msgs);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                LogService.Log($"AllMail fetch {account.DisplayName}/{folder.FullName}", ex);
            }
        }
        return result;
    }

    [RelayCommand]
    private async Task DeleteMessageAsync()
    {
        if (SelectedMessage == null) return;
        await DeleteMessagesAsync([SelectedMessage]);
    }

    /// <summary>
    /// Deletes a batch of messages (may span multiple accounts/folders).
    /// Called directly from the view when multiple items are selected.
    /// </summary>
    public async Task DeleteMessagesAsync(IReadOnlyList<MailMessageSummary> toDelete)
    {
        if (toDelete.Count == 0) return;

        // Index of the first item being deleted so we can land near that spot after removal
        var minIdx = toDelete.Min(m => Messages.IndexOf(m));

        var label = toDelete.Count == 1 ? "message" : $"{toDelete.Count} messages";
        StatusText = $"Deleting {label}\u2026";
        IsBusy = true;
        MessageDetail = null;
        IsMessageOpen = false;

        try
        {
            _messageCts?.Cancel();
            _messageCts = new CancellationTokenSource();

            // Group by account + folder so we open each folder only once
            var groups = toDelete.GroupBy(m => (m.AccountId, m.FolderName));
            foreach (var group in groups)
            {
                var uids = group.Select(m => m.UniqueId).ToList();
                await _imap.MoveToTrashBatchAsync(
                    group.Key.AccountId, group.Key.FolderName, uids, _messageCts.Token);
            }

            foreach (var msg in toDelete)
                Messages.Remove(msg);

            if (Messages.Count > 0)
            {
                var landIdx = Math.Max(0, Math.Min(minIdx, Messages.Count - 1));
                SelectedMessage = Messages[landIdx];
                StatusText = $"{toDelete.Count} {(toDelete.Count == 1 ? "message" : "messages")} deleted.";
                MessageListFocusRequested?.Invoke();
            }
            else
            {
                SelectedMessage = null;
                StatusText = $"{toDelete.Count} {(toDelete.Count == 1 ? "message" : "messages")} deleted. Folder is now empty.";
            }
        }
        catch (OperationCanceledException)
        {
            StatusText = "Delete cancelled.";
        }
        catch (Exception ex)
        {
            StatusText = $"Delete failed: {ex.Message}";
            LogService.Log("DeleteMessages", ex);
        }
        finally
        {
            IsBusy = false;
        }
    }

    // Reply / ReplyAll / Forward: raise events that the View handles to open ComposeWindow
    public event Action<ComposeModel>? ComposeRequested;
    public event Action? ManageAccountsRequested;
    /// <summary>Fired after delete so the view can focus the newly-selected message row.</summary>
    public event Action? MessageListFocusRequested;

    [RelayCommand]
    private void Reply()
    {
        if (MessageDetail == null || SelectedAccount == null) return;
        var compose = ComposeViewModel.CreateReply(MessageDetail, SelectedAccount.Id);
        ComposeRequested?.Invoke(compose);
    }

    [RelayCommand]
    private void ReplyAll()
    {
        if (MessageDetail == null || SelectedAccount == null) return;
        var compose = ComposeViewModel.CreateReplyAll(MessageDetail, SelectedAccount.Id);
        ComposeRequested?.Invoke(compose);
    }

    [RelayCommand]
    private void Forward()
    {
        if (MessageDetail == null || SelectedAccount == null) return;
        var compose = ComposeViewModel.CreateForward(MessageDetail, SelectedAccount.Id);
        ComposeRequested?.Invoke(compose);
    }

    [RelayCommand]
    private void NewMessage()
    {
        if (SelectedAccount == null) return;
        var compose = new ComposeModel { AccountId = SelectedAccount.Id };
        ComposeRequested?.Invoke(compose);
    }

    [RelayCommand]
    private void ManageAccounts()
    {
        ManageAccountsRequested?.Invoke();
    }

    public void RefreshAccountList()
    {
        LoadAccountList();
    }
}
