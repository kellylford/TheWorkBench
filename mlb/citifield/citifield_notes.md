# Citi Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/citifield/>.

A guide in words to Citi Field, home of the New York Mets: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League East.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `citifield_sections.csv` | 176 sections, 13 columns — the primary dataset |
| `citifield_layout.csv` | 21 seating zones — the layout overview |
| `citifield_notes.md` | This file |

## Orientation

Section numbers increase from right field, up the first-base side, past home plate, down the third-base side and out to left field. Low numbers are the first-base and right-field side; high numbers are the third-base and left-field side.

Home-plate blocks by level:

- **Clover Home Plate Club (11-19):** sections 11–19
- **Field Level (100s):** sections 117–118
- **Excelsior Level (300s):** sections 317–321
- **Promenade Level (400s):** sections 413–417
- **Promenade Level (500s):** sections 512–517

**Dugouts and bullpens.** Mets (home) dugout: first-base side, fronted by sections 111–114, with the Hyundai Club sections just inside them. Visiting dugout: third-base side, fronted by sections 121–124. Both bullpens sit in right-centre field at Bullpen Plaza, beneath and in front of the Shea Bridge, with section 143 directly behind them. Which pen is the home pen is not stated by the source.

**Rows.** The Field Level mixes letters and numbers, with lettered rows A to E sitting in front of numbered row 1 in sections such as 107, 109, 110, 125, 126 and 128. The Clover, Excelsior and both Promenade tiers use numbers only. Depth falls sharply by tier — up to 39 rows at Field Level, no more than 12 on the Excelsior Level, five to eight on the 400 deck and 17 on the 500 deck. A park-wide accessible-row convention is not published; a WC suffix appears on a handful of sections, such as row 10WC in section 16 and row 5WC in sections 410 and 411, but it is observed rather than stated.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your left.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next HIGHER section number; seat numbers count up toward the next LOWER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

119 sections are rated high confidence, 57 medium and 0 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The seat-1 side is the largest open item at this park. The ticketing source states "when looking towards the field, lower number seats are on the left" identically on all 166 section pages. An independent guide states instead that "seat 1 in any row is closest to home plate". The two agree on the first-base and right-field side and invert each other on the third-base and left-field side. This guide follows the per-section source, which is corroborated by section 328's own question and answer describing a third-base-side row starting at seat 1 on the left, and by section 506's. The contradiction is real and unresolved.
2. Seats per row is missing park-wide. Only sections 328 and 506 publish a figure.
3. Entrance rows are not published for Excelsior Gold sections 314, 315, 316, 317, 321, 322, 323 and 324.
4. The Hyundai Club's section numbers conflict between sources: the ticketing source places the club at 115–120, while the club's own guide puts its first-base entrance at section 114 and its third-base entrance at 121, which are adjacent to that range rather than inside it.
5. The Excelsior home-plate anchor of 317–321 is derived from which pages carry a home-plate view note, not from a positional statement. The side is certain; the exact centred section is not.
6. Boilerplate is repeated across pages — the netting note describing sections 107–128 appears verbatim on the Clover pages 11–19, which are outside that range.
7. Which bullpen belongs to the home team is not stated by the source.

## Sources

- [New York Mets ballpark guide](https://www.mlb.com/mets/ballpark)
- [Mets accessibility guide](https://www.mlb.com/mets/ballpark/disability-access-guide)
- [RateYourSeats: Citi Field](https://www.rateyourseats.com/citi-field)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Citi+Field/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/citi-field/)
