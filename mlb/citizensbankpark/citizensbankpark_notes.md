# Citizens Bank Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/citizensbankpark/>.

A guide in words to Citizens Bank Park, home of the Philadelphia Phillies: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `citizensbankpark_sections.csv` | 153 sections, 13 columns — the primary dataset |
| `citizensbankpark_layout.csv` | 14 seating zones — the layout overview |
| `citizensbankpark_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side. Straightaway centre field has no numbered sections, so the run ends at 148 rather than wrapping back round.

Home-plate blocks by level:

- **Field Level (100s):** sections 119–128
- **Club and Hall of Fame Club (200s):** sections 220–224
- **Lower Terrace (300s):** sections 319–322
- **Upper Terrace (400s):** sections 419–422

**Dugouts and bullpens.** Phillies (home) dugout: first-base side, fronted by sections 115–118. Visiting dugout: third-base side, fronted by sections 129–132. Both bullpens sit in right-centre field in a split-level stack directly below section 101. Which team occupies the upper deck is not stated by the source.

**Rows.** Rows are numbers on every tier — short up top, where Lower Terrace sections mostly run 1 to 8 and Upper Terrace 1 to 16, and long at field level, where several sections reach row 40. Many field-level sections do not start at row 1: sections 119–128 begin at row 21 or 24. Accessible seating carries a WC suffix on the last row number — row 37WC in sections 109, 111, 112, 139 and 143, row 34WC in 116, 117, 130 and 131, and row 21WC in 140, 144 and 147. Section 132 is the lone exception to the numbers-only rule, carrying lettered rows A and B ahead of row 1.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

127 sections are rated high confidence, 26 medium and 0 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The lettered field-level club sections A to G appear to run the opposite way to the numbered sections. A single source states that F and G sit closest to the Phillies on-deck circle and A and B closest to the visitors', which with the Phillies on first base would reverse the 101-to-148 sweep. It is uncorroborated, so no seat-1 rule is stated for those sections and they are not documented here.
2. Capacity is disputed — 42,901 against 43,035. The lower figure is used here; the higher one matches an older published number and is probably stale.
3. A multiyear renovation is in progress, so premium-area names, capacity and some section labels are moving targets.
4. The section-number gaps at 238–240, 311 and everything below 412 are unexplained. No source states whether those numbers do not exist, are suites, or are merely absent from the index.
5. Section 132 publishes lettered rows A and B ahead of row 1, the only lettered rows found anywhere in the park, contradicting the general numbers-only rule. It is recorded as published.
6. Six Lower Terrace sections — 318 and 323 to 326 and 330 — publish a row hint that exceeds their own stated row range. The stated range is used and the conflict is kept in the section notes.
7. The compass orientation is inferred rather than quoted, and the split-level bullpen assignment is not stated by the source.

## Sources

- [Philadelphia Phillies ballpark guide](https://www.mlb.com/phillies/ballpark)
- [Phillies disability access guide](https://www.mlb.com/phillies/ballpark/disability-access-guide)
- [RateYourSeats: Citizens Bank Park](https://www.rateyourseats.com/citizens-bank-park)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Citizens+Bank+Park/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/citizens-bank-park/)
