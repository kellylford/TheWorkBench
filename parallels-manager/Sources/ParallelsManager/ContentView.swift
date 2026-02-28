import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: VMStore

    var body: some View {
        VStack(spacing: 0) {
            // ── Toolbar ───────────────────────────────────────────────────
            HStack(spacing: 8) {
                Text("Parallels Manager")
                    .font(.headline)
                Spacer()
                if store.isRefreshing {
                    ProgressView()
                        .scaleEffect(0.65)
                        .accessibilityLabel("Refreshing")
                }
                Button {
                    store.refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
                .help("Refresh VM list (⌘R)")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(nsColor: .windowBackgroundColor))

            Divider()

            // ── VM List ───────────────────────────────────────────────────
            if store.vms.isEmpty && !store.isRefreshing {
                Spacer()
                Text("No virtual machines found")
                    .foregroundColor(.secondary)
                Spacer()
            } else {
                List(store.vms, selection: $store.selectedID) { vm in
                    VMRow(vm: vm, isBusy: store.busyIDs.contains(vm.id))
                        .tag(vm.id)
                        // Context menu — right-click or VoiceOver VO+Shift+M
                        .contextMenu { vmContextMenu(for: vm) }
                        // Accessibility actions — VoiceOver VO+Z to cycle through them
                        .accessibilityAction(named: "Start")  { if vm.status.canStart  { store.perform(.start,  on: vm) } }
                        .accessibilityAction(named: "Stop")   { if vm.status.canStop   { store.perform(.stop,   on: vm) } }
                        .accessibilityAction(named: "Pause")  { if vm.status.canPause  { store.perform(.pause,  on: vm) } }
                        .accessibilityAction(named: "Resume") { if vm.status.canResume { store.perform(.resume, on: vm) } }
                        .accessibilityAction(named: "Clone")  { store.beginClone(vm) }
                        .accessibilityAction(named: "Delete") { store.beginDelete(vm) }
                }
                .accessibilityLabel("Virtual machines")
                .listStyle(.inset(alternatesRowBackgrounds: true))
            }

            // ── Error bar ─────────────────────────────────────────────────
            if let err = store.lastError {
                Divider()
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.red)
                    Text(err).font(.caption).foregroundColor(.red).lineLimit(2)
                    Spacer()
                    Button("Dismiss") { store.lastError = nil }.font(.caption)
                }
                .padding(.horizontal, 12).padding(.vertical, 6)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Error: \(err)")
            }
        }
        .frame(minWidth: 580, minHeight: 300)

        // Clone sheet
        .sheet(item: $store.cloneTargetVM) { vm in
            CloneSheet(vm: vm, cloneName: $store.cloneName,
                       onClone:  { store.commitClone() },
                       onCancel: { store.cloneTargetVM = nil })
        }

        // Delete confirmation
        .confirmationDialog(
            "Delete \"\(store.deleteTarget?.name ?? "")\"?",
            isPresented: $store.showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { store.commitDelete() }
            Button("Cancel", role: .cancel)      { store.deleteTarget = nil }
        } message: {
            Text("This permanently removes the VM and all its files. This cannot be undone.")
        }
    }

    // MARK: - Context menu

    @ViewBuilder
    private func vmContextMenu(for vm: VM) -> some View {
        if vm.status.canStart  { Button("Start")                         { store.perform(.start,  on: vm) } }
        if vm.status.canResume { Button("Resume")                        { store.perform(.resume, on: vm) } }
        if vm.status.canPause  { Button("Pause")                         { store.perform(.pause,  on: vm) } }
        if vm.status.canStop   { Button("Stop")                          { store.perform(.stop,   on: vm) } }
        Divider()
        Button("Clone…")                                                  { store.beginClone(vm) }
        Button("Delete…", role: .destructive)                            { store.beginDelete(vm) }
    }
}
