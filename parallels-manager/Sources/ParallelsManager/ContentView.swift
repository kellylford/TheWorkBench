import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: VMStore
    @State private var selectedID: String? = nil
    @State private var cloneTargetVM: VM? = nil
    @State private var cloneName = ""
    @State private var showDeleteConfirm = false
    @State private var deleteTarget: VM? = nil

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack {
                Text("Parallels Manager")
                    .font(.headline)
                Spacer()
                if store.isRefreshing {
                    ProgressView()
                        .scaleEffect(0.6)
                        .accessibilityLabel("Refreshing VM list")
                }
                Button {
                    store.refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
                .accessibilityLabel("Refresh VM list")
                .help("Refresh VM list (⌘R)")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(nsColor: .windowBackgroundColor))

            Divider()

            if store.vms.isEmpty && !store.isRefreshing {
                Spacer()
                Text("No VMs found")
                    .foregroundColor(.secondary)
                    .accessibilityLabel("No virtual machines found")
                Spacer()
            } else {
                List(store.vms, selection: $selectedID) { vm in
                    VMRow(vm: vm,
                          isBusy: store.busyIDs.contains(vm.id),
                          onStart:  { store.perform(.start,  on: vm) },
                          onStop:   { store.perform(.stop,   on: vm) },
                          onPause:  { store.perform(.pause,  on: vm) },
                          onResume: { store.perform(.resume, on: vm) },
                          onClone: {
                              cloneTargetVM = vm
                              cloneName = "\(vm.name) (Clone)"
                          },
                          onDelete: {
                              deleteTarget = vm
                              showDeleteConfirm = true
                          })
                    .tag(vm.id)
                }
                .accessibilityLabel("Virtual machine list")
            }

            // Error bar
            if let err = store.lastError {
                Divider()
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.red)
                    Text(err)
                        .font(.caption)
                        .foregroundColor(.red)
                        .lineLimit(2)
                    Spacer()
                    Button("Dismiss") { store.lastError = nil }
                        .font(.caption)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Error: \(err)")
            }
        }
        .frame(minWidth: 560, minHeight: 340)
        // Clone sheet
        .sheet(item: $cloneTargetVM) { vm in
            CloneSheet(vm: vm, cloneName: $cloneName) {
                store.perform(.clone(newName: cloneName), on: vm)
                cloneTargetVM = nil
            } onCancel: {
                cloneTargetVM = nil
            }
        }
        // Delete confirmation
        .confirmationDialog(
            "Delete \"\(deleteTarget?.name ?? "")\"?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let vm = deleteTarget { store.perform(.delete, on: vm) }
                deleteTarget = nil
            }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("This permanently removes the VM and all its files. This cannot be undone.")
        }
    }
}
