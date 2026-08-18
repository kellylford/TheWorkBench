# Rogers Centre — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/rogerscentre/>.

A guide in words to Rogers Centre, home of the Toronto Blue Jays: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `rogerscentre_sections.csv` | 155 sections, 13 columns — the primary dataset |
| `rogerscentre_layout.csv` | 13 seating zones — the layout overview |
| `rogerscentre_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side. All four numbered series run the same way, and none of them wraps back round the outfield — the 100 Level stops at 148 in left field rather than carrying on into right. The lettered sub-sections are front and rear halves of one numbered section, the A half nearer the field and the B half behind it, so 144A and 144B are both section 144 and both sit on the same tier as a bare number would.

Home-plate blocks by level:

- **Field Level clubs (1-32):** sections 21–26
- **100 Level (101-148):** sections 122–126
- **200 Level (204-244):** sections 221–227
- **500 Level (508-540):** sections 522–526

**Dugouts and bullpens.** Blue Jays (home) dugout: third-base side, with field-level Banner Club sections 29–32 directly behind it and 100 Level sections 129 and 131 stated to be just above it. Visiting dugout: first-base side, with field-level sections 16–19 behind it and the Blueprint Club 16–22 just behind that. Row 8 is given as the first row behind the visiting dugout in section 118. Both bullpens are beyond the outfield wall, raised and ringed by seating since the first phase of the renovation — the Blue Jays' in left field in front of sections 142–144B, the visitors' in right field near 103A and 103B, with Schneiders Porch and The Catch Bar looking down on it.

**Rows.** Rows are numbers at every tier, but the 100 Level adds a letter at the back and several of its sections do not start at row 1. Sections 113, 122 and 126 read "1-36, A" or "1-15, A" with the entrance at row A, while 116 and 132 read "1-6, 7-40, 41D" and 118, 119, 129 and 130 end at a D-suffixed row; sections 108, 109, 110, 139, 140 and 141 begin at row 22, 21, 7, 12, 22 and 32 respectively, and 111 puts a lettered row F in front of everything else. The field-level clubs are shallow — five rows in 1–5, eight in 20–28 and eleven in 16–19 and 29–32, with no entrance row published for any of them. The 200 Level runs seven to thirteen rows and enters at the last row; the 500 Level runs thirteen to thirty-seven and enters at row 5, near the front, the opposite way round. Accessible rows are labelled WCA and are the entry row where they appear, in sections 102B, 111, 112 and 207 — and sections 131 and 147B give WCA as their entrance without listing it among their rows.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

62 sections are rated high confidence, 92 medium and 1 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The seat-1 rule is the least corroborated thing on this page, and one section flatly contradicts it. The only statement available is the ticketing source's park-wide boilerplate, "when looking towards the field/ring/stage, lower number seats are on the right", printed identically on every Rogers Centre section page checked and absent altogether from two of them. Across all 155 sections not one page carries a plain per-section answer naming seat 1's aisle for a baseball game, so the boilerplate cannot be tested the way it can at other parks. The one answer that bears on it directly, on section 524A and stamped Verified Feb 2026, says the opposite: row 15 seat 9 is "the 9th seat in from the aisle on the left side of the section (as you face the field)", which puts seat 1 on the left. That answer is about a concert and is a single data point, and the only other text naming seat 1 — section 239's answer that the right-hand half of that section starts at seat 1 on its aisle — agrees with the boilerplate. "Right" is kept here because one contradiction does not overturn a rule found everywhere else, but it is a real contradiction and it is not resolved. Check the seat numbers on your own ticket.
2. The 2023–24 renovation renumbered the seating and no source publishes an old-to-new map. Phase one rebuilt the outfield for 2023 and phase two demolished and rebuilt the entire lower-level seating structure for 2024. The field-level club series 1–5 and 16–32 and the A/B outfield sub-sections did not exist beforehand. The club's own netting page still cites suffixes that no longer exist, giving the endpoints as sections 113C and 130C, and the ticketing source still serves a question-and-answer describing 113 and 130 as splitting into 130A, 130B, 130C and so on — while the same page, stamped Verified Feb 2026, gives section 130 a single undivided row series with one entrance. C and D suffixes appear nowhere in the current index. Any pre-2023 seating source is unusable here for section identifiers.
3. Capacity is 39,150 against 41,500 and there is no club figure at all. Wikipedia dates 39,150 to after phase two and 41,500 to after phase one; Ballparks of Baseball prints 41,500 as current, though its own prose ties that number to the phase-one upper-deck reseating, so it looks one phase stale. Neither figure is confirmed by the Blue Jays, whose ballpark pages state no capacity.
4. The netting range is stated twice and differently — the club's "to Sections 113C & 130C" against the fan-reported "front of sections 117-126 are behind the netting". The official statement predates the rebuild and uses dead identifiers; the fan note is narrower and unofficial. No post-renovation official netting statement was found.
5. Numbers missing from the index, which no source explains: 6–15 between the TD Lounge and the Blueprint Club, 106 and 107, 208 and 209 — though the club's own elevator table names section 208, so that one does exist — and 501–507. The sub-section suffixes are uneven too: 104 and 104B appear with no 104A, 142 and 143 have no A/B split while 144–148 all do, and 23, 224 and 524 each appear both bare and with A and B halves.
6. Two pages disagree about where the 23 series is. The section 23A page assigns it to the Blueprint Club behind the visiting dugout on the first-base side, while the 23 and 23B pages put the 23 series in the Banner Club behind home plate. The 23A page never names 23A in its own location sentences, so the club text may simply have bled onto it, but neither reading is adopted here.
7. Section 126 is placed in two incompatible ways. Its own page and the site's best-seats list put it behind home plate, but the section 131 page carries "row 8 is the first row behind the Blue Jays dugout in Section 126", and that dugout is on the third-base side by every other source. The same list stops at 125 where the anchor used here runs to 126, and section 126's page recommends rows 32–37 when its own row labels stop at 15 and A. Section 113 has the same fault, an insight citing rows 36–40 against a row list ending at 36 and A.
8. W 11 is carried because the index lists it, and nothing else about it is known. Its page is a stub with no rows, no entrance, no level and no seat-numbering text of any kind, so every column for it is blank. The fan-photo source spells it W11, calls it accessible seating and ties it to Club 328 on the 300 Level, while the ticketing source's accessible page suggests a W prefix relates to section 111 on the 100 Level; the two point at different parts of the building. A bare "General Admission" entry in the same index has no geometry at all and is not carried here.
9. The internal order of the TD Lounge, sections 1–5, is not stated anywhere. The 16–32 series is well attested as increasing toward third base, but 1–5 are a physically separate strip and no source says which end of it is section 1, so no distance is offered for those five.
10. The compass bearing rests on one source, which says the batter faces north, making the first-base side the sunny side and the third-base side the shade side. Neither the club nor Wikipedia states a bearing, and that same source's section numbers are pre-renovation and were not used. With a retractable roof, no source publishes which sections are covered when it is closed, so no coverage rule is given.
11. Seats per row is not published for any section in the park. Two 200 Level answers describe sections splitting into L and R halves on real tickets, with the left half numbered from 101 — but the section 230 and section 239 answers put that 101 series on opposite sides of the aisle, and no such split is documented for any other tier. The pages for 104B and W 11 carry no seat-numbering text at all.

## Sources

- [Toronto Blue Jays ballpark A-Z guide](https://www.mlb.com/bluejays/ballpark/information/guide)
- [Blue Jays know before you go](https://www.mlb.com/bluejays/ballpark/know-before-you-go)
- [Blue Jays netting](https://www.mlb.com/bluejays/ballpark/netting)
- [RateYourSeats: Rogers Centre](https://www.rateyourseats.com/rogers-centre)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Rogers+Centre/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/rogers-centre/)
