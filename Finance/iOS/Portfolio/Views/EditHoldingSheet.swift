import SwiftUI

struct EditHoldingSheet: View {
    let holding: PortfolioHolding
    let onSave: (String, Double) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var ticker: String
    @State private var shares: String
    @State private var isSaving = false
    @State private var error: String?

    init(holding: PortfolioHolding, onSave: @escaping (String, Double) async -> Void) {
        self.holding = holding
        self.onSave = onSave
        _ticker = State(initialValue: holding.ticker)
        _shares = State(initialValue: String(holding.shares))
    }

    var body: some View {
        NavigationView {
            Form {
                Section("Ticker Symbol") {
                    TextField("e.g., AAPL", text: $ticker)
                        .textInputAutocapitalization(.characters)
                        .disabled(isSaving)
                }

                Section("Number of Shares") {
                    TextField("e.g., 10.5", text: $shares)
                        .keyboardType(.decimalPad)
                        .disabled(isSaving)
                }

                if let error {
                    Section {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Edit Holding")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            save()
                        }
                    }
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    private func save() {
        error = nil
        let trimmedTicker = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()

        guard !trimmedTicker.isEmpty else {
            error = "Ticker is required"
            return
        }

        guard let sharesValue = Double(shares.trimmingCharacters(in: .whitespacesAndNewlines)), sharesValue > 0 else {
            error = "Shares must be a valid number greater than 0"
            return
        }

        isSaving = true
        Task {
            await onSave(trimmedTicker, sharesValue)
            isSaving = false
            dismiss()
        }
    }
}

#Preview {
    EditHoldingSheet(
        holding: PortfolioHolding(ticker: "MSFT", shares: 10),
        onSave: { _, _ in }
    )
}
