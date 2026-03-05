import Foundation

class FinnhubService {
    static let shared = FinnhubService()
    
    private let apiKey = "YOUR_FINNHUB_API_KEY_HERE"
    private let baseURL = "https://finnhub.io/api/v1"
    
    func fetchQuote(for ticker: String) async throws -> StockQuote {
        let urlString = "\(baseURL)/quote?symbol=\(ticker)&token=\(apiKey)"
        guard let url = URL(string: urlString) else {
            throw NetworkError.invalidURL
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw NetworkError.invalidResponse
        }
        
        var quote = try JSONDecoder().decode(StockQuote.self, from: data)
        quote.ticker = ticker
        return quote
    }
    
    func fetchCompanyProfile(for ticker: String) async throws -> FinnhubCompanyProfile {
        let urlString = "\(baseURL)/stock/profile2?symbol=\(ticker)&token=\(apiKey)"
        guard let url = URL(string: urlString) else {
            throw NetworkError.invalidURL
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw NetworkError.invalidResponse
        }
        
        return try JSONDecoder().decode(FinnhubCompanyProfile.self, from: data)
    }
    
    func fetchAndUpdateHolding(_ holding: inout PortfolioHolding) async throws {
        async let quoteTask = fetchQuote(for: holding.ticker)
        async let profileTask = fetchCompanyProfile(for: holding.ticker)

        let quote = try await quoteTask
        let profile = try? await profileTask
        holding.quote = quote.with(ticker: holding.ticker, name: profile?.name)
    }
}

enum NetworkError: Error {
    case invalidURL
    case invalidResponse
    case decodingError
}
