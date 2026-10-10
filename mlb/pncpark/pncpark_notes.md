# PNC Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/pncpark/>.

A guide in words to PNC Park, home of the Pittsburgh Pirates: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League Central.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `pncpark_sections.csv` | 136 sections, 13 columns — the primary dataset |
| `pncpark_layout.csv` | 18 seating zones — the layout overview |
| `pncpark_notes.md` | This file |

## Orientation

Section numbers increase from the right-field and first-base side toward the third-base and left-field side, then keep going around the outfield from left field through centre and back to right field — a full loop. Low numbers are the first-base side; the highest numbers come back around to right field.

Home-plate blocks by level:

- **Field Level (1-32):** sections 15–18
- **Lower Bowl (100s):** sections 116–117
- **Club Level (200s):** sections 216–219
- **Grandstand Level (300s):** sections 316–318

**Dugouts and bullpens.** The Pirates dugout is on the THIRD-base side — unusual in the majors, and deliberate, so the home team looks out over right field toward the downtown skyline. Field Level sections 20–24 front it. Visiting dugout: first-base side, fronted by Field Level sections 9–13. Both bullpens are beyond the left-centre field wall, stacked one behind the other, with the visiting bullpen nearer the field. The left-field Bleacher Reserved seats beside section 138 are closest.

**Rows.** Rows are letters at PNC Park, not numbers — confirmed on every level. Field Level sections run A–M. Lower Bowl Infield Box sections run A–Z and then double letters AA–KK; section 117 has 53 rows that way. Where a section starts at F rather than A, the rows in front are a separate premium block.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

125 sections are rated high confidence, 7 medium and 4 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Capacity is reported as 38,747 by MLB and 38,362 by other guides.
2. A number of section numbers are absent from the venue index (102, 104, 106, 111, 122, 126, 206, 215, 218, 224, 226, 229–234, 304, 306, 324, 326, 334). Sections 3 and 118 were spot-checked and confirmed not to exist; the rest were not individually verified.
3. The exact boundary between the left-field Bleacher Reserved run and the centre and right-field Outfield Reserved run on the 100 level is not stated.
4. The source applies a generic "behind the right field wall" blurb to sections 139–147 even though 139 sits in left-centre by the bullpens. Quoted as written, with the discrepancy noted on those sections.
5. Seats per row is published for only a handful of sections.

## Sources

- [Pittsburgh Pirates ballpark guide](https://www.mlb.com/pirates/ballpark/information/guide)
- [Pirates accessibility information](https://www.mlb.com/pirates/ballpark/accessibility)
- [RateYourSeats: PNC Park](https://www.rateyourseats.com/pnc-park)
- [A View From My Seat: PNC Park](https://aviewfrommyseat.com/venue/PNC+Park/)
- [Ballparks of Baseball: PNC Park](https://www.ballparksofbaseball.com/ballparks/pnc-park/)
