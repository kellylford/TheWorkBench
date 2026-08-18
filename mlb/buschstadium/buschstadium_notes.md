# Busch Stadium — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/buschstadium/>.

A guide in words to Busch Stadium, home of the St. Louis Cardinals: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League Central.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `buschstadium_sections.csv` | 183 sections, 13 columns — the primary dataset |
| `buschstadium_layout.csv` | 23 seating zones — the layout overview |
| `buschstadium_notes.md` | This file |

## Orientation

Section numbers increase from right field, around the first-base side, past home plate, along the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side.

Home-plate blocks by level:

- **Field Level (100s):** sections 145–155
- **Loge and Redbird Club Level (200s):** sections 249–251
- **Pavilion Level (300s):** sections 347–353
- **Terrace Level (400s):** sections 447–450

**Dugouts and bullpens.** Cardinals (home) dugout: first-base side, fronted by Home Field Box sections 141–144. Section 141 sits directly behind it. Visiting dugout: third-base side, fronted by sections 156–159. Bullpens are beyond the outfield fence, under the bleachers. The Cardinals bullpen is in right and right-center beneath bleacher sections 107–109; the visiting bullpen is in left field.

**Rows.** Rows are mostly numbers, but the field-level infield uses a mixed scheme: lettered rows closest to the field, then numbered rows behind a cross-aisle. Section 141, for example, is labelled "F-L, 1-24" — row F is the front row, and a walkway separates row L from row 1. Read the row label on your ticket carefully at this park.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

172 sections are rated high confidence, 3 medium and 8 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Capacity is reported as 44,383 by one source and 43,975 by another; the Cardinals' own A-Z guide page returned a 404 and could not settle it.
2. The exact dead-centre behind-home-plate sections on the Terrace 400 level are not stated; 447–450 is the best-supported span but the source treats all of 441–454 as infield terrace.
3. Ford Plaza appears in the venue index but no source describes its location or level.
4. Seats per row is published for only a handful of sections.

## Sources

- [St. Louis Cardinals ballpark guide](https://www.mlb.com/cardinals/ballpark)
- [Cardinals access guide for guests with disabilities](https://www.mlb.com/cardinals/ballpark/accessibility)
- [RateYourSeats: Busch Stadium](https://www.rateyourseats.com/busch-stadium)
- [A View From My Seat: Busch Stadium](https://aviewfrommyseat.com/venue/Busch+Stadium/)
- [Ballparks of Baseball: Busch Stadium](https://www.ballparksofbaseball.com/ballparks/busch-stadium/)
