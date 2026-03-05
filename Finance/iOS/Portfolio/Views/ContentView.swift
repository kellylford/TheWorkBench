import SwiftUI

struct ContentView: View {
    @EnvironmentObject var portfolioVM: PortfolioViewModel
    @State private var showAddSheet = false
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                PortfolioSummaryView()
                    .padding()
                    .background(Color(.systemGray6))
                
                Divider()
                
                if portfolioVM.holdings.isEmpty {
                    VStack {
                        Text("No Holdings")
                            .font(.headline)
                            .padding()
                        Text("Add a ticker to get started")
                            .font(.caption)
                            .foregroundColor(.gray)
                    }
                    .frame(maxHeight: .infinity)
                    .frame(maxWidth: .infinity)
                } else {
                    PortfolioTableView()
                }
                
                Spacer()
            }
            .navigationTitle("Portfolio")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        Button(action: {
                            Task {
                                await portfolioVM.refreshAllHoldings()
                            }
                        }) {
                            Image(systemName: "arrow.clockwise")
                        }
                        .disabled(portfolioVM.isLoading)
                        
                        Button(action: { showAddSheet = true }) {
                            Image(systemName: "plus")
                        }
                    }
                }
            }
            .sheet(isPresented: $showAddSheet) {
                AddTickerSheet(isPresented: $showAddSheet)
            }
            .alert("Error", isPresented: .constant(portfolioVM.errorMessage != nil)) {
                Button("OK") { portfolioVM.errorMessage = nil }
            } message: {
                if let message = portfolioVM.errorMessage {
                    Text(message)
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }
}

struct PortfolioSummaryView: View {
    @EnvironmentObject var portfolioVM: PortfolioViewModel
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Total Value")
                .font(.caption)
                .foregroundColor(.gray)
            Text(String(format: "$%.2f", portfolioVM.totalValue))
                .font(.title2.bold())
            
            HStack {
                VStack(alignment: .leading) {
                    Text("Total Gain/Loss")
                        .font(.caption)
                        .foregroundColor(.gray)
                    Text(String(format: "$%.2f", portfolioVM.totalGains))
                        .font(.subheadline.bold())
                        .foregroundColor(portfolioVM.totalGains >= 0 ? .green : .red)
                }
                Spacer()
            }
        }
    }
}

struct PortfolioTableView: View {
    @EnvironmentObject var portfolioVM: PortfolioViewModel
    
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Header Row
                HStack(spacing: 0) {
                    Text("Ticker")
                        .font(.caption.bold())
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                    
                    Text("Price")
                        .font(.caption.bold())
                        .frame(width: 60)
                    
                    Text("Change")
                        .font(.caption.bold())
                        .frame(width: 80)
                    
                    Text("Shares")
                        .font(.caption.bold())
                        .frame(width: 50)
                    
                    Text("Value")
                        .font(.caption.bold())
                        .frame(width: 60)
                }
                .padding(.vertical, 6)
                .background(Color.secondary.opacity(0.15))
                
                Divider()
                
                // Data Rows
                ForEach(Array(portfolioVM.holdings.enumerated()), id: \.element.id) { idx, holding in
                    PortfolioRow(
                        columns: portfolioVM.tableRows[idx],
                        index: idx,
                        onMoveUp: { portfolioVM.moveUp(id: holding.id) },
                        onMoveDown: { portfolioVM.moveDown(id: holding.id) },
                        onMoveToTop: { portfolioVM.moveToTop(id: holding.id) },
                        onMoveToBottom: { portfolioVM.moveToBottom(id: holding.id) },
                        canMoveUp: portfolioVM.canMoveUp(id: holding.id),
                        canMoveDown: portfolioVM.canMoveDown(id: holding.id)
                    )
                    
                    if idx < portfolioVM.holdings.count - 1 {
                        Divider().padding(.leading, 8)
                    }
                }
            }
            .accessibilityHidden(true)
            .overlay(
                AccessibleDataTable(
                    headers: portfolioVM.tableHeaders,
                    rows: portfolioVM.tableRows,
                    canMoveUp: { row in
                        row > 0
                    },
                    canMoveDown: { row in
                        row < portfolioVM.holdings.count - 1
                    },
                    onMoveUp: { row in
                        guard portfolioVM.holdings.indices.contains(row) else { return }
                        portfolioVM.moveUp(id: portfolioVM.holdings[row].id)
                    },
                    onMoveDown: { row in
                        guard portfolioVM.holdings.indices.contains(row) else { return }
                        portfolioVM.moveDown(id: portfolioVM.holdings[row].id)
                    },
                    onMoveToTop: { row in
                        guard portfolioVM.holdings.indices.contains(row) else { return }
                        portfolioVM.moveToTop(id: portfolioVM.holdings[row].id)
                    },
                    onMoveToBottom: { row in
                        guard portfolioVM.holdings.indices.contains(row) else { return }
                        portfolioVM.moveToBottom(id: portfolioVM.holdings[row].id)
                    }
                )
                .allowsHitTesting(false)
            )
        }
    }
}

struct PortfolioRow: View {
    let columns: [String]
    let index: Int
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onMoveToTop: () -> Void
    let onMoveToBottom: () -> Void
    let canMoveUp: Bool
    let canMoveDown: Bool
    
    var body: some View {
        rowContent
            .contextMenu { menuContent }
    }
    
    private var rowContent: some View {
        HStack(spacing: 0) {
            Text(columns[0])
                .font(.subheadline.bold())
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
            
            Text(columns[1])
                .font(.caption.monospacedDigit())
                .frame(width: 60)
            
            Text(columns[2])
                .font(.caption2.monospacedDigit())
                .frame(width: 80)
            
            Text(columns[3])
                .font(.caption.monospacedDigit())
                .frame(width: 50)
            
            Text(columns[4])
                .font(.caption.monospacedDigit())
                .frame(width: 60)
        }
        .padding(.vertical, 7)
        .background(index % 2 == 0 ? Color.clear : Color.secondary.opacity(0.05))
        .contentShape(Rectangle())
    }
    
    @ViewBuilder
    private var menuContent: some View {
        Button("Move Up", action: onMoveUp)
            .disabled(!canMoveUp)
        
        Button("Move Down", action: onMoveDown)
            .disabled(!canMoveDown)
        
        Button("Move To Top", action: onMoveToTop)
            .disabled(!canMoveUp)
        
        Button("Move To Bottom", action: onMoveToBottom)
            .disabled(!canMoveDown)
    }
}

#Preview {
    ContentView()
        .environmentObject(PortfolioViewModel())
}
