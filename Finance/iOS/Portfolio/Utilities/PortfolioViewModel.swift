import SwiftUI

@MainActor
class PortfolioViewModel: ObservableObject {
    @Published var holdings: [PortfolioHolding] = []
    @Published var isLoading = false
    @Published var errorMessage: String? = nil
    
    private let defaults = UserDefaults.standard
    private let holdingsKey = "portfolio_holdings"
    
    init() {
        loadHoldings()
        if holdings.isEmpty {
            addDefaultHoldings()
        }
    }
    
    // MARK: - Portfolio Management
    
    func addHolding(ticker: String, shares: Double) async {
        let newHolding = PortfolioHolding(ticker: ticker.uppercased(), shares: shares)
        holdings.append(newHolding)
        
        await refreshHolding(newHolding)
        saveHoldings()
    }
    
    func removeHolding(_ holding: PortfolioHolding) {
        holdings.removeAll { $0.id == holding.id }
        saveHoldings()
    }

    func updateHolding(id: UUID, ticker: String, shares: Double) async {
        guard let index = holdings.firstIndex(where: { $0.id == id }) else { return }

        holdings[index].ticker = ticker.uppercased()
        holdings[index].shares = shares
        holdings[index].quote = nil

        let refreshed = holdings[index]
        await refreshHolding(refreshed)
        saveHoldings()
    }

    func moveUp(id: UUID) {
        guard let index = indexForHolding(id), index > 0 else { return }
        holdings.swapAt(index, index - 1)
        saveHoldings()
    }

    func moveDown(id: UUID) {
        guard let index = indexForHolding(id), index < holdings.count - 1 else { return }
        holdings.swapAt(index, index + 1)
        saveHoldings()
    }

    func moveToTop(id: UUID) {
        guard let index = indexForHolding(id), index > 0 else { return }
        let holding = holdings.remove(at: index)
        holdings.insert(holding, at: 0)
        saveHoldings()
    }

    func moveToBottom(id: UUID) {
        guard let index = indexForHolding(id), index < holdings.count - 1 else { return }
        let holding = holdings.remove(at: index)
        holdings.append(holding)
        saveHoldings()
    }

    func canMoveUp(id: UUID) -> Bool {
        guard let index = indexForHolding(id) else { return false }
        return index > 0
    }

    func canMoveDown(id: UUID) -> Bool {
        guard let index = indexForHolding(id) else { return false }
        return index < holdings.count - 1
    }
    
    func refreshAllHoldings() async {
        isLoading = true
        errorMessage = nil
        
        for i in 0..<holdings.count {
            await refreshHolding(holdings[i])
        }
        
        isLoading = false
        saveHoldings()
    }
    
    private func refreshHolding(_ holding: PortfolioHolding) async {
        do {
            var updatedHolding = holding
            try await FinnhubService.shared.fetchAndUpdateHolding(&updatedHolding)
            if let index = holdings.firstIndex(where: { $0.id == holding.id }) {
                holdings[index] = updatedHolding
            }
        } catch {
            errorMessage = "Stock data for \(holding.ticker) couldn't be retrieved. Check the symbol or your network connection, then try again."
        }
    }

    private func indexForHolding(_ id: UUID) -> Int? {
        holdings.firstIndex(where: { $0.id == id })
    }
    
    // MARK: - Portfolio Calculations
    
    var totalValue: Double {
        holdings.reduce(0) { $0 + $1.currentValue }
    }
    
    var totalGains: Double {
        holdings.reduce(0) { $0 + ($1.gains ?? 0) }
    }
    
    // MARK: - Table Data
    
    var tableHeaders: [String] {
        ["Ticker", "Price", "Change", "Shares", "Value"]
    }
    
    var tableRows: [[String]] {
        holdings.map { holding in
            let name = holding.name
            let price = formatPrice(holding.quote?.current)
            let change = formatChange(holding.quote?.change, percent: holding.quote?.percentChange)
            let shares = formatNumber(holding.shares)
            let value = formatPrice(holding.currentValue)
            
            return [name, price, change, shares, value]
        }
    }
    
    // MARK: - Persistence
    
    private func saveHoldings() {
        if let encoded = try? JSONEncoder().encode(holdings) {
            defaults.set(encoded, forKey: holdingsKey)
        }
    }
    
    private func loadHoldings() {
        if let data = defaults.data(forKey: holdingsKey),
           let decoded = try? JSONDecoder().decode([PortfolioHolding].self, from: data) {
            holdings = decoded
        }
    }
    
    private func addDefaultHoldings() {
        let defaults = [
            PortfolioHolding(ticker: "MSFT", shares: 10),
            PortfolioHolding(ticker: "GOOG", shares: 10),
            PortfolioHolding(ticker: "QQQ", shares: 10),
            PortfolioHolding(ticker: "SPY", shares: 10),
            PortfolioHolding(ticker: "LITE", shares: 10)
        ]
        holdings = defaults
        
        // Fetch quotes for all defaults
        Task {
            await refreshAllHoldings()
        }
    }
    
    // MARK: - Formatting Helpers
    
    private func formatPrice(_ price: Double?) -> String {
        guard let price = price, price > 0 else { return "—" }
        return String(format: "$%.2f", price)
    }
    
    private func formatChange(_ change: Double?, percent: Double?) -> String {
        guard let change = change, let percent = percent else { return "—" }
        let symbol = change >= 0 ? "+" : ""
        return String(format: "%@$%.2f (%.2f%%)", symbol, change, percent)
    }
    
    private func formatNumber(_ num: Double) -> String {
        if num == Double(Int(num)) {
            return String(Int(num))
        }
        return String(format: "%.2f", num)
    }
}
