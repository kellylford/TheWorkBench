# Angel Stadium — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/angelstadium/>.

A guide in words to Angel Stadium, home of the Los Angeles Angels: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League West.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `angelstadium_sections.csv` | 202 sections, 13 columns — the primary dataset |
| `angelstadium_layout.csv` | 15 seating zones — the layout overview |
| `angelstadium_notes.md` | This file |

## Orientation

Section numbers increase from the third-base and left-field side, past home plate, toward the first-base and right-field side. Low numbers are the third-base side; high numbers are the first-base side.

Home-plate blocks by level:

- **Field Level (100s):** sections 114–122
- **Terrace Level (200s):** sections 213–221
- **Club Level (300s):** sections 320–332
- **View Level (400s):** sections 418–421
- **Upper View Level (500s):** sections 519–522

**Dugouts and bullpens.** Dugout: the dugout sits in front of sections 110–112. Netting is stated in front of sections 110–126. The rock formation and waterfall sit beyond the left-centre field wall.

**Rows.** Rows are letters at every level of this park — there are no numbered rows. Field Level sections run AA and BB, then A to Z, with row A nearest the field and the entrance at row Z at the back. The letters I, O and Q are skipped. Club sections run A to H, View Level A to J, and the 500s A to R.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your left.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

181 sections are rated high confidence, 18 medium and 3 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Capacity is reported as 45,517 officially, 45,483 and 45,050 elsewhere.
2. Concert floor sections could not be verified — the ticketing venue page refused automated access, so no concert configuration is documented here.
3. Sections 214–220 are not sold as numbered seats; the Don Julio Club occupies that gap behind home plate on the Terrace Level.
4. Zone names are missing from the source for a handful of sections.

## Sources

- [Los Angeles Angels ballpark guide](https://www.mlb.com/angels/ballpark)
- [Angels accessibility information](https://www.mlb.com/angels/ballpark/accessibility)
- [RateYourSeats: Angel Stadium](https://www.rateyourseats.com/angel-stadium)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Angel+Stadium/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/angel-stadium/)
