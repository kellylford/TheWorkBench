using System;
using System.Collections.ObjectModel;
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

    [RelayCommand]
    private async Task SelectAccountAsync(AccountModel? account)
    {
        if (account == null) return;
        SelectedAccount = account;
        Folders.Clear();
        Messages.Clear();
        MessageDetail = null;
        IsMessageOpen = false;
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
            Folders = new ObservableCollection<MailFolderModel>(folderList);
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
        if (folder == null || SelectedAccount == null) return;
        _messageLimit = 100; // reset to default when switching to any folder
        SelectedFolder = folder;
        MessageDetail = null;
        IsMessageOpen = false;
        await FetchFolderAsync();
    }

    [RelayCommand]
    private async Task LoadMoreMessagesAsync()
    {
        if (SelectedFolder == null || SelectedAccount == null) return;
        _messageLimit += 100;
        await FetchFolderAsync();
    }

    private async Task FetchFolderAsync()
    {
        if (SelectedFolder == null || SelectedAccount == null) return;
        var folder = SelectedFolder;
        Messages.Clear();
        StatusText = $"Loading {folder.DisplayName}\u2026";
        IsBusy = true;
        try
        {
            _folderCts?.Cancel();
            _folderCts = new CancellationTokenSource();
            var list = await _imap.GetMessageSummariesAsync(SelectedAccount.Id, folder.FullName, _messageLimit, _folderCts.Token);
            Messages = new ObservableCollection<MailMessageSummary>(list);
            StatusText = list.Count == 0
                ? "No messages"
                : $"{list.Count} messages loaded. Arrow keys to navigate, Enter to read.";
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
        if (summary == null || SelectedAccount == null) return;
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
        // Keeps the current _messageLimit so the same number of messages reloads
        if (SelectedFolder != null && SelectedAccount != null)
            await FetchFolderAsync();
    }

    [RelayCommand]
    private async Task DeleteMessageAsync()
    {
        if (SelectedMessage == null || SelectedAccount == null) return;
        var summary = SelectedMessage;
        // Remember position so we can land on the next message after removal
        var nextIndex = Math.Max(0, Messages.IndexOf(summary) - 1);
        StatusText = "Deleting message\u2026";
        IsBusy = true;
        try
        {
            _messageCts?.Cancel();
            _messageCts = new CancellationTokenSource();
            await _imap.MoveToTrashAsync(summary.AccountId, summary.FolderName, summary.UniqueId, _messageCts.Token);
            Messages.Remove(summary);
            MessageDetail = null;
            IsMessageOpen = false;
            if (Messages.Count > 0)
            {
                SelectedMessage = Messages[Math.Min(nextIndex, Messages.Count - 1)];
                StatusText = "Message deleted.";
                MessageListFocusRequested?.Invoke();
            }
            else
            {
                SelectedMessage = null;
                StatusText = "Message deleted. Folder is now empty.";
            }
        }
        catch (OperationCanceledException)
        {
            StatusText = "Delete cancelled.";
        }
        catch (Exception ex)
        {
            StatusText = $"Delete failed: {ex.Message}";
            LogService.Log("DeleteMessage", ex);
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
