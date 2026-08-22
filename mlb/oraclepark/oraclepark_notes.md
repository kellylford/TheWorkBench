# Oracle Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/oraclepark/>.

A guide in words to Oracle Park, home of the San Francisco Giants: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League West.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `oraclepark_sections.csv` | 111 sections, 13 columns — the primary dataset |
| `oraclepark_layout.csv` | 7 seating zones — the layout overview |
| `oraclepark_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side. All three numbered series run the same way and none is reversed. The Promenade series then keeps going. It does not stop at the left-field corner but carries on round the outfield through the bleachers and closes the circle at the Outfield Arcade, so 145–152 are the one place in the park where a high number means right field. The Club and View levels run foul pole to foul pole and do not wrap.

Home-plate blocks by level:

- **Promenade Level (101-152):** sections 112–119
- **Alaska Airlines Club Level (202-234):** sections 213–218
- **View Level (302-336):** sections 313–318

**Dugouts and bullpens.** Giants (home) dugout: third-base side. Field Club sections 121–123 are stated to sit directly behind it and 122–124 to be near it, with a fan note giving row B of section 123 as the first row behind the bench. The same review also says 110–121 sit between the dugouts, which puts 121 in both places at once. Visiting dugout: first-base side, with Field Club sections 107–109 behind it and the sixteen-seat Dugout Box alongside. Both bullpens are behind the centre-field wall, one either side of The Garden, where they were moved for the 2020 season from foul territory. Only one source says which is which — the visitors' pen nearer Triples Alley in right-centre, the Giants' nearer left field — and standing-room terraces about three feet above them are built into the bleachers on both sides.

**Rows.** Rows are both letters and numbers, and on the Promenade and View levels the two run consecutively inside one section, letters at the front and numbers continuing behind them. On the Promenade infield the Field Club rows A to R sit in front of the numbered rows through sections 107–124, and the Audi Dugout Club's triple-letter rows AAA to DDD sit in front of those again in sections 112, 113, 115, 117, 119 and 121, so the numbered rows in that block start at 23 rather than 1. Sections 114, 116 and 118 have no lettered block at all and are numbers only, and the left-field corner sections 132–134 begin behind 131 and 135 rather than at the field, so they start at row 12 or row 28. The Bleachers and the Arcade are numbers, with oddities — section 140 reads "A, 0-26" and section 141 reads "A, 0-29, B-C", lettered at both ends of the sequence. The Club Level is letters only, row A first and row M the usual last. The View Level puts lettered View Box rows in front and numbered View Reserve rows behind, split by the entry tunnel. No accessible-row label convention is published anywhere in this park — no WC or equivalent suffix appears on any row list.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

109 sections are rated high confidence, 2 medium and 0 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The Promenade home-plate block is disputed by about three sections. The ticketing source flags a home-plate view on 112–119 and centres the arc between 115 and 116; the Giants' own pages put the behind-the-plate point at 118 and 119 four separate times; two row-AA fan notes put the Giants on-deck circle in front of 117 and 119, which would place the plate lower still. 112–119 is used here because it is the only reading stated as a range and the only one consistent with the dugout statements, but the conflict is not resolved.
2. Capacity is stated twice and differently. The Giants and Ballparks of Baseball both give 40,260; Wikipedia gives 41,331 for 2021 onward, against 41,915 before the 2020 fence move and 40,930 in 2000–01. 40,260 is used as the club's own figure.
3. The Club Level anchor rests on a thin base. The park-level research confirmed the home-plate flag on section 217 alone and recorded the true range as unknown; the per-section pass then found the same flag on 213 through 218 and explicitly not on 212 or 219, so 213–218 is used. The centred section itself is named by no source.
4. Eleven numbers have no page in the index: 111, 120, 201, 206, 301, 303, 306, 309, 316, 322 and 329. No source says whether they do not exist or are merely missing, though a second ticketing source does list 111. Section 316 falls inside the stated View Level home-plate range 313–318.
5. The netting range is stated twice and differently — the Giants' seat map says sections 101–135, the ticketing source says the front of 105–126. The official figure is preferred but the older note is still being served.
6. No baseball-configuration list of accessible seating locations was found on any official page. The only list that names sections — 123–131 except 128 and 130 — comes from a football-configuration review, so it is not recorded here as a baseball fact, and the widely quoted line about accessible rows at the top of most sections could not be verified word for word on the club's own site.
7. The seat-1 rule comes from one source family only. The sentence "lower number seats are on the right" was checked on twenty-four section pages across every tier and every part of the bowl with no variation, and two separate question-and-answer entries for sections 112 and 302 agree with it. No official Giants page states a seat rule at all, so there is no contradiction but no independent confirmation either.
8. Which bullpen belongs to which team is single-sourced to one 2020 news report. The official releases say only that the pens sit either side of The Garden. Pre-2020 text is still live on both sites — the Giants' pen in front of 126–128 and the visitors' in front of 105–106, both in foul ground — and neither describes the current arrangement.
9. The compass orientation is not stated by the club or by Wikipedia. Two other sources agree the batter looks east or east-south-east toward McCovey Cove, which makes the first-base side the shade side and the third-base line and outfield the sunny side, but "due east" and "ESE" are not the same bearing.
10. The View Level row labels contradict themselves. Sections 302 and 336 label rows "A-D, 1-18" yet give the entrance as row E, which is not in the range; 313 and 318 have a numbered row 0 and the other sections do not; and the two priced products, View Box and View Reserve, share the same section number but are listed as separate levels with VB and VR prefixes by the fan-photo source.
11. The Coors Light Silver Seats are placed in two different parts of the outfield — the Giants put them in section 145 of the Arcade in right field, the ticketing source puts them in deep centre field with a photo captioned right-centre. They may be the same place described from different angles; neither is preferred.

## Sources

- [San Francisco Giants ballpark A-Z guide](https://www.mlb.com/giants/ballpark/information/guide)
- [Giants accessible services](https://www.mlb.com/giants/ballpark/accessible-services)
- [Giants seat map and netting](https://www.mlb.com/giants/ballpark/seat-map)
- [RateYourSeats: Oracle Park](https://www.rateyourseats.com/oracle-park)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Oracle+Park/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/oracle-park/)
