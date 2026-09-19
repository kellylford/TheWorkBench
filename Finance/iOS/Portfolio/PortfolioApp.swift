import SwiftUI

@main
struct PortfolioApp: App {
    @StateObject private var portfolioVM = PortfolioViewModel()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(portfolioVM)
        }
    }
}
