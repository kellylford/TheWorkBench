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
    @State private var selectedForDelete: UUID? = nil
    
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
                        holding: holding,
                        columns: portfolioVM.tableRows[idx],
                        index: idx,
                        onDelete: { selectedForDelete = holding.id },
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
        }
        .confirmationDialog("Remove Holding", isPresented: .constant(selectedForDelete != nil)) {
            Button("Remove", role: .destructive) {
                if let id = selectedForDelete {
                    if let holding = portfolioVM.holdings.first(where: { $0.id == id }) {
                        portfolioVM.removeHolding(holding)
                    }
                }
                selectedForDelete = nil
            }
        } message: {
            if let id = selectedForDelete, let holding = portfolioVM.holdings.first(where: { $0.id == id }) {
                Text("Remove \(holding.name) from your portfolio?")
            }
        }
    }
}

struct PortfolioRow: View {
    let holding: PortfolioHolding
    let columns: [String]
    let index: Int
    let onDelete: () -> Void
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onMoveToTop: () -> Void
    let onMoveToBottom: () -> Void
    let canMoveUp: Bool
    let canMoveDown: Bool
    
    var body: some View {
        rowContent
            .contextMenu {
                menuContent
            }
            .modifier(AccessibilityModifier(
                label: accessibilityText,
                onDelete: onDelete,
                onMoveUp: onMoveUp,
                onMoveDown: onMoveDown,
                onMoveToTop: onMoveToTop,
                onMoveToBottom: onMoveToBottom
            ))
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
        Button("Delete", role: .destructive, action: onDelete)
        
        Button("Move Up", action: onMoveUp)
            .disabled(!canMoveUp)
        
        Button("Move Down", action: onMoveDown)
            .disabled(!canMoveDown)
        
        Button("Move To Top", action: onMoveToTop)
            .disabled(!canMoveUp)
        
        Button("Move To Bottom", action: onMoveToBottom)
            .disabled(!canMoveDown)
    }
    
    private var accessibilityText: String {
        "\(columns[0]), Price \(columns[1]), Change \(columns[2]), \(columns[3]) shares, Value \(columns[4])"
    }
}

struct AccessibilityModifier: ViewModifier {
    let label: String
    let onDelete: () -> Void
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onMoveToTop: () -> Void
    let onMoveToBottom: () -> Void
    
    func body(content: Content) -> some View {
        content
            .accessibilityElement(children: .combine)
            .accessibilityLabel(label)
            .accessibilityHint("Actions available")
            .accessibilityAction(named: "Delete") {
                onDelete()
            }
            .accessibilityAction(named: "Move Up") {
                onMoveUp()
            }
            .accessibilityAction(named: "Move Down") {
                onMoveDown()
            }
            .accessibilityAction(named: "Move To Top") {
                onMoveToTop()
            }
            .accessibilityAction(named: "Move To Bottom") {
                onMoveToBottom()
            }
    }
}

#Preview {
    ContentView()
        .environmentObject(PortfolioViewModel())
}
