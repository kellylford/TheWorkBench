import Foundation

// MARK: - Portfolio Models

struct PortfolioHolding: Identifiable, Codable {
    var id = UUID()
    var ticker: String
    var shares: Double
    var quote: StockQuote?
    var name: String { quote?.name ?? ticker }
    
    var currentValue: Double {
        guard let price = quote?.current, price > 0 else { return 0 }
        return price * shares
    }
    
    var gains: Double? {
        guard let price = quote?.current, price > 0 else { return nil }
        guard let change = quote?.change else { return nil }
        return change * shares
    }
    
    var gainsPercent: Double? {
        quote?.percentChange
    }
}

// MARK: - API Models

struct StockQuote: Codable {
    var ticker: String
    let current: Double?
    let change: Double?
    let percentChange: Double?
    let name: String?
    
    enum CodingKeys: String, CodingKey {
        case current = "c"
        case change = "d"
        case percentChange = "dp"
        case name
    }

    init(ticker: String = "",
         current: Double?,
         change: Double?,
         percentChange: Double?,
         name: String?) {
        self.ticker = ticker
        self.current = current
        self.change = change
        self.percentChange = percentChange
        self.name = name
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.ticker = ""
        self.current = try container.decodeIfPresent(Double.self, forKey: .current)
        self.change = try container.decodeIfPresent(Double.self, forKey: .change)
        self.percentChange = try container.decodeIfPresent(Double.self, forKey: .percentChange)
        self.name = try container.decodeIfPresent(String.self, forKey: .name)
    }

    func with(ticker: String, name: String?) -> StockQuote {
        StockQuote(
            ticker: ticker,
            current: current,
            change: change,
            percentChange: percentChange,
            name: name ?? self.name
        )
    }
}

struct FinnhubCompanyProfile: Codable {
    let name: String?
    let ticker: String
    
    enum CodingKeys: String, CodingKey {
        case name
        case ticker = "ticker"
    }
}
