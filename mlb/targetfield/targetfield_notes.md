# Target Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/targetfield/>.

A guide in words to Target Field, home of the Minnesota Twins: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League Central.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `targetfield_sections.csv` | 149 sections, 13 columns — the primary dataset |
| `targetfield_layout.csv` | 23 seating zones — the layout overview |
| `targetfield_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side.

Home-plate blocks by level:

- **Dugout Box and Champions Club (1-17):** sections 7–10
- **Main Level (100s):** sections 112–115
- **Terrace Level (200s):** sections 214–216
- **View Level (300s):** sections 314–316

**Dugouts and bullpens.** Sections 132–135 are the Treasure Island Cove, under cover in right field. 136–138 are the Overlook, completely open-air. 139–140 are the Corona Porch down the right-field line. 128–131 are the left-field bleachers. Rain cover matters here — there is no roof. Many View Level sections state that rows 3 and above are covered; the Overlook states it is fully open.

**Rows.** Rows are numbers nearly everywhere, with WC rows interleaved into the numbering behind home plate rather than placed at one end — sections read like "1-24, WC-27, 25-WC" with the entrance at row WC. The exception is Champions Club sections 7 to 10, which use lettered rows A to M.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

133 sections are rated high confidence, 15 medium and 1 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Capacity is reported as 38,544 officially, with 39,021, 39,504 and about 40,000 elsewhere.
2. The compass bearing is reported as east by some sources and east-north-east by others.
3. Sections 235, 236 and 328 do not appear in the venue index and are not documented here.
4. The source's page for section 125 contradicts itself on which baseline it sits on; both statements are recorded rather than reconciled.
5. Sections 139 and 140 have no stated entrance row or seat direction.
6. Seats per row is not published for essentially any section.

## Sources

- [Minnesota Twins ballpark guide](https://www.mlb.com/twins/ballpark)
- [Twins accessibility information](https://www.mlb.com/twins/ballpark/accessibility)
- [RateYourSeats: Target Field](https://www.rateyourseats.com/target-field)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Target+Field/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/target-field/)
