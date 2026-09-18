import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: VMStore

    var body: some View {
        mainContent
            // New Windows VM sheet
            .sheet(isPresented: $store.showNewVMSheet) {
                NewWindowsVMSheet()
                    .environmentObject(store)
            }
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

    private var mainContent: some View {
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

                Button {
                    store.showNewVMSheet = true
                } label: {
                    Label("New Windows VM", systemImage: "plus")
                }
                .help("Create a new Windows 11 ARM VM")
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
                List(selection: $store.selectedID) {
                    ForEach(store.vms) { vm in
                        VMRow(vm: vm,
                              isBusy: store.busyIDs.contains(vm.id),
                              isSelected: store.selectedID == vm.id)
                            .tag(vm.id)
                            .listRowInsets(EdgeInsets(top: 2, leading: 8, bottom: 2, trailing: 8))
                            .contextMenu { vmContextMenu(for: vm) }
                            .modifier(VMAccessibilityActions(vm: vm, store: store))
                    }
                }
                .listStyle(.plain)
                .accessibilityLabel("Virtual machines")
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
    }

    // MARK: - Context menu
}

// MARK: - Accessibility actions modifier

/// Attaches only the VO custom actions that make sense for the VM's current state.
/// VoiceOver exposes these via VO+Cmd+Space (CapsLock or Ctrl+Opt), giving a clean, filtered action menu.
private struct VMAccessibilityActions: ViewModifier {
    let vm: VM
    let store: VMStore

    func body(content: Content) -> some View {
        // Each .accessibilityAction call wraps the view in a new generic type,
        // so we type-erase with AnyView to accumulate conditional actions cleanly.
        var view: AnyView = AnyView(content)
        if vm.status.canStart   { view = AnyView(view.accessibilityAction(named: Text("Start"))   { store.perform(.start,   on: vm) }) }
        if vm.status.canResume  { view = AnyView(view.accessibilityAction(named: Text("Resume"))  { store.perform(.resume,  on: vm) }) }
        if vm.status.canPause   { view = AnyView(view.accessibilityAction(named: Text("Pause"))   { store.perform(.pause,   on: vm) }) }
        if vm.status.canSuspend { view = AnyView(view.accessibilityAction(named: Text("Suspend")) { store.perform(.suspend, on: vm) }) }
        if vm.status.canStop    { view = AnyView(view.accessibilityAction(named: Text("Stop"))    { store.perform(.stop,    on: vm) }) }
        if vm.status.canReset   { view = AnyView(view.accessibilityAction(named: Text("Reset"))   { store.perform(.reset,   on: vm) }) }
        view = AnyView(view.accessibilityAction(named: Text("Clone…"))  { store.beginClone(vm) })
        view = AnyView(view.accessibilityAction(named: Text("Delete…")) { store.beginDelete(vm) })
        return view
    }
}

private extension ContentView {
    @ViewBuilder
    func vmContextMenu(for vm: VM) -> some View {
        if vm.status.canStart   { Button("Start")   { store.perform(.start,   on: vm) } }
        if vm.status.canResume  { Button("Resume")  { store.perform(.resume,  on: vm) } }
        if vm.status.canPause   { Button("Pause")   { store.perform(.pause,   on: vm) } }
        if vm.status.canSuspend { Button("Suspend") { store.perform(.suspend, on: vm) } }
        if vm.status.canStop    { Button("Stop")    { store.perform(.stop,    on: vm) } }
        if vm.status.canReset   { Button("Reset")   { store.perform(.reset,   on: vm) } }
        Divider()
        Button("Clone…")                            { store.beginClone(vm) }
        Button("Delete…", role: .destructive)       { store.beginDelete(vm) }
    }
}
