# Oriole Park at Camden Yards — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/oriolepark/>.

A guide in words to Oriole Park at Camden Yards, home of the Baltimore Orioles: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `oriolepark_sections.csv` | 163 sections, 13 columns — the primary dataset |
| `oriolepark_layout.csv` | 11 seating zones — the layout overview |
| `oriolepark_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side. Every series at the park runs that same way, and in the lower bowl the sweep carries on past the left-centre bullpens at 84–86 into the bleachers 90–98, which end up somewhere between centre and right-centre field.

Home-plate blocks by level:

- **Field Level (even) and Terrace Level (odd), 1&ndash;98:** sections 33–39
- **Upper Level (300s):** sections 330–342

**Dugouts and bullpens.** Orioles (home) dugout: first-base side, fronted by sections 22, 24 and 26, with row 1 of section 24 directly behind the bench. Visiting dugout: third-base side, fronted by sections 48, 50 and 52. Both bullpens sit beyond the wall in left-centre field, stacked in two tiers, a design this park introduced. Section 86 looks straight at them — a fan note says both pens lie to the left of that section — and 84–86 are named the Bird Bath. Which of the two tiers is the Orioles' is not stated by the source.

**Rows.** Rows are numbers on every tier. The entrance row is labelled EAL in the even Field Level sections and in bleachers 96 and 98, and it is the only lettered row in the lower bowl. Depth varies sharply: Field Level sections run to row 23, 27 or 29, the odd Terrace sections behind them are much shallower at 1 to 13 and only 1 to 6 in the behind-the-plate block 33–39, the Club Level runs 1 to 5 in sections 204–210 and 1 to 9 elsewhere, the left-field Club sections 268–288 run 1 to 6 with a lettered row A or TB that doubles as the entrance, and the Upper Level reaches row 25. There is no WC or other accessible row label. Accessible positions show up instead as a gap in the numbering — section 336 reads "1-5, 9-25", and the missing rows 6 to 8 are the wheelchair platform.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

93 sections are rated high confidence, 70 medium and 0 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. 2026 is a renovation year here, so older charts and figures are stale. Work begun after the 2025 season added a centre-field videoboard about two and a half times larger, a right-field wall display, new ribbon boards and a Premium Club behind home plate for about 380 people. Any seating chart, capacity figure or Club Level section list predating that work should be treated as out of date, and the capacity itself is given three ways — 42,455 scoped to 2026, 44,970 by the club and 45,971 by an older guide, which is the 2011 renovation figure.
2. The bleachers 90–98 are placed three different ways. The ticketing source has them in right-centre field below the main scoreboard, Wikipedia has them lining Eutaw Street beyond right field, and a third guide calls them centre-field bleachers. All three land somewhere in the centre to right-centre arc but no closer together than that, so no distance from home plate is stated for those five sections.
3. The ticketing source contradicts itself on sections 272–288. Its Club Level zone page puts "242-280 along the third base side", while the section pages from 272 upward call the same block the Left Field Club Level, overlooking left field. Sections 272, 274, 276, 278 and 280 are described both ways on the same site.
4. Club Level sections 232, 234, 236, 238 and 240 — the behind-the-plate stretch on older charts — are absent from the 2026 index, as are 224 and 266, with no explanation. The Premium Club appears to have taken that position over, but no source says so, and its own sections are given only as the range C31–C43, which may mean seven odd-numbered blocks or every number between. They are not enumerated here.
5. Row labels are letters in one source and numbers in another. The ticketing source prints all-numeric rows, plus the EAL entrance row, on every section page checked; an independent guide describes lettered rows beginning at AA and running A to CCC. Both cannot be current. The ticketing source is followed here.
6. The seat-1 rule rests on two guides and no official source. The ticketing source prints "when looking towards the field, lower number seats are on the right" on every page — the reverse of the sentence it prints at most parks — and sections 13, 54, 74, 76, 85 and 86 each add a statement of their own that agrees with it, on both halves of the park. Nothing contradicts it, but the Orioles publish no seat-numbering rule at all. Note that under this rule seat 1 is not always the home-plate end of the row.
7. Section 381 is the only odd number in an otherwise even 300 series and its rows start at 8 rather than 1. No source explains what it is. Upper Level sections 320, 338, 350, 358 and 366 publish row lists ending at 8 where every neighbour runs to 25, which is recorded as published rather than corrected.
8. The club publishes no list of accessible sections, so per-section accessible locations are unknown apart from the row gap visible in Upper Level sections such as 336. Standing room is sold but its locations are not stated anywhere, and the Coors Light Center Field Roof Deck carries no section identifiers.
9. Seats per row is published for only nine sections — 13, 54, 74, 76, 79, 85, 248, 262 and 326 — and several of those are counts for a single row rather than the whole section.
10. Gate letters conflict between the club's own pages: the accessibility guide names Gate G for the Family Wellness Rooms while the A-to-Z guide lists family gates as C, D and H. The compass orientation, centre field to the north-north-east, rests on one statement cross-checked against shade descriptions rather than on an official source.

## Sources

- [Baltimore Orioles ballpark A-to-Z guide](https://www.mlb.com/orioles/ballpark/information/guide)
- [Orioles disability access guide](https://www.mlb.com/orioles/ballpark/disability-access-guide)
- [RateYourSeats: Oriole Park at Camden Yards](https://www.rateyourseats.com/oriole-park)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Oriole+Park+at+Camden+Yards/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/camden-yards/)
- [Ballpark Digest: Oriole Park renovations for 2026](https://ballparkdigest.com/2025/06/18/oriole-park-renovations-unveiled-for-2026/)
