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
    @State private var editingHolding: PortfolioHolding? = nil
    
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
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
                
                ForEach(Array(portfolioVM.holdings.enumerated()), id: \.element.id) { idx, holding in
                    let cols = portfolioVM.tableRows[idx]
                    
                    HStack(spacing: 0) {
                        Text(cols[0])
                            .font(.subheadline.bold())
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8)
                        
                        Text(cols[1])
                            .font(.caption.monospacedDigit())
                            .frame(width: 60)
                        
                        Text(cols[2])
                            .font(.caption2.monospacedDigit())
                            .frame(width: 80)
                        
                        Text(cols[3])
                            .font(.caption.monospacedDigit())
                            .frame(width: 50)
                        
                        Text(cols[4])
                            .font(.caption.monospacedDigit())
                            .frame(width: 60)
                    }
                    .padding(.vertical, 7)
                    .background(idx % 2 == 0 ? Color.clear : Color.secondary.opacity(0.05))
                    .contentShape(Rectangle())
                    .contextMenu {
                        Button("Edit") {
                            editingHolding = holding
                        }

                        Button("Delete", role: .destructive) {
                            selectedForDelete = holding.id
                        }

                        Button("Move Up") {
                            portfolioVM.moveUp(id: holding.id)
                        }
                        .disabled(!portfolioVM.canMoveUp(id: holding.id))

                        Button("Move Down") {
                            portfolioVM.moveDown(id: holding.id)
                        }
                        .disabled(!portfolioVM.canMoveDown(id: holding.id))

                        Button("Move To Top") {
                            portfolioVM.moveToTop(id: holding.id)
                        }
                        .disabled(!portfolioVM.canMoveUp(id: holding.id))

                        Button("Move To Bottom") {
                            portfolioVM.moveToBottom(id: holding.id)
                        }
                        .disabled(!portfolioVM.canMoveDown(id: holding.id))
                    }
                    .accessibilityHidden(true)
                    
                    if idx < portfolioVM.holdings.count - 1 {
                        Divider().padding(.leading, 8)
                    }
                }
            }
            .accessibilityHidden(true)
            .overlay(
                AccessibleDataTable(
                    headers: portfolioVM.tableHeaders,
                    rows: portfolioVM.tableRows
                )
                .allowsHitTesting(false)
            )

            // VoiceOver-operable row actions mirror the long-press context menu.
            VStack(alignment: .leading, spacing: 6) {
                Text("Manage Holdings")
                    .font(.caption.bold())
                    .foregroundColor(.secondary)
                    .padding(.top, 10)

                ForEach(portfolioVM.holdings) { holding in
                    HStack {
                        Text(holding.name)
                            .font(.subheadline)
                        Spacer()
                        Text("\(holding.shares, specifier: "%.2f")")
                            .font(.caption.monospacedDigit())
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                    .contextMenu {
                        Button("Edit") {
                            editingHolding = holding
                        }

                        Button("Delete", role: .destructive) {
                            selectedForDelete = holding.id
                        }

                        Button("Move Up") {
                            portfolioVM.moveUp(id: holding.id)
                        }
                        .disabled(!portfolioVM.canMoveUp(id: holding.id))

                        Button("Move Down") {
                            portfolioVM.moveDown(id: holding.id)
                        }
                        .disabled(!portfolioVM.canMoveDown(id: holding.id))

                        Button("Move To Top") {
                            portfolioVM.moveToTop(id: holding.id)
                        }
                        .disabled(!portfolioVM.canMoveUp(id: holding.id))

                        Button("Move To Bottom") {
                            portfolioVM.moveToBottom(id: holding.id)
                        }
                        .disabled(!portfolioVM.canMoveDown(id: holding.id))
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(holding.name), \(holding.shares, specifier: "%.2f") shares")
                    .accessibilityHint("Actions available")
                    .accessibilityAction(named: "Edit") {
                        editingHolding = holding
                    }
                    .accessibilityAction(named: "Delete") {
                        selectedForDelete = holding.id
                    }
                    .accessibilityAction(named: "Move Up") {
                        portfolioVM.moveUp(id: holding.id)
                    }
                    .accessibilityAction(named: "Move Down") {
                        portfolioVM.moveDown(id: holding.id)
                    }
                    .accessibilityAction(named: "Move To Top") {
                        portfolioVM.moveToTop(id: holding.id)
                    }
                    .accessibilityAction(named: "Move To Bottom") {
                        portfolioVM.moveToBottom(id: holding.id)
                    }

                    Divider()
                }
            }
            .padding(.horizontal, 8)
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
        .sheet(item: $editingHolding) { holding in
            EditHoldingSheet(holding: holding) { ticker, shares in
                await portfolioVM.updateHolding(id: holding.id, ticker: ticker, shares: shares)
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(PortfolioViewModel())
}
