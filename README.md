# The WorkBench

## Overview
The Workbench has small projects I’m working on. These may or may not be final or receive future development.
## Projects

### The Card Place
A landing page for the browser card games — pick a game and play. All of them are built to be
fully playable with a keyboard or a screen reader.

Every game, the landing page and the transport they share live under [`thecardplace/`][11]. They
were spread across the top level of this repository until they were not; the sections below name
them one at a time because they are separate games, but the directory is the unit that moves.

[Open The Card Place][5]

How the games are tested — what is covered, what is not, and what each suite exists because of —
is written up in [TESTING.md][7].

#### The Card Place for iOS

The same five games as a native SwiftUI app, played against the computer and entirely offline —
not a wrapper around the web pages. The rules and computer players are ported into a Swift
package with the same rules-oracle, invariant and hidden-information suites the browser games
have, and the screens are built for VoiceOver first: every card is a button that says what it is
and where it sits, every message goes through one announcement queue, and every part of a table is
a heading. It lives in [`thecardplace/ios/`](./thecardplace/ios/), and its README says how it is
built and how it meets WCAG.

### Euchre
Euchre for four, in two fixed partnerships, first to ten points. Play against three computer
opponents or open a table and play with other people; any empty seat is played by the computer, so
a table works with two people or four.

The interesting accessibility problem here is the left bower — the jack of the same colour as
trump, which becomes a trump card and stops being a card of its printed suit. A sighted player
absorbs that at a glance. So the game names both bowers wherever a card is read out, and while you
are bidding it tells you what your hand would be worth with the suit on offer as trump.

[View Project][9]

### Hearts
Hearts for four. Every heart is a point and the queen of spades is thirteen, and the lowest score
wins — which is the thing that catches new players out, so the game says it rather than assuming it.

[View Project][12]

### Spades
Spades for four in two fixed partnerships, with a bid made before a card is played. Missing the
contract costs the whole bid rather than the difference, and tricks taken over it fill a bag bin
that eventually costs a hundred — so the running bag count is text the same as everything else.

[View Project][13]

### Cribbage
Cribbage for two: pegging, fifteens, runs and the crib, scored to 121 on a board that reads as well
as it looks. Play the computer or open a table and play somebody else.

[View Project][10]

### Sheephead
The Wisconsin classic, also called Schafkopf, for three to six. Queens and jacks are trump, the
picker takes the blind, and the jack of diamonds is a secret partner nobody admits to. Any seat
nobody is sitting in is played by the computer, so a table works alone or with five other people.

How it was built — four review passes, and every place a reviewer contradicted the plan — is in
[PLAN.md](./thecardplace/sheephead-multiplayer/PLAN.md).

[View Project][8]

### The two originals: `Cribbage/` and `sheephead/`

Cribbage and Sheephead each began as a single-player game against the computer, and each was then
forked rather than rewritten, so that the working game could not regress while the networked one was
built. A CI guard still enforces that: a branch touching a fork and its original together fails.

The forks are the games now — they play the same alone, and other people can join — so The Card
Place links those, and these two are kept for reference rather than for playing. Each says so at the
top of its own page and asks search engines not to index it, because a page that does not say so is
indistinguishable from the live game.

[Cribbage, the original][6] · [Sheephead, the original][4]

## Other projects

### parallels-manager
A macOS application for managing Parallels Desktop virtual machines.

[View Project][1]

### win11arm-install
Windows 11 ARM installation scripts and resources.

[View Project][2]

## Getting Started

## Requirements

## Usage

## License
See [LICENSE][3] for details.

## Contributing
Contributions to existing projects are welcome. If you have a script, app or other contribution you want to share, it is also welcome. Put it in a separate directory specific to that code.

[1]:	./parallels-manager
[2]:	./win11arm-install
[3]:	./LICENSE
[4]:	./thecardplace/sheephead
[5]:	https://kellylford.github.io/TheWorkBench/thecardplace/
[6]:	./thecardplace/Cribbage
[7]:	./thecardplace/TESTING.md
[8]:	./thecardplace/sheephead-multiplayer
[9]:	./thecardplace/euchre
[10]:	./thecardplace/cribbage-multiplayer
[11]:	./thecardplace
[12]:	./thecardplace/hearts
[13]:	./thecardplace/spades
