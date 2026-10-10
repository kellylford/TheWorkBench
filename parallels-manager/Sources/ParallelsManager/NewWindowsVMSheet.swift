import SwiftUI
import AppKit

struct NewWindowsVMSheet: View {
    @EnvironmentObject private var store: VMStore
    @Environment(\.dismiss) private var dismiss

    @State private var vmName = "Windows 11 ARM"
    @State private var errorMessage: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("New Windows 11 ARM VM")
                .font(.headline)

            Form {
                TextField("VM Name", text: $vmName)
                    .frame(width: 300)
            }

            Text("Downloads Windows 11 ARM64 from UUP Dump (~5 GB first run, cached after that) and creates a fully unattended VM with Parallels Tools and Edge pre-installed.\n\nRequired Homebrew packages: aria2, p7zip, cabextract, wimlib, cdrtools\nInstall: brew install aria2 p7zip cabextract wimlib cdrtools")
                .font(.caption)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let err = errorMessage {
                Text(err)
                    .font(.caption)
                    .foregroundColor(.red)
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Create VM") { launch() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(vmName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 500)
    }

    // MARK: - Launch

    private func launch() {
        errorMessage = nil

        guard let shURL = Bundle.main.url(forResource: "install-windows-full",
                                          withExtension: "sh") else {
            errorMessage = "install-windows-full.sh not found in app bundle."
            return
        }

        let workDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(
                "Library/Application Support/ParallelsManager/WindowsInstall")

        let tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ParallelsManagerInstall-\(UUID().uuidString)")

        do {
            try FileManager.default.createDirectory(at: tmpDir,
                                                    withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: workDir,
                                                    withIntermediateDirectories: true)

            let tmpSh = tmpDir.appendingPathComponent("install-windows-full.sh")
            try FileManager.default.copyItem(at: shURL, to: tmpSh)
            try FileManager.default.setAttributes([.posixPermissions: 0o755],
                                                   ofItemAtPath: tmpSh.path)

            // Escape single quotes for single-quoted bash strings
            let safeN = vmName.replacingOccurrences(of: "'", with: "'\\''")
            let safeW = workDir.path.replacingOccurrences(of: "'", with: "'\\''")

            let script = [
                "#!/usr/bin/env bash",
                "export VM_NAME='\(safeN)'",
                "export WORK_DIR='\(safeW)'",
                "export PATH=\"/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH\"",
                "cd \"$(dirname \"$0\")\"" ,
                "bash install-windows-full.sh",
                "echo \"  \"",
                "echo \"Done. Press Return to close.\"",
                "read -r"
            ].joined(separator: "\n")

            let wrapperURL = tmpDir.appendingPathComponent("install.command")
            try script.write(to: wrapperURL, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o755],
                                                   ofItemAtPath: wrapperURL.path)

            NSWorkspace.shared.open(wrapperURL)
        } catch {
            errorMessage = "Setup error: \(error.localizedDescription)"
            return
        }

        dismiss()
    }
}
