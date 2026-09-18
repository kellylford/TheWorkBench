# Fenway Park — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/fenwaypark/>.

A guide in words to Fenway Park, home of the Boston Red Sox: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `fenwaypark_sections.csv` | 273 sections, 13 columns — the primary dataset |
| `fenwaypark_layout.csv` | 20 seating zones — the layout overview |
| `fenwaypark_notes.md` | This file |

## Orientation

Fenway Park runs two numbering schemes at once, and which one applies depends on the tier. On the lower tiers — Field Box, Loge Box, Grandstand and Bleachers — the numbers sweep one way round the bowl: they rise from right field and the first-base side, past home plate, and on toward third base and left field. On the Pavilion tiers they do not sweep at all: they run outward from home plate by parity, with odd-numbered sections along the first-base line and even-numbered sections along the third-base line, so PC1 and PC2 are neighbours beside the plate on opposite sides of the diamond rather than next to each other.

Home-plate blocks by level:

- **Field Box (FB1&ndash;FB82):** sections 39–50
- **Loge Box (LB98&ndash;LB165):** sections 125–134
- **Grandstand (GS1&ndash;GS33):** sections 18–20
- **Dell Technologies Club (EMCC1&ndash;EMCC6):** sections 1–6
- **Aura Club (HPPC1&ndash;HPPC5):** sections 1–5

**Dugouts and bullpens.** The Red Sox dugout is on the first-base side, behind Field Box sections FB21–FB28; the visiting dugout is on the third-base side behind FB62–FB68. That is what fixes the direction of the lower-bowl sweep, and it agrees with the club's own netting endpoints. The Jim Beam Dugout, a sunken field-level area, sits just past the Red Sox dugout on the same side. Both bullpens are in right and right-centre field, side by side in front of the Bleachers — Fenway has no left-field bullpen at all, because the Green Monster occupies that ground. The visiting bullpen is stated to be in front of Bleachers B42 and B43; a fan report puts the Red Sox bullpen in front of B40, which would place it on the centre-field side of the pair. The Green Monster is the 37-foot left field wall, 310 to 315 feet from home plate, with about 250 seats added on top of it before the 2003 season. Those are sections M1–M10, three rows deep at most, plus a standing-room walkway. No source found states which end of the wall M1 sits at.

**Rows.** Row labelling changes from tier to tier and, at Fenway, from section to section within a tier, so the per-section row list below is the one to trust. Field Boxes use letters, generally up to row M where the main concourse walkway runs, but the premium Dugout Club rows sit in front of row A and are labelled numerically or with tripled letters — FB45 reads "A1, 2-3, A-M" and FB80 reads "AAA, A-L". Right Field Boxes and Loge Boxes use doubled letters, and the Loge zone claim of AA–NN is a generalisation only: LB98 runs DD–RR, LB130 AA–NN and LB165 JJ–PP. The Grandstand, the Bleachers, the Green Monster Seats and the Aura Pavilion Club use numbers, with row 1 at the front; bleacher depth varies enormously, from 1–10 in B34 to 1–50 in B42 and B43. Pavilion Box, Pavilion Reserved and Roof Box use letters from row A at the front. No source states an accessible-row label convention for this ballpark, so none is given here.

## The seat-numbering rule

**This ballpark uses two numbering schemes at once.** Most of it sweeps one way round the bowl toward third base and left field, but Aura Pavilion Club (PC1–PC14) and Pavilion Reserved (PR15–PR20) number outward from home plate by parity instead &mdash; odd numbers toward first base and right field, even numbers toward third base and left field. A section number therefore means something different depending on its tier.

> Facing the field, seat 1 is on your right.

Which end of the row that is relative to home plate changes from one half of the park to the other, and on the parity tiers between odd and even sections. The `seat_numbering` column in the CSV states the answer for every section.

## Confidence

