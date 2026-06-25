import SwiftUI
import UIKit

// MARK: - Cell element

final class DataTableCellElement: UIAccessibilityElement,
                                  UIAccessibilityContainerDataTableCell {
    private let _row: Int
    private let _col: Int

    init(container: AccessibleDataTableView,
         label: String,
         traits: UIAccessibilityTraits = .none,
         row: Int,
         col: Int) {
        self._row = row
        self._col = col
        super.init(accessibilityContainer: container)
        accessibilityLabel = label
        accessibilityTraits = traits
    }

    @objc func accessibilityRowRange() -> NSRange {
        NSRange(location: _row, length: 1)
    }

    @objc func accessibilityColumnRange() -> NSRange {
        NSRange(location: _col, length: 1)
    }
}

// MARK: - Container view

final class AccessibleDataTableView: UIView,
                                     UIAccessibilityContainerDataTable {

    var columnHeaders: [String] = [] { didSet { rebuild() } }
    var dataRows: [[String]] = []    { didSet { rebuild() } }
    var canMoveUp: (Int) -> Bool = { _ in false }
    var canMoveDown: (Int) -> Bool = { _ in false }
    var onMoveUp: (Int) -> Void = { _ in }
    var onMoveDown: (Int) -> Void = { _ in }
    var onMoveToTop: (Int) -> Void = { _ in }
    var onMoveToBottom: (Int) -> Void = { _ in }

    private var headerElements: [DataTableCellElement] = []
    private var rowElements:    [[DataTableCellElement]] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityContainerType = .dataTable
        isUserInteractionEnabled = false
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        rebuild()
    }

    private func rebuild() {
        guard !columnHeaders.isEmpty else {
            headerElements = []
            rowElements    = []
            return
        }

        let ncols = columnHeaders.count
        let nrows = dataRows.count

        let totalW    = max(1, bounds.width)
        let totalH    = max(1, bounds.height)
        let col0W     = totalW * 0.40
        let otherColW = ncols > 1 ? (totalW - col0W) / CGFloat(ncols - 1) : 0
        let rowH      = totalH / CGFloat(nrows + 1)

        func xOffset(col: Int) -> CGFloat {
            col == 0 ? 0 : col0W + CGFloat(col - 1) * otherColW
        }
        func colWidth(col: Int) -> CGFloat {
            col == 0 ? col0W : otherColW
        }
        func screenFrame(row: Int, col: Int) -> CGRect {
            let local = CGRect(x: xOffset(col: col),
                               y: CGFloat(row) * rowH,
                               width: colWidth(col: col),
                               height: rowH)
            return UIAccessibility.convertToScreenCoordinates(local, in: self)
        }

        headerElements = columnHeaders.enumerated().map { col, title in
            let el = DataTableCellElement(container: self, label: title,
                                          traits: .header, row: 0, col: col)
            el.accessibilityFrame = screenFrame(row: 0, col: col)
            return el
        }

        rowElements = dataRows.enumerated().map { row, cols in
            cols.enumerated().map { col, label in
                let el = DataTableCellElement(container: self, label: label,
                                              traits: .staticText,
                                              row: row + 1, col: col)
                el.accessibilityFrame = screenFrame(row: row + 1, col: col)
                el.accessibilityCustomActions = customActions(forRow: row)
                return el
            }
        }
    }

    private func customActions(forRow row: Int) -> [UIAccessibilityCustomAction] {
        var actions: [UIAccessibilityCustomAction] = []

        if canMoveUp(row) {
            actions.append(UIAccessibilityCustomAction(name: "Move Up") { [weak self] _ in
                self?.onMoveUp(row)
                return true
            })
            actions.append(UIAccessibilityCustomAction(name: "Move To Top") { [weak self] _ in
                self?.onMoveToTop(row)
                return true
            })
        }

        if canMoveDown(row) {
            actions.append(UIAccessibilityCustomAction(name: "Move Down") { [weak self] _ in
                self?.onMoveDown(row)
                return true
            })
            actions.append(UIAccessibilityCustomAction(name: "Move To Bottom") { [weak self] _ in
                self?.onMoveToBottom(row)
                return true
            })
        }

        return actions
    }

    @objc func accessibilityRowCount() -> Int {
        dataRows.count + 1
    }

    @objc func accessibilityColumnCount() -> Int {
        columnHeaders.count
    }

    @objc func accessibilityHeaderElements(forColumn column: Int) -> [Any]? {
        guard column < headerElements.count else { return nil }
        return [headerElements[column]]
    }

    @objc func accessibilityHeaderElements(forRow row: Int) -> [Any]? {
        guard row > 0 else { return nil }
        let dataRow = row - 1
        guard dataRow < rowElements.count,
              !rowElements[dataRow].isEmpty else { return nil }
        return [rowElements[dataRow][0]]
    }

    @objc func accessibilityDataTableCellElement(
        forRow row: Int, column: Int
    ) -> (any UIAccessibilityContainerDataTableCell)? {
        if row == 0 {
            return column < headerElements.count ? headerElements[column] : nil
        }
        let dataRow = row - 1
        guard dataRow < rowElements.count,
              column < rowElements[dataRow].count else { return nil }
        return rowElements[dataRow][column]
    }

    override var accessibilityElements: [Any]? {
        get {
            var all: [Any] = headerElements
            rowElements.forEach { all.append(contentsOf: $0) }
            return all
        }
        set {}
    }
}

// MARK: - SwiftUI representable

struct AccessibleDataTable: UIViewRepresentable {
    let headers: [String]
    let rows: [[String]]
    let canMoveUp: (Int) -> Bool
    let canMoveDown: (Int) -> Bool
    let onMoveUp: (Int) -> Void
    let onMoveDown: (Int) -> Void
    let onMoveToTop: (Int) -> Void
    let onMoveToBottom: (Int) -> Void

    func makeUIView(context: Context) -> AccessibleDataTableView {
        AccessibleDataTableView()
    }

    func updateUIView(_ uiView: AccessibleDataTableView, context: Context) {
        uiView.canMoveUp = canMoveUp
        uiView.canMoveDown = canMoveDown
        uiView.onMoveUp = onMoveUp
        uiView.onMoveDown = onMoveDown
        uiView.onMoveToTop = onMoveToTop
        uiView.onMoveToBottom = onMoveToBottom

        guard uiView.columnHeaders != headers || uiView.dataRows != rows else { return }
        uiView.columnHeaders = headers
        uiView.dataRows      = rows
    }
}
