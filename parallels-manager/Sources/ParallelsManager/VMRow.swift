import SwiftUI

struct VMRow: View {
    let vm: VM
    let isBusy: Bool
    let onStart:  () -> Void
    let onStop:   () -> Void
    let onPause:  () -> Void
    let onResume: () -> Void
    let onClone:  () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            // Status indicator
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(vm.name)
                    .font(.body)
                    .lineLimit(1)
                Text(vm.status.displayName)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            if isBusy {
                ProgressView()
                    .scaleEffect(0.65)
                    .frame(width: 20)
                    .accessibilityLabel("Working…")
            } else {
                actionButtons
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(vm.name), \(vm.status.displayName)")
        .accessibilityHint(accessibilityHint)
    }

    // MARK: - Action buttons

    @ViewBuilder
    private var actionButtons: some View {
        Group {
            if vm.status.canStart {
                IconButton("Start", systemImage: "play.fill", tint: .green, action: onStart)
            }
            if vm.status.canResume {
                IconButton("Resume", systemImage: "play.circle.fill", tint: .green, action: onResume)
            }
            if vm.status.canPause {
                IconButton("Pause", systemImage: "pause.fill", tint: .orange, action: onPause)
            }
            if vm.status.canStop {
                IconButton("Stop", systemImage: "stop.fill", tint: .red, action: onStop)
            }
            IconButton("Clone", systemImage: "doc.on.doc", tint: .blue, action: onClone)
            IconButton("Delete", systemImage: "trash", tint: .red, action: onDelete)
        }
    }

    // MARK: - Helpers

    private var statusColor: Color {
        switch vm.status {
        case .running:   return .green
        case .paused:    return .orange
        case .suspended: return .yellow
        case .stopped:   return .gray
        case .unknown:   return .gray
        }
    }

    private var accessibilityHint: String {
        var actions: [String] = []
        if vm.status.canStart  { actions.append("Start") }
        if vm.status.canResume { actions.append("Resume") }
        if vm.status.canPause  { actions.append("Pause") }
        if vm.status.canStop   { actions.append("Stop") }
        actions.append("Clone")
        actions.append("Delete")
        return "Available actions: \(actions.joined(separator: ", "))"
    }
}

// MARK: - Icon button helper

private struct IconButton: View {
    let label: String
    let systemImage: String
    let tint: Color
    let action: () -> Void

    init(_ label: String, systemImage: String, tint: Color, action: @escaping () -> Void) {
        self.label = label
        self.systemImage = systemImage
        self.tint = tint
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .foregroundColor(tint)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .help(label)
    }
}
