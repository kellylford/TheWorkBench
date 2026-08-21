# The WorkBench

## Overview
The Workbench has small projects I’m working on. These may or may not be final or receive future development.
## Projects

### The Card Place
A landing page for the browser card games — pick a game and play. All of them are built to be
fully playable with a keyboard or a screen reader.

[Open The Card Place][5]

How the games are tested — what is covered, what is not, and what each suite exists because of —
is written up in [TESTING.md][7].

### Euchre
Euchre for four, in two fixed partnerships, first to ten points. Play against three computer
opponents or open a table and play with other people; any empty seat is played by the computer, so
a table works with two people or four.

The interesting accessibility problem here is the left bower — the jack of the same colour as
trump, which becomes a trump card and stops being a card of its printed suit. A sighted player
absorbs that at a glance. So the game names both bowers wherever a card is read out, and while you
are bidding it tells you what your hand would be worth with the suit on offer as trump.

[View Project][9]

### Cribbage
The classic two-hander against the computer, scored to 121.

[View Project][6]

### cribbage-multiplayer
A fork of the above, extended so two people in different places can play each other. It exists as a
separate directory so the stable game cannot regress while it is built — a CI guard fails the build
if a branch touching this directory also touches `Cribbage/`.

The interesting part is what did not survive the move to a server: the computer used to read your
hand while deciding what to lay, the count reset lived in the browser rather than the engine, and
the discard was a single function call that moved both players at once. All three are written up in
its README.

[View Project][10]

# 
## parallels-manager
A macOS application for managing Parallels Desktop virtual machines.

[View Project][1]

### win11arm-install
Windows 11 ARM installation scripts and resources.

[View Project][2]

### sheephead
A fully keyboard and screen reader accessible Sheephead card game for 3 to 6 players, played
against computer opponents. Runs entirely in the browser with no build step and no dependencies.

[View Project][4]

### sheephead-multiplayer
A fork of the above, being extended so people in different places can play against each other. It
exists as a separate directory so the stable game cannot regress while it is built — a CI guard
fails the build if a branch touching this directory also touches `sheephead/`. Not finished; see
[PLAN.md](./sheephead-multiplayer/PLAN.md).

[View Project][8]

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
[4]:	./sheephead
[5]:	https://kellylford.github.io/TheWorkBench/thecardplace.html
[6]:	./Cribbage
[7]:	./TESTING.md
[8]:	./sheephead-multiplayer
[9]:	./euchre
[10]:	./cribbage-multiplayer