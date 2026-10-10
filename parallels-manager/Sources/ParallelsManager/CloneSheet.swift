import SwiftUI

struct CloneSheet: View {
    let vm: VM
    @Binding var cloneName: String
    let onClone:  () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Clone \"\(vm.name)\"")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)

            Text("Enter a name for the cloned VM:")
                .foregroundColor(.secondary)

            TextField("Clone name", text: $cloneName)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("New VM name")

            HStack {
                Spacer()
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button("Clone") {
                    guard !cloneName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    onClone()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(cloneName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 360)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Clone VM dialog")
    }
}
