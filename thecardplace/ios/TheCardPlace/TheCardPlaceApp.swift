import SwiftUI

/// The Card Place: five card games against the computer, built so that
/// nothing is conveyed by sight alone. Everything the player needs to know is
/// said in words — as a label on a control, as a status line, or as an
/// announcement — and every shortcut is also a button.
@main
struct TheCardPlaceApp: App {
    @State private var settings = AppSettings()

    var body: some Scene {
        WindowGroup {
            HubView()
                .environment(settings)
        }
    }
}
