import SwiftUI

struct VMRow: View {
    let vm: VM
    let isBusy: Bool
    var isSelected: Bool = false

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
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var accessibilityLabel: String {
        var parts = [vm.name, vm.status.displayName]
        if isBusy { parts.append("Busy") }
        return parts.joined(separator: ", ")
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
