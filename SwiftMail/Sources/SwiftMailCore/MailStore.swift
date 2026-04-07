import Foundation
import Security
import Logging

// MARK: - MailStore

/// Central observable store. All mutations happen on MainActor, IMAP work on background tasks.
@MainActor
public final class MailStore: ObservableObject {

    // MARK: Published State

    @Published public var accounts: [MailAccount] = []
    @Published public var folders: [MailFolder] = []
    @Published public var messages: [MailMessage] = []
    @Published public var selectedFolder: MailFolder?
    @Published public var isLoading: Bool = false
    @Published public var errorMessage: String?

    // MARK: Private

    private var clients: [UUID: IMAPClient] = [:]
    private var logger = Logger(label: "swiftmail.store")

    public init() {
        loadAccounts()
    }

    // MARK: - Account Management

    public func addAccount(_ account: MailAccount, password: String) {
        storePassword(password, for: account)
        accounts.append(account)
        saveAccounts()
    }

    public func removeAccount(_ account: MailAccount) {
        removePassword(for: account)
        accounts.removeAll { $0.id == account.id }
        folders.removeAll { $0.accountID == account.id }
        messages.removeAll { $0.accountID == account.id }
        saveAccounts()
    }

    // MARK: - Connect & Load Folders

    public func connectAndLoadFolders(for account: MailAccount) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let client = IMAPClient(host: account.imapHost, port: account.imapPort, useTLS: account.useTLS)
            try await client.connect()
            guard let password = retrievePassword(for: account) else {
                errorMessage = "No password stored for \(account.emailAddress). Please re-add the account."
                return
            }
            try await client.login(username: account.imapUsername, password: password)
            clients[account.id] = client

