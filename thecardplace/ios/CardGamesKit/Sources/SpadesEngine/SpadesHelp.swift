/// The "How spades works" text from `spades/index.html`, as plain sentences,
/// so the app can show it offline. The keyboard section is not here: the app
/// has buttons.
public enum SpadesHelp {
    public static let rules: [(heading: String, body: String)] = [
        (heading: "The object",
         body: "You and the player opposite are a partnership. Before a card is played, everybody says how many of the thirteen tricks they think they will take. Your two bids added together are your contract, and the whole hand is about meeting it. First partnership to the target wins."),

        (heading: "The bidding",
         body: "Bidding starts to the dealer's left and goes round once, out loud, so the later seats know what has already been promised. A bid is any number from one to thirteen, or nil, which is a promise to take no tricks at all. Choose your bid, then place it. Reading through the choices never bids on its own, so you can hear your hand again without committing to anything until you place the bid."),

        (heading: "The play",
         body: "Spades are always trump. A spade beats any card of any other suit. Follow the suit led if you can. If you cannot, play anything, including a spade, whenever you like. Spades cannot be led until they have been broken, which happens as soon as anybody plays one, usually somebody trumping in on a suit they could not follow. If spades are all you hold you may lead one anyway, and that breaks them too. The highest spade takes the trick. If no spade is played, the highest card of the suit led takes it."),

        (heading: "The scoring",
         body: "Make the contract and it is worth ten points a trick. Miss it by even one and you lose ten points a trick for the whole bid, not the difference. Bidding seven and taking six is minus seventy. Every trick over the contract is worth one point and one bag. Ten bags costs a hundred points, and the count carries on from whatever is left over. This is why quietly over-performing every hand is a way to lose."),

        (heading: "Nil",
         body: "A bid of nil is a promise to take nothing at all. Bring it in and it is worth a hundred; take a single trick and it costs a hundred. It is scored on its own, and your partner's bid is still an ordinary contract that still has to be made, so a partner sitting on nil is somebody you are now covering for."),
    ]
}
