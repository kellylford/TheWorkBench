import SwiftUI

@main
struct ParallelsManagerApp: App {
    @StateObject private var store = VMStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Refresh VMs") {
                    store.refresh()
                }
                .keyboardShortcut("r", modifiers: .command)
            }
        }
    }
}
