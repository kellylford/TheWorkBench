import SwiftUI

struct HelpSection: Identifiable {
    let heading: String
    let body: String
    var id: String { heading }
}

/// A help screen: headings VoiceOver can jump to, plain paragraphs under them.
struct HelpView: View {
    let title: String
    let intro: String?
    let sections: [HelpSection]

    init(title: String, intro: String? = nil, sections: [HelpSection]) {
        self.title = title
        self.intro = intro
        self.sections = sections
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let intro {
                    Text(intro)
                }
                ForEach(sections) { section in
                    Text(section.heading)
                        .font(.title3.weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                        .padding(.top, 6)
                    Text(section.body)
                }
            }
            .frame(maxWidth: 640, alignment: .leading)
            .padding()
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// How the games work with VoiceOver. Nothing about any game's rules — those
/// are in each game's own How to play — only how to get at the game.
struct AccessibilityHintsView: View {
    var body: some View {
        HelpView(
            title: "Accessibility hints",
            intro: "Nothing in these games is conveyed by sight alone. Everything the game knows is said in words: as the label on a card, as a status line, as an announcement, or in the log. These are the parts worth knowing before the first hand.",
            sections: [
                HelpSection(
                    heading: "Cards are buttons",
                    body: "Every card in your hand is a button. Its label says what the card is, anything worth knowing about it right now — that it is trump, or the left bower, or worth three points — and where it sits: \"card 2 of 5\". Double-tap to play it. A card you may not play right now stays in the list and says why: \"cannot be played, you must follow hearts\". It is not disabled, so you can still review your whole hand on your turn."
                ),
                HelpSection(
                    heading: "Move by headings",
                    body: "Each part of the table is under a heading: What you can do, Your hand, This trick, Last completed trick, the scores, and What has happened, which is the log. Set the rotor to Headings and flick down to jump between them without passing every card in between. Your hand is a group, so you can also skip past it in one move."
                ),
                HelpSection(
                    heading: "Announcements",
                    body: "The game says what happens as it happens: who played what, who took the trick, what was scored. They are spoken one at a time, and nothing is started until the last one has finished. Anything you ask to hear from the Review menu jumps ahead of the game's own messages, and the message it interrupted is said again afterwards rather than lost. The most recent announcement is also shown as text under the status line, with a Repeat button beside it."
                ),
                HelpSection(
                    heading: "The Review menu",
                    body: "The Review button at the top of every game reads the things a player asks for most: your hand grouped by suit, the trick so far, the last completed trick, the scores, what has been played, the order of play, and each game's own — the contract in spades, who picked in sheephead, what the count is in cribbage. Every one is a button; none of it depends on a shortcut."
                ),
                HelpSection(
                    heading: "Your turn",
                    body: "When it becomes your turn, VoiceOver moves to the first card you can play, and the announcement says it is your turn. If you would rather it stayed where you were, turn off \"Move to my cards on my turn\" in Settings; the announcement still tells you."
                ),
                HelpSection(
                    heading: "Pace",
                    body: "How fast the computer players move is a setting, in real seconds: Immediate, Brisk, Comfortable, Relaxed, or Wait for me to continue. The timed settings are a ceiling, not a wait you are held to — a Continue button is on screen during every pause, and pressing it moves on at once. With Wait for me, nothing moves until you press it. Every setting except Immediate announces each play on its own; Immediate gathers a run of plays into one message so they cannot cut each other off."
                ),
                HelpSection(
                    heading: "When something is refused",
                    body: "If you try to play a card the rules do not allow, the game says why, in the words of the rule, and nothing changes. \"Nothing happened\" is never the answer."
                ),
                HelpSection(
                    heading: "The log",
                    body: "What has happened is a plain list at the bottom of every game, newest first, with every message the game has said. It is not read out on its own, so nothing is ever spoken twice; move to it when you want to read back."
                ),
                HelpSection(
                    heading: "A hardware keyboard",
                    body: "With a keyboard attached, the review shortcuts from the browser games work here too: H for your hand, T for the trick, L for the last trick, S for the scores, C for the cards played, O for the play order, R to repeat, and N to continue. Each game's own review has a letter as well, shown in the Review menu. Tab moves between controls and Space activates one."
                ),
                HelpSection(
                    heading: "Seeing the cards",
                    body: "Cards follow your text size, including the largest accessibility sizes, and wrap onto more rows rather than shrinking. Nothing depends on colour: red suits are red, but the suit is printed as a symbol, trump and points are written on the card, a card you may not play is greyed and marked with a cross, and a selected card has a thick border and a tick. Increase Contrast, Bold Text, Reduce Motion and dark mode are all respected."
                ),
                HelpSection(
                    heading: "Offline",
                    body: "Everything runs on this device. The games never use the network, and nothing you do is sent anywhere."
                )
            ]
        )
    }
}