            let rawFolders = try await client.listFolders()
            var newFolders: [MailFolder] = rawFolders.map { name in
                MailFolder(accountID: account.id, name: name, displayName: friendlyFolderName(name))
            }
            // Add virtual All Mail folder
            newFolders.insert(
                MailFolder(accountID: account.id, name: "__ALLMAIL__", displayName: "All Mail", isVirtual: true),
                at: 0
            )
            // Remove duplicates
            folders.removeAll { $0.accountID == account.id }
            folders.append(contentsOf: newFolders)

        } catch {
            errorMessage = error.localizedDescription
            logger.error("Connect failed: \(error)")
        }
    }

    // MARK: - Load Messages

    public func loadMessages(for folder: MailFolder) async {
        selectedFolder = folder
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        if folder.isVirtual && folder.name == "__ALLMAIL__" {
            await loadAllMail(accountID: folder.accountID)
            return
        }

        guard let client = clients[folder.accountID] else {
            errorMessage = "Not connected to account"
            return
        }
        do {
            let count = try await client.selectFolder(folder.name)
            guard count > 0 else {
                messages = []
                return
            }
            // Fetch latest 100 messages
            let low = max(1, count - 99)
            let range = "\(low):\(count)"
            let envelopes = try await client.fetchHeaders(range: range)
            let newMessages: [MailMessage] = envelopes.map { env in
                MailMessage(
                    uid: env.uid,
                    folderID: folder.id,
                    accountID: folder.accountID,
                    subject: env.subject.isEmpty ? "(No Subject)" : env.subject,
                    from: env.from.isEmpty ? "(Unknown)" : env.from,
                    to: [env.to],
                    date: env.date,
                    isRead: env.isRead,
                    flags: env.flags
                )
            }
            messages = newMessages.sorted { $0.date > $1.date }
        } catch {
            errorMessage = error.localizedDescription
            logger.error("Load messages failed: \(error)")
        }
    }

    // MARK: - All Mail Virtual Folder

    private func loadAllMail(accountID: UUID) async {
        guard let client = clients[accountID] else {
            errorMessage = "Not connected to account"
            return
        }
        let account = accounts.first { $0.id == accountID }
        let realFolders = folders.filter { $0.accountID == accountID && !$0.isVirtual }

        var allMessages: [MailMessage] = []
        for folder in realFolders {
            do {
                let count = try await client.selectFolder(folder.name)
                guard count > 0 else { continue }
                let low = max(1, count - 49)
                let range = "\(low):\(count)"
                let envelopes = try await client.fetchHeaders(range: range)
                let msgs: [MailMessage] = envelopes.map { env in
                    MailMessage(
                        uid: env.uid,
                        folderID: folder.id,
                        accountID: accountID,
                        subject: env.subject.isEmpty ? "(No Subject)" : env.subject,
                        from: env.from.isEmpty ? "(Unknown)" : env.from,
                        to: [env.to],
                        date: env.date,
                        isRead: env.isRead,
                        flags: env.flags
                    )
                }
                allMessages.append(contentsOf: msgs)
            } catch {
                logger.warning("Skipping folder \(folder.name): \(error)")
            }
        }
        // Deduplicate by message-id equivalent (folderID+uid is unique per folder, so no dedup needed)
        messages = allMessages.sorted { $0.date > $1.date }
    }

    // MARK: - Fetch Full Body

    public func fetchBody(for message: MailMessage) async {
        guard let client = clients[message.accountID] else { return }
        do {
            // Select the original folder (not virtual)
            let realFolder = folders.first {
                $0.id == message.folderID && !$0.isVirtual
            } ?? folders.first {
                $0.accountID == message.accountID && $0.name == "INBOX"
            }
            if let folder = realFolder {
                _ = try? await client.selectFolder(folder.name)
            }
            let (plain, html) = try await client.fetchBody(uid: message.uid)
            if let idx = messages.firstIndex(where: { $0.id == message.id }) {
                messages[idx].plainBody = plain
                messages[idx].htmlBody = html
            }
        } catch {
            logger.error("Fetch body failed: \(error)")
        }
    }

    // MARK: - Mark as Read

    public func markRead(_ message: MailMessage) async {
        guard !message.isRead,
              let client = clients[message.accountID] else { return }
        do {
            try await client.markRead(uid: message.uid)
            if let idx = messages.firstIndex(where: { $0.id == message.id }) {
                messages[idx].isRead = true
            }
        } catch {
            logger.warning("markRead failed: \(error)")
        }
    }

    // MARK: - Delete Message

    public func deleteMessage(_ message: MailMessage) async {
        guard let client = clients[message.accountID] else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let realFolder = folders.first { $0.id == message.folderID && !$0.isVirtual }
            if let folder = realFolder {
                _ = try? await client.selectFolder(folder.name)
            }
            try await client.deleteMessage(uid: message.uid)
            messages.removeAll { $0.id == message.id }
        } catch {
            errorMessage = error.localizedDescription
            logger.error("Delete failed: \(error)")
        }
    }

    // MARK: - Send Mail

    /// Returns nil on success, or a localised error string on failure.
    public func sendMail(
        accountID: UUID,
        displayName: String,
        to: [String],
        subject: String,
        body: String
    ) async -> String? {
        guard let account = accounts.first(where: { $0.id == accountID }) else {
            return "Account not found"
        }
        guard !account.smtpHost.isEmpty else {
            return "No SMTP server configured. Please edit the account and add an SMTP server."
        }
        guard let password = retrievePassword(for: account) else {
            return "No password stored for \(account.emailAddress)"
        }
        let smtp = SMTPClient(host: account.smtpHost, port: account.smtpPort)
        do {
            try await smtp.connect()
            try await smtp.authenticate(username: account.imapUsername, password: password)
            try await smtp.sendMail(
                from: account.emailAddress,
                fromDisplay: displayName,
                to: to,
                subject: subject,
                body: body
            )
            try await smtp.quit()
            return nil
        } catch {
            logger.error("SMTP send failed: \(error)")
            return error.localizedDescription
        }
    }

    // MARK: - Refresh

    public func refreshCurrentFolder() async {
        guard let folder = selectedFolder else { return }
        await loadMessages(for: folder)
    }

    public func reconnectAll() async {
        for account in accounts {
            await connectAndLoadFolders(for: account)
        }
    }

    // MARK: - Keychain Helpers

    private func storePassword(_ password: String, for account: MailAccount) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassInternetPassword,
            kSecAttrAccount as String: account.imapUsername,
            kSecAttrServer as String: account.imapHost,
            kSecValueData as String: password.data(using: .utf8)!,
            kSecAttrLabel as String: "SwiftMail: \(account.emailAddress)"
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private func retrievePassword(for account: MailAccount) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassInternetPassword,
            kSecAttrAccount as String: account.imapUsername,
            kSecAttrServer as String: account.imapHost,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let password = String(data: data, encoding: .utf8) else {
            return nil
        }
        return password
    }

    private func removePassword(for account: MailAccount) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassInternetPassword,
            kSecAttrAccount as String: account.imapUsername,
            kSecAttrServer as String: account.imapHost
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Persistence

    private func saveAccounts() {
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(accounts) {
            UserDefaults.standard.set(data, forKey: "swiftmail.accounts")
        }
    }

    private func loadAccounts() {
        let decoder = JSONDecoder()
        if let data = UserDefaults.standard.data(forKey: "swiftmail.accounts"),
           let loaded = try? decoder.decode([MailAccount].self, from: data) {
            accounts = loaded
        }
    }

    // MARK: - Helpers

    private func friendlyFolderName(_ name: String) -> String {
        let lower = name.lowercased()
        if lower == "inbox" { return "Inbox" }
        if lower.hasSuffix("/sent") || lower == "sent" { return "Sent" }
        if lower.hasSuffix("/drafts") || lower == "drafts" { return "Drafts" }
        if lower.hasSuffix("/trash") || lower == "trash" { return "Trash" }
        if lower.hasSuffix("/spam") || lower == "spam" || lower.hasSuffix("/junk") { return "Junk" }
        if lower.hasSuffix("/archive") || lower == "archive" { return "Archive" }
        // Use last path component
        return name.components(separatedBy: "/").last ?? name
    }
}
