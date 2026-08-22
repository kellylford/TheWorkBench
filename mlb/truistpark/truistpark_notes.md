# Truist Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/truistpark/>.

A guide in words to Truist Park, home of the Atlanta Braves: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `truistpark_sections.csv` | 181 sections, 13 columns — the primary dataset |
| `truistpark_layout.csv` | 18 seating zones — the layout overview |
| `truistpark_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side.

Home-plate blocks by level:

- **Field Level (1-42):** sections 25–26
- **Lower Level (100s):** sections 125–126
- **Terrace Level (200s):** sections 226–226
- **Vista Level (300s):** sections 325–327
- **Grandstand Level (400s):** sections 425–427

**Dugouts and bullpens.** Braves (home) dugout: first-base side, fronted by field-level sections 17–21. Visiting dugout: third-base side, fronted by sections 31–35. One source gives 31–34, so treat the far end as approximate. Both bullpens sit beneath the Home Run Porch beyond the outfield wall — the Braves' below sections 153–154 and the visitors' below 144–145.

**Rows.** Rows are numbers everywhere at this park — no section uses lettered rows, though a few premium blocks carry prefixed labels, such as the Xfinity Club sections 222–230 reading "1-7, TB1-TB9". Depth varies sharply by tier: Truist Club sections have four rows, Lower Level sections run to about row 20, Terrace Infield sections about 19 with entry tunnels at the very top, Vista sections 7 to 13 and Grandstand sections 1 to 12.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

161 sections are rated high confidence, 12 medium and 8 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Eight sections have no row or seat-direction data at all. Section 250 is general admission and states outright that seats and rows are not assigned; sections 437, 438, 439, 440, 442, 443 and 444 have no row list published on their pages and are recorded as unknown rather than filled in from their neighbours.
2. The Lower Level home-plate anchor of 125–126 is a geometric estimate. The source names the Delta Sky360 block 122–130 as the behind-the-plate product but never names a single centred section on that tier.
3. The venue section index omits numbers that its own zone pages imply exist, among them 129, 221, 319, 321, 332, 419, 421 and 432. Only sections the index actually lists are documented here.
4. Capacity is reported as 41,084, 41,500 and 41,147 by different sources; no primary Braves figure was retrieved.
5. Bullpen and visiting-dugout extents disagree between sources — the Braves bullpen at 153–154 against 152–153, and the visiting dugout at 31–35 against 31–34.
6. The compass orientation could not be resolved. Two sources put centre field to the south-east and a third contradicts them outright, so no bearing is stated here.
7. Seats per row is not published for any section in the park.

## Sources

- [Atlanta Braves ballpark guide](https://www.mlb.com/braves/ballpark)
- [Braves disability access guide](https://www.mlb.com/braves/ballpark/disability-access-guide)
- [RateYourSeats: Truist Park](https://www.rateyourseats.com/truist-park)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Truist+Park/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/truist-park/)
