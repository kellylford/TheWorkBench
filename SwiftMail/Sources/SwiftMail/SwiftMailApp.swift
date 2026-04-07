import SwiftUI
import SwiftMailCore

@main
struct SwiftMailApp: App {
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
    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Message") {
                NotificationCenter.default.post(name: .showCompose, object: nil)
            }
            .keyboardShortcut("n", modifiers: .command)

            Button("Add Account…") {
                NotificationCenter.default.post(name: .showAddAccount, object: nil)
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
        }
    }
}

extension Notification.Name {
    static let showAddAccount = Notification.Name("showAddAccount")
    static let showCompose    = Notification.Name("showCompose")
}
