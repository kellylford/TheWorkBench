# Great American Ball Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/greatamericanballpark/>.

A guide in words to Great American Ball Park, home of the Cincinnati Reds: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League Central.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `greatamericanballpark_sections.csv` | 157 sections, 13 columns — the primary dataset |
| `greatamericanballpark_layout.csv` | 21 seating zones — the layout overview |
| `greatamericanballpark_notes.md` | This file |

## Orientation

Section numbers increase from left field, around the third-base side, past home plate, along the first-base side and out to right field. Low numbers are the third-base and left-field side; high numbers are the first-base and right-field side.

Home-plate blocks by level:

- **Field Level - Diamond and Scout Seats (1-25):** sections 1–25
- **Lower Bowl (100s):** sections 122–126
- **Club Home (200s):** sections 220–228
- **Champions Club (300s):** sections 301–307
- **Mezzanine and View Level Box (400s):** sections 422–426
- **View Level (500s):** sections 521–525

**Dugouts and bullpens.** Reds (home) dugout: first-base side, fronted by lower-bowl sections 127–132. The Dugout Box seats directly behind it are rows F–J of 127–131. Visiting dugout: third-base side, fronted by sections 114–119. Reds bullpen is in left-centre field behind the wall; the visiting bullpen is in the right-field corner near the foul pole.

**Rows.** Rows are letters at this park, not numbers. Lower-bowl infield sections run A–Z and then continue AA–GG. Diamond Club sections 1–5 use A–I, Scout Seats 22–25 use A–H. Some sections start part-way through the alphabet because the rows in front are sold as a separate premium block — section 119 starts at F because A–E are Dugout Box.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next HIGHER section number; seat numbers count up toward the next LOWER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

119 sections are rated high confidence, 14 medium and 24 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Capacity is reported as 45,814 by the Reds and 42,319 seated by Wikipedia; the higher figure most likely includes standing room and group areas. Not reconciled.
2. The home-plate spans on the 400 and 500 levels are interpolated. Only 424 and 523 are explicitly documented as behind home plate; 422–426 and 521–525 are inferred around those anchors.
3. Redlegs Landing appears as a ticketed area in the venue index but no source states where it is.
4. Section 435's page contradicts itself, saying both "labelled A-F" and "only 5 total rows". Recorded as stated.
5. Seats per row is published for only two sections.

## Sources

- [Cincinnati Reds ballpark guide](https://www.mlb.com/reds/ballpark/information/guide)
- [Reds disability access guide](https://www.mlb.com/reds/ballpark/disability-access-guide)
- [RateYourSeats: Great American Ball Park](https://www.rateyourseats.com/great-american-ball-park)
- [A View From My Seat: Great American Ball Park](https://aviewfrommyseat.com/venue/Great+American+Ball+Park/)
- [Ballparks of Baseball: Great American Ball Park](https://www.ballparksofbaseball.com/ballparks/great-american-ball-park/)
