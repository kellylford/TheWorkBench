# Progressive Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/progressivefield/>.

A guide in words to Progressive Field, home of the Cleveland Guardians: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League Central.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `progressivefield_sections.csv` | 178 sections, 13 columns — the primary dataset |
| `progressivefield_layout.csv` | 19 seating zones — the layout overview |
| `progressivefield_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side.

Home-plate blocks by level:

- **Field Level (100s):** sections 152–155
- **Upper Level (400s):** sections 452–452
- **Upper Level (500s):** sections 553–553

**Dugouts and bullpens.** Guardians (home) dugout: third-base side, fronted by sections 160–164. Section 162 notes row F is the first row behind it. Visiting dugout: first-base side, fronted by sections 140–146. Wheelchair seating behind row EE is stated for the home-plate sections 152–155.

**Rows.** Rows are letters here. Field Level sections run A to Z and then continue AA to HH, and infield sections often start mid-alphabet rather than at A because the rows in front belong to a different block. The 400 level runs A to F, the club A to T and the 500 level A to X.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

129 sections are rated high confidence, 46 medium and 3 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Capacity figures conflict: about 34,820 from one source and 34,631 from another.
2. The compass orientation could not be resolved — one shade source is self-contradictory and street geometry suggests the batter faces roughly north-east. Marked uncertain rather than stated.
3. No 300-level section is confirmed behind home plate; the behind-the-plate product at that tier is a named club rather than a numbered section.
4. One widely used stadium guide inverted both the dugout sides and the numbering direction for this park. This guide follows the sources that agree with each other and with the official netting and gate statements.
5. Seats per row is not published for essentially any section.

## Sources

- [Cleveland Guardians ballpark guide](https://www.mlb.com/guardians/ballpark)
- [Guardians accessibility information](https://www.mlb.com/guardians/ballpark/accessibility)
- [RateYourSeats: Progressive Field](https://www.rateyourseats.com/progressive-field)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Progressive+Field/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/progressive-field/)
