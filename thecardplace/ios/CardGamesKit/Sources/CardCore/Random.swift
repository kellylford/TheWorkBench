import Foundation

/// The one source of randomness an engine is handed.
///
/// Every deal and every cut goes through this, and it can be seeded, which is
/// what makes a whole game replayable in a test: the same seed produces the
/// same shuffle, so a bug report that carries the seed can be re-run. Unseeded
/// it wraps the system generator and is as random as the platform makes it.
public struct RandomSource: RandomNumberGenerator, Sendable {
    private var state: UInt64
    private let seeded: Bool

    /// System randomness.
    public init() {
        self.state = 0
        self.seeded = false
    }

    /// Deterministic. SplitMix64: small, fast, and good enough for a shuffle,
    /// which is all this has to be. Not for anything cryptographic.
    public init(seed: UInt64) {
        self.state = seed
        self.seeded = true
    }

    public mutating func next() -> UInt64 {
        guard seeded else {
            var g = SystemRandomNumberGenerator()
            return g.next()
        }
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// A uniform double in [0, 1), the shape the ported heuristics expect.
    public mutating func nextUnit() -> Double {
        Double(next() >> 11) / Double(1 << 53)
    }

    /// A uniform integer in the half-open range.
    public mutating func nextInt(below n: Int) -> Int {
        precondition(n > 0, "nextInt(below:) needs a positive bound")
        return Int(next() % UInt64(n))
    }

    /// True with the given probability.
    public mutating func chance(_ p: Double) -> Bool { nextUnit() < p }
}

extension Array {
    /// Fisher–Yates with the engine's own generator, so a seeded game shuffles
    /// the same way every time.
    public func shuffled(with rng: inout RandomSource) -> [Element] {
        var a = self
        guard a.count > 1 else { return a }
        for i in stride(from: a.count - 1, to: 0, by: -1) {
            let j = rng.nextInt(below: i + 1)
            if i != j { a.swapAt(i, j) }
        }
        return a
    }
}
