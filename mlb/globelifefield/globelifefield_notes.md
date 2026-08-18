# Globe Life Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/globelifefield/>.

A guide in words to Globe Life Field, home of the Texas Rangers: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
American League West.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `globelifefield_sections.csv` | 168 sections, 13 columns — the primary dataset |
| `globelifefield_layout.csv` | 26 seating zones — the layout overview |
| `globelifefield_notes.md` | This file |

## Orientation

Section numbers increase from the third-base and left-field side, past home plate, toward the first-base and right-field side. Low numbers are the third-base side; high numbers are the first-base side.

Home-plate blocks by level:

- **Lower Level (1-33):** sections 12–15
- **Mezzanine Level (100s):** sections 112–115
- **Pavilion Level (200s):** sections 214–220
- **Upper Level (300s):** sections 313–314

**Dugouts and bullpens.** Netting extends in front of sections 1 through 25 on the Lower Level. The All You Can Eat seats are sections 27–33, in left field. Sections 27 and 28 sit above the visiting bullpen. Corner Boxes are 21–26, in the first-base corner.

**Rows.** Rows are numbers at this park, on every level. Lower Level sections typically run 1 to 16, Mezzanine infield 1 to 20, Pavilion 1 to 13 and Upper Level 1 to 14.

## The seat-numbering rule

Every section page for this park states: **facing the field, seat 1 is on your left.** Combined with the direction the section numbers run, that gives one rule for the whole park:

> Seat 1 sits on the edge of the section facing the next LOWER section number; seat numbers count up toward the next HIGHER section number.

Because of that, the relationship to home plate reverses at home plate. On one half of the park seat 1 is the end of the row nearest home plate; on the other half it is the end farthest away. The `seat_numbering` column in the CSV spells it out per section, so you do not have to work it out.

## Confidence

143 sections are rated high confidence, 4 medium and 21 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The exact home-plate sections on the Lower Level are inferred from the midpoint of the 1–26 run plus the Balcones Speakeasy anchor at sections 13–14, not stated outright.
2. The Lower Level numbering is discontinuous — sections 27–33 sit in left field rather than continuing round into right, which breaks the otherwise steady progression.
3. The ballpark's official map, A–Z guide and accessibility pages are JavaScript-rendered and could not be read; the team's disability access guide was used instead.
4. Sections 134 and 135 are table seating with no published row range.
5. Entrance rows and seats per row are unavailable for the Lower Level sections.

## Sources

- [Texas Rangers ballpark guide](https://www.mlb.com/rangers/ballpark)
- [Rangers disability access guide](https://www.mlb.com/rangers/ballpark/disability-access-guide)
- [RateYourSeats: Globe Life Field](https://www.rateyourseats.com/globe-life-field)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Globe+Life+Field/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/globe-life-field/)
