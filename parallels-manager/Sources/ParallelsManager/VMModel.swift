import Foundation

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

    var canStart:  Bool { self == .stopped  || self == .suspended }
    var canStop:   Bool { self == .running  || self == .paused }
    var canPause:  Bool { self == .running }
    var canResume: Bool { self == .paused   || self == .suspended }
}

// MARK: - VM Model

struct VM: Identifiable, Equatable {
    let id: String      // Parallels UUID e.g. {xxxxxxxx-xxxx-…}
    let name: String
    let status: VMStatus
}

// MARK: - VM Action

enum VMAction {
    case start, stop, pause, resume, delete, clone(newName: String)

    var displayName: String {
        switch self {
        case .start:  return "Start"
        case .stop:   return "Stop"
        case .pause:  return "Pause"
        case .resume: return "Resume"
        case .delete: return "Delete"
        case .clone:  return "Clone"
        }
    }

    var prlctlArgs: [String] {
        switch self {
        case .start:               return ["start"]
        case .stop:                return ["stop", "--kill"]
        case .pause:               return ["pause"]
        case .resume:              return ["resume"]
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

    var selectedVM: VM? { vms.first { $0.id == selectedID } }

    private var timer: Timer?

    init() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.refresh() }
        }
    }

    deinit { timer?.invalidate() }

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

    func startSelected()  { if let v = selectedVM, v.status.canStart  { perform(.start,  on: v) } }
    func stopSelected()   { if let v = selectedVM, v.status.canStop   { perform(.stop,   on: v) } }
    func pauseSelected()  { if let v = selectedVM, v.status.canPause  { perform(.pause,  on: v) } }
    func resumeSelected() { if let v = selectedVM, v.status.canResume { perform(.resume, on: v) } }

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
