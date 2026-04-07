import Foundation
import NIOCore
import NIOPosix
import NIOSSL
import Logging

// MARK: - IMAP Client Errors

public enum IMAPError: Error, LocalizedError {
    case connectionFailed(String)
    case authenticationFailed(String)
    case commandFailed(String)
    case parseError(String)
    case notConnected
    case timeout

    public var errorDescription: String? {
        switch self {
        case .connectionFailed(let msg): return "Connection failed: \(msg)"
        case .authenticationFailed(let msg): return "Authentication failed: \(msg)"
        case .commandFailed(let msg): return "Command failed: \(msg)"
        case .parseError(let msg): return "Parse error: \(msg)"
        case .notConnected: return "Not connected"
        case .timeout: return "Operation timed out"
        }
    }
}

// MARK: - Raw IMAP TCP Client

/// A minimal IMAP client that communicates over a plain socket protected by TLS.
/// Performs auth, LIST, SELECT, FETCH (headers), and FETCH (body) in a sequential
/// request/response style using structured concurrency.
public actor IMAPClient {

    private let host: String
    private let port: Int
    private let useTLS: Bool
    private var logger = Logger(label: "swiftmail.imap")

    // TCP connection handle
    private var connection: IMAPConnection?

    public init(host: String, port: Int, useTLS: Bool) {
        self.host = host
        self.port = port
        self.useTLS = useTLS
    }

    // MARK: Connect

    public func connect() async throws {
        let conn = IMAPConnection(host: host, port: port, useTLS: useTLS)
        try await conn.connect()
        self.connection = conn
        // Read the server greeting
        _ = try await conn.readUntilTaggedResponse(tag: nil)
    }

    // MARK: Login

    public func login(username: String, password: String) async throws {
        let conn = try requireConnection()
        let tag = conn.nextTag()
        let cmd = "\(tag) LOGIN \"\(username)\" \"\(escapeIMAPString(password))\"\r\n"
        try await conn.send(cmd)
        let response = try await conn.readUntilTaggedResponse(tag: tag)
        guard response.contains("OK") else {
            throw IMAPError.authenticationFailed(response)
        }
    }

    // MARK: Logout

    public func logout() async throws {
        guard let conn = connection else { return }
        let tag = conn.nextTag()
        try? await conn.send("\(tag) LOGOUT\r\n")
        _ = try? await conn.readUntilTaggedResponse(tag: tag)
        conn.close()
        connection = nil
    }

    // MARK: List Folders

    public func listFolders() async throws -> [String] {
        let conn = try requireConnection()
        let tag = conn.nextTag()
        try await conn.send("\(tag) LIST \"\" \"*\"\r\n")
        let response = try await conn.readUntilTaggedResponse(tag: tag)
        return parseListResponse(response)
    }

    // MARK: Select Folder

    /// Returns the number of messages in the mailbox.
    @discardableResult
    public func selectFolder(_ name: String) async throws -> Int {
        let conn = try requireConnection()
        let tag = conn.nextTag()
        try await conn.send("\(tag) SELECT \"\(name)\"\r\n")
        let response = try await conn.readUntilTaggedResponse(tag: tag)
        guard response.contains("OK") else {
            throw IMAPError.commandFailed("SELECT \(name): \(response)")
        }
        return parseExistsCount(response)
    }

    // MARK: Fetch Header Summaries

    /// Fetches envelope data for messages in the given UID range (e.g. "1:50").
    public func fetchHeaders(range: String) async throws -> [IMAPEnvelope] {
        let conn = try requireConnection()
        let tag = conn.nextTag()
        let cmd = "\(tag) UID FETCH \(range) (FLAGS UID ENVELOPE INTERNALDATE)\r\n"
        try await conn.send(cmd)
        let response = try await conn.readUntilTaggedResponse(tag: tag)
        return parseEnvelopes(response)
    }

    // MARK: Fetch Full Body

    public func fetchBody(uid: UInt32) async throws -> (plain: String?, html: String?) {
        let conn = try requireConnection()
        let tag = conn.nextTag()
        let cmd = "\(tag) UID FETCH \(uid) (BODY[])\r\n"
        try await conn.send(cmd)
        let response = try await conn.readUntilTaggedResponse(tag: tag)
        return parseBodyResponse(response)
    }

    // MARK: Mark as Read / Unread

    public func markRead(uid: UInt32) async throws {
        let conn = try requireConnection()
        let tag = conn.nextTag()
        try await conn.send("\(tag) UID STORE \(uid) +FLAGS (\\Seen)\r\n")
        _ = try await conn.readUntilTaggedResponse(tag: tag)
    }

    public func markUnread(uid: UInt32) async throws {
        let conn = try requireConnection()
        let tag = conn.nextTag()
        try await conn.send("\(tag) UID STORE \(uid) -FLAGS (\\Seen)\r\n")
        _ = try await conn.readUntilTaggedResponse(tag: tag)
    }

    // MARK: Delete Message

    /// Flags the message \Deleted and issues EXPUNGE.
    public func deleteMessage(uid: UInt32) async throws {
        let conn = try requireConnection()
        let storeTag = conn.nextTag()
        try await conn.send("\(storeTag) UID STORE \(uid) +FLAGS (\\Deleted)\r\n")
        _ = try await conn.readUntilTaggedResponse(tag: storeTag)
        let expungeTag = conn.nextTag()
        try await conn.send("\(expungeTag) EXPUNGE\r\n")
        _ = try await conn.readUntilTaggedResponse(tag: expungeTag)
    }

    // MARK: Private Helpers

    private func requireConnection() throws -> IMAPConnection {
        guard let conn = connection else { throw IMAPError.notConnected }
        return conn
    }

    private func escapeIMAPString(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }

    // MARK: Response Parsers

    private func parseListResponse(_ raw: String) -> [String] {
        var folders: [String] = []
        let lines = raw.components(separatedBy: "\r\n")
        for line in lines {
            guard line.hasPrefix("* LIST") else { continue }
            // * LIST (\HasNoChildren) "/" "INBOX"
            // Extract the folder name after the last space-delimited token
            if let lastSpace = line.lastIndex(of: " ") {
                var name = String(line[line.index(after: lastSpace)...])
                name = name.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
                if !name.isEmpty { folders.append(name) }
            }
        }
        return folders
    }

    private func parseExistsCount(_ raw: String) -> Int {
        let lines = raw.components(separatedBy: "\r\n")
        for line in lines {
            if line.hasSuffix(" EXISTS") {
                let parts = line.split(separator: " ")
                if parts.count >= 2, let n = Int(parts[1]) { return n }
            }
        }
        return 0
    }

    private static let envelopePattern: NSRegularExpression? = {
        let p = #"\* \d+ FETCH \((.*?)\)\r?\n"#
        return try? NSRegularExpression(pattern: p, options: [.dotMatchesLineSeparators])
    }()

    func parseEnvelopes(_ raw: String) -> [IMAPEnvelope] {
        var envelopes: [IMAPEnvelope] = []
        // Split on fetch response blocks
        let blocks = splitFetchBlocks(raw)
        for block in blocks {
            if let env = parseEnvelopeBlock(block) {
                envelopes.append(env)
            }
        }
        return envelopes
    }

    private func splitFetchBlocks(_ raw: String) -> [String] {
        var blocks: [String] = []
        let lines = raw.components(separatedBy: "\r\n")
        var current = ""
        var depth = 0
        for line in lines {
            if line.hasPrefix("* ") && line.contains(" FETCH (") && depth == 0 {
                if !current.isEmpty { blocks.append(current) }
                current = line + "\r\n"
                depth = line.filter { $0 == "(" }.count - line.filter { $0 == ")" }.count
            } else {
                current += line + "\r\n"
                depth += line.filter { $0 == "(" }.count - line.filter { $0 == ")" }.count
                if depth <= 0 && !current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    blocks.append(current)
                    current = ""
                    depth = 0
                }
            }
        }
        if !current.isEmpty { blocks.append(current) }
        return blocks
    }

    private func parseEnvelopeBlock(_ block: String) -> IMAPEnvelope? {
        let uid = extractUIDFromBlock(block)
        let flags = extractFlagsFromBlock(block)
        let isRead = flags.contains("\\Seen")
        let date = extractInternalDate(block)
        let (subject, from, to) = extractEnvelopeFields(block)
        guard let uid = uid else { return nil }
        return IMAPEnvelope(uid: uid, subject: subject, from: from, to: to, date: date, flags: flags, isRead: isRead)
    }

    private func extractUIDFromBlock(_ block: String) -> UInt32? {
        // UID <number>
        let pattern = #"UID (\d+)"#
        if let match = block.range(of: pattern, options: .regularExpression) {
            let sub = block[match]
            let digits = sub.components(separatedBy: " ").last ?? ""
            return UInt32(digits)
        }
        return nil
    }

    private func extractFlagsFromBlock(_ block: String) -> [String] {
        let pattern = #"FLAGS \(([^)]*)\)"#
        if let match = block.range(of: pattern, options: .regularExpression) {
            let sub = String(block[match])
            let inner = sub.dropFirst(7).dropFirst().dropLast() // Remove "FLAGS (" and ")"
            return inner.components(separatedBy: " ").filter { !$0.isEmpty }
        }
        return []
    }

    private func extractInternalDate(_ block: String) -> Date {
        let pattern = #"INTERNALDATE "([^"]+)""#
        if let range = block.range(of: pattern, options: .regularExpression) {
            let sub = String(block[range])
            // Remove INTERNALDATE " and trailing "
            let dateString = sub
                .replacingOccurrences(of: "INTERNALDATE \"", with: "")
                .replacingOccurrences(of: "\"", with: "")
                .trimmingCharacters(in: .whitespaces)
            let formatter = DateFormatter()
            formatter.dateFormat = "d-MMM-yyyy HH:mm:ss Z"
            formatter.locale = Locale(identifier: "en_US_POSIX")
            return formatter.date(from: dateString) ?? Date()
        }
        return Date()
    }

    private func extractEnvelopeFields(_ block: String) -> (subject: String, from: String, to: String) {
        // Look for ENVELOPE (date subject from-list sender-list reply-to-list to-list ...)
        let pattern = #"ENVELOPE \("#
        guard let envStart = block.range(of: pattern) else {
            return ("(No subject)", "(Unknown)", "")
        }
        // Find the balanced parentheses starting at envStart
        var idx = block.index(envStart.upperBound, offsetBy: -1) // position of opening (
        var depth = 0
        var envContent = ""
        var inEnv = false
        var i = envStart.lowerBound
        while i < block.endIndex {
            let ch = block[i]
            if !inEnv && ch == "(" {
                inEnv = true
                depth = 1
                i = block.index(after: i)
                idx = i
                continue
            }
            if inEnv {
                if ch == "(" { depth += 1 }
                else if ch == ")" {
                    depth -= 1
                    if depth == 0 {
                        envContent = String(block[idx..<i])
                        break
                    }
                }
            }
            i = block.index(after: i)
        }
        // IMAP ENVELOPE: (date subject from sender reply-to to cc bcc in-reply-to message-id)
        let subject = extractNthEnvelopeToken(envContent, n: 2)  // position 2
        let fromRaw = extractNthEnvelopeToken(envContent, n: 3)  // position 3
        let toRaw   = extractNthEnvelopeToken(envContent, n: 6)  // position 6
        return (
            subject: decodeIMAPString(subject),
            from: decodeAddressList(fromRaw),
            to: decodeAddressList(toRaw)
        )
    }

    // Very simplified: extract the nth "token" (quoted string or parenthesised group or NIL)
    private func extractNthEnvelopeToken(_ s: String, n: Int) -> String {
        var count = 0
        var i = s.startIndex
        while i < s.endIndex {
            let ch = s[i]
            if ch == " " || ch == "\t" {
                i = s.index(after: i)
                continue
            }
            count += 1
            if ch == "\"" {
                // quoted string — track content start, return slice between the quotes
                i = s.index(after: i)  // skip opening "
                let contentStart = i
                while i < s.endIndex {
                    if s[i] == "\\" {
                        i = s.index(after: i)  // skip backslash
                        if i < s.endIndex { i = s.index(after: i) }  // skip escaped char
                    } else if s[i] == "\"" {
                        if count == n { return String(s[contentStart..<i]) }
                        i = s.index(after: i)  // skip closing "
                        break
                    } else {
                        i = s.index(after: i)
                    }
                }
                continue  // i already advanced past closing "
            } else if ch == "(" {
                var depth = 1
                i = s.index(after: i)
                let start = i
                while i < s.endIndex && depth > 0 {
                    if s[i] == "(" { depth += 1 }
                    else if s[i] == ")" { depth -= 1 }
                    if depth > 0 { i = s.index(after: i) }
                }
                if count == n { return "(" + String(s[start..<i]) + ")" }
                if i < s.endIndex { i = s.index(after: i) }
            } else {
                // NIL or atom
                let start = i
                while i < s.endIndex && s[i] != " " && s[i] != "\t" && s[i] != ")" {
                    i = s.index(after: i)
                }
                if count == n { return String(s[start..<i]) }
            }
        }
        return "NIL"
    }

    private func decodeIMAPString(_ s: String) -> String {
        if s == "NIL" { return "" }
        var result = s
        if result.hasPrefix("\"") && result.hasSuffix("\"") {
            result = String(result.dropFirst().dropLast())
        }
        // Basic RFC 2047 decode: =?charset?encoding?text?=
        let rfc2047 = #"=\?([^?]+)\?([BbQq])\?([^?]*)\?="#
        while let range = result.range(of: rfc2047, options: .regularExpression) {
            let encoded = String(result[range])
            let decoded = decodeRFC2047(encoded)
            result.replaceSubrange(range, with: decoded)
        }
        return result
    }

    private func decodeRFC2047(_ token: String) -> String {
        // =?charset?B?base64?=  or  =?charset?Q?quoted-printable?=
        let parts = token.dropFirst(2).dropLast(2).components(separatedBy: "?")
        guard parts.count == 3 else { return token }
        let charset = parts[0]
        let encoding = parts[1].uppercased()
        let text = parts[2]
        let enc = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(
            CFStringConvertIANACharSetNameToEncoding(charset as CFString)))
        if encoding == "B" {
            if let data = Data(base64Encoded: text, options: .ignoreUnknownCharacters) {
                return String(data: data, encoding: enc) ?? token
            }
        } else if encoding == "Q" {
            let qp = text.replacingOccurrences(of: "_", with: " ")
                         .replacingOccurrences(of: "=([0-9A-Fa-f]{2})", with: "%$1", options: .regularExpression)
            return qp.removingPercentEncoding ?? token
        }
        return token
    }

    private func decodeAddressList(_ s: String) -> String {
        if s == "NIL" || s.isEmpty { return "" }
        // ((name NIL mailbox host) ...)
        // Extract first address
        guard s.hasPrefix("(") else { return s }
        let inner = String(s.dropFirst().dropLast())
        // Find first address tuple
        var depth = 0
        var start: String.Index? = nil
        for idx in inner.indices {
            if inner[idx] == "(" {
                if depth == 0 { start = inner.index(after: idx) }
                depth += 1
            } else if inner[idx] == ")" {
                depth -= 1
                if depth == 0, let s = start {
                    let addr = String(inner[s..<idx])
                    return parseAddressTuple(addr)
                }
            }
        }
        return decodeIMAPString(inner)
    }

    private func parseAddressTuple(_ s: String) -> String {
        // IMAP address tuple: (name NIL mailbox host) — positions are 1-indexed
        let name    = extractNthEnvelopeToken(s, n: 1)  // display name
        let mailbox = extractNthEnvelopeToken(s, n: 3)  // local-part (position 2 is NIL/route)
        let host    = extractNthEnvelopeToken(s, n: 4)  // domain
        let decodedName = decodeIMAPString(name)
        let email = "\(decodeIMAPString(mailbox))@\(decodeIMAPString(host))"
        if !decodedName.isEmpty && decodedName != "NIL" {
            return "\(decodedName) <\(email)>"
        }
        return email
    }

    func parseBodyResponse(_ raw: String) -> (plain: String?, html: String?) {
        // The body is everything between the size literal {n} or the first quoted value
        // and the final closing )
        // Find BODY[] literal
        let marker = "BODY[] {"
        if let range = raw.range(of: marker) {
            // Read {n}
            if let closeBrace = raw[range.upperBound...].firstIndex(of: "}") {
                let sizeStr = String(raw[range.upperBound..<closeBrace])
                if let size = Int(sizeStr) {
                    let bodyStart = raw.index(after: closeBrace)
                    if raw.index(bodyStart, offsetBy: size, limitedBy: raw.endIndex) != nil {
                        let bodyEnd = raw.index(bodyStart, offsetBy: min(size, raw.distance(from: bodyStart, to: raw.endIndex)))
                        let body = String(raw[bodyStart..<bodyEnd])
                        return parseMIMEMessage(body)
                    }
                }
            }
        }
        // Fallback: return raw as plain
        return (raw, nil)
    }

    private func parseMIMEMessage(_ raw: String) -> (plain: String?, html: String?) {
        let normalized = raw.replacingOccurrences(of: "\r\n", with: "\n")
        // Split headers from body
        guard let headerBodySep = normalized.range(of: "\n\n") else {
            return (normalized, nil)
        }
        let headers = String(normalized[..<headerBodySep.lowerBound])
        let body = String(normalized[headerBodySep.upperBound...])

        let contentType = extractHeader("Content-Type", from: headers)
        let transferEncoding = extractHeader("Content-Transfer-Encoding", from: headers).lowercased()

        if contentType.lowercased().contains("multipart") {
            // Extract boundary
            if let boundaryRange = contentType.range(of: #"boundary="?([^";]+)"?"#, options: .regularExpression) {
                var boundary = String(contentType[boundaryRange])
                boundary = boundary
                    .replacingOccurrences(of: "boundary=", with: "")
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
                return parseMultipart(body, boundary: boundary)
            }
        }

        if contentType.lowercased().contains("text/html") {
            let decoded = decodeBodyContent(body, encoding: transferEncoding)
            return (nil, decoded)
        }

        // Default: plain text
        let decoded = decodeBodyContent(body, encoding: transferEncoding)
        return (decoded, nil)
    }

    private func parseMultipart(_ body: String, boundary: String) -> (plain: String?, html: String?) {
        let delimiter = "--" + boundary
        let parts = body.components(separatedBy: delimiter)
        var plain: String? = nil
        var html: String? = nil
        for part in parts {
            guard !part.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !part.hasPrefix("--") else { continue }
            let normalized = part.replacingOccurrences(of: "\r\n", with: "\n")
            guard let sep = normalized.range(of: "\n\n") else { continue }
            let partHeaders = String(normalized[..<sep.lowerBound])
            let partBody = String(normalized[sep.upperBound...])
            let ct = extractHeader("Content-Type", from: partHeaders).lowercased()
            let te = extractHeader("Content-Transfer-Encoding", from: partHeaders).lowercased()
            if ct.contains("text/plain") && plain == nil {
                plain = decodeBodyContent(partBody, encoding: te)
            } else if ct.contains("text/html") && html == nil {
                html = decodeBodyContent(partBody, encoding: te)
            } else if ct.contains("multipart") {
                // nested
                if let bRange = ct.range(of: #"boundary="?([^";]+)"?"#, options: .regularExpression) {
                    var nb = String(ct[bRange])
                    nb = nb.replacingOccurrences(of: "boundary=", with: "")
                        .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
                    let (p, h) = parseMultipart(partBody, boundary: nb)
                    if plain == nil { plain = p }
                    if html == nil { html = h }
                }
            }
        }
        return (plain, html)
    }

    private func extractHeader(_ name: String, from headers: String) -> String {
        let lines = headers.components(separatedBy: "\n")
        for (i, line) in lines.enumerated() {
            if line.lowercased().hasPrefix(name.lowercased() + ":") {
                var value = String(line.dropFirst(name.count + 1)).trimmingCharacters(in: .whitespaces)
                // Handle folded headers
                var j = i + 1
                while j < lines.count && (lines[j].hasPrefix(" ") || lines[j].hasPrefix("\t")) {
                    value += " " + lines[j].trimmingCharacters(in: .whitespaces)
                    j += 1
                }
                return value
            }
        }
        return ""
    }

    private func decodeBodyContent(_ body: String, encoding: String) -> String {
        if encoding.contains("base64") {
            let compacted = body.components(separatedBy: .newlines).joined()
            if let data = Data(base64Encoded: compacted, options: .ignoreUnknownCharacters),
               let str = String(data: data, encoding: .utf8) {
                return str
            }
            // Try latin1
            if let data = Data(base64Encoded: compacted, options: .ignoreUnknownCharacters),
               let str = String(data: data, encoding: .isoLatin1) {
                return str
            }
        } else if encoding.contains("quoted-printable") {
            return decodeQuotedPrintable(body)
        }
        return body
    }

    private func decodeQuotedPrintable(_ s: String) -> String {
        var result = ""
        let lines = s.components(separatedBy: "\n")
        for line in lines {
            var l = line
            if l.hasSuffix("=\r") { l = String(l.dropLast(2)) }
            else if l.hasSuffix("=") { l = String(l.dropLast()) }
            else { l += "\n" }
            // Decode =XX
            var i = l.startIndex
            while i < l.endIndex {
                if l[i] == "=" {
                    let next = l.index(after: i)
                    if next < l.endIndex {
                        let next2 = l.index(after: next)
                        if next2 < l.endIndex {
                            let hex = String(l[next...next2])
                            if let byte = UInt8(hex, radix: 16) {
                                result += String(UnicodeScalar(byte))
                                i = l.index(after: next2)
                                continue
                            }
                        }
                    }
                }
                result.append(l[i])
                i = l.index(after: i)
            }
        }
        return result
    }
}

// MARK: - IMAP Envelope (intermediate parse result)

public struct IMAPEnvelope: Sendable {
    public let uid: UInt32
    public let subject: String
    public let from: String
    public let to: String
    public let date: Date
    public let flags: [String]
    public let isRead: Bool
}
