# Dodger Stadium — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/dodgerstadium/>.

A guide in words to Dodger Stadium, home of the Los Angeles Dodgers: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
National League West.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `dodgerstadium_sections.csv` | 276 sections, 13 columns — the primary dataset |
| `dodgerstadium_layout.csv` | 11 seating zones — the layout overview |
| `dodgerstadium_notes.md` | This file |

## Orientation

Dodger Stadium does not number one way round the bowl. Numbering starts at home plate and runs outward in both directions at once, split by parity: odd-numbered sections run down the third-base side toward left field, even-numbered sections run down the first-base side toward right field, and within each side the number rises as you move away from the plate. Sections 40 and 41 are the same distance from home plate on opposite sides of the diamond, which is how the club's own netting statement describes them. The rule holds on every tier, so the useful question about a Dodger Stadium section number is not "how high is it" but "is it odd or even, and how far above the middle".

Home-plate blocks by level:

- **Dugout Club (1DC&ndash;15DC):** sections 1–2
- **Field Level (1&ndash;53):** sections 1–2
- **Loge Level (101&ndash;168):** sections 101–102
- **Reserve Level (1&ndash;61, tagged IR, LR or R):** sections 1–2
- **Top Deck (1TD&ndash;13TD):** sections 1–2

**Dugouts and bullpens.** The Dodgers dugout is on the third-base side, which puts the home dugout in front of the odd-numbered Field Level sections 15–27 and the visiting dugout in front of the even 14–26. This is the minority arrangement in Major League Baseball and it is worth checking twice, because the ticketing source's Dugout Club page states the exact opposite. Five sources including the club's own netting page and the geography of the bullpens say third base. Both bullpens sit beyond the outfield wall, below the Pavilion rather than along the foul lines — the Dodgers' in left field near sections 53, 167 and 301, the visitors' in right field near 52, 168 and 302. Raised overlooks were added behind each of them in 2014. Protective netting runs from behind home plate out to the end of baseline section 40 on the first-base side and section 41 on the third-base side, per the club's own netting statement.

**Rows.** Rows are lettered almost everywhere at Dodger Stadium, which makes it the opposite of most parks in this set. Field Level runs from row A, with an extra leading AA in some outfield-corner sections and a trailing DR — the drink rail — behind row X in the home-plate sections. The Loge Level runs A–T then U–W, with a handful of Preferred Loge Box sections ending in a row labelled PB or BOX instead. Lower and Infield Reserve run A–V with row I skipped; Value Reserve uses doubled letters from AA. The Dugout Club also uses doubled letters. Entry is usually at the back of the section — you come in from the concourse behind and walk down — but the Pavilion and the Value Reserve sections are entered at the front instead, at row A and row AA respectively.

## The seat-numbering rule

**This ballpark does not have a single seat-1 side.** Section numbers run outward from home plate by parity rather than sweeping one way round the bowl &mdash; odd numbers toward third base and left field, even numbers toward first base and right field. The ticketing source's own per-section answers put seat 1 on your right in odd-numbered sections and on your left in even-numbered ones. Those are two descriptions of one rule:

> Seat 1 is the end of the row nearest home plate, and seat numbers count up away from home plate.

Note that this contradicts the boilerplate sentence the same source prints on every section page, which states a single side for the whole park and is correct on only one half of it. The per-section answers are followed here because they are specific, dated and mutually consistent. The `seat_numbering` column in the CSV spells out the result for every section.

## Confidence

163 sections are rated high confidence, 113 medium and 0 low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

1. The ticketing source's park-wide seat-1 sentence is wrong on half the ballpark. Every section page prints "lower number seats are on the right". Thirteen of the same source's own per-section answers say otherwise, and they split perfectly by parity: sections 41, 47, 53, 161 and 43LR (odd) put seat 1 on the right, while 26, 106, 144, 158, 168, 16IR, 42R and 52LR (even) put it on the left, two of them adding "closer to home plate". Those are one rule — seat 1 is the end of the row nearest home plate — and this guide follows the per-section answers. No per-section answer anywhere contradicts that reading.
2. The section identifiers here are the ticketing source's, not necessarily the ones printed on a ticket. The club appears to use suffixes FD, LG, RS, TD and DC; the source uses bare numbers for the Field, Loge, Executive Club and Pavilion tiers and its own tags IR, LR and R on the Reserve Level, and its own expert answers admit a real ticket may read "30RS" or "8FD". Check the suffix on your ticket against the tier, not just the number.
3. The same bare number means different seats on different tiers. Sections 1–53 exist at Field Level, 1–61 on the Reserve Level, 1–15 in the Dugout Club and 1–13 on the Top Deck; and on the Suite Level the bare Executive Club numbers 229, 231 and 233 collide with suites 229LS, 231LS and 233LS. A ticket reading "section 8" is ambiguous without its tier.
4. The Reserve Level zone split may be hiding a second block. The source assigns Lower Reserve to sections of the form 4k+3 and 4k+4 and Value Reserve to the others, in a strict alternating pattern, while also saying Value Reserve sits above Lower Reserve. That pattern suggests the physical level has both a lower and an upper block at most section numbers, flattened into one identifier each. The sections are listed as the source lists them.
5. The Baseline Club is quoted as rows 1–6 of sections 26–43, but the same sections' own pages give lettered rows, and sections 41–43 print a row list beginning "3-6". The front-row product and the row labels have not been reconciled by any source.
6. No seat numbering is published for the Club Suites at all, so this guide states none for them. Whether the odd/even rule even applies to suites 201LS–233LS, which run consecutively in both parities, is not stated anywhere, and E1 and E2 are unexplained by every source consulted.
7. One fan note on section 301 says the Dodgers bullpen is to the right of the section and then advises sitting in higher-numbered seats to be near it, which contradicts itself. The equivalent note on section 53 is self-consistent and agrees with the rule used here.
8. Sections 12DC and 14DC are absent from the venue index, as are the Home Run Seats and the bullpen overlooks, which are sold as lettered zones with no per-section pages. No source states a compass bearing for home plate; that right field is on the east side of the stadium is the sourced fact and the rest is inference.

## Sources

- [Los Angeles Dodgers ballpark guide](https://www.mlb.com/dodgers/ballpark/information/guide)
- [Dodgers protective netting](https://www.mlb.com/dodgers/ballpark/netting)
- [RateYourSeats: UNIQLO Field at Dodger Stadium](https://www.rateyourseats.com/uniqlo-field-at-dodger-stadium)
- [A View From My Seat](https://aviewfrommyseat.com/venue/Dodger+Stadium/)
- [Ballparks of Baseball](https://www.ballparksofbaseball.com/ballparks/dodger-stadium/)
