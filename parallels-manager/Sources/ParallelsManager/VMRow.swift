import SwiftUI

struct VMRow: View {
    let vm: VM
    let isBusy: Bool

    var body: some View {
        HStack(spacing: 10) {
            // Status dot
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
                    .accessibilityLabel("Working")
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityHint("Use VM Actions menu, context menu (VO+Shift+M), or VO+Z for quick actions")
    }

    private var statusColor: Color {
        switch vm.status {
        case .running:   return .green
        case .paused:    return .orange
        case .suspended: return .yellow
        case .stopped, .unknown: return .gray
        }
    }
}
