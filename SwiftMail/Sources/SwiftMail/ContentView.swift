import SwiftUI
import SwiftMailCore

struct ContentView: View {
    @EnvironmentObject private var store: MailStore
    @State private var showAddAccount = false
    @State private var showCompose = false
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    // Which message is open for reading (nil = show list)
    @State private var readingMessage: MailMessage? = nil

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            // Sidebar: Accounts + Folders
            FolderSidebarView()
                .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 300)
        } content: {
            // Middle: Message List
            MessageListView(readingMessage: $readingMessage)
                .navigationSplitViewColumnWidth(min: 280, ideal: 360)
        } detail: {
            // Right: Message Reader (only shown on wide layouts)
            if let msg = readingMessage {
                MessageReaderView(message: msg, onDismiss: { readingMessage = nil })
            } else {
                NoSelectionView()
            }
        }
        .sheet(isPresented: $showAddAccount) {
            AddAccountView()
        }
        .sheet(isPresented: $showCompose) {
            ComposeView(mode: .new)
                .environmentObject(store)
        }
        .onReceive(NotificationCenter.default.publisher(for: .showAddAccount)) { _ in
            showAddAccount = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .showCompose)) { _ in
            showCompose = true
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
