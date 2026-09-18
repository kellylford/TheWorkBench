# Wrigley Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/wrigleyfield/>.

A guide in words to Wrigley Field, home of the Chicago Cubs: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League Central.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `wrigleyfield_sections.csv` | 194 sections, 13 columns — the primary dataset |
| `wrigleyfield_layout.csv` | 31 seating zones — the layout overview |
| `wrigleyfield_notes.md` | This file |

## Orientation

Section numbers increase from the left-field foul pole, around behind home plate, toward the first-base and right-field side. Low numbers are the third-base and left-field side; high numbers are the first-base and right-field side. This is the opposite of the direction used at several other parks, so do not carry a habit over.

Home-plate blocks by level:

- **Club Box Level (3-32):** sections 13–22
- **Field Box Level (100s):** sections 112–122
- **Terrace Level (200s):** sections 213–222
- **Upper Box (300s):** sections 315–318
- **Upper Reserved (400s):** sections 415–419

**Dugouts and bullpens.** Cubs (home) dugout: third-base side, the low-numbered side. Club Box sections 9–12 sit behind it. Visiting dugout: first-base side, fronted by Club Box sections 23–27. Both bullpens are under the bleachers, off the field of play, moved there before the 2017 season. The Cubs bullpen is under the left-field bleachers, the visiting bullpen under the right-field bleachers, both with windows.

**Rows.** Rows are numbers at Wrigley, not letters. Club Box runs rows 1–15; Field Box 1–15; Terrace rows 1–6 are Terrace Box and rows 7 and beyond are Terrace Reserved; Upper Box roughly 1–12; Upper Reserved roughly 1–9.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your left.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

140 sections are rated high confidence, 21 medium and 33 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The seat-1 side is not settled. RateYourSeats contradicts itself: its individual section pages say seat 1 is on the left facing the field, while its seating chart overview page says seat 1 is on the far right. This page follows the section pages, which is the more specific source, but the whole seat-1 rule above rests on it. Treat it as unverified and check your ticket.
2. Bleacher sections 536, 537 and 538 are grouped with the Bleachers by one source and labelled Upper Reserved by another. Their real location is not confirmed.
3. The left-field versus right-field split of bleacher sections 501–515 is inferred from the numbering direction, not stated directly.
4. Sections 516, 517 and 518 have no individual section page; the URLs resolve to a zone page, so no row data exists for them.
5. Seats per row is not published for any section at this park.

## Sources

- [Chicago Cubs ballpark guide](https://www.mlb.com/cubs/ballpark)
- [Chicago Cubs accessibility guide](https://www.mlb.com/cubs/ballpark/accessibility)
- [RateYourSeats: Wrigley Field](https://www.rateyourseats.com/wrigley-field)
- [A View From My Seat: Wrigley Field](https://aviewfrommyseat.com/venue/Wrigley+Field/)
- [Ballparks of Baseball: Wrigley Field](https://www.ballparksofbaseball.com/ballparks/wrigley-field/)
