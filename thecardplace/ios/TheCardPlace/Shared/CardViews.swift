import SwiftUI
import CardCore

/// One card in the player's hand, as the interface needs to draw and label it.
/// The engine supplies the description; the game screen decides the rest.
struct HandCardItem: Identifiable, Equatable {
    let card: Card
    /// What the card is called when read out: "Jack of Clubs, left bower,
    /// second highest trump, counts as spades". Comes from the engine.
    var description: String
    /// A short visual tag printed on the face: "trump", "left bower", "3 pts".
    var badge: String? = nil
    var playable: Bool = true
    /// Why it cannot be played right now, in the words of the rule.
    var reason: String? = nil
    var selected: Bool = false
    /// Something worth marking: "from the blind", "partner card". Spoken and shown.
    var marked: String? = nil

    var id: String { card.id }
}

/// The picture of a card. Purely visual: it is hidden from VoiceOver, and the
/// button or row around it carries the words.
///
/// Nothing here is conveyed by colour alone. Red suits are red, but the suit
/// symbol is printed twice and the badge is text; a card that cannot be played
/// is greyed *and* carries a cross; a selected card has a thick border *and* a
/// tick. The red is dark enough for 4.5:1 on white and on the grey.
struct CardFace: View {
    let card: Card
    var badge: String? = nil
    var dimmed = false
    var selected = false
    var marked: String? = nil
    var compact = false

    @ScaledMetric(relativeTo: .title3) private var baseWidth: CGFloat = 66
    @Environment(\.colorSchemeContrast) private var contrast

    private var width: CGFloat { compact ? baseWidth * 0.68 : baseWidth }
    private var tag: String? { badge ?? marked }
    private var ink: Color {
        card.isRed ? Color(red: 0.69, green: 0.0, blue: 0.125) : Color.black
    }
    private var paper: Color { dimmed ? Color(white: 0.82) : Color.white }
    /// Cards are white in both colour schemes, so the selection colour is fixed
    /// rather than the accent, which is light in dark mode: this teal is 9.8:1
    /// on white.
    static let selection = Color(red: 0.0, green: 0.29, blue: 0.40)
    private var border: Color { selected ? Self.selection : Color.black.opacity(contrast == .increased ? 1 : 0.6) }

    var body: some View {
        VStack(spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(card.rank.shortText)
                    .font(compact ? .callout.weight(.bold) : .title3.weight(.bold))
                Spacer(minLength: 0)
                Text(card.suit.symbol)
                    .font(compact ? .callout : .title3)
            }
            Spacer(minLength: 0)
            Text(card.suit.symbol)
                .font(compact ? .title2 : (tag == nil ? .largeTitle : .title2))
            Spacer(minLength: 0)
            if !compact, let tag {
                // The tag keeps every line it needs; the symbol above gives way.
                Text(tag)
                    .font(.caption2.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
            }
        }
        .padding(compact ? 4 : 6)
        .frame(width: width, height: width * 1.6)
        .foregroundStyle(ink)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(paper))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(border, lineWidth: selected ? 4 : 1.5)
        )
        .overlay(alignment: .topTrailing) {
            if selected {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Color.white, Self.selection)
                    .offset(x: 6, y: -6)
            } else if dimmed {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Color.white, Color.black)
                    .offset(x: 6, y: -6)
            }
        }
        .overlay(alignment: .bottomLeading) {
            if marked != nil && badge != nil && !compact {
                Image(systemName: "star.fill")
                    .font(.caption)
                    .foregroundStyle(Self.selection)
                    .offset(x: -4, y: 4)
            }
        }
        .accessibilityHidden(true)
    }
}

/// A card the player can act on. The whole card is the button, the label
/// says everything the picture shows and where the card sits in the hand, and
/// a card that cannot be played stays in the list and says why — it is not
/// disabled, because a disabled control is one a screen reader user may never
/// learn exists.
struct HandCardButton: View {
    let item: HandCardItem
    let position: Int
    let total: Int
    let hint: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            CardFace(card: item.card, badge: item.badge, dimmed: !item.playable, selected: item.selected, marked: item.marked)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityHint(item.playable ? hint : "")
        .accessibilityAddTraits(item.selected ? .isSelected : [])
    }

    private var label: String {
        var s = item.description
        if let marked = item.marked { s += ", \(marked)" }
        s += ", card \(position) of \(total)"
        if item.selected { s += ", selected" }
        if !item.playable, let reason = item.reason { s += ", cannot be played, \(reason)" }
        return s
    }
}

/// The player's hand, wrapped onto as many rows as it needs so every card is
/// on screen at once. VoiceOver reads it as a group called "Your hand" and
/// then card by card.
struct HandView: View {
    let items: [HandCardItem]
    var hint: String = "Plays this card"
    var focus: AccessibilityFocusState<String?>.Binding
    let onTap: (HandCardItem) -> Void

    var body: some View {
        if items.isEmpty {
            Text("No cards in hand.")
                .foregroundStyle(.secondary)
        } else {
            FlowLayout(spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    HandCardButton(item: item, position: index + 1, total: items.count, hint: hint) {
                        onTap(item)
                    }
                    .accessibilityFocused(focus, equals: item.id)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Your hand")
        }
    }
}

/// Left to right, wrapping. Rows are as tall as their tallest item.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        return place(in: width, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = place(in: bounds.width, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func place(in width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowHeight), origins)
    }
}
