import SwiftUI

struct AddTickerSheet: View {
    @EnvironmentObject var portfolioVM: PortfolioViewModel
    @Binding var isPresented: Bool
    @State private var ticker = ""
    @State private var shares = ""
    @State private var isLoading = false
    @State private var error: String? = nil
    
    var body: some View {
        NavigationView {
            Form {
                Section("Ticker Symbol") {
                    TextField("e.g., AAPL", text: $ticker)
                        .textInputAutocapitalization(.characters)
                        .disabled(isLoading)
                }
                
                Section("Number of Shares") {
                    TextField("e.g., 10.5", text: $shares)
                        .keyboardType(.decimalPad)
                        .disabled(isLoading)
                }
                
                if let error = error {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Add Ticker")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        isPresented = false
                    }
                    .disabled(isLoading)
                }
                
                ToolbarItem(placement: .topBarTrailing) {
                    if isLoading {
                        ProgressView()
                    } else {
                        Button("Add") {
                            addTicker()
                        }
                        .disabled(ticker.trimmingCharacters(in: .whitespaces).isEmpty ||
                                  shares.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }
    
    private func addTicker() {
        error = nil
        isLoading = true
        
        let trimmedTicker = ticker.trimmingCharacters(in: .whitespaces).uppercased()
        guard let sharesDouble = Double(shares.trimmingCharacters(in: .whitespaces)) else {
            error = "Please enter a valid number of shares"
            isLoading = false
            return
        }
        
        guard sharesDouble > 0 else {
            error = "Number of shares must be greater than 0"
            isLoading = false
            return
        }
        
        Task {
            await portfolioVM.addHolding(ticker: trimmedTicker, shares: sharesDouble)
            isLoading = false
            isPresented = false
        }
    }
}

#Preview {
    AddTickerSheet(isPresented: .constant(true))
        .environmentObject(PortfolioViewModel())
}
