# loanDepot park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/loandepotpark/>.

A guide in words to loanDepot park, home of the Miami Marlins: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `loandepotpark_sections.csv` | 107 sections, 13 columns — the primary dataset |
| `loandepotpark_layout.csv` | 9 seating zones — the layout overview |
| `loandepotpark_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side.

Home-plate blocks by level:

- **Promenade Level (1-40):** sections 13–18
- **Vista Level (300s):** sections 311–318

**Dugouts and bullpens.** The dugout sides are genuinely disputed. Ballparks of Baseball and the ticketing source's Promenade Infield review put the Marlins on the third-base side, fronted by sections 19–21, with the visitors at 8–10. The same ticketing source's Dugout Club page says the opposite. The club's own guide names the dugout clubs without assigning teams, so this guide does not settle it. Bullpens beyond the outfield walls — one behind the left-field fence at sections 29–31, the other in right field beneath the Home Run Porch at 38–39. Which pen belongs to which team is contradicted between the expert review and the fan notes on the very same pages. Netting stands 30 feet high at the ends of each dugout and tapers down each foul line, reaching the end of section 3 in right field.

**Rows.** Rows are mixed and vary by section. Promenade infield sections usually run lettered rows in front of numbered ones — sections 12 and 18 read "A-E, 1-27" — while some corner sections are numbers only and do not start at 1, as section 1 does at row 9. The Legends Level is numbers only and no more than ten rows deep, and the Dugout Club uses rows AA to DD. Accessible rows are labelled WC and sit at the top of the section, doubling as the entrance.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

96 sections are rated high confidence, 11 medium and 0 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Which side the home dugout is on is not settled. Three sources put the Marlins on third base and one puts them on first. The club's own guide declines to say. Both readings are recorded rather than reconciled.
2. The Bullpen Bar & Grill sells its own "sections 1-3", which collide by number with lower-bowl sections 1–3 down the right-field line. A ticket reading section 2 could mean either.
3. The lower-bowl wrap is medium confidence. Two sources place sections 34–40 in right field beneath the Home Run Porch; an older review from the same ticketing source calls 38–39 left field.
4. Bullpen ownership is contradicted within single pages — the expert review and the fan notes on the same section disagree about which team warms up where.
5. Fourteen field-level premium sections labelled FL1 to FL16 appear in the venue index but carry no per-section data, and FL12, FL13, lower-bowl 33 and 37, Legends 212–218 and Vista 301 do not exist at all.
6. Capacity is 37,442 against a seated-only figure of 36,742, and no source states which compass direction the batter faces.
7. Seats per row is not published for any section in the park.

## Sources

- [Miami Marlins ballpark guide](https://www.mlb.com/marlins/ballpark)
- [Marlins disability access guide](https://www.mlb.com/marlins/ballpark/disability-access-guide)
- [RateYourSeats: loanDepot park](https://www.rateyourseats.com/loandepot-park)
- [A View From My Seat](https://aviewfrommyseat.com/venue/loanDepot+park/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/loandepot-park/)
