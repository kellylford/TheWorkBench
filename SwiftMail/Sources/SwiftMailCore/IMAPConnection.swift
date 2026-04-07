import Foundation
import NIOCore
import NIOPosix
import NIOSSL

// MARK: - IMAP TCP Connection

/// Manages a persistent TLS socket connection to an IMAP server.
/// Uses NIO with async/await bridges for structured concurrency.
final class IMAPConnection: @unchecked Sendable {

    private let host: String
    private let port: Int
    private let useTLS: Bool

    private var channel: Channel?
    private let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)

    // Accumulated incoming data
    private var buffer = ""
    private let bufferLock = NSLock()
    private var dataWaiters: [(String) -> Bool] = []  // predicate + continuation
    private var continuations: [CheckedContinuation<String, Error>] = []

    private var tagCounter = 0

    init(host: String, port: Int, useTLS: Bool) {
        self.host = host
        self.port = port
        self.useTLS = useTLS
    }

    func nextTag() -> String {
        tagCounter += 1
        return "A\(String(format: "%04d", tagCounter))"
    }

    // MARK: Connect

    func connect() async throws {
        let bootstrap = ClientBootstrap(group: group)
            .channelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .channelOption(ChannelOptions.connectTimeout, value: .seconds(15))
            .channelInitializer { [weak self] channel in
                guard let self = self else {
                    return channel.eventLoop.makeFailedFuture(IMAPError.connectionFailed("Deallocated"))
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
                handlers.append(ByteToMessageHandler(LineDelimiterDecoder()))
                handlers.append(IMAPInboundHandler(connection: self))
                return channel.pipeline.addHandlers(handlers)
            }

        let ch = try await bootstrap.connect(host: host, port: port).get()
        self.channel = ch
    }

    // MARK: Send

    func send(_ text: String) async throws {
        guard let channel = channel else { throw IMAPError.notConnected }
        var buf = channel.allocator.buffer(capacity: text.utf8.count)
        buf.writeString(text)
        try await channel.writeAndFlush(buf).get()
    }

    // MARK: Read Until Tagged Response

    /// Reads accumulated data until a line starting with `tag OK/NO/BAD` is found.
    /// If tag is nil, reads until any complete line arrives (for greeting).
    func readUntilTaggedResponse(tag: String?) async throws -> String {
        return try await withCheckedThrowingContinuation { cont in
            bufferLock.lock()
            defer { bufferLock.unlock() }
            // Check if already satisfied
            if let result = checkBuffer(tag: tag) {
                cont.resume(returning: result)
                return
            }
            continuations.append(cont)
            dataWaiters.append { [weak self] _ in
                guard let self = self else { return false }
                if let result = self.checkBuffer(tag: tag) {
                    cont.resume(returning: result)
                    return true
                }
                return false
            }
        }
    }

    private func checkBuffer(tag: String?) -> String? {
        if let tag = tag {
            // Look for tagged response line
            let lines = buffer.components(separatedBy: "\r\n")
            for line in lines {
                if line.hasPrefix(tag + " OK") ||
                   line.hasPrefix(tag + " NO") ||
                   line.hasPrefix(tag + " BAD") {
                    let result = buffer
                    buffer = ""
                    return result
                }
            }
            return nil
        } else {
            // Greeting: any non-empty complete line
            if buffer.contains("\r\n") {
                let result = buffer
                buffer = ""
                return result
            }
            return nil
        }
    }

    // Called from IMAPInboundHandler
    func didReceiveData(_ data: String) {
        bufferLock.lock()
        buffer += data
        var satisfied: [CheckedContinuation<String, Error>] = []
        var remaining: [(String) -> Bool] = []
        var remainingConts: [CheckedContinuation<String, Error>] = []
        for (i, waiter) in dataWaiters.enumerated() {
            if i < continuations.count {
                if waiter(data) {
                    // continuation was resumed inside waiter
                } else {
                    remaining.append(waiter)
                    remainingConts.append(continuations[i])
                }
            }
        }
        dataWaiters = remaining
        continuations = remainingConts
        bufferLock.unlock()
    }

    func didReceiveError(_ error: Error) {
        bufferLock.lock()
        let conts = continuations
        continuations = []
        dataWaiters = []
        bufferLock.unlock()
        for cont in conts {
            cont.resume(throwing: error)
        }
    }

    func close() {
        try? channel?.close().wait()
        try? group.syncShutdownGracefully()
    }
}

// MARK: - NIO Line Decoder

private final class LineDelimiterDecoder: ByteToMessageDecoder {
    typealias InboundOut = ByteBuffer

    func decode(context: ChannelHandlerContext, buffer: inout ByteBuffer) throws -> DecodingState {
        // Forward all available bytes immediately (IMAP isn't line-simple enough
        // to require line-by-line splitting at the NIO level — let the actor handle it)
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

private final class IMAPInboundHandler: ChannelInboundHandler {
    typealias InboundIn = ByteBuffer

    private weak var connection: IMAPConnection?

    init(connection: IMAPConnection) {
        self.connection = connection
    }

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
        connection?.didReceiveError(IMAPError.connectionFailed("Connection closed"))
    }
}
