# QuickMail

WPF desktop email client (.NET 8, C#). Multi-account IMAP/SMTP with unified inbox, keyboard-centric UI.

## Build & Run

```bat
cd QuickMail
build.bat          # build
build.bat run      # build + launch
build.bat publish  # self-contained win-x64
build.bat clean
```

Or directly: `dotnet run --project QuickMail`

## Project Layout

```
QuickMail/QuickMail/
├── App.xaml.cs              # DI composition root — wires all services/VMs
├── Views/
│   ├── MainWindow.xaml(.cs) # 3-pane layout; keyboard nav; WebView2 HTML rendering
│   ├── ComposeWindow.xaml   # New/Reply/Forward dialog
│   ├── AccountManagerDialog.xaml
│   └── FolderPickerWindow.xaml  # Ctrl+Y quick nav
├── ViewModels/
│   ├── MainViewModel.cs     # Master state (accounts, folders, messages, selection)
│   ├── ComposeViewModel.cs  # Compose/reply/forward factories
│   └── AccountManagerViewModel.cs
├── Services/
│   ├── ImapService.cs       # IMAP via MailKit; client pool keyed by account Guid
│   ├── SmtpService.cs       # Send via MailKit
│   ├── AccountService.cs    # Persist accounts to %APPDATA%\QuickMail\accounts.json
│   ├── CredentialService.cs # Windows Credential Manager (no plaintext passwords)
│   └── LogService.cs
├── Models/
│   ├── AccountModel.cs
│   ├── MailMessageSummary.cs / MailMessageDetail.cs
│   ├── MailFolderModel.cs
│   └── ComposeModel.cs
└── Styles/AccessibleStyles.xaml
```

## Key Conventions

- **MVVM strictly**: views bind to VM properties/commands; no logic in code-behind except UI-only concerns (keyboard shortcuts, WebView2 navigation)
- **IMAP client pool**: `ImapService` keeps one `ImapClient` per account Guid; reconnect on demand
- **"All Mail" virtual folder**: identified by `FullName == "\x00AllMail"`; aggregates all accounts sorted newest-first
- **Passwords**: never written to JSON; always round-trip through `CredentialService` (Windows Credential Manager)
- **HTML sandbox**: WebView2 `NavigateToString` with strict CSP — no scripts, no object/embed, no frames
- **Cancellation**: three separate `CancellationTokenSource` (connect, folder load, message load) — cancel the right one when switching context
- **Pagination**: messages fetched in batches of 100; "Load More" appends next batch

## Keyboard Shortcuts (MainWindow)

| Key | Action |
|-----|--------|
| Ctrl+0 | Focus account list |
| Ctrl+1 | Focus folder list |
| Ctrl+2 | Focus message list |
| Ctrl+3 | Focus reading pane |
| Ctrl+N | New message |
| Ctrl+Y | Folder picker |
| Delete | Delete selected messages |
| Escape | Close reading pane |

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| MailKit | 4.15.1 | IMAP + SMTP protocol |
| CommunityToolkit.Mvvm | 8.4.2 | ObservableProperty, RelayCommand |
| Microsoft.Web.WebView2 | latest | HTML email rendering |
| AdysTech.CredentialManager | 3.1.0 | Windows Credential Manager |
