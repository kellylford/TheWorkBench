import SwiftUI
import SwiftMailCore

struct AddAccountView: View {
    @EnvironmentObject private var store: MailStore
    @Environment(\.dismiss) private var dismiss

    @State private var displayName = ""
    @State private var emailAddress = ""
    @State private var imapHost = ""
    @State private var imapPort = "993"
    @State private var imapUsername = ""
    @State private var password = ""
    @State private var useTLS = true
    @State private var smtpHost = ""
    @State private var smtpPort = "587"
    @State private var isValidating = false
    @State private var validationError: String? = nil

    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case displayName, email, imapHost, imapPort, username, password, smtpHost, smtpPort
    }

    private var isFormValid: Bool {
        !displayName.isEmpty &&
        !emailAddress.isEmpty &&
        !imapHost.isEmpty &&
        !imapUsername.isEmpty &&
        !password.isEmpty &&
        (Int(imapPort) != nil)
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("Add Mail Account")
                .font(.title2.weight(.semibold))
                .padding(.vertical, 20)
                .accessibilityAddTraits(.isHeader)

            Divider()

            Form {
                Section("Your Details") {
                    LabeledField("Display Name", systemImage: "person") {
                        TextField("Your Name", text: $displayName)
                            .focused($focusedField, equals: .displayName)
                            .textContentType(.name)
                            .onSubmit { focusedField = .email }
                    }

                    LabeledField("Email Address", systemImage: "envelope") {
                        TextField("you@example.com", text: $emailAddress)
                            .focused($focusedField, equals: .email)
                            .textContentType(.emailAddress)
                            .onSubmit {
                                autoFillServers()
                                focusedField = .imapHost
                            }
                    }
                }

                Section("Incoming Mail (IMAP)") {
                    LabeledField("Server", systemImage: "server.rack") {
                        TextField("imap.example.com", text: $imapHost)
                            .focused($focusedField, equals: .imapHost)
                            .textContentType(.URL)
                            .onSubmit { focusedField = .imapPort }
                    }

                    LabeledField("Port", systemImage: "number") {
                        TextField("993", text: $imapPort)
                            .focused($focusedField, equals: .imapPort)
                            .onSubmit { focusedField = .username }
                    }

                    Toggle(isOn: $useTLS) {
                        Label("Use TLS/SSL", systemImage: "lock")
                    }
                    .onChange(of: useTLS) { tls in
                        if imapPort == "993" || imapPort == "143" {
                            imapPort = tls ? "993" : "143"
                        }
                    }
                }

                Section("Outgoing Mail (SMTP)") {
                    LabeledField("Server", systemImage: "paperplane") {
                        TextField("smtp.example.com", text: $smtpHost)
                            .focused($focusedField, equals: .smtpHost)
                            .textContentType(.URL)
                            .onSubmit { focusedField = .smtpPort }
                    }

                    LabeledField("Port", systemImage: "number") {
                        TextField("587", text: $smtpPort)
                            .focused($focusedField, equals: .smtpPort)
                            .onSubmit { focusedField = .username }
                    }

                    Text("Port 587 uses STARTTLS · Port 465 uses TLS")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Authentication") {
                    LabeledField("Username", systemImage: "at") {
                        TextField("username or email", text: $imapUsername)
                            .focused($focusedField, equals: .username)
                            .textContentType(.username)
                            .onSubmit { focusedField = .password }
                    }

                    LabeledField("Password", systemImage: "key") {
                        SecureField("Password", text: $password)
                            .focused($focusedField, equals: .password)
                            .textContentType(.password)
                            .onSubmit { tryAdd() }
                    }
                }

                if let err = validationError {
                    Section {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                                .accessibilityHidden(true)
                            Text(err)
                                .foregroundStyle(.red)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Error: \(err)")
                    }
                }
            }
            .formStyle(.grouped)

            Divider()

            HStack(spacing: 12) {
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.escape, modifiers: [])
                .accessibilityLabel("Cancel adding account")

                Spacer()

                Button(action: tryAdd) {
                    if isValidating {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text("Add Account")
                    }
                }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!isFormValid || isValidating)
                .buttonStyle(.borderedProminent)
                .accessibilityLabel("Add mail account")
                .accessibilityHint("Command-Return to confirm")
            }
            .padding(20)
        }
        .frame(width: 480)
        .onAppear { focusedField = .displayName }
    }

    // MARK: - Auto-fill known providers

    private func autoFillServers() {
        guard let atIndex = emailAddress.firstIndex(of: "@") else { return }
        let domain = String(emailAddress[emailAddress.index(after: atIndex)...]).lowercased()
        switch domain {
        case "gmail.com":
            if imapHost.isEmpty { imapHost = "imap.gmail.com" }
            if smtpHost.isEmpty { smtpHost = "smtp.gmail.com" }
        case "outlook.com", "hotmail.com", "live.com":
            if imapHost.isEmpty { imapHost = "outlook.office365.com" }
            if smtpHost.isEmpty { smtpHost = "smtp-mail.outlook.com" }
        case "yahoo.com":
            if imapHost.isEmpty { imapHost = "imap.mail.yahoo.com" }
            if smtpHost.isEmpty { smtpHost = "smtp.mail.yahoo.com" }
        case "icloud.com", "me.com", "mac.com":
            if imapHost.isEmpty { imapHost = "imap.mail.me.com" }
            if smtpHost.isEmpty { smtpHost = "smtp.mail.me.com" }
        default:
            if imapHost.isEmpty { imapHost = "imap.\(domain)" }
            if smtpHost.isEmpty { smtpHost = "smtp.\(domain)" }
        }
        if imapUsername.isEmpty { imapUsername = emailAddress }
    }

    // MARK: - Submit

    private func tryAdd() {
        guard isFormValid else { return }
        validationError = nil
        isValidating = true

        let account = MailAccount(
            displayName: displayName.trimmingCharacters(in: .whitespaces),
            emailAddress: emailAddress.trimmingCharacters(in: .whitespaces),
            imapHost: imapHost.trimmingCharacters(in: .whitespaces),
            imapPort: Int(imapPort) ?? 993,
            imapUsername: imapUsername.trimmingCharacters(in: .whitespaces),
            useTLS: useTLS,
            smtpHost: smtpHost.trimmingCharacters(in: .whitespaces),
            smtpPort: Int(smtpPort) ?? 587
        )

        Task {
            let client = IMAPClient(
                host: account.imapHost,
                port: account.imapPort,
                useTLS: account.useTLS
            )
            do {
                try await client.connect()
                try await client.login(username: account.imapUsername, password: password)
                try await client.logout()
                store.addAccount(account, password: password)
                await store.connectAndLoadFolders(for: account)
                isValidating = false
                dismiss()
            } catch {
                validationError = error.localizedDescription
                isValidating = false
            }
        }
    }
}

// MARK: - LabeledField helper

struct LabeledField<Content: View>: View {
    let label: String
    let systemImage: String
    let content: Content

    init(_ label: String, systemImage: String, @ViewBuilder content: () -> Content) {
        self.label = label
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 10) {
            Label(label, systemImage: systemImage)
                .frame(width: 140, alignment: .trailing)
                .foregroundStyle(.secondary)
                .font(.callout)
                .accessibilityHidden(true)
            content
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}
