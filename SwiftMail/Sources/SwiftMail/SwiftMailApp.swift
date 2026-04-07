import SwiftUI
import AppKit
import SwiftMailCore

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            sender.windows.first?.makeKeyAndOrderFront(nil)
        }
        return true
    }
}

@main
struct SwiftMailApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var store = MailStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.titleBar)
        .commands {
            SwiftMailCommands()
        }
    }
}

// MARK: - Menu Commands

struct SwiftMailCommands: Commands {
    @FocusedObject var store: MailStore?

    var body: some Commands {

        // MARK: File menu
        CommandGroup(replacing: .newItem) {
            Button("New Message") {
                NotificationCenter.default.post(name: .showCompose, object: nil)
            }
            .keyboardShortcut("n", modifiers: .command)

            Divider()

            Button("Add Account…") {
                NotificationCenter.default.post(name: .showAddAccount, object: nil)
            }
            .keyboardShortcut("a", modifiers: [.command, .shift])
        }

        // MARK: Mailbox menu
        CommandMenu("Mailbox") {
            Button("Get All New Mail") {
                NotificationCenter.default.post(name: .getNewMail, object: nil)
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])

            Divider()

            Button("Mark All as Read") {
                NotificationCenter.default.post(name: .markAllRead, object: nil)
            }
            .disabled(store?.messages.isEmpty ?? true)
        }

        // MARK: Message menu
        CommandMenu("Message") {
            Button("Reply") {
                NotificationCenter.default.post(name: .replyMessage, object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)
            .disabled(store?.selectedMessage == nil)

            Button("Reply All") {
                NotificationCenter.default.post(name: .replyAllMessage, object: nil)
            }
            .keyboardShortcut("r", modifiers: [.command, .shift])
            .disabled(store?.selectedMessage == nil)

            Button("Forward") {
                NotificationCenter.default.post(name: .forwardMessage, object: nil)
            }
            .keyboardShortcut("f", modifiers: [.command, .shift])
            .disabled(store?.selectedMessage == nil)

            Divider()

            Button("Move to Trash") {
                NotificationCenter.default.post(name: .deleteMessage, object: nil)
            }
            .keyboardShortcut(.delete, modifiers: .command)
            .disabled(store?.selectedMessage == nil)

            Divider()

            Button("Mark as Read") {
                NotificationCenter.default.post(name: .markRead, object: nil)
            }
            .disabled(store?.selectedMessage == nil || store?.selectedMessage?.isRead == true)

            Button("Mark as Unread") {
                NotificationCenter.default.post(name: .markUnread, object: nil)
            }
            .disabled(store?.selectedMessage == nil || store?.selectedMessage?.isRead == false)
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let showAddAccount  = Notification.Name("showAddAccount")
    static let showCompose     = Notification.Name("showCompose")
    static let getNewMail      = Notification.Name("getNewMail")
    static let markAllRead     = Notification.Name("markAllRead")
    static let replyMessage    = Notification.Name("replyMessage")
    static let replyAllMessage = Notification.Name("replyAllMessage")
    static let forwardMessage  = Notification.Name("forwardMessage")
    static let deleteMessage   = Notification.Name("deleteMessage")
    static let markRead        = Notification.Name("markRead")
    static let markUnread      = Notification.Name("markUnread")
}
