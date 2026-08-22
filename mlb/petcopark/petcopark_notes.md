# Petco Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/petcopark/>.

A guide in words to Petco Park, home of the San Diego Padres: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League West.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `petcopark_sections.csv` | 132 sections, 13 columns — the primary dataset |
| `petcopark_layout.csv` | 16 seating zones — the layout overview |
| `petcopark_notes.md` | This file |

## Orientation

Section numbers do not sweep one way round the bowl. They run outward from home plate by parity: odd numbers go up the first-base side and on into right field, even numbers go down the third-base side and on into left field, so the two runs climb away from the plate at the same time and the low numbers on every tier are the ones behind the plate. The rule is stated outright by the club's own netting page, which names "Sections 111-115 on the first base side and Sections 112-116 on the 3rd base side", and again as a park-wide rule by Petco Park Insider. The lettered Premier Club A to L is the one exception — a single sweep from A at the third-base end to L at the first-base end, with F and G dead centre.

Home-plate blocks by level:

- **Field Level boxes (0-13):** sections 0–1
- **Field Level (100s):** sections 101–102
- **Toyota Terrace and Upper Box Outfield (200s):** sections 201–202
- **Upper Deck (300s):** sections 300–301

**Dugouts and bullpens.** Padres (home) dugout: first-base side, the odd-numbered side, fronted by sections 107 and 109, with row 8 in section 107 the first row behind it. The field-level First Base VIP Box sections 7, 9 and 11 sit beside it, in front of that block. Visiting dugout: third-base side, the even-numbered side, fronted by sections 108 and 110, with row 8 in section 108 the first row behind it. The Third Base Coach's Box is sold as sections 8 and 10; Petco Park Insider describes the same seats as the first three rows of 108 and 110, and no source reconciles the two descriptions. Both bullpens sit beyond the wall in left-centre field, stacked, with the visiting pen behind the Padres' since the 2013 alterations. Both are immediately beside section 134 at field level and below section 230 on the 200 level. Whether they lie left or right of section 134 is stated both ways by different sources.

**Rows.** Rows are numbers almost everywhere. Petco Park Insider states the general rule — "Section rows start at 1 (closest to the field) and radiate back consecutively" — but many sections do not start at row 1 and several are split by a mid-section walkway: section 101 runs 8–20, section 110 runs 5–22 then 26–46, and section 300 begins at row 5. Depth varies from 44 rows in the biggest Field Level sections to no more than 15 on the Toyota Terrace, three in section 13 and a single row in section 329. The handful of non-numeric labels are lettered front rows A and B ahead of row 1 in sections 126 and 128, a row "BRS" at the back of 128, an unexplained "1D" between rows 25 and 27 in section 115, "SRO" in The Point and the Agave Club's table and drink-rail rows. The accessible-row label convention is unknown — no source consulted states a WC-style suffix anywhere in this ballpark.

## The seat-numbering rule

**This ballpark does not have a single seat-1 side.** Section numbers run outward from home plate by parity rather than sweeping one way round the bowl &mdash; odd numbers toward first base and right field, even numbers toward third base and left field. The ticketing source's own per-section answers put seat 1 on your left in odd-numbered sections and on your right in even-numbered ones. Those are two descriptions of one rule:

> Seat 1 is the end of the row nearest home plate, and seat numbers count up away from home plate.

Note that this contradicts the boilerplate sentence the same source prints on every section page, which states a single side for the whole park and is correct on only one half of it. The per-section answers are followed here because they are specific, dated and mutually consistent. The `seat_numbering` column in the CSV spells out the result for every section.

## Confidence

96 sections are rated high confidence, 16 medium and 20 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The ticketing source's park-wide boilerplate contradicts its own per-section answers, and is wrong on half the ballpark. Every section page prints the same sentence, "when looking towards the field, lower number seats are on the right", with no variation anywhere. But seven of that source's own questions and answers, each marked verified in February 2026, split by parity: sections 123, 203, 207 and 211 — odd, so the first-base side and right field — put seat 1 on the fan's left, while sections 110, 112 and 310 — even, so the third-base side and left field — put it on the right, section 112 adding that this is the end "closer to home plate". Section 203's page carries both statements at once. Those seven answers are one rule, seat 1 is the end of the row nearest home plate, and Petco Park Insider states exactly that rule in words. This guide follows the seven; the boilerplate is recorded as contradicted, not reconciled, and it is the even-numbered half where the two happen to agree.
2. Twelve sections have no page of their own. Sections 0, 1, 2, 3, 4, 5 and 6 redirect to the Home Plate Club zone page, 7, 9 and 11 to the First Base VIP Box and 8 and 10 to the Third Base Coach's Box, so no row list, entrance row, seats-per-row figure or seat direction is published for any of them. What is recorded comes from the zone text and from fan data on A View From My Seat — seat tags, photo captions and comments — and several of those pages have no photographs at all. Section 224's own page exists but its row block is empty, and its fan reviews disagree, one citing a row A and another saying the section has only one row.
3. The single most centred section on a tier is named only at Field Level, where 101 and 102 are called the most centred of the 101–106 group. The pairs used for the other three tiers — 0/1, 201/202 and 300/301 — follow from the parity rule and from which pages carry a home-plate-view note, not from any statement, so distances counted outward from them may be a section out.
4. Numbers are missing from the runs and nobody explains them: there is no section 12, no 136, and no 232 or 234. Section 225 is listed by Petco Park Insider but not by the ticketing index. Section 314 certainly exists — it is on the club's own elevator list and has an A View From My Seat page — but it has no ticketing page, apparently because it is sold only with the Skyline Patio, so it is not documented here.
5. The lettered Premier Club A to L does not follow the parity rule, running instead as one sweep from A at the third-base end to L at the first-base end. Two non-official sources agree on that and no official one states it. Those twelve sections carry no per-section record and are not documented here, and neither are the named areas Gallagher Square, The Landing, The Point, the Rail Seats, the Agave Club, Coronado Club 206, 208 and 210 or Gallagher Chairman's Club A and B.
6. No official list of accessible or wheelchair sections exists for this ballpark, and no accessible-row label convention is published. The club's accessibility page also contradicts itself within a few lines, giving Guest Service Centers as 108, 131 and 303 and then wheelchair storage as 108 and 135.
7. Seats per row is published for six sections only — 112, 123, 203, 207, 211 and 310 — and each figure is for a single named row rather than the section.
8. Capacity of 39,860 counts fixed seats only. The same Ballparks of Baseball page that prints it still carries the 2004-era "42,000-seat ballpark" and "42,500 blue seats" figures in its narrative, and which bullpen lies to which side of section 134 is stated both ways by two sources.

## Sources

- [San Diego Padres ballpark guide](https://www.mlb.com/padres/ballpark)
- [Padres disability access guide](https://www.mlb.com/padres/ballpark/disability-access-guide)
- [Padres protective netting](https://www.mlb.com/padres/ballpark/netting)
- [RateYourSeats: Petco Park](https://www.rateyourseats.com/petco-park)
- [Petco Park Insider seating chart](https://www.petcoparkinsider.com/padres-seating-chart)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Petco+Park/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/petco-park/)
