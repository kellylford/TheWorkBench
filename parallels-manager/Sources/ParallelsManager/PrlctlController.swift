import Foundation

enum PrlctlError: LocalizedError {
    case notFound
    case executionFailed(String)

    var errorDescription: String? {
        switch self {
        case .notFound:               return "prlctl not found. Is Parallels Desktop installed?"
        case .executionFailed(let m): return m
        }
    }
}

struct PrlctlController {

    private static let prlctlPath = "/usr/local/bin/prlctl"

    // MARK: - List VMs

    static func listVMs() async -> Result<[VM], Error> {
        await withCheckedContinuation { cont in
            DispatchQueue.global().async {
                let result = shell([prlctlPath, "list", "--all", "-o", "uuid,status,name"])
                switch result {
                case .failure(let e): cont.resume(returning: .failure(e))
                case .success(let output):
                    let vms = parseList(output)
                    cont.resume(returning: .success(vms))
                }
            }
        }
    }

    // MARK: - Run Action

    static func run(action: VMAction, vmID: String) async -> Result<Void, Error> {
        await withCheckedContinuation { cont in
            DispatchQueue.global().async {
                // prlctl expects: prlctl <verb> <ID> [extra-flags...]
                // e.g. "prlctl stop {uuid} --kill" NOT "prlctl stop --kill {uuid}"
                let verb = action.prlctlArgs[0]
                let extraArgs = Array(action.prlctlArgs.dropFirst())
                var args = [prlctlPath, verb, vmID] + extraArgs
                // Clone is: prlctl clone <source-ID> --name <newName>
                if case .clone = action {
                    args = [prlctlPath, "clone", vmID] + action.prlctlArgs.dropFirst()
                }
                // Run via /bin/sh so the subprocess gets a full login-like environment
                // and can connect to the Parallels dispatcher service.
                let cmd = args
                    .map { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }
                    .joined(separator: " ")
                let result = shellCmd(cmd)
                cont.resume(returning: result.map { _ in () })
            }
        }
    }

    // MARK: - Helpers

    /// Run via /bin/sh so prlctl gets a proper environment to reach the Parallels dispatcher.
    private static func shellCmd(_ cmd: String) -> Result<String, Error> {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/sh")
        proc.arguments = ["-c", cmd]
        proc.environment = ProcessInfo.processInfo.environment
        let pipe = Pipe()
        let errPipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError  = errPipe
        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            return .failure(error)
        }
        let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(),    encoding: .utf8) ?? ""
        let err = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        if proc.terminationStatus != 0 {
            return .failure(PrlctlError.executionFailed(err.isEmpty ? out : err))
        }
        // prlctl sometimes exits 0 but prints an error on stderr — surface it
        let errTrimmed = err.trimmingCharacters(in: .whitespacesAndNewlines)
        if !errTrimmed.isEmpty {
            return .failure(PrlctlError.executionFailed(errTrimmed))
        }
        return .success(out)
    }

    private static func shell(_ args: [String]) -> Result<String, Error> {
        guard FileManager.default.fileExists(atPath: prlctlPath) else {
            return .failure(PrlctlError.notFound)
        }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: args[0])
        proc.arguments = Array(args.dropFirst())
        let pipe = Pipe()
        let errPipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError  = errPipe
        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            return .failure(error)
        }
        let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        if proc.terminationStatus != 0 {
            let err = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            return .failure(PrlctlError.executionFailed(err.isEmpty ? out : err))
        }
        return .success(out)
    }

    // MARK: - Parser
    // prlctl list --all -o uuid,status,name produces lines like:
    // {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx} running   My VM Name

    private static func parseList(_ raw: String) -> [VM] {
        var vms: [VM] = []
        for line in raw.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("{") else { continue }
            // UUID ends at first }
            guard let closeBrace = trimmed.firstIndex(of: "}") else { continue }
            let uuid = String(trimmed[trimmed.startIndex...closeBrace])
            let rest = trimmed[trimmed.index(after: closeBrace)...]
                .trimmingCharacters(in: .whitespaces)
            // Next token is status, rest is name
            let parts = rest.components(separatedBy: .whitespaces)
            guard parts.count >= 2 else { continue }
            let statusStr = parts[0].lowercased()
            let name = parts.dropFirst().joined(separator: " ")
            let status: VMStatus
            switch statusStr {
            case "running":   status = .running
            case "stopped":   status = .stopped
            case "paused":    status = .paused
            case "suspended": status = .suspended
            default:          status = .unknown
            }
            vms.append(VM(id: uuid, name: name.isEmpty ? uuid : name, status: status))
        }
        return vms
    }
}
