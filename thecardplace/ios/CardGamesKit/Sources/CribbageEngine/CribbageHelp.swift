/// The "How to play" text from `cribbage-multiplayer/index.html`, so the app
/// can show it offline. Plain sentences; no markup.
public enum CribbageHelp {
    public static let rules: [(heading: String, body: String)] = [
        ("How to play Cribbage",
         "Two players, 121 points, and the first one there wins — the moment they get there, not at the end of the hand."),
        ("Two numbers on every card",
         "A card's counting value is what it adds during the play and towards a fifteen: ace is one, and the ten, jack, queen and king are all ten. A card's order is where it sits in a run: ace is one and the king is thirteen, so a ten really is lower than a jack. Confusing the two is the most common cribbage mistake there is."),
        ("The deal",
         "Cut for deal — lower card deals first and takes the first crib. The dealer gives six cards each. Both players then throw two cards face down to the crib, which belongs to the dealer and is counted at the end as an extra hand. Neither player sees the crib until then. Then the top of the pack is turned: the starter. If it is a jack the dealer scores two for his heels straight away."),
        ("The play",
         "Starting with the non-dealer, you take turns laying a card face up and calling the running total. You may not take it past 31. Score as you go. Fifteen: 2. Thirty-one: 2. A pair: 2; three of a kind is 6, four is 12. A run of three or more: one per card. They need not arrive in order: 5, 3, 4 is a run of three. One for the go: if your opponent cannot play, they say go and you keep laying cards until you cannot either. Whoever laid last takes 1 — or 2 if they made exactly 31. One for the last card of the hand. When neither of you can play, the count goes back to nothing and whoever did not lay the last card leads again. Pairs and runs only count within the current run of cards, never back across a reset."),
        ("The count",
         "Now the hands are counted, each with the starter as a fifth card. Non-dealer first, then the dealer, then the dealer's crib — and that order is why being non-dealer matters when the game is close. Fifteens: 2 for every combination adding to 15. Pairs: 2 each; three of a kind is three pairs, so 6; four is 12. Runs: one per card, and scored once for every distinct set that makes it. 4-5-6-6 is two runs of three, for 6. A flush: 4 for all four cards in your hand matching, 5 if the starter matches too. In the crib it must be all five or it scores nothing. One for his nob: the jack of the starter's suit, in your hand. The best possible hand is 29: three fives and the jack of the starter's suit, with the fourth five turned."),
        ("What this game does not do",
         "There is no muggins — nobody can claim points you failed to count, because the program counts for you. Three and four handed cribbage are not implemented. A skunk is reported when it happens but counts as one game, not two."),
    ]
}
