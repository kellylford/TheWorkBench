import Foundation
import NIOCore
import NIOPosix
import NIOSSL
import Logging

// MARK: - SMTP Errors

public enum SMTPError: Error, LocalizedError {
    case connectionFailed(String)
    case authenticationFailed(String)
    case sendFailed(String)
    case notConnected

    public var errorDescription: String? {
        switch self {
        case .connectionFailed(let msg):      return "SMTP connection failed: \(msg)"
        case .authenticationFailed(let msg):  return "SMTP authentication failed: \(msg)"
        case .sendFailed(let msg):            return "Send failed: \(msg)"
        case .notConnected:                   return "SMTP not connected"
        }
    }
}

// MARK: - SMTP Connection

/// Low-level buffered TCP/TLS connection for SMTP.
final class SMTPConnection: @unchecked Sendable {

    private let host: String
    private let port: Int
    private let useTLS: Bool   // direct TLS on connect (port 465)

    private var channel: Channel?
    private let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)

    private var buffer = ""
    private let bufferLock = NSLock()
    private var continuations: [CheckedContinuation<String, Error>] = []
    private var waiters: [() -> Bool] = []

    init(host: String, port: Int, useTLS: Bool) {
        self.host = host
        self.port = port
        self.useTLS = useTLS
    }

    func connect() async throws {
        let bootstrap = ClientBootstrap(group: group)
            .channelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .channelOption(ChannelOptions.connectTimeout, value: .seconds(15))
            .channelInitializer { [weak self] channel in
                guard let self = self else {
                    return channel.eventLoop.makeFailedFuture(SMTPError.connectionFailed("Deallocated"))
                }
                var handlers: [ChannelHandler] = []
                if self.useTLS {
                    do {
                        let tlsConfig = TLSConfiguration.makeClientConfiguration()
                        let sslContext = try NIOSSLContext(configuration: tlsConfig)
                        let sslHandler = try NIOSSLClientHandler(context: sslContext, serverHostname: self.host)
                        handlers.append(sslHandler)
                    } catch {
                        return channel.eventLoop.makeFailedFuture(error)
                    }
                }
                handlers.append(ByteToMessageHandler(SMTPPassthroughDecoder()))
                handlers.append(SMTPChannelHandler(connection: self))
                return channel.pipeline.addHandlers(handlers)
            }
        channel = try await bootstrap.connect(host: host, port: port).get()
    }

    func send(_ text: String) async throws {
        guard let ch = channel else { throw SMTPError.notConnected }
        var buf = ch.allocator.buffer(capacity: text.utf8.count)
        buf.writeString(text)
        try await ch.writeAndFlush(buf).get()
    }

    /// Read a complete SMTP response. A response is complete when a line begins
    /// with a 3-digit code followed by a space (not a dash).
    func readResponse() async throws -> String {
        return try await withCheckedThrowingContinuation { cont in
            bufferLock.lock()
            defer { bufferLock.unlock() }
            if let result = checkCompleteResponse() {
                cont.resume(returning: result)
                return
            }
            continuations.append(cont)
            waiters.append { [weak self] in
                guard let self = self else { return false }
                if let result = self.checkCompleteResponse() {
                    cont.resume(returning: result)
                    return true
                }
                return false
            }
        }
    }

    private func checkCompleteResponse() -> String? {
        guard buffer.contains("\r\n") else { return nil }
        let lines = buffer.components(separatedBy: "\r\n")
        var result: [String] = []
        var consumed = 0
        for line in lines {
            consumed += 1
            if line.isEmpty {
                if result.isEmpty { continue }
                break
            }
            result.append(line)
            // Final line: 3-digit code + space
            if line.count >= 4 {
                let sep = line[line.index(line.startIndex, offsetBy: 3)]
                if sep == " " && line.prefix(3).allSatisfy({ $0.isNumber }) {
                    buffer = lines.dropFirst(consumed).joined(separator: "\r\n")
                    return result.joined(separator: "\r\n")
                }
            }
        }
        return nil
    }

    /// Add TLS to an already-connected plain channel (STARTTLS).
    func upgradeToTLS(serverHostname: String) async throws {
        guard let ch = channel else { throw SMTPError.notConnected }
        let tlsConfig = TLSConfiguration.makeClientConfiguration()
        let sslContext = try NIOSSLContext(configuration: tlsConfig)
        let sslHandler = try NIOSSLClientHandler(context: sslContext, serverHostname: serverHostname)
        try await ch.pipeline.addHandler(sslHandler, position: .first).get()
    }

    // Called from SMTPChannelHandler
    func didReceiveData(_ data: String) {
        bufferLock.lock()
        buffer += data
        var remaining: [() -> Bool] = []
        var remainingConts: [CheckedContinuation<String, Error>] = []
        for (i, waiter) in waiters.enumerated() {
            if !waiter() {
                remaining.append(waiter)
                if i < continuations.count { remainingConts.append(continuations[i]) }
            }
        }
        waiters = remaining
        continuations = remainingConts
        bufferLock.unlock()
    }

    func didReceiveError(_ error: Error) {
        bufferLock.lock()
        let conts = continuations
        continuations = []
        waiters = []
        bufferLock.unlock()
        for cont in conts { cont.resume(throwing: error) }
    }

    func close() {
        try? channel?.close().wait()
        try? group.syncShutdownGracefully()
    }
}

