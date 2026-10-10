# Tropicana Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/tropicanafield/>.

A guide in words to Tropicana Field, home of the Tampa Bay Rays: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `tropicanafield_sections.csv` | 120 sections, 13 columns — the primary dataset |
| `tropicanafield_layout.csv` | 20 seating zones — the layout overview |
| `tropicanafield_notes.md` | This file |

## Orientation

Tropicana Field does not number one way round the bowl. Numbering starts at home plate and runs outward in both directions at once, split by parity: odd-numbered sections run down the third-base side and on into left field, even-numbered sections run down the first-base side and on into right field, and within each side the number rises with distance from the plate. The club states it in those words, and its own netting page proves it — the netted run is one unbroken list from 101 to 138 ending at the two foul poles, which the club places in sections 137 and 138 on opposite sides of the field. The all-odd SkyDeck above left field says the same thing again. The sections mirror about home plate; the seat numbers do not. Facing the field, seat 1 is on your left in every section of the ballpark — the ticketing source prints that on every page, and its own per-section answers confirm it on both halves, at even 126, 148, 150 and 210 and at odd 133 and 141 — so seat 1 is the end of the row nearest home plate in an even-numbered section and the end farthest from home plate in an odd-numbered one.

Home-plate blocks by level:

- **DEX Imaging Home Plate Club (HPC103-HPC108):** sections 103–108
- **100 Level (101-150):** sections 101–102
- **200 Level (203-224):** sections 203–204
- **300 Level and MaintenX SkyDeck (300-324, 341-355 odd):** sections 300–301

**Dugouts and bullpens.** The Rays dugout is on the first-base side, the even-numbered side, in front of sections 112–118, with the visiting dugout opposite in front of odd 111–117. Section 118 is described as sitting behind the Rays dugout and 111–117 as above the visitors'. The club, Ballparks of Baseball and the ticketing source all agree on the side. Both bullpens are in foul territory down the lines, in front of the seats rather than beyond the wall — the Rays' in front of even sections 128 and 130, the visitors' in front of odd 127 and 129. Anyone in those four sections has a bullpen between them and the field. Netting runs from home plate to the foul poles, which the club places in sections 137 and 138, and the club's netted list is every section from 101 to 138 — the whole lower bowl on both sides. Only the outfield sections 139–150 are outside it. The club adds that height and coverage vary by section, and its list uses plain numbers, so it says nothing about the letter-suffixed premium sections in front of them.

**Rows.** Rows are lettered everywhere at Tropicana Field. The lower bowl runs a single-letter series and then doubles — section 126 reads "A-Z, AA-JJ" — and the deeper down-the-line sections add a third block, "G-Z, AA-JJ, PP-XX". Where a section starts varies widely, at A, B, G, K, L or T, so do not assume a first row of A: the outfield sections 141–150 begin at row T, and the source confirms outright that row T is the row closest to the field in section 148. The 200 Level is a short tier of eight rows, A–H. The 300 Level runs A–Z and then on to DD, EE, JJ or NN depending on the section; the SkyDeck runs A–F or A–J; the Home Plate Club is D–J and The Baldwin Group Club PP–UU. Accessible positions are a row labelled WCH, appended after the last lettered row, so it is at the back of the section by the concourse rather than at the front, and it is often given as the entrance row as well. Entry is generally at the back — row JJ, KK, UU or WCH — and several corner and outfield sections list two entrances, one part-way down at row W and one at the rear.

## The seat-numbering rule

Section numbers here run outward from home plate by parity rather than sweeping one way round the bowl &mdash; odd numbers toward third base and left field, even numbers toward first base and right field &mdash; so the two halves of the park are mirror images. The seat numbering does not mirror:

> Facing the field, seat 1 is on your left, in every section of the ballpark.

Because of that, seat 1 is the end of the row farthest from home plate in an odd-numbered section and the end nearest home plate in an even-numbered one. The `seat_numbering` column in the CSV spells out the result for every section.

## Confidence

