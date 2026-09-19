import CardCore

/// The "How to play Euchre" text from the browser game's rules section, so the
/// app can show it offline. Plain sentences; no markup.
public enum EuchreHelp {
    public static let rules: [(heading: String, body: String)] = [
        ("How to play Euchre",
         "Four players in two fixed partnerships, sitting alternately: seats 1 and 3 are one side, " +
         "seats 2 and 4 the other. You are in seat 1, so your partner is in seat 3, across the table. " +
         "First side to ten points wins."),

        ("The deck",
         "Twenty-four cards: nine, ten, jack, queen, king and ace in each suit. Everything lower is taken out."),

        ("The bowers — the one rule that surprises everybody",
         "Once a suit is trump, the two highest cards in the game are the right bower — the jack of the " +
         "trump suit — and the left bower — the jack of the other suit of the same colour. And while it " +
         "is the left bower, it is a trump card and not a card of its printed suit at all. With spades " +
         "trump, the jack of clubs is a spade: it follows spades, and you may not play it on a club lead " +
         "if you hold any spade. " +
         "So with spades trump the order is: jack of spades, jack of clubs, ace, king, queen, ten, nine " +
         "of spades — then everything else. Clubs are down to six cards, because their jack has left. " +
         "This game marks both bowers in your hand and names them whenever a card is read out, so you " +
         "never have to work it out under time pressure."),

        ("The deal",
         "Five cards each. Four are left over; the top one is turned face up for everybody to see. " +
         "That is the upcard."),

        ("The bidding",
         "First round. Starting to the dealer's left, each player in turn may order it up — making the " +
         "upcard's suit trump — or pass. Whoever orders it up, the dealer takes the upcard into their " +
         "hand and puts one card back face down. If the dealer orders it up themselves, that is called " +
         "taking it up. " +
         "Second round. If all four pass, the upcard is turned down and its suit is out for the hand. " +
         "Starting again to the dealer's left, each player may name any other suit as trump, or pass. " +
         "If everybody passes again the hand is thrown in and redealt — unless stick the dealer is on, " +
         "in which case the dealer has to name something. " +
         "Whoever settles the trump suit is called the maker, and their side has to take at least " +
         "three of the five tricks."),

        ("Going alone",
         "The maker may play the hand alone. Their partner puts their cards down and sits the hand out, " +
         "so it is one player against two. It pays four points instead of two if they take all five " +
         "tricks, and nothing extra otherwise — so it is a bid for a sweep, not a safer way to make three."),

        ("The play",
         "The player to the dealer's left leads to the first trick. You must follow the suit that was " +
         "led if you can — remembering that the left bower counts as trump. If you cannot follow, you " +
         "may play anything, including trump. Highest trump takes the trick; with no trump in it, the " +
         "highest card of the suit led. The winner leads to the next one."),

        ("Scoring",
         "Three or four tricks: 1 point to the makers. All five tricks: 2 points to the makers. " +
         "All five, playing alone: 4 points to the makers. Three or four, playing alone: 1 point to " +
         "the makers. Fewer than three — euchred: 2 points to the other side. " +
         "Being euchred is the thing to avoid: it hands the other side two points for a hand you asked " +
         "to play. That is why ordering up on a weak hand is worse than passing on a fair one."),

        ("What this game does not do",
         "There is no defending alone, no farmer's hand, no no-trump and no six-handed variant. Those " +
         "are all real house rules somewhere; they are simply not implemented here."),
    ]

    /// The rule options as the settings dialog describes them.
    public static let settings: [(name: String, body: String)] = [
        ("Game is played to",
         "10 points — the standard game. 11 points. 15 points — a longer game. 5 points — a quick one."),
        ("Stick the dealer",
         "If everybody passes twice the dealer must name a suit, so no hand is ever thrown in."),
        ("Allow going alone",
         "Whoever makes trump may send their partner out of the hand, for four points if they take " +
         "all five tricks."),
        ("Opponent skill",
         "Easy — they bid on too little and misplay. Normal. Hard — they count cards and press advantages."),
    ]
}
