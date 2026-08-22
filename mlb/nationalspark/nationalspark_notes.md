# Nationals Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/nationalspark/>.

A guide in words to Nationals Park, home of the Washington Nationals: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `nationalspark_sections.csv` | 129 sections, 13 columns — the primary dataset |
| `nationalspark_layout.csv` | 14 seating zones — the layout overview |
| `nationalspark_notes.md` | This file |

## Orientation

Section numbers increase from left field, up the third-base side, past home plate, down the first-base side and out to right field. Low numbers are the third-base and left-field side; high numbers are the first-base and right-field side. This is the opposite of the other four parks in this division.

Home-plate blocks by level:

- **Main Level (100s):** sections 119–126
- **Mezzanine (200s):** sections 212–215
- **Gallery (300s):** sections 310–316

**Dugouts and bullpens.** Nationals (home) dugout: first-base side, fronted by sections 127–131, with 128–129 directly behind it. Row D is the first row behind the bench. Visiting dugout: third-base side, fronted by sections 114–118, with 116–117 directly behind it. Bullpens: one in left field in front of sections 101–102, the other in right field beside 138–139. Sit in row L or higher in left field to be behind rather than beside the pen.

**Rows.** Rows are letters on every level. The Main Level runs long alphabetic sequences that double up, A to Z and then AA to WW in the deepest sections, with A to U across the Diamond Club block 119–126. The Mezzanine runs A to P, the Right Field Terrace A to X, the Gallery A to J or A to L and the Upper Gallery A to N. The accessible convention here is a WC suffix on the section number rather than the row — section 114's accessible block is sold as 114WC.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next HIGHER section number; seat numbers count up toward the next LOWER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

106 sections are rated high confidence, 21 medium and 2 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Capacity is reported five different ways — 41,373, 41,565, 41,339, 41,313 and 41,888 at opening. The first is used here.
2. Which bullpen is on which side rests on a single source. No official Nationals page read states the sides, and section 100's own fan note places the visiting pen somewhere that does not sit cleanly with the rest.
3. Sections 222 and 236 belong to no zone in the venue's own zone pages. Their individual pages call them Right Field Terrace, which is the better answer but is unconfirmed.
4. The 200-level right-field range splits by parity and no source explains why. Even sections 222 to 236 are Right Field Terrace with rows A to X entered at row A; the odd sections between them are Mezzanine with rows A to P entered at row P.
5. The 400-level side assignment is unverified. The directly fetched pages for 401, 409, 416, 419 and 420 carry no first-base or third-base statement at all.
6. Row ranges conflict between the zone text and the individual pages on the 200 and 300 levels — A to J against A to L on sections 317, 318 and 320, and section 316 recommends rows H to L in a section it says ends at J. Both are recorded as published.
7. The lettered Terra Club sections A to E, the Diamond Club tables and the standing-room inventory appear in the venue index but have no per-section data, so they are not documented here.

## Sources

- [Washington Nationals ballpark guide](https://www.mlb.com/nationals/ballpark)
- [Nationals accessibility information](https://www.mlb.com/nationals/ballpark/accessibility)
- [RateYourSeats: Nationals Park](https://www.rateyourseats.com/nationals-park)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Nationals+Park/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/nationals-park/)