71 sections are rated high confidence, 49 medium and 0 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Whether the 300 Level is sold at all in 2026 is unresolved. The upper deck has been tarped and unsold since the 2019 reconfiguration that set capacity at 25,025, and the club's 2026 elevator list names no 300 Level stop — yet the club's own 2026 guide still lists a 300 Level among its levels and the ticketing source still serves live per-section pages for 300–324. No 2026-dated official statement was found either way, and both 2026 upgrade announcements are silent on it. There is precedent for opening parts of the upper deck for a single series, and the tarps are described as removable for the postseason. The sections are documented here and should be treated as unavailable for ordinary games unless the club says otherwise.
2. The 300 Level pages carry no zone name and no location text at all. Not one of the twenty-five pages says which side of the ballpark its section is on or names a tier: two reads of the section index labelled the group "Club Level" once and "Upper Deck" the other, and neither label appears on the pages themselves. The parity rule is nowhere quoted on this tier — it is carried over from the club's park-wide sentence, supported only by section 301 being described as a view from behind home plate. Seventeen of the pages also give the entrance row as row E identically, which reads as a template value rather than seventeen observations, and 324 as the last section is the weakest item in the whole section list.
3. The building was rebuilt after Hurricane Milton, and no source republishes the seating bowl. The roof was torn off in October 2024 and the Rays played 2025 in Tampa; five dated sources confirm the return, and the 2026 home opener was played here on 6 April. But the club states no 2026 capacity — 25,025 is a 2019 figure carried by everyone else — and nobody republished a section list after the rebuild, so if any section was added, merged or retired, no consulted source says so. No source consulted gives the ballpark's opening year either, which is why none is stated above.
4. The 200 Level has two names and two row counts. The ticketing source calls sections 203–224 the Press Level; the club's own guide lists a 200 Level, a Club Level and the Webull Suite Level, and never uses Press Level as a ticketed tier. On the same pages the zone text says these sections have seven rows, A–G, with row A closest to the field, while each section's own row line says A–H and puts the entrance at row H. Neither pair has been reconciled by any source.
5. The Baldwin Group Club is placed in three different spots by three sources. The ticketing source's zone page puts it at sections 106–126 along the first-base line, its own per-section pages say "just above the 100 Level seating", and the club's February 2026 article puts the club on the fourth floor. They may be describing a seating product and a lounge of the same name, but no source says so.
6. The premium identifiers are the ticketing source's URL forms, not necessarily what is printed on a ticket. The Home Plate Club sections are addressed as HPC103, HPC104, HPC107 and HPC108 but headed "Home Plate Club 103"; the Baldwin Group Club sections are addressed as 106C to 126C and headed "Rays Club 106". Note also that the Home Plate Club skips 105 and 106 altogether, and that plain-numbered sections 103, 104, 107 and 108 exist as well, one step back from them.
7. One "verified" answer for section 210 contradicts itself, saying the rows hold 22 seats and then that the last seat in each row is 24. Only the arithmetic is in doubt — the side is not, since it puts seat 1 on the left and the high numbers on the right, as everywhere else. Seats per row are not published for most of the park.
8. The obstruction range printed on the lower-bowl pages, rows VV–YY, runs past the last row several of those sections actually list, and the advice to avoid rows WW and XX is carried generically onto sections that have no such rows. The same zone text tells readers to "sit in an odd section for the best view of the scoreboard" on even-numbered pages, and says elsewhere that the outfield scoreboard cannot be seen from the even-numbered outfield sections at all.
9. Direct access to the ticketing source was blocked while this was compiled, so its quotes were read through a summarising tool. Short sentences repeated identically across many pages, so the parity rule, the seat-1 rule, the bullpens and the row labels are solid; the long section index is the item most exposed. The compass orientation is single-sourced — the batter facing roughly north-east — and in a domed park with no sun it drives nothing here.

## Sources

- [Tampa Bay Rays ballpark guide](https://www.mlb.com/rays/ballpark/information/guide)
- [Rays Tropicana Field accessibility guide](https://www.mlb.com/rays/ballpark/information/accessibility-guide)
- [Rays protective netting](https://www.mlb.com/rays/ballpark/netting)
- [RateYourSeats: Tropicana Field](https://www.rateyourseats.com/tropicana-field)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Tropicana+Field/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/tropicana-field/)
