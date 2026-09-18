# Comerica Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/comericapark/>.

A guide in words to Comerica Park, home of the Detroit Tigers: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League Central.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `comericapark_sections.csv` | 123 sections, 13 columns — the primary dataset |
| `comericapark_layout.csv` | 19 seating zones — the layout overview |
| `comericapark_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side.

Home-plate blocks by level:

- **Lower Level (100s):** sections 127–128
- **Upper Level (300s):** sections 327–328

**Dugouts and bullpens.** The Tigers dugout is on the THIRD-base side, fronted by sections 131–136. The visiting dugout is on first base, at 120–124. Both bullpens sit behind the left-field wall — the Tigers at 147–148 and the visitors at 149–150. Netting runs in front of sections 116–140, and the official statement describes a safety net running foul pole to foul pole.

**Rows.** Rows are mixed here, and the ADA convention is unusually clear: any row label ending in AC is the accessible row — you will see 33AC, 44AC, DAC, TAC and HHAC. Premium and outfield blocks use letters (A to F, A to Z then AA to GG, and HHH to KKK), while the main bowl uses numbers.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

113 sections are rated high confidence, 4 medium and 6 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The compass bearing is reported as south by some sources and south-east by others.
2. The ticketing source states the Tigers dugout fronts sections 131–136 while the discovery pass recorded 131–135. Both are within a section of each other.
3. Seats per row is not published for most sections.
4. Entrance rows are not published for sections 121–140 at all.

## Sources

- [Detroit Tigers ballpark guide](https://www.mlb.com/tigers/ballpark)
- [Tigers accessibility information](https://www.mlb.com/tigers/ballpark/accessibility)
- [RateYourSeats: Comerica Park](https://www.rateyourseats.com/comerica-park)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Comerica+Park/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/comerica-park/)