267 sections are rated high confidence, 6 medium and 0 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The per-section boilerplate says seat 1 is on the left, and this guide does not follow it. The same sentence — "when looking towards the field/field/stage, lower number seats are on the left" — is printed byte-identically on every Fenway section page, so it carries no per-section authority. The same site's own Fenway seating-chart page says the opposite: "Seat Numbers at Fenway Park go from right-to-left." Four independent fan reports on three different tiers agree with the chart page and against the boilerplate. Loge Box 160: "There are 12 seats in the row with a railing at the right side of the row, so if you're in seat 1 you'll be climbing over quite a few people to get to the only aisle which is at the left side of the row (at Seat 12)." Grandstand 33: "Seats 5 and higher have far superior views, but put you further from the lone aisle which is at the right side of the row (at Seat 1)." Grandstand 27 puts the "left aisle (higher numbered seats)" and the reviewer "in a very good position at Seat 18", and Grandstand 18 describes a beam "just 4 seats in from the right aisle" with "Seats 1-4 seem to be safe but anything to the left will deal with the pole". Those four agree with each other and with the venue's own chart page, so this guide states seat 1 on the right throughout. They are fan reports rather than the source's own verified answers, which is a weaker kind of evidence than most parks in this set rest on, and it is the single item here most worth checking against your own ticket.
2. Right Field Box sections RFB87–RFB97 break the sweep. They are physically in right field beside the low-numbered Field Boxes, yet they carry numbers above FB82, which is at the opposite, left-field end of the park. Numbers 83–86 are absent from the index entirely and no source explains the gap. No distance from home plate is given for them, and no source states which end of the run — RFB87 or RFB97 — is nearer the infield.
3. Plain section numbers are reused across tiers and are ambiguous on their own. Numbers 1–14 exist simultaneously as Field Box, Grandstand, Monster, Aura Pavilion Club, Pavilion Box and Dell Technologies Club sections, and 34–43 as Field Box, Bleachers and Roof Box sections. The famous red seat marking Ted Williams' 502-foot home run is in Bleachers 42, row 37, seat 21, out in right field — not Field Box 42, which is behind home plate. Always carry the prefix.
4. Parity is stated for the Aura Pavilion Club and the Pavilion Reserved, and only inferred for the Pavilion Box and the Roof Box. The Aura Pavilion pages print the rule outright — "Odd-numbered sections run along the first base line", "Even-numbered sections run along the third base line" — and the Pavilion Reserved pages name the sides section by section in the same pattern. The Pavilion Box pages state no side at all, and the odd sections PB3, PB5 and PB7 are tagged "Top Pick for Visiting Team Fans", which would put them on the third-base side and invert the rule. The Roof Boxes are odd-numbered only and wholly on the first-base side, which is consistent with parity but is not a statement of it. Both tiers are therefore left out of the parity model, and no odd-or-even side is claimed for them here.
5. Several identifiers in the venue index have no per-section content. "Hornitos Cantina", "Roof Deck Tables", "Roof Deck SRO" and "Field Sections" are index links that resolve to zone pages with no section behind them, so they are not listed as sections; the first three are real baseball ticket types all the same. Loge Box 156 is missing between LB155 and LB157, and Pavilion Reserved 17 and 19 are missing although the zone page describes "Sections 15-20". No source explains any of these gaps. The six standing-room slugs do have pages, but they carry no rows, no seat numbers and largely identical text, so no seat-1 side is stated for them.
6. The club's own seating map was unreachable, so the section list rests on one source. The MLB.com Red Sox seating-map page returns a 404, and the accessibility page does too at its published address. Every section identifier here comes from RateYourSeats alone, uncorroborated by an official source apart from Field Box 9 and 79 on the netting page and the broad area names in the disability access guide. The 82-section Field Box series in particular has no official confirmation of its extent.
7. Three interior sponsor names are stale on that source. The section index still prints "State Street Pavilion Club" where the pages it links to are headed "Aura Pavilion Club", and the slug EMCC is the legacy EMC Club, now the Dell Technologies Club, whose own review text calls the sections DTC 1–DTC 6. The Aura Club sections are filed under the slug HPPC. The current names are used throughout this page and the slugs are kept as identifiers because they are what the underlying data is keyed on. The index's display labels are inconsistent in other ways too, printing bare "Section PB1" for some pavilion boxes and "Pavilion Box 11" for others.
8. The Grandstand home-plate block is the least certain anchor in the park. GS18–GS20 is derived from the GS20 page placing that section behind home plate, bounded by "Sections 1-6" on the first-base side and sections 23–33 on the third-base side; no source names the range outright, so the true block may be wider. Grandstand 1's own placement is likewise inferred, from its being one of the sections that catch late afternoon sun, rather than quoted.
9. Capacity is published as four different figures and no two agree: 37,775 by MLB.com in March 2026, 37,755 at night by Wikipedia, and 37,673 at night with 37,221 by day by Ballparks of Baseball. Because the centre-field bleachers are tarped for the batter's eye, no single number is fully correct.
10. Which bullpen is which is medium confidence. The editorial note states the visiting bullpen is in front of Bleachers 42 and 43; that the Red Sox pen is the centre-field one rests on a single fan review of Bleachers 40. No official source found says.
11. The Roof Box row description contradicts itself: "Each section includes eight rows labeled A through G", and A to G is seven letters. Neither figure is relied on here. Orientation rests on one textual source giving "northeast", corroborated only indirectly by shade behaviour and by the gate-and-elevator geography in the club's access guide.

## Sources

- [MLB.com Fenway Park guide](https://www.mlb.com/news/featured/fenway-park-guide-capacity-seating-chart-parking-and-more)
- [Red Sox disability access guide](https://www.mlb.com/redsox/ballpark/disability-access-guide)
- [Red Sox protective netting](https://www.mlb.com/redsox/ballpark/netting)
- [RateYourSeats: Fenway Park](https://www.rateyourseats.com/fenway-park)
- [Where&rsquo;s The Shade: Fenway Park](https://wherestheshade.com/stadium/fenway-park)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/fenway-park/)
