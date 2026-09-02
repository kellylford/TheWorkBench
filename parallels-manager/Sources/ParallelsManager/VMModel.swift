import Foundation
import AppKit

// MARK: - VM Status

enum VMStatus: String, Equatable {
    case running
    case stopped
    case paused
    case suspended
    case unknown

    var displayName: String {
        switch self {
        case .running:   return "Running"
        case .stopped:   return "Stopped"
        case .paused:    return "Paused"
        case .suspended: return "Suspended"
        case .unknown:   return "Unknown"
        }
    }

    var canStart:   Bool { self == .stopped  || self == .suspended }
    var canStop:    Bool { self == .running  || self == .paused }
    var canPause:   Bool { self == .running }
    var canResume:  Bool { self == .paused   || self == .suspended }
    var canSuspend: Bool { self == .running }
    var canReset:   Bool { self == .running  || self == .paused }
}

// MARK: - VM Model

struct VM: Identifiable, Equatable {
    let id: String      // Parallels UUID e.g. {xxxxxxxx-xxxx-…}
    let name: String
    let status: VMStatus
}

// MARK: - VM Action

enum VMAction {
    case start, stop, pause, resume, suspend, reset, delete, clone(newName: String)

    var displayName: String {
        switch self {
        case .start:   return "Start"
        case .stop:    return "Stop"
        case .pause:   return "Pause"
        case .resume:  return "Resume"
        case .suspend: return "Suspend"
        case .reset:   return "Reset"
        case .delete:  return "Delete"
        case .clone:   return "Clone"
        }
    }

    var prlctlArgs: [String] {
        switch self {
        case .start:               return ["start"]
        case .stop:                return ["stop", "--kill"]
        case .pause:               return ["pause"]
        case .resume:              return ["resume"]
        case .suspend:             return ["suspend"]
        case .reset:               return ["reset"]
        case .delete:              return ["delete"]
        case .clone(let newName):  return ["clone", "--name", newName]
        }
    }
}

// MARK: - VMStore

@MainActor
final class VMStore: ObservableObject {
    @Published var vms: [VM] = []
    @Published var isRefreshing = false
    @Published var lastError: String? = nil
    @Published var busyIDs: Set<String> = []
    @Published var selectedID: String? = nil
    @Published var cloneTargetVM: VM? = nil
    @Published var cloneName: String = ""
    @Published var showDeleteConfirm = false
    @Published var deleteTarget: VM? = nil
    @Published var showNewVMSheet = false

    var selectedVM: VM? { vms.first { $0.id == selectedID } }

    init() {
        refresh()
    }

    func refresh() {
        Task { await fetchVMs() }
    }

    private func fetchVMs() async {
        isRefreshing = true
        lastError = nil
        defer { isRefreshing = false }
        switch await PrlctlController.listVMs() {
        case .success(let list): vms = list
        case .failure(let err):  lastError = err.localizedDescription
        }
    }

    func perform(_ action: VMAction, on vm: VM) {
        busyIDs.insert(vm.id)
        Task {
            if case .failure(let err) = await PrlctlController.run(action: action, vmID: vm.id) {
                lastError = "\(action.displayName) failed: \(err.localizedDescription)"
            }
            busyIDs.remove(vm.id)
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await fetchVMs()
        }
    }

    // MARK: - Convenience helpers for menu / context actions

    func startSelected()   { if let v = selectedVM, v.status.canStart   { perform(.start,   on: v) } }
    func stopSelected()    { if let v = selectedVM, v.status.canStop    { perform(.stop,    on: v) } }
    func pauseSelected()   { if let v = selectedVM, v.status.canPause   { perform(.pause,   on: v) } }
    func resumeSelected()  { if let v = selectedVM, v.status.canResume  { perform(.resume,  on: v) } }
    func suspendSelected() { if let v = selectedVM, v.status.canSuspend { perform(.suspend, on: v) } }
    func resetSelected()   { if let v = selectedVM, v.status.canReset   { perform(.reset,   on: v) } }

    func copyIdentifier() {
        guard let vm = selectedVM else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(vm.id, forType: .string)
    }

    func beginClone(_ vm: VM) {
        cloneTargetVM = vm
        cloneName = "\(vm.name) (Clone)"
    }
    func commitClone() {
        guard let vm = cloneTargetVM, !cloneName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        perform(.clone(newName: cloneName), on: vm)
        cloneTargetVM = nil
    }
    func beginDelete(_ vm: VM) {
        deleteTarget = vm
        showDeleteConfirm = true
    }
    func commitDelete() {
        if let vm = deleteTarget { perform(.delete, on: vm) }
        deleteTarget = nil
    }
}
