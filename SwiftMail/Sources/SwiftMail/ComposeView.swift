import SwiftUI
import SwiftMailCore

// MARK: - Compose Mode

enum ComposeMode {
    case new
    case reply(to: MailMessage)
    case forward(message: MailMessage)
}

// MARK: - Compose View

struct ComposeView: View {
    let mode: ComposeMode

    @EnvironmentObject private var store: MailStore
    @Environment(\.dismiss) private var dismiss

    @State private var selectedAccountID: UUID?
    @State private var toField = ""
    @State private var subjectField = ""
    @State private var bodyText = ""
    @State private var isSending = false
    @State private var sendError: String?

    @FocusState private var focusedField: Field?

    private enum Field: Hashable { case to, subject, body }

    private var selectedAccount: MailAccount? {
        if let id = selectedAccountID { return store.accounts.first { $0.id == id } }
        return store.accounts.first
    }

    private var titleText: String {
        switch mode {
        case .new:     return "New Message"
        case .reply:   return "Reply"
        case .forward: return "Forward"
        }
    }

    init(mode: ComposeMode = .new) {
        self.mode = mode
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(titleText)
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.escape, modifiers: [])
                    .accessibilityLabel("Cancel")
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)

            Divider()

            // From picker (multi-account only)
            if store.accounts.count > 1 {
                HStack(spacing: 0) {
                    Text("From")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .frame(width: 70, alignment: .trailing)
                        .padding(.leading, 16)
                        .accessibilityHidden(true)
                    Picker("From", selection: Binding(
                        get: { selectedAccountID ?? store.accounts.first?.id },
                        set: { selectedAccountID = $0 }
                    )) {
                        ForEach(store.accounts) { acct in
                            Text(acct.emailAddress).tag(acct.id as UUID?)
                        }
                    }
                    .labelsHidden()
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    Spacer()
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("From account")
                Divider().padding(.leading, 70)
            }

            // To
            ComposeFieldRow(label: "To") {
                TextField("recipient@example.com", text: $toField)
                    .focused($focusedField, equals: .to)
                    .textContentType(.emailAddress)
                    .onSubmit { focusedField = .subject }
                    .accessibilityLabel("To")
            }
            Divider().padding(.leading, 70)

            // Subject
            ComposeFieldRow(label: "Subject") {
                TextField("Subject", text: $subjectField)
                    .focused($focusedField, equals: .subject)
                    .onSubmit { focusedField = .body }
                    .accessibilityLabel("Subject")
            }
            Divider()

            // Body
            TextEditor(text: $bodyText)
                .focused($focusedField, equals: .body)
                .font(.body)
                .padding(16)
                .accessibilityLabel("Message body")

            // Error
            if let err = sendError {
                Divider()
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .accessibilityHidden(true)
                    Text(err)
                        .foregroundStyle(.red)
                        .font(.callout)
                    Spacer()
                    Button("Dismiss") { sendError = nil }
                        .buttonStyle(.borderless)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.red.opacity(0.08))
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Send error: \(err)")
            }

            Divider()

            // Send button
            HStack {
                Spacer()
                Button(action: sendMessage) {
                    if isSending {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Send", systemImage: "paperplane.fill")
                    }
                }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(isSending || toField.trimmingCharacters(in: .whitespaces).isEmpty || selectedAccount == nil)
                .buttonStyle(.borderedProminent)
                .accessibilityLabel("Send message")
                .accessibilityHint("Command-Return")
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .frame(minWidth: 580, minHeight: 480)
        .onAppear { prefill() }
    }

    // MARK: - Pre-fill

    private func prefill() {
        selectedAccountID = store.accounts.first?.id
        switch mode {
        case .new:
            focusedField = .to

        case .reply(let original):
            toField = original.from
            subjectField = original.subject.hasPrefix("Re:") ? original.subject : "Re: \(original.subject)"
            bodyText = "\n\n" + quoteMessage(original)
            focusedField = .body

        case .forward(let original):
            subjectField = original.subject.hasPrefix("Fwd:") ? original.subject : "Fwd: \(original.subject)"
            bodyText = "\n\n" + quoteMessage(original)
            focusedField = .to
        }
    }

    private func quoteMessage(_ msg: MailMessage) -> String {
        let dateStr = DateFormatter.localizedString(from: msg.date, dateStyle: .long, timeStyle: .short)
        var q  = "---------- Original Message ----------\n"
        q     += "From: \(msg.from)\n"
        q     += "Date: \(dateStr)\n"
        q     += "Subject: \(msg.subject)\n"
        q     += "--------------------------------------\n"
        q     += msg.bodyText
        return q
    }

    // MARK: - Send

    private func sendMessage() {
        guard let account = selectedAccount else { return }
        let recipients = toField
            .components(separatedBy: CharacterSet(charactersIn: ",;"))
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard !recipients.isEmpty else { return }

        isSending = true
        sendError = nil

        Task {
            let err = await store.sendMail(
                accountID: account.id,
                displayName: account.displayName,
                to: recipients,
                subject: subjectField,
                body: bodyText
            )
            isSending = false
            if let err = err {
                sendError = err
            } else {
                dismiss()
            }
        }
    }
}

// MARK: - Compose Field Row

private struct ComposeFieldRow<Content: View>: View {
    let label: String
    let content: Content

    init(label: String, @ViewBuilder content: () -> Content) {
        self.label = label
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 0) {
            Text(label)
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(width: 70, alignment: .trailing)
                .padding(.leading, 16)
                .accessibilityHidden(true)
            content
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            Spacer()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}