// MARK: - NIO Decoder (passthrough)

private final class SMTPPassthroughDecoder: ByteToMessageDecoder {
    typealias InboundOut = ByteBuffer

    func decode(context: ChannelHandlerContext, buffer: inout ByteBuffer) throws -> DecodingState {
        if buffer.readableBytes > 0 {
            let slice = buffer.readSlice(length: buffer.readableBytes)!
            context.fireChannelRead(wrapInboundOut(slice))
            return .continue
        }
        return .needMoreData
    }

    func decodeLast(context: ChannelHandlerContext, buffer: inout ByteBuffer, seenEOF: Bool) throws -> DecodingState {
        return try decode(context: context, buffer: &buffer)
    }
}

// MARK: - NIO Inbound Handler

private final class SMTPChannelHandler: ChannelInboundHandler {
    typealias InboundIn = ByteBuffer
    private weak var connection: SMTPConnection?

    init(connection: SMTPConnection) { self.connection = connection }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        var buf = unwrapInboundIn(data)
        if let str = buf.readString(length: buf.readableBytes) {
            connection?.didReceiveData(str)
        }
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        connection?.didReceiveError(error)
        context.close(promise: nil)
    }

    func channelInactive(context: ChannelHandlerContext) {
        connection?.didReceiveError(SMTPError.connectionFailed("Connection closed"))
    }
}

// MARK: - SMTP Client

