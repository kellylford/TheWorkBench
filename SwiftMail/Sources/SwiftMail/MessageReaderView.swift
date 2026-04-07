import SwiftUI
import SwiftMailCore
import AppKit

// MARK: - Message Reader View

struct MessageReaderView: View {
    let message: MailMessage
    let onDismiss: () -> Void

    @EnvironmentObject private var store: MailStore
    @State private var bodyText: String = ""
    @State private var isLoadingBody = true
    @State private var showCompose = false
    @State private var composeMode: ComposeMode = .new
    @State private var showDeleteConfirm = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header bar
            MessageHeaderBar(
                message: message,
                onDismiss: onDismiss,
                onReply: {
                    composeMode = .reply(to: message)
                    showCompose = true
                },
                onForward: {
                    composeMode = .forward(message: message)
                    showCompose = true
                },
                onDelete: {
                    showDeleteConfirm = true
                }
            )

            Divider()

            // Body
            if isLoadingBody {
                Spacer()
                ProgressView("Loading message…")
                    .accessibilityLabel("Loading message body")
                    .frame(maxWidth: .infinity)
                Spacer()
            } else {
                MessageBodyView(text: bodyText)
            }
        }
        .onAppear { loadBody() }
        .onChange(of: message.id) { _ in
            isLoadingBody = true
            loadBody()
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onKeyPress(.escape) {
            onDismiss()
            return .handled
        }
        .sheet(isPresented: $showCompose) {
            ComposeView(mode: composeMode)
                .environmentObject(store)
        }
        .confirmationDialog(
            "Delete this message?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task {
                    await store.deleteMessage(message)
                    onDismiss()
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Message: \(message.subject)")
    }

    private func loadBody() {
        if let stored = store.messages.first(where: { $0.id == message.id }),
           (stored.plainBody != nil || stored.htmlBody != nil) {
            bodyText = stored.bodyText
            isLoadingBody = false
            return
        }
        Task {
            await store.fetchBody(for: message)
            if let updated = store.messages.first(where: { $0.id == message.id }) {
                bodyText = updated.bodyText
            } else {
                bodyText = message.bodyText
            }
            isLoadingBody = false
        }
    }
}

// MARK: - Message Header Bar

struct MessageHeaderBar: View {
    let message: MailMessage
    let onDismiss: () -> Void
    let onReply: () -> Void
    let onForward: () -> Void
    let onDelete: () -> Void

    private static let fullDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .long
        f.timeStyle = .short
        return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center) {
                Button {
                    onDismiss()
                } label: {
                    Label("Back to list", systemImage: "chevron.left")
                }
                .buttonStyle(.borderless)
                .keyboardShortcut(.escape, modifiers: [])
                .accessibilityLabel("Back to message list")
                .accessibilityHint("Press Escape to return")

                Spacer()

                // Action buttons
                HStack(spacing: 4) {
                    Button {
                        onReply()
                    } label: {
                        Label("Reply", systemImage: "arrowshape.turn.up.left")
                    }
                    .buttonStyle(.borderless)
                    .help("Reply")
                    .accessibilityLabel("Reply to this message")
                    .keyboardShortcut("r", modifiers: .command)

                    Button {
                        onForward()
                    } label: {
                        Label("Forward", systemImage: "arrowshape.turn.up.right")
                    }
                    .buttonStyle(.borderless)
                    .help("Forward")
                    .accessibilityLabel("Forward this message")
                    .keyboardShortcut("f", modifiers: [.command, .shift])

                    Divider()
                        .frame(height: 18)
                        .padding(.horizontal, 4)

                    Button {
                        onDelete()
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .buttonStyle(.borderless)
                    .help("Delete")
                    .accessibilityLabel("Delete this message")
                    .keyboardShortcut(.delete, modifiers: [])
                }

                Divider()
                    .frame(height: 18)
                    .padding(.horizontal, 8)

                Text(Self.fullDateFormatter.string(from: message.date))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Date: \(Self.fullDateFormatter.string(from: message.date))")
            }

            Text(message.subject.isEmpty ? "(No Subject)" : message.subject)
                .font(.title2.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
                .accessibilityLabel("Subject: \(message.subject)")

            HStack(spacing: 4) {
                Text("From:")
                    .foregroundStyle(.secondary)
                    .font(.callout)
                Text(message.from)
                    .font(.callout.weight(.medium))
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("From: \(message.from)")

            if let firstTo = message.to.first, !firstTo.isEmpty {
                HStack(spacing: 4) {
                    Text("To:")
                        .foregroundStyle(.secondary)
                        .font(.callout)
                    Text(firstTo)
                        .font(.callout)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("To: \(firstTo)")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

// MARK: - Message Body View

/// A NavigableTextView wraps NSTextView to provide full cursor movement,
/// VoiceOver reading, and keyboard navigation within the message body.
struct MessageBodyView: View {
    let text: String

    var body: some View {
        NavigableTextView(text: text)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel("Message body")
            .accessibilityHint("Use arrow keys to navigate text. Press Escape to return to the message list.")
    }
}

// MARK: - NavigableTextView (NSTextView wrapper)

struct NavigableTextView: NSViewRepresentable {
    let text: String

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSTextView.scrollableTextView()
        guard let textView = scrollView.documentView as? NSTextView else { return scrollView }

        // Configure for read-only accessible text navigation
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.font = NSFont.preferredFont(forTextStyle: .body, options: [:])
        textView.textColor = NSColor.labelColor
        textView.backgroundColor = NSColor.textBackgroundColor
        textView.textContainerInset = NSSize(width: 20, height: 20)
        textView.isAutomaticTextCompletionEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false

        // Accessibility
        textView.setAccessibilityLabel("Message body")
        textView.setAccessibilityRole(.textArea)

        // Make it use dynamic type sizing
        textView.isAutomaticTextReplacementEnabled = false
        textView.usesFontPanel = false

        // Line wrapping
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true

        // Delegate to handle Escape key forwarding
        textView.delegate = context.coordinator

        setText(text, on: textView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        if textView.string != text {
            setText(text, on: textView)
        }
    }

    private func setText(_ text: String, on textView: NSTextView) {
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = 4
        paragraphStyle.paragraphSpacing = 8

        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.preferredFont(forTextStyle: .body, options: [:]),
            .foregroundColor: NSColor.labelColor,
            .paragraphStyle: paragraphStyle
        ]
        let attributed = NSAttributedString(string: text, attributes: attrs)
        textView.textStorage?.setAttributedString(attributed)
        // Position caret at start
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        textView.scrollToBeginningOfDocument(nil)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    // MARK: Coordinator

    final class Coordinator: NSObject, NSTextViewDelegate {
        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            // Allow Escape to propagate to parent SwiftUI view
            if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
                // Post escape key event equivalent so SwiftUI .onKeyPress(.escape) fires
                NSApp.sendAction(#selector(NSResponder.cancelOperation(_:)), to: nil, from: textView)
                return true
            }
            return false
        }
    }
}
