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
            // ── Refresh ──────────────────────────────────────────────────
            CommandGroup(after: .appInfo) {
                Button("Refresh VM List") { store.refresh() }
                    .keyboardShortcut("r", modifiers: .command)
            }

            // ── VM Actions menu ──────────────────────────────────────────
            CommandMenu("VM Actions") {
                let vm = store.selectedVM

                Button("Start") { store.startSelected() }
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(vm == nil || !(vm!.status.canStart))

                Button("Stop") { store.stopSelected() }
                    .keyboardShortcut(".", modifiers: .command)
                    .disabled(vm == nil || !(vm!.status.canStop))

                Button("Pause") { store.pauseSelected() }
                    .keyboardShortcut("p", modifiers: [.command, .option])
                    .disabled(vm == nil || !(vm!.status.canPause))

                Button("Resume") { store.resumeSelected() }
                    .keyboardShortcut("p", modifiers: [.command, .shift])
                    .disabled(vm == nil || !(vm!.status.canResume))

                Divider()

                Button("Clone…") {
                    if let v = store.selectedVM { store.beginClone(v) }
                }
                .keyboardShortcut("d", modifiers: [.command, .shift])
                .disabled(vm == nil || store.busyIDs.contains(vm!.id))

                Button("Delete…") {
                    if let v = store.selectedVM { store.beginDelete(v) }
                }
                .keyboardShortcut(.delete, modifiers: [.command, .shift])
                .disabled(vm == nil || store.busyIDs.contains(vm!.id))
            }
        }
    }
}
