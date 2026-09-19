import SwiftUI
import CardCore

/// The pause between computer turns.
///
/// Timed paces are a ceiling rather than a wait the player is held to:
/// Continue is on screen throughout, and pressing it ends the pause early.
/// "Wait for me" has no timer at all and only Continue moves the game on.
@MainActor
@Observable
final class PaceGate {
    /// True while the game is paused waiting for the pace or for Continue.
    private(set) var waiting = false

    private var continuation: CheckedContinuation<Void, Never>?
    private var timer: Task<Void, Never>?

    func wait(_ pace: Pace) async {
        guard pace != .immediate else { return }
        // Never two at once; a second caller ends the first wait.
        fire()
        waiting = true
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            continuation = c
            if let delay = pace.delay {
                timer = Task { [weak self] in
                    try? await Task.sleep(for: delay)
                    guard !Task.isCancelled else { return }
                    self?.fire()
                }
            }
        }
    }

    /// The Continue button.
    func continueNow() { fire() }

    func cancel() { fire() }

    private func fire() {
        timer?.cancel()
        timer = nil
        waiting = false
        let c = continuation
        continuation = nil
        c?.resume()
    }
}
