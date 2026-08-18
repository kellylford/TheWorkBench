# American Family Field — stadium layout and section detail

Two CSVs, built 15 August 2026, describing the layout of American Family Field (Milwaukee Brewers)
in words: what each section number means, where it sits, and how its rows and seats are numbered.

- **`american_family_field_layout.csv`** — 13 rows. The general layout: each level, the zones on it,
  the section ranges, where they sit, typical rows, and entry rows.
- **`american_family_field_sections.csv`** — 151 rows, one per section. Section number, level, zone,
  plain-language location, side of the ballpark, distance from home plate in sections, row labels,
  entrance row, aisle and walkway locations, seat-numbering explanation, seats per row, notes,
  and a confidence rating.

---

## Orientation — the facts you need before any section number means anything

**Section numbers run counter-clockwise, starting in right field.** They begin in the right-field
corner, rise up the first-base side, cross home plate, and continue up the third-base side into left
field. On every level:

- **Lower number = toward first base and right field.**
- **Higher number = toward third base and left field.**

Behind home plate: **117–120** (Field), **216–221** (Loge), **328–331** (Club), **420–423** (Terrace).

**Do not assume the levels stack by number.** 118, 218, 328 and 422 are all roughly behind home
plate — but 318 and 418 are not. 418 is well down the first-base side. There is no "just add 100" rule.

**Dugouts:** Brewers (home) dugout is on the **first-base side**, fronting sections 112–114. The
visiting dugout is on the **third-base side**, fronting 121–123.

**Bullpens are on opposite sides:** Brewers bullpen in **left/left-center field**; visiting bullpen in
**right field**, beneath sections 101–102.

**Compass:** a batter at home plate faces roughly **southeast**. Left field is northeast, right field
southwest, the backstop northwest. This makes the **third-base side the sunny side** in the afternoon
and the **first-base side the shade side** — which is why the sources repeatedly say first-base-side
seats hold shade better. *(Corroborated by three shade-analysis sites and internally consistent with
the reported sun behaviour, but not confirmed against a primary source — see Confidence below.)*

**Capacity:** 41,900.

---

## The seat-numbering rule, and why it is the interesting part

Every source states the same per-section rule: **facing the field, seat 1 is on your left.** Combined
with the counter-clockwise section numbering, that resolves to a single global rule:

> **Seat 1 sits on the edge of the section facing the next HIGHER section number. Seat numbers count
> up toward the edge facing the next LOWER section number.**

Which means the relationship to home plate **flips at home plate**:

| Where you are | Seat 1 | Higher seat numbers |
|---|---|---|
| First-base / right-field half (sections below the home-plate arc) | closest to home plate | **farther** from home plate |
| Behind home plate | on the third-base side of the section | toward the first-base side |
| Third-base / left-field half (sections above the home-plate arc) | farthest from home plate | **closer** to home plate |

So "higher seat number = farther from home plate" is true in section 112 and **false** in section 124.
One rule of thumb will not cover the whole park — check the row for the specific section, where the
`seat_numbering` column spells out which end of the row seat 1 is on.

---

## Rows and aisles

**Rows are numbers, not letters,** throughout the seating bowl. Letters appear only on concert-floor
sections.

- **Field Level:** deepest rows in the park — up to row 27 in the wide infield sections, up to 30 in
  parts of the outfield. Dugout-adjacent sections stop at row 21. Some sections start partway
  (section 106 starts at row 17, section 131 at row 20) because the bowl geometry cuts them off.
- **Loge Level:** the six sections directly behind home plate (216–221) are only **10 rows** deep.
  Everything else runs 14–21.
- **Club Level:** **7 rows, full stop** — every section. The most predictable level in the park.
- **Terrace Level:** rows have **gaps**. A typical section reads `1-3, 5, 8-24`. **Rows 4, 6 and 7 do
  not exist.** A walkway crosses between row 5 and row 8, and in the even-numbered sections a
  **wheelchair platform occupies the space between rows 3 and 5**. Section 404 and section 442 use
  row 4 instead of row 5 for that break.

**Aisles:** stairway aisles run along both side edges of every section; rows are not split by a mid-row
aisle, so seat numbers run continuously from one side aisle to the other. Each section's entry portal
is at a specific row, listed per-section in the CSV — Field and Loge sections are entered from the
**top** (the entrance row equals the last row), Club sections at row 7–8, Terrace sections at row 5.

*The "aisles at both section edges, none mid-row" pattern is inferred from the consistent seat-numbering
statements and typical row widths (~18–23 seats), not from an explicit published statement.*

---

## Accessibility landmarks

From the Brewers' official disability access guide:

- Accessible seating is available **on all seating levels**; **three companion seats** accompany each
  accessible seat.
- **Elevators** at the **left-field corner** and the **Clock Tower**, both serving all levels.
- **Wheelchair lifts** at Associated Bank Power Alley, J. Leinenkugel's Barrel Yard, Miller Lite
  Landing, and **Loge section 221**.
- **Guest Relations kiosks** — one per level, all near home plate: **Field near 116, Loge behind 221,
  Terrace behind 419**.
- Removable armrests on aisle seats in various locations.

The Terrace Level is the one level where the accessible positions are legible from the published row
labels: the even-numbered sections have the platform **between rows 3 and 5**. A full section-and-row
inventory of accessible seating was not available in text form when this was compiled, so the list
above is a set of landmarks rather than a complete map. The ticket office can confirm specific seats.

---

## Confidence and caveats

Per-section rows, entrance rows and seat direction come from RateYourSeats section pages (one page
fetched per section, 151 pages), with AViewFromMySeat as fallback. Orientation, dugouts, bullpens,
capacity and accessibility come from the Brewers' official ballpark and disability-access guides
cross-checked against independent guides. Each CSV row carries a `confidence` value. Known soft spots:

1. **Sections 302–305** (Party Deck / Miller High Life Loft) — row range comes from a secondary source
   and contradicts itself (listed 1–8, but a fan photo is tagged row 13). Marked LOW.
2. **Sections 237–238** — appear in some venue indexes as left-field Loge sections but not on the
   primary source's index. Included for completeness, marked LOW, all detail unknown.
3. **Sections 324 and 335** — the source lists rows 1–8 while the same page says seven rows per
   section. Marked MEDIUM.
4. **Seats per row** is not published for almost any section. Where a specific row's seat count was
   reported it is recorded; otherwise the field says so rather than guessing.
5. **Compass orientation** (southeast) is corroborated but not confirmed against a primary source.
6. **`location_in_stadium` within a band is partly derived** from the counter-clockwise numbering rule
   rather than quoted per section — e.g. that 101 is deeper toward right-center than 104. The rule
   itself is confirmed at three anchor points (101 right field, 118 home plate, 131 left field); the
   ordering inside each band follows from it.
7. **Section 228** is the one section where the source did not state a seat-numbering direction. The
   global rule is applied; flagged in its notes.
8. Recent change: fan reviews from October 2025 report **sections 407 and 408** now have a
   significantly restricted view of right field due to new office construction.

**Sources:** RateYourSeats section pages (`rateyourseats.com/american-family-field/seating/sections/{n}`),
AViewFromMySeat, mlb.com/brewers ballpark A–Z guide and disability access guide, TicketIQ,
The Stadium Insiders, Ballparks of Baseball, theshadium.com / wherestheshade.com.
