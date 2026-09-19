# T-Mobile Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/tmobilepark/>.

A guide in words to T-Mobile Park, home of the Seattle Mariners: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League West.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `tmobilepark_sections.csv` | 145 sections, 13 columns — the primary dataset |
| `tmobilepark_layout.csv` | 12 seating zones — the layout overview |
| `tmobilepark_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side.

Home-plate blocks by level:

- **Diamond Club (field level):** sections 25–35
- **Main Level and Bleachers (100s):** sections 127–132
- **Terrace Club (200s):** sections 224–236
- **View Level (300s):** sections 328–332

**Dugouts and bullpens.** Mariners (home) dugout: first-base side, fronted by sections 121–124. Visiting dugout: third-base side, fronted by sections 136–139. Both bullpens sit beyond the left-centre field fence, under the bleachers.

**Rows.** Rows are numbers on every level. What catches people out here is that many infield sections do not start at row 1 — they start at row 5, 9, 17 or even 23, because the rows in front belong to a different priced block. Section 108, for instance, is labelled rows 23 to 41.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

123 sections are rated high confidence, 18 medium and 4 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. No official capacity figure is published; sources range from 47,368 to 47,574.
2. No section-level wheelchair seating list is published.
3. A few sections publish self-contradictory row strings — 223, 227, 306, 308, 345 and 347 — and are recorded exactly as the source states them rather than tidied.
4. Seats per row is unavailable for many sections.

## Sources

- [Seattle Mariners ballpark guide](https://www.mlb.com/mariners/ballpark)
- [Mariners accessibility information](https://www.mlb.com/mariners/ballpark/accessibility)
- [RateYourSeats: T-Mobile Park](https://www.rateyourseats.com/t-mobile-park)
- [A View From My Seat](https://aviewfrommyseat.com/venue/T-Mobile+Park/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/t-mobile-park/)
