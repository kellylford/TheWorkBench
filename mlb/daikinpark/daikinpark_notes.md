# Daikin Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/daikinpark/>.

A guide in words to Daikin Park, home of the Houston Astros: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League West.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `daikinpark_sections.csv` | 142 sections, 13 columns — the primary dataset |
| `daikinpark_layout.csv` | 15 seating zones — the layout overview |
| `daikinpark_notes.md` | This file |

## Orientation

Section numbers increase from left field, up the third-base side, past home plate, down the first-base side and out to right field. Low numbers are the third-base and left-field side; high numbers are the first-base and right-field side.

Home-plate blocks by level:

- **Field Level (100s):** sections 118–120
- **Club and Mezzanine (200s):** sections 219–221
- **Terrace Level (300s):** sections 319–321
- **Upper Deck (400s):** sections 419–421

**Dugouts and bullpens.** Astros (home) dugout: first-base side, fronted by sections 122–126. Visiting dugout: third-base side, fronted by sections 112–116. The Crawford Boxes are sections 100–104 — the short porch in left field, close to the wall and a magnet for home runs.

**Rows.** Rows are numbers at this park. Infield sections generally start at row 5 rather than row 1, because the rows in front are sold as a separate premium block; outfield sections start at row 1.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your left.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

119 sections are rated high confidence, 18 medium and 5 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Capacity is reported as 40,963 by the Astros and 41,168 by Wikipedia.
2. One guide reverses the dugouts; three independent sources place the Astros on first base and the visitors on third, which is what this page follows.
3. Seats per row is not published for most sections.
4. Zone names are missing from the source for a handful of upper-deck sections.

## Sources

- [Houston Astros ballpark guide](https://www.mlb.com/astros/ballpark)
- [Astros disability access guide](https://www.mlb.com/astros/ballpark/disability-access-guide)
- [RateYourSeats: Daikin Park](https://www.rateyourseats.com/daikin-park)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Daikin+Park/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/minute-maid-park/)
