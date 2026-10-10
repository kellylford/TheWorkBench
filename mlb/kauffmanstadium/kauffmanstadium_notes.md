# Kauffman Stadium — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/kauffmanstadium/>.

A guide in words to Kauffman Stadium, home of the Kansas City Royals: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League Central.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `kauffmanstadium_sections.csv` | 174 sections, 13 columns — the primary dataset |
| `kauffmanstadium_layout.csv` | 20 seating zones — the layout overview |
| `kauffmanstadium_notes.md` | This file |

## Orientation

Section numbers increase from left field, up the third-base side, past home plate, down the first-base side and out to right field. Low numbers are the third-base and left-field side; high numbers are the first-base and right-field side. This is the opposite of the other four parks in this division.

Home-plate blocks by level:

- **Field Level (100s):** sections 126–130
- **Plaza Level (200s):** sections 225–230
- **Loge Level (300s):** sections 313–314
- **View Level (400s):** sections 419–421

**Dugouts and bullpens.** Royals (home) dugout: first-base side, fronted by sections 136–139. Visiting dugout: third-base side, fronted by sections 116–119. The fountains and waterfall sit beyond the outfield wall — the signature feature of this ballpark.

**Rows.** Rows are letters on every level. The Field Level runs A to U or A to X, often ending in a wheelchair row labelled VWC or WWC; the Plaza runs AA to TT; the Loge A to J; and the View Level H to V and then AA to ZZ.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your left.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

145 sections are rated high confidence, 16 medium and 13 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. Section 141 contradicts the rest of the park. Its page states seat 1 is the right-most seat facing the field, while every other section states seat 1 is on the left. This guide applies the park-wide rule; treat section 141 as unverified.
2. The Loge Level home-plate anchor (313–314) is a geometric estimate. No source names the behind-the-plate sections on that tier.
3. Section 111 has no row, entrance or seat-direction data; its page describes it only as a general admission area.
4. The source places the Royals bullpen near section 148 on some pages and describes sections 150–152 as sitting behind it on others.
5. Capacity is reported as 37,903 by most references, with variants elsewhere.
6. There has been public discussion of a future new Royals ballpark; this guide documents the current home only.

## Sources

- [Kansas City Royals ballpark guide](https://www.mlb.com/royals/ballpark)
- [Royals accessibility information](https://www.mlb.com/royals/ballpark/accessibility)
- [RateYourSeats: Kauffman Stadium](https://www.rateyourseats.com/kauffman-stadium)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Kauffman+Stadium/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/kauffman-stadium/)
