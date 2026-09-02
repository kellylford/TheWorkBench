import CardCore

/// "How hearts works", from the rules section of `hearts/index.html`, so the
/// app can show it offline. Plain sentences; no HTML.
public enum HeartsHelp {
    public static let rules: [(heading: String, body: String)] = [
        (heading: "The object",
         body: "Take as few points as possible. Every heart is one point and the queen of spades is thirteen — twenty-six in every hand. When somebody reaches the target the game ends, and the player with the lowest score wins."),
        (heading: "Passing",
         body: "Before each hand you give three cards away and are given three in return. Everybody chooses at the same time, so you commit before you see what is coming. The direction rotates: left, right, across, and then a hand where nobody passes at all."),
        (heading: "The play",
         body: "Whoever holds the two of clubs leads it. That is not a choice. Follow the suit led if you can. There is no trump, so the highest card of the suit led takes the trick. No hearts and no queen of spades on the first trick, unless that is all you hold. Hearts cannot be led until somebody has discarded one on another suit. That is what \"hearts are broken\" means."),
        (heading: "Shooting the moon",
         body: "Take all twenty-six points and the hand turns inside out: you score nothing and everybody else scores twenty-six. It is worth watching for — if somebody has taken every heart so far, letting them have one is cheaper than letting them have the rest."),
    ]
}
