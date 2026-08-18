# Yankee Stadium — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/yankeestadium/>.

A guide in words to Yankee Stadium, home of the New York Yankees: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `yankeestadium_sections.csv` | 181 sections, 13 columns — the primary dataset |
| `yankeestadium_layout.csv` | 24 seating zones — the layout overview |
| `yankeestadium_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side. The club's own netting statement says as much — the net runs "between Section 011 on the 1st base/right field side of the Stadium and continues to Section 029 on the 3rd base/left field side". The same one-way sweep holds on every tier, and there is no odd/even split of the kind Petco Park and Dodger Stadium use.

Home-plate blocks by level:

- **Legends and Champions Suites (11&ndash;29):** sections 18–21
- **Field Level (103&ndash;136):** sections 118–121
- **Main Level and Bleachers (201&ndash;239):** sections 218–222
- **Terrace Level (305&ndash;334):** sections 318–322
- **Grandstand Level (405&ndash;434):** sections 419–421

**Dugouts and bullpens.** Which dugout is which is not settled, and this guide does not settle it. Ballparks of Baseball states "Home Dugout: First Base", a dugout-side listing at Event Ticket Center puts the Yankees in the first-base dugout, and the ticketing source's own Legends pages agree with them — "Sit in Sections 15-17 to be behind the Yankees' dugout, or choose 23-25 for the visitors' side", and 15–17 is the low-numbered first-base end. Against that, the same source prints on every Field MVP page that the 115–125 seats wrap "from behind the visitors' dugout to the home dugout", which read as an ordered sweep puts the visitors at the first-base end and the Yankees at third. Both readings are recorded; no club page states a side. Both bullpens are beyond the centre-field fence, flanking Monument Park rather than lying along the foul lines. The Yankees' pen is in right-centre, beside section 103 and in front of bleachers 201 and 202; the visitors' is in left-centre, beside section 136 and in front of bleachers 237 and 238, which look straight down into it. All of this comes from the ticketing source; no club page states bullpen sides. Protective netting spans the field-level ring only, from section 011 on the first-base side round to 029 on the third-base side. It stands 31 feet above the playing-field wall behind home plate at 018–021B, 11'-6" above the wall at 017B and 022 and behind the photo wells at 015A and 025, about 14 feet above the field at 014B–011 and 026–029, and 9 feet above the dugouts, retractable by up to three feet before games. The 100, 200, 300 and 400 level sections sit behind and above it.

**Rows.** Rows are numbered everywhere at this park, starting at row 1 at the front and counting back. Depth varies by tier: the field-level ring runs 1–9, Field Level sections to about 1–21, the Main Level to 1–22, the Bleachers 1–24, the Terrace 1–10 and the Grandstand 1–14, with the Audi Yankees Club at 1–3. The accessible row carries a letter suffix — 8WC on the Terrace and in the Delta Sky360 sections, 21W in the Bleachers — and on the Terrace a standing-room row 9SR sits behind it and doubles as the entrance. Entry is at the back of the section on most tiers, at row 10 in section 103, row 18 in 104 and row 24 in 201, but the Grandstand is entered near the front, at row 2.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

106 sections are rated high confidence, 72 medium and 3 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The dugout sides are genuinely disputed and are left unresolved here. Ballparks of Baseball ("Home Dugout: First Base"), a dugout-side listing at Event Ticket Center, and the ticketing source's Legends pages ("Sit in Sections 15-17 to be behind the Yankees' dugout, or choose 23-25 for the visitors' side") all put the Yankees on first base. The same ticketing source's Field MVP sentence, repeated on all of 115–125 and on the Legends pages beside it, says the zone wraps "from behind the visitors' dugout to the home dugout", which in a park whose numbers climb toward third base reads as the opposite arrangement. It may be describing extent rather than order. No club page states a side, so both readings stand.
2. Capacity is contradicted between sources. Wikipedia gives 46,537 for 2020 onward, within a year-stamped series; Ballparks of Baseball gives 50,287 with no year attached. No official 2026 figure was found. Both are recorded and neither is preferred.
3. The Field Level home-plate anchor is inferred, not stated. 118–121B comes from "Home Plate View" tags on 119, 120A, 120B, 121A and 121B, from the 115–125 infield wrap, and from the club's accessibility page grouping 118–121B as one run. Nothing says it in as many words, unlike the netting page for 018–021B and the section 418 page for 419–421.
4. Bleacher sections 235–238 publish no row, entrance or seat data at all. Their pages carry the zone review and the soccer supporters-section text but none of the row blocks every other page in the park carries, confirmed on two passes, so those four sections are recorded as unknown rather than filled in from their neighbours. Sections 201 and 239 are treated as Bleachers because they share the 1–24 row form and the centre-field obstruction language, but the source's own layout sentence names only 202–204 and 235–238.
5. The same sections are spelled two ways. The ticketing source writes the field-level ring without leading zeros (11, 18, 21B, 29) and the club writes it with them (011, 018, 021B, 029). This guide uses the ticketing form; a ticket may not match character for character.
6. The seat-1 rule is well evidenced on the numbered bowl but unverified on two products. The park-wide sentence "lower number seats are on the right" is corroborated by per-section statements at 103, 129, 136, 201, 233B, 308, 328 and 423 — both halves of the park, four tiers, no contradiction anywhere — but no per-section statement was found for the field-level ring 11–29 or for the Audi Yankees Club, so the rule is carried there on the boilerplate alone.
7. "Audi Club" is a club, not a bowl section. The ticketing source lists it among the sections, which is why it appears here; it is an enclosed suite-level room on the left-field line with rows 1–3, no entrance row and no seats per row published, and its own review calls it more restaurant than seating section.
8. No source consulted states a compass bearing for the ballpark, so none is given. A single rendering of the section 236 page calling the left-field bleachers west-facing was not confirmed as page text and is not relied on.
9. The accessible sections are not published in full. The club's outlet-equipped list is the best available proxy but is a list of sections with outlets, not a list of accessible sections, and companion-seat counts and accessible-seat totals are stated nowhere. The source also names the accessible seating platforms themselves as a source of obstructed views, alongside the foul poles at 107 and 132.
10. Bullpen sides rest on the ticketing source alone. Three of its statements — at sections 103, 136 and 237 — agree with each other and with the numbering direction, but no club page states them, and Wikipedia only says the Yankees' pen connects to Monument Park by a door.

## Sources

- [Yankee Stadium guide for guests with disabilities](https://www.mlb.com/yankees/ballpark/information/disabled-services)
- [Yankees protective netting](https://www.mlb.com/yankees/ballpark/netting)
- [RateYourSeats: Yankee Stadium](https://www.rateyourseats.com/yankee-stadium)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Yankee+Stadium/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/yankee-stadium/)
- [Wikipedia: Yankee Stadium](https://en.wikipedia.org/wiki/Yankee_Stadium)