/// High-level SMTP client.
/// - Port 465 → direct TLS
/// - Port 587 (or any other) → plain connect then STARTTLS
public actor SMTPClient {

    private let host: String
    private let port: Int
    private var connection: SMTPConnection?

    private var useTLS: Bool { port == 465 }

    public init(host: String, port: Int) {
        self.host = host
        self.port = port
    }

    // MARK: Connect

    public func connect() async throws {
        let conn = SMTPConnection(host: host, port: port, useTLS: useTLS)
        try await conn.connect()
        self.connection = conn
        let greeting = try await conn.readResponse()
        guard greeting.hasPrefix("220") else {
            throw SMTPError.connectionFailed(greeting)
        }
    }

    // MARK: Authenticate

    public func authenticate(username: String, password: String) async throws {
        let conn = try requireConnection()

        try await conn.send("EHLO swiftmail.local\r\n")
        let ehloResp = try await conn.readResponse()
        guard ehloResp.contains("250") else {
            throw SMTPError.connectionFailed("EHLO rejected: \(ehloResp)")
        }

        // STARTTLS if not direct TLS and server supports it
        if !useTLS && ehloResp.contains("STARTTLS") {
            try await conn.send("STARTTLS\r\n")
            let tlsResp = try await conn.readResponse()
            guard tlsResp.hasPrefix("220") else {
                throw SMTPError.connectionFailed("STARTTLS failed: \(tlsResp)")
            }
            try await conn.upgradeToTLS(serverHostname: host)
            // Re-EHLO after TLS upgrade
            try await conn.send("EHLO swiftmail.local\r\n")
            _ = try await conn.readResponse()
        }

        // AUTH LOGIN
        try await conn.send("AUTH LOGIN\r\n")
        let authPrompt = try await conn.readResponse()
        guard authPrompt.hasPrefix("334") else {
            throw SMTPError.authenticationFailed("AUTH LOGIN rejected: \(authPrompt)")
        }

        try await conn.send(Data(username.utf8).base64EncodedString() + "\r\n")
        let passPrompt = try await conn.readResponse()
        guard passPrompt.hasPrefix("334") else {
            throw SMTPError.authenticationFailed("Username rejected: \(passPrompt)")
        }

        try await conn.send(Data(password.utf8).base64EncodedString() + "\r\n")
        let authResult = try await conn.readResponse()
        guard authResult.hasPrefix("235") else {
            throw SMTPError.authenticationFailed(authResult)
        }
    }

    // MARK: Send Mail

    public func sendMail(
        from: String,
        fromDisplay: String,
        to: [String],
        subject: String,
        body: String
    ) async throws {
        let conn = try requireConnection()

        // MAIL FROM
        try await conn.send("MAIL FROM:<\(from)>\r\n")
        let fromResp = try await conn.readResponse()
        guard fromResp.hasPrefix("250") else {
            throw SMTPError.sendFailed("MAIL FROM rejected: \(fromResp)")
        }

        // RCPT TO
        for recipient in to {
            let addr = extractEmail(recipient.trimmingCharacters(in: .whitespaces))
            try await conn.send("RCPT TO:<\(addr)>\r\n")
            let rcptResp = try await conn.readResponse()
            guard rcptResp.hasPrefix("25") else {
                throw SMTPError.sendFailed("RCPT TO <\(addr)> rejected: \(rcptResp)")
            }
        }

        // DATA
        try await conn.send("DATA\r\n")
        let dataResp = try await conn.readResponse()
        guard dataResp.hasPrefix("354") else {
            throw SMTPError.sendFailed("DATA rejected: \(dataResp)")
        }

        // Build the RFC 2822 message
        let toHeader = to.joined(separator: ", ")
        let fromHeader = fromDisplay.isEmpty ? from : "\(fromDisplay) <\(from)>"
        var message =  "From: \(fromHeader)\r\n"
        message     += "To: \(toHeader)\r\n"
        message     += "Subject: \(subject)\r\n"
        message     += "Date: \(rfc2822Date())\r\n"
        message     += "MIME-Version: 1.0\r\n"
        message     += "Content-Type: text/plain; charset=UTF-8\r\n"
        message     += "Content-Transfer-Encoding: 8bit\r\n"
        message     += "\r\n"
        // Dot-stuff body (SMTP transparency requirement)
        for line in body.components(separatedBy: "\n") {
            message += (line.hasPrefix(".") ? "." + line : line) + "\r\n"
        }
        message += ".\r\n"

        try await conn.send(message)
        let sendResp = try await conn.readResponse()
        guard sendResp.hasPrefix("250") else {
            throw SMTPError.sendFailed(sendResp)
        }
    }

    // MARK: Quit

    public func quit() async throws {
        guard let conn = connection else { return }
        try? await conn.send("QUIT\r\n")
        _ = try? await conn.readResponse()
        conn.close()
        connection = nil
    }

    // MARK: Private

    private func requireConnection() throws -> SMTPConnection {
        guard let conn = connection else { throw SMTPError.notConnected }
        return conn
    }

    private func extractEmail(_ address: String) -> String {
        if let start = address.lastIndex(of: "<"),
           let end = address.lastIndex(of: ">"),
           start < end {
            return String(address[address.index(after: start)..<end])
        }
        return address
    }

    private func rfc2822Date() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        return f.string(from: Date())
    }
}
