import Foundation

// MARK: - Mail Account

public struct MailAccount: Identifiable, Equatable, Sendable {
    public let id: UUID
    public var displayName: String
    public var emailAddress: String
    public var imapHost: String
    public var imapPort: Int
    public var imapUsername: String
    public var useTLS: Bool
    // Outgoing mail
    public var smtpHost: String
    public var smtpPort: Int  // 465 = direct TLS, 587 = STARTTLS

    public init(
        id: UUID = UUID(),
        displayName: String,
        emailAddress: String,
        imapHost: String,
        imapPort: Int = 993,
        imapUsername: String,
        useTLS: Bool = true,
        smtpHost: String = "",
        smtpPort: Int = 587
    ) {
        self.id = id
        self.displayName = displayName
        self.emailAddress = emailAddress
        self.imapHost = imapHost
        self.imapPort = imapPort
        self.imapUsername = imapUsername
        self.useTLS = useTLS
        self.smtpHost = smtpHost
        self.smtpPort = smtpPort
    }
}

extension MailAccount: Codable {
    enum CodingKeys: String, CodingKey {
        case id, displayName, emailAddress, imapHost, imapPort, imapUsername, useTLS
        case smtpHost, smtpPort
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id           = try c.decode(UUID.self,   forKey: .id)
        displayName  = try c.decode(String.self, forKey: .displayName)
        emailAddress = try c.decode(String.self, forKey: .emailAddress)
        imapHost     = try c.decode(String.self, forKey: .imapHost)
        imapPort     = try c.decode(Int.self,    forKey: .imapPort)
        imapUsername = try c.decode(String.self, forKey: .imapUsername)
        useTLS       = try c.decode(Bool.self,   forKey: .useTLS)
        smtpHost     = (try? c.decodeIfPresent(String.self, forKey: .smtpHost)) ?? ""
        smtpPort     = (try? c.decodeIfPresent(Int.self,    forKey: .smtpPort)) ?? 587
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id,           forKey: .id)
        try c.encode(displayName,  forKey: .displayName)
        try c.encode(emailAddress, forKey: .emailAddress)
        try c.encode(imapHost,     forKey: .imapHost)
        try c.encode(imapPort,     forKey: .imapPort)
        try c.encode(imapUsername, forKey: .imapUsername)
        try c.encode(useTLS,       forKey: .useTLS)
        try c.encode(smtpHost,     forKey: .smtpHost)
        try c.encode(smtpPort,     forKey: .smtpPort)
    }
}

// MARK: - Mail Folder

public struct MailFolder: Identifiable, Hashable, Sendable {
    public let id: String          // "<accountID>/<name>"
    public let accountID: UUID
    public let name: String        // raw IMAP name e.g. "INBOX"
    public let displayName: String // human-readable
    public let isVirtual: Bool     // true for "All Mail"

    public init(
        accountID: UUID,
        name: String,
        displayName: String,
        isVirtual: Bool = false
    ) {
        self.id = "\(accountID.uuidString)/\(name)"
        self.accountID = accountID
        self.name = name
        self.displayName = displayName
        self.isVirtual = isVirtual
    }
}

// MARK: - Mail Message

public struct MailMessage: Identifiable, Hashable, Sendable {
    public let id: String          // "<folderID>/<uid>"
    public let uid: UInt32
    public let folderID: String
    public let accountID: UUID
    public var subject: String
    public var from: String
    public var to: [String]
    public var date: Date
    public var isRead: Bool
    public var flags: [String]

    // Body — nil until fetched
    public var plainBody: String?
    public var htmlBody: String?

    public init(
        uid: UInt32,
        folderID: String,
        accountID: UUID,
        subject: String,
        from: String,
        to: [String],
        date: Date,
        isRead: Bool,
        flags: [String],
        plainBody: String? = nil,
        htmlBody: String? = nil
    ) {
        self.id = "\(folderID)/\(uid)"
        self.uid = uid
        self.folderID = folderID
        self.accountID = accountID
        self.subject = subject
        self.from = from
        self.to = to
        self.date = date
        self.isRead = isRead
        self.flags = flags
        self.plainBody = plainBody
        self.htmlBody = htmlBody
    }

    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
    public static func == (lhs: MailMessage, rhs: MailMessage) -> Bool { lhs.id == rhs.id }

    /// Best available readable body text
    public var bodyText: String {
        plainBody ?? htmlBody?.strippingHTML() ?? "(No body)"
    }
}

// MARK: - HTML stripping helper

extension String {
    public func strippingHTML() -> String {
        // Crude tag strip — NSAttributedString HTML initializion is AppKit-only and deprecated in newer SDKs
        return replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&quot;", with: "\"")
    }
}
