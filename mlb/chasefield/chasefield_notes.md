# Chase Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/chasefield/>.

A guide in words to Chase Field, home of the Arizona Diamondbacks: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League West.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `chasefield_sections.csv` | 138 sections, 13 columns — the primary dataset |
| `chasefield_layout.csv` | 14 seating zones — the layout overview |
| `chasefield_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side. The lettered Field Level ring runs the same way, A at the first-base end and S at the third-base end. The bowl is a horseshoe broken at dead centre field by the 25-foot batter's-eye wall, so each series ends at the outfield rather than wrapping back round.

Home-plate blocks by level:

- **100 Level (100s):** sections 122–122
- **Club Level (200s):** sections 210–210
- **Upper Deck (300s):** sections 316–316

**Dugouts and bullpens.** Diamondbacks (home) dugout: third-base side, fronted by the lettered Dugout Box sections N–Q. This is the less common arrangement and is easy to get backwards, so it was confirmed against two independent sources. Visiting dugout: first-base side, fronted by lettered sections C–F. Rows behind both dugouts run 6 to 18, with row 6 closest to the bench, and the dugouts sit below field level so those seats look slightly down on the players. Both bullpens sit beyond the outfield fences at the foot of the two bleacher blocks — the visitors' in right field beside section 105, the Diamondbacks' in left field beside 139, each on the same side of the park as its own dugout. Whether either pen is raised or at field level is not stated.

**Rows.** Rows are numbers on the three numbered tiers. The 100 Level infield starts at row 21, because rows 1 to 20 belong to the lettered ring in front of it — sections 122 and 128 read "21-39, 40C-40W" — while the bleachers and corner sections start lower and run to about 40. The Club Level is short, mostly rows 1 to 11, and the 210A–210I sections behind the plate have no more than two rows each. The 300 Level runs long, to row 40 on the infield and 32 in the corners, and is entered near the front at row 4 rather than at the back. Field level mixes the two schemes: the Dugout Box sections C–F and N–Q run numbered rows 6 to 18, while the Clubhouse Box in G–M is limited to lettered rows A to F. Accessible rows are the same row number with a C or W suffix — 40C and 40W at the top of the 100 Level, 4C and 4W on the 300 Level, 1C and 1W on the Club Level. There is no WC label anywhere in this park.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

129 sections are rated high confidence, 4 medium and 5 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The netting extent is contradicted between sources. The ticketing source's fan feedback puts netting in front of sections 115–129; press reporting from 2019 and 2020 says the Diamondbacks carried it out to each foul pole, which would cover roughly 106–138 and the whole lettered ring. No current official netting diagram was retrievable and the fan note may simply be stale, so both are recorded.
2. Each behind-the-plate block rests on a single flagged section. Only 122 on the 100 Level and 316 on the 300 Level carry a home-plate note, so those single sections are the anchors here. The wider arcs — roughly 118–127 below and 314–318 up top — are inferred from the netting range and the flanking elevators, and 121, 123 and 315 are not individually sourced.
3. The lettered Field Level ring is documented at zone level only. Sections A to S were never fetched individually, so their rows, entry portals and seat-1 side rest on the park-wide pattern rather than their own pages. No source names a single letter as dead centre behind the plate: G–M is the sourced block and J is merely its arithmetic middle.
4. The field-level row scheme is mixed and only partly explained. The Clubhouse Box in G–M is stated as rows A to F and the Dugout Box in C–F and N–Q as rows 6 to 18, yet the ticketing source's own photo captions show a row G in sections A, B and R and a row M in G and L. How lettered and numbered rows coexist inside one section is not published.
5. Several sections have no per-section data at all: the wheelchair-suffixed 100W, 145W, 224W, 300W, 332W, AW, BW and RFW; the two "L" sections 214L and 215L, which the club's own mention of Limited Mobility seats would explain but which no source connects to it; and the nine Club Level sections 210A–210I, which are described as a block behind home plate and never singly.
6. The official ramp list contradicts itself. The same accessibility page gives the main-level ramp as across from section 111 in one list and across from section 110 in another. Both are recorded.
7. No source defines the C and W row suffixes. Reading W as the wheelchair row and C as the adjoining companion row fits every observation, including section 316's note that there is wheelchair seating between rows 4W and 8, but nothing states it, so this guide publishes the labels and not the expansion.
8. Seats per row is unpublished for all but five sections — 104, 307, 308, 319 and 326 — and three of those give a figure for a single row rather than the section.
9. The Club Level is stated to run 200–220, yet 221, 222 and 223 sell All You Can Eat seats on the same tier in the left-field corner and 224W exists with no description at all. Whether those four belong to the Club or Diamond Level is not stated.
10. Capacity is 48,330 against 48,633. The lower figure is used here; the higher one matches a published 2011–2014 number and is probably stale. A state-funded renovation programme was approved in September 2025, so names, section numbers and capacity are all liable to move.
11. The compass bearing is low confidence — one source says the park faces north and another north-east, and neither gives degrees. With the roof usually closed it rarely matters in practice.

## Sources

- [Arizona Diamondbacks ballpark guide](https://www.mlb.com/dbacks/ballpark)
- [D-backs access guide for guests with disabilities](https://www.mlb.com/dbacks/ballpark/information/ada)
- [RateYourSeats: Chase Field](https://www.rateyourseats.com/chase-field/seating)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Chase+Field/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/chase-field/)
