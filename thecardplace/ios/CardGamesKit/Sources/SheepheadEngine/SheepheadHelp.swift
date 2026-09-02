/// "How to play Sheephead", from the web game's rules section, so the app can
/// show it offline. Plain sentences; no markup.
public enum SheepheadHelp {
    public static let rules: [(heading: String, body: String)] = [
        ("The idea",
         "Sheephead is a trick taking game about capturing card points. One player, the picker, takes on the rest of the table, usually with a secret partner. The picker's side needs more than half the points in the deck to win the hand."),

        ("The deck",
         "Thirty-two cards: seven, eight, nine, ten, jack, queen, king and ace in each suit. At four players the seven and eight of diamonds come out, leaving thirty, so that everyone still gets a full hand with a two card blind. Both are worth nothing, so a hand is 120 points at every table size.\n\n"
         + "Trump is a single fourteen card suit made of all four queens, then all four jacks, then the whole diamond suit. From highest to lowest: queen of clubs, queen of spades, queen of hearts, queen of diamonds, jack of clubs, jack of spades, jack of hearts, jack of diamonds, then ace, ten, king, nine, eight and seven of diamonds.\n\n"
         + "Fail suits are clubs, spades and hearts, ranked ace, ten, king, nine, eight, seven. Two things surprise new players: the ten sits above the king, and the queens and jacks are not in their fail suits at all, they are trump. So the highest club is the ace of clubs, not the queen or the jack of clubs.\n\n"
         + "Card values: ace 11, ten 10, king 4, queen 3, jack 2, and nine, eight and seven nothing. That is 120 points in the deck."),

        ("The deal",
         "Everyone gets a hand and a small blind is set aside. Starting to the dealer's left, each player may pick up the blind or pass. Whoever picks takes the blind into their hand and buries the same number of cards face down; those buried cards count for the picker's team at the end, so it pays to bury points you could not otherwise protect.\n\n"
         + "With four, five or six players the jack of diamonds is the secret partner card. Whoever holds it plays with the picker but says nothing until the card hits the table. If the picker holds it or buries it, the picker plays alone against everyone.\n\n"
         + "None of that is announced. The sides only become public when the jack of diamonds is actually played: if somebody else plays it they are the partner, and if the picker plays it themselves that is the moment everyone learns the picker is alone. If the picker buried it, nobody finds out until the hand is scored. You are told your own situation, whether you picked or hold the jack, but never anyone else's.\n\n"
         + "With three players there is no partner card and the picker is always alone, which everyone knows in advance."),

        ("Play",
         "The player to the dealer's left leads. You must follow the suit that was led if you can. Remember that trump is its own suit: if a queen, jack or diamond is led, every queen, jack and diamond in your hand must follow it, and a queen of clubs does not follow a lead of clubs. Highest trump takes the trick; if no trump is played, the highest card of the led suit takes it. If you cannot follow, you may play anything, including trump."),

        ("Winning the hand",
         "The picker's team needs 61 of the 120 points. A normal win pays one unit, 91 or more pays two (a schneider), and taking every trick pays three. If the picker's team falls short they pay double, and more if they are held to 30 points or fewer, or take no tricks at all. Each opponent settles for two units times the multiplier; the picker takes roughly two thirds of that pot and the partner one third."),

        ("Leaster",
         "If everyone passes and you chose the leaster option, there is no picker. Everyone plays for themselves, the blind goes to whoever wins the last trick, and the player with the fewest points wins. You must have taken at least one trick to be eligible, so ducking every single trick loses."),

        ("Doublers",
         "Optional house rules that multiply what a hand is worth. A doubler applies to the whole hand however it turns out, so holding the queens and going down costs double as well. Two doublers on the same hand make it worth four times.\n\n"
         + "Black queens: the queen of clubs and the queen of spades held by the same player after burying doubles the hand. Red queens: the queen of hearts and the queen of diamonds held by the same player doubles the hand. Redeal: when everybody passes and the hand is redealt, the next hand is doubled; repeated redeals do not stack. A pair only counts inside a single hand, and who holds what stays private until scoring, exactly like the partner card."),

        ("Two different numbers on the table",
         "Two things are easy to mix up. Card points this hand is what you have taken in tricks out of the 120 in the deck; those always total 120 across everyone, plus whatever the picker buried. Game score is the running total in scoring units across all the hands you have played; those always total zero, so one player being well ahead means the others are behind by the same amount."),
    ]
}
