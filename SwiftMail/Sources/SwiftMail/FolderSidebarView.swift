import SwiftUI
import SwiftMailCore

struct FolderSidebarView: View {
    @EnvironmentObject private var store: MailStore
    @State private var showAddAccount = false

    // Group folders by account
    private var foldersByAccount: [(account: MailAccount, folders: [MailFolder])] {
        store.accounts.map { account in
            let accountFolders = store.folders.filter { $0.accountID == account.id }
            return (account: account, folders: accountFolders)
        }
    }

    var body: some View {
        List(selection: Binding(
            get: { store.selectedFolder },
            set: { folder in
                guard let folder = folder else { return }
                Task { await store.loadMessages(for: folder) }
            }
        )) {
            if store.accounts.isEmpty {
                Text("No accounts added")
                    .foregroundStyle(.secondary)
                    .font(.callout)
                    .listRowBackground(Color.clear)
                    .accessibilityLabel("No mail accounts configured")
            }

            ForEach(foldersByAccount, id: \.account.id) { entry in
                Section(entry.account.emailAddress) {
                    ForEach(entry.folders) { folder in
                        FolderRow(folder: folder)
                            .tag(folder)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Mailboxes")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showAddAccount = true
                } label: {
                    Label("Add Account", systemImage: "plus")
                }
                .help("Add a new mail account")
                .accessibilityLabel("Add Account")
            }

            ToolbarItem {
                Button {
                    Task { await store.reconnectAll() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Refresh all accounts")
                .accessibilityLabel("Refresh all accounts")
            }

            ToolbarItem {
                if store.isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Loading")
                }
            }
        }
        .sheet(isPresented: $showAddAccount) {
            AddAccountView()
        }
    }
}

// MARK: - Folder Row

struct FolderRow: View {
    let folder: MailFolder

    private var iconName: String {
        switch folder.displayName {
        case "Inbox": return "tray"
        case "Sent": return "paperplane"
        case "Drafts": return "doc"
        case "Trash": return "trash"
        case "Junk": return "exclamationmark.octagon"
        case "Archive": return "archivebox"
        case "All Mail": return "tray.2"
        default: return "folder"
        }
    }

    var body: some View {
        Label(folder.displayName, systemImage: iconName)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(folder.displayName)
            .accessibilityHint("Mailbox folder")
            .accessibilityAddTraits(.isButton)
    }
}
