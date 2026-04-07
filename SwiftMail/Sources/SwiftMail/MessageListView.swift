import SwiftUI
import SwiftMailCore

struct MessageListView: View {
    @EnvironmentObject private var store: MailStore

    // The currently keyboard-focused row index
    @State private var focusedIndex: Int? = nil
    @FocusState private var listFocused: Bool

    private var messages: [MailMessage] { store.messages }

    var body: some View {
        VStack(spacing: 0) {
            if let folder = store.selectedFolder {
                HStack {
                    Text(folder.displayName)
                        .font(.headline)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Text("\(messages.count) message\(messages.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.trailing, 8)
                        .accessibilityLabel("\(messages.count) messages")
                    Button {
                        Task { await store.refreshCurrentFolder() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.borderless)
                    .padding(.trailing, 12)
                    .help("Refresh")
                    .accessibilityLabel("Refresh messages")
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                }
                .background(.bar)
                Divider()
            }

            if store.isLoading {
                Spacer()
                ProgressView("Loading messages…")
                    .accessibilityLabel("Loading messages")
                Spacer()
            } else if messages.isEmpty {
                Spacer()
                Text("No messages")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("No messages in this folder")
                Spacer()
            } else {
                messageList
            }
        }
        .navigationTitle(store.selectedFolder?.displayName ?? "Messages")
        .onChange(of: store.messages) { _ in
            // Reset focus when folder changes
            if !messages.isEmpty {
                focusedIndex = 0
            } else {
                focusedIndex = nil
            }
        }
        // Global keyboard handler for the list
        .background(
            KeyboardNavigationView(
                count: messages.count,
                focusedIndex: $focusedIndex,
                onOpen: openFocused,
                onMoveUp: moveFocusUp,
                onMoveDown: moveFocusDown,
                onDelete: deleteFocused
            )
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Message list")
    }

    // MARK: - Message List

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        MessageRow(
                            message: message,
                            isFocused: focusedIndex == index
                        )
                        .contentShape(Rectangle())
                        .onTapGesture {
                            focusedIndex = index
                            openMessage(message)
                        }
                        .background(rowBackground(index: index, message: message))
                        .overlay(
                            Group {
                                if focusedIndex == index {
                                    RoundedRectangle(cornerRadius: 4)
                                        .strokeBorder(Color.accentColor, lineWidth: 2)
                                }
                            }
                        )
                        .id(message.id)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(messageAccessibilityLabel(message))
                        .accessibilityHint("Press Return to open. Row \(index + 1) of \(messages.count)")
                        .accessibilityAddTraits(focusedIndex == index ? [.isSelected] : [])
                    }
                }
            }
            .focused($listFocused)
            .onChange(of: focusedIndex) { idx in
                if let idx = idx, idx < messages.count {
                    withAnimation { proxy.scrollTo(messages[idx].id, anchor: .center) }
                    // Announce to VoiceOver
                    let msg = messages[idx]
                    UIAccessibility.post(
                        notification: .announcement,
                        argument: messageAccessibilityLabel(msg)
                    )
                }
            }
        }
        .onAppear { listFocused = true }
    }

    // MARK: - Row Background

    private func rowBackground(index: Int, message: MailMessage) -> some View {
        Group {
            if focusedIndex == index {
                Color.accentColor.opacity(0.15)
            } else if !message.isRead {
                Color.primary.opacity(0.04)
            } else {
                Color.clear
            }
        }
    }

    // MARK: - Navigation Actions

    private func moveFocusUp() {
        guard !messages.isEmpty else { return }
        let current = focusedIndex ?? 0
        focusedIndex = max(0, current - 1)
    }

    private func moveFocusDown() {
        guard !messages.isEmpty else { return }
        let current = focusedIndex ?? -1
        focusedIndex = min(messages.count - 1, current + 1)
    }

    private func openFocused() {
        guard let idx = focusedIndex, idx < messages.count else { return }
        openMessage(messages[idx])
    }

    private func openMessage(_ message: MailMessage) {
        store.selectedMessage = message
        Task { await store.fetchBody(for: message) }
        Task { await store.markRead(message) }
    }

    private func deleteFocused() {
        guard let idx = focusedIndex, idx < messages.count else { return }
        let message = messages[idx]
        if store.selectedMessage?.id == message.id { store.selectedMessage = nil }
        Task { await store.deleteMessage(message) }
    }

    // MARK: - Accessibility Label

    private func messageAccessibilityLabel(_ msg: MailMessage) -> String {
        let readState = msg.isRead ? "Read" : "Unread"
        let dateStr = RelativeDateTimeFormatter().localizedString(for: msg.date, relativeTo: Date())
        return "\(readState). \(msg.from). \(msg.subject). \(dateStr)"
    }
}

// MARK: - Message Row

struct MessageRow: View {
    let message: MailMessage
    let isFocused: Bool

    private static let dateFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Unread indicator
            Circle()
                .fill(message.isRead ? Color.clear : Color.accentColor)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(message.from)
                        .font(.callout.weight(message.isRead ? .regular : .semibold))
                        .lineLimit(1)
                        .foregroundStyle(.primary)
                    Spacer()
                    Text(Self.dateFormatter.localizedString(for: message.date, relativeTo: Date()))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(message.subject)
                    .font(.subheadline)
                    .lineLimit(1)
                    .foregroundStyle(message.isRead ? .secondary : .primary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

// MARK: - Keyboard Navigation (NSView bridge for low-level key events)

/// Transparent NSView that captures arrow keys and Return/Escape without
/// swallowing focus from SwiftUI.
struct KeyboardNavigationView: NSViewRepresentable {
    let count: Int
    @Binding var focusedIndex: Int?
    let onOpen: () -> Void
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onDelete: () -> Void

    func makeNSView(context: Context) -> KeyCaptureNSView {
        let view = KeyCaptureNSView()
        view.onMoveUp = onMoveUp
        view.onMoveDown = onMoveDown
        view.onOpen = onOpen
        view.onDelete = onDelete
        return view
    }

    func updateNSView(_ nsView: KeyCaptureNSView, context: Context) {
        nsView.onMoveUp = onMoveUp
        nsView.onMoveDown = onMoveDown
        nsView.onOpen = onOpen
        nsView.onDelete = onDelete
    }
}

final class KeyCaptureNSView: NSView {
    var onMoveUp: (() -> Void)?
    var onMoveDown: (() -> Void)?
    var onOpen: (() -> Void)?
    var onDelete: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 125:     // Down arrow
            onMoveDown?()
        case 126:     // Up arrow
            onMoveUp?()
        case 36, 76:  // Return / Enter
            onOpen?()
        case 51, 117: // Backspace or Forward-Delete
            onDelete?()
        default:
            super.keyDown(with: event)
        }
    }
}

// MARK: - UIAccessibility on macOS (shim)

private enum UIAccessibility {
    enum Notification {
        case announcement
    }
    static func post(notification: Notification, argument: Any?) {
        guard case .announcement = notification,
              let str = argument as? String else { return }
        // Use NSAccessibility announcement API
        let announcement: [NSAccessibility.NotificationUserInfoKey: Any] = [
            .announcement: str,
            .priority: NSNumber(value: 50)  // medium priority
        ]
        NSAccessibility.post(
            element: NSApp.mainWindow as AnyObject,
            notification: .announcementRequested,
            userInfo: announcement
        )
    }
}
