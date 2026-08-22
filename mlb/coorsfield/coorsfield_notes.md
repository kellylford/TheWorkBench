# Coors Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/coorsfield/>.

A guide in words to Coors Field, home of the Colorado Rockies: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League West.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `coorsfield_sections.csv` | 139 sections, 13 columns — the primary dataset |
| `coorsfield_layout.csv` | 11 seating zones — the layout overview |
| `coorsfield_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side. All three numbered series run the same way and none is reversed. The Rockpile, 401–403, is a three-section block in straightaway centre field and takes no part in the sweep.

Home-plate blocks by level:

- **Lower Level (105-160):** sections 126–135
- **Upper Reserve Level (300s):** sections 330–331

**Dugouts and bullpens.** Rockies (home) dugout: first-base side, fronted by sections 121–125. Visiting dugout: third-base side, fronted by sections 136–140. Both bullpens sit behind the right-field fence, beside the landscaped rock, tree and fountain area. The Rockies' pen is the one immediately beside section 105, and Right Field Mezzanine sections 202–204 look straight down on both. Which pen is nearer the foul line, and whether the two are side by side or stacked, is not stated by any source.

**Rows.** Rows are mixed, and the pattern differs by tier. Lower Level sections run numbered rows from the field back and then a lettered block C to W behind them — section 130 reads "4-38, C-W" and section 142 "1-38, C-W" — with the entrance at row W, so fans enter at the top and walk down as far as 38 rows. The numbered rows do not all start at 1: 105 starts at 2 and 130 at 4. The Upper Reserve Level uses a split range, typically "1-5, C-W, 10-25", where rows 1 to 5 are Lower Reserved, rows 10 and above are Upper Reserved behind a walkway, and the entrance is at row 5 rather than at the top. Club Level sections are short, no more than 13 rows, with section 241 reading "1-10, W", and the Rockpile is benches. Accessible rows carry a WC label — section 142's own recommendation reads "rows 36-WC" — and on the upper level the platform sits between lettered row C and row 10 in sections 328 and 330. Beyond that, the accessible-row convention is not published.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your right.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

139 sections are rated high confidence, 0 medium and 0 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The section index is not a complete list of the sections that exist. The Club Level zone page gives the tier as 214–227 and 234–247, but 220, 224, 237 and 240 have no page; the 300 series likewise skips 320, 322, 324, 337, 339 and 341. Those ten numbers are probably real sections and are simply not documented here.
2. The six lettered Toyota Clubhouse sections A–F have no per-section data at all — no rows, no seat counts, and no statement of which end of the block is the first-base end. Only that they sit directly behind the plate within about six rows of the field is sourced, so no seat-1 side and no distance are stated for them.
3. The ruling that the Club Level never reaches home plate rests on one sentence. It is supported by the absence of 228–233 from the index and by the Legacy Club and PNC Press Club both sitting directly behind the plate on the tiers immediately above and below, but no official document says outright that 228–233 do not exist. If they do, the 200-level anchor would be about 230–231.
4. The netting range is contradicted. The club states the front of sections 112–147; the ticketing source's fan note says 122–139. The club's figure is used here and the narrower one is thought to predate the 2018 extension, but no source gives the current net height by section.
5. Capacity is reported four ways — 46,897 for the current fixed seating, 50,144 with standing room, and 50,398 from Ballparks of Baseball, which is the superseded 2012–2017 figure. The first is used here.
6. The exact centred section on each tier is medium confidence. The ticketing source calls 126–135 the behind-the-plate block, whose midpoint is 130.5, while the official netting run is symmetric about 129.5. Upstairs, both 330 and 331 carry the home-plate view note, and a shade guide instead describes the home-plate block as 330–335. The side is certain in both cases; the centre is not.
7. Club Level row labels conflict on a single page. The zone page recommends "Rows 8 and higher" for cover and then "Rows H and above", but the one club section with published labels, 241, reads "1-10, W" and has no row H. Unresolved.
8. No source states whether sections 101–104 exist; the index begins the series at 105 and a request for a 103 page redirects away. If they exist they would be further into right field than 105, which would not change the direction of the numbering.
9. The Mountain Ranch Club is described only as being on the 200 level in the right-field corner. The index gap at 210–213 is exactly where it would sit, but no source assigns it those numbers, so none are recorded.
10. The purple row marking one mile above sea level is described as the twentieth row of the upper deck. Because the 300-level labels are split into 1–5, C–W and 10–25, it is not established whether that means the row labelled 20 or the twentieth row counted from the front.
11. The seat-1 side rests on one source family. Twelve section pages state "when looking towards the field, lower number seats are on the right" identically, and a fan note on section 105 corroborates it by tying "the right side" to the bullpen, but no independent guide states any seat rule for this park.
12. Seats per row is published for only 27 of the 133 documented sections, and mostly as the zone-level "about 14 seats per row" rather than a count for the section in hand.

## Sources

- [Colorado Rockies ballpark guide](https://www.mlb.com/rockies/ballpark)
- [Rockies access guide for guests with disabilities](https://www.mlb.com/rockies/ballpark/disability-access-guide)
- [RateYourSeats: Coors Field](https://www.rateyourseats.com/coors-field)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Coors+Field/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/coors-field/)
