import SwiftUI
import SwiftMailCore

struct ContentView: View {
    @EnvironmentObject private var store: MailStore
    @State private var showAddAccount = false
    @State private var showCompose = false
    @State private var composeMode: ComposeMode = .new
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            // Sidebar: Accounts + Folders
            FolderSidebarView()
                .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 300)
        } content: {
            // Middle: Message List
            MessageListView()
                .navigationSplitViewColumnWidth(min: 280, ideal: 360)
        } detail: {
            // Right: Message Reader
            if let msg = store.selectedMessage {
                MessageReaderView(message: msg, onDismiss: { store.selectedMessage = nil })
            } else {
                NoSelectionView()
            }
        }
        .focusedObject(store)
        .sheet(isPresented: $showAddAccount) {
            AddAccountView()
        }
        .sheet(isPresented: $showCompose) {
            ComposeView(mode: composeMode)
                .environmentObject(store)
        }
        // App-level notifications from menu bar
        .onReceive(NotificationCenter.default.publisher(for: .showAddAccount)) { _ in
            showAddAccount = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .showCompose)) { _ in
            composeMode = .new
            showCompose = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .getNewMail)) { _ in
            Task { await store.reconnectAll() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .markAllRead)) { _ in
            Task {
                for msg in store.messages where !msg.isRead {
                    await store.markRead(msg)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .replyMessage)) { _ in
            guard let msg = store.selectedMessage else { return }
            composeMode = .reply(to: msg)
            showCompose = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .replyAllMessage)) { _ in
            guard let msg = store.selectedMessage else { return }
            composeMode = .reply(to: msg)
            showCompose = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .forwardMessage)) { _ in
            guard let msg = store.selectedMessage else { return }
            composeMode = .forward(message: msg)
            showCompose = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .deleteMessage)) { _ in
            guard let msg = store.selectedMessage else { return }
            store.selectedMessage = nil
            Task { await store.deleteMessage(msg) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .markRead)) { _ in
            guard let msg = store.selectedMessage else { return }
            Task { await store.markRead(msg) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .markUnread)) { _ in
            guard let msg = store.selectedMessage else { return }
            Task { await store.markUnread(msg) }
        }
        .overlay(alignment: .bottom) {
            if let err = store.errorMessage {
                ErrorBanner(message: err) {
                    store.errorMessage = nil
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .padding()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: store.errorMessage)
        .task {
            // Auto-connect all accounts on launch
            for account in store.accounts {
                await store.connectAndLoadFolders(for: account)
            }
        }
    }
}

// MARK: - Error Banner

struct ErrorBanner: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
                .accessibilityHidden(true)
            Text(message)
                .foregroundStyle(.primary)
            Spacer()
            Button("Dismiss", action: onDismiss)
                .buttonStyle(.borderless)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Error: \(message)")
        .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - No Selection Placeholder

struct NoSelectionView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "envelope.open")
                .font(.system(size: 56))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            Text("Select a message to read")
                .font(.title3)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("No message selected")
    }
}
