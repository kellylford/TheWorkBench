# Rate Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/ratefield/>.

A guide in words to Rate Field, home of the Chicago White Sox: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League Central.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `ratefield_sections.csv` | 133 sections, 13 columns — the primary dataset |
| `ratefield_layout.csv` | 12 seating zones — the layout overview |
| `ratefield_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side.

Home-plate blocks by level:

- **Lower Level (100s):** sections 130–134
- **Club Level (300s):** sections 328–336
- **Upper Level (500s):** sections 529–535

**Dugouts and bullpens.** White Sox (home) dugout: third-base side, fronted by sections 137–142. Visiting dugout: first-base side, fronted by sections 122–127. Scout Seats are the premium block closest to the plate, labelled 130S, 131S, 133S and 134S — the S suffix matters when you read a ticket.

**Rows.** Rows are numbers here, with two wrinkles. Many Lower Level sections end in a row labelled WCH, which is the wheelchair-accessible row, and some sections (112–119, 147–150, 152) begin with a row labelled AA ahead of row 1.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

109 sections are rated high confidence, 20 medium and 4 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The 300 and 500 series full extents differ between sources: one guide lists 301–359 and 501–559 while the ticketing source lists only the subsets documented here.
2. Sections 330 and 334 have no stated entrance row or seat direction; their row range is only implied by a general Club Level line about five rows.
3. Sections 516 and 548 each state rows labelled 6–21 while also stating an entrance at row 1. Both are recorded exactly as published rather than reconciled.
4. No concert configuration is documented.

## Sources

- [Chicago White Sox ballpark guide](https://www.mlb.com/whitesox/ballpark)
- [White Sox accessibility information](https://www.mlb.com/whitesox/ballpark/accessibility)
- [RateYourSeats: Rate Field](https://www.rateyourseats.com/rate-field)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Rate+Field/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/guaranteed-rate-field/)
