import SwiftUI
import UIKit

/// Everything the game says out loud goes through here, one message at a time.
///
/// VoiceOver will happily start a new announcement on top of one it is half
/// way through, and a run of computer turns arriving a few hundred
/// milliseconds apart would leave the player hearing the second half of one
/// sentence and the first half of another. So announcements are queued and
/// the next one is not posted until VoiceOver says the last one finished.
///
/// Two kinds of message, and they are not equal:
///
/// - A **game event** ("Ruth played the Ten of Hearts") waits its turn.
/// - A **request** — something the player asked to hear, such as the hand read
///   or a score — jumps the queue, and whatever it interrupted is put back to
///   be spoken afterwards rather than thrown away. An error ("you must follow
///   hearts") is a request that also interrupts.
///
/// The most recent message is also kept as text, so it can be shown on screen
/// and repeated on demand. The visible copy is not itself announced, which is
/// how the same sentence avoids being read twice.
@MainActor
@Observable
final class Announcer {
    enum Channel { case polite, assertive }

    struct Item: Equatable {
        let text: String
        let channel: Channel
        let isRequest: Bool
    }

    /// The last thing said, for the screen and for Repeat.
    private(set) var lastText: String = ""

    private var queue: [Item] = []
    private var current: Item?
    private var fallback: Task<Void, Never>?
    nonisolated(unsafe) private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: UIAccessibility.announcementDidFinishNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            let ok = (note.userInfo?[UIAccessibility.announcementWasSuccessfulUserInfoKey] as? Bool) ?? true
            let text = note.userInfo?[UIAccessibility.announcementStringValueUserInfoKey] as? String
            Task { @MainActor in self?.finished(text: text, ok: ok) }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// A game event. Waits behind whatever is already queued.
    func say(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        queue.append(Item(text: t, channel: .polite, isRequest: false))
        pump()
    }

    /// Several game events spoken as one message, so a run of computer turns
    /// cannot cut each other off.
    func say(batch texts: [String]) {
        let joined = texts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        say(joined)
    }

    /// Something the player asked to hear. Goes to the front; a newer request
    /// replaces an older one still waiting; the game event it interrupts is
    /// put back to be said afterwards.
    func request(_ text: String) {
        preempt(Item(text: text, channel: .polite, isRequest: true))
    }

    /// A refusal or a mistake. Interrupts, like a request.
    func error(_ text: String) {
        preempt(Item(text: text, channel: .assertive, isRequest: true))
    }

    /// Say the last message again.
    func repeatLast() {
        guard !lastText.isEmpty else {
            request("Nothing has been announced yet.")
            return
        }
        request(lastText)
    }

    /// Forget everything waiting. Used when a game ends or the screen goes away.
    func clear() {
        queue.removeAll()
        fallback?.cancel()
        current = nil
    }

    // MARK: - the queue

    private func preempt(_ item: Item) {
        queue.removeAll { $0.isRequest }
        queue.insert(item, at: 0)
        if let c = current, !c.isRequest {
            // Put the interrupted game event back, right after the request.
            queue.insert(c, at: 1)
        }
        fallback?.cancel()
        current = nil
        pump()
    }

    private func pump() {
        guard current == nil, !queue.isEmpty else { return }
        post(queue.removeFirst())
    }

    private func post(_ item: Item) {
        current = item
        lastText = item.text

        guard UIAccessibility.isVoiceOverRunning else {
            // Nobody is listening; keep the text for the screen and move on.
            current = nil
            pump()
            return
        }

        let priority: UIAccessibilityPriority = item.isRequest ? .high : .default
        let attributed = NSAttributedString(
            string: item.text,
            attributes: [.accessibilitySpeechAnnouncementPriority: priority]
        )
        UIAccessibility.post(notification: .announcement, argument: attributed)

        // If the finish notification never comes — it does not when VoiceOver
        // is muted, for instance — do not hold the queue for ever.
        let seconds = max(2.0, Double(item.text.count) * 0.075)
        fallback?.cancel()
        fallback = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self?.finished(text: nil, ok: true)
        }
    }

    private func finished(text: String?, ok: Bool) {
        guard let c = current else { return }
        // Finish notifications carry the text; ignore one for a message that is
        // not the one we are waiting on (it was pre-empted and already requeued).
        if let text, text != c.text { return }
        fallback?.cancel()
        current = nil
        // If VoiceOver cut it off because the player moved, it is not said
        // again: re-posting would interrupt whatever they moved to, and the
        // text is on screen with Repeat beside it.
        _ = ok
        pump()
    }
}
