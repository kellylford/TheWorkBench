# Ballpark seating guides

Lives at <https://theideaplace.net/projects/mlb/>.

Guides in words to where every section actually is. **4,723 sections across all thirty Major
League ballparks.**

**Changing anything? Read `PROCESS.md` first.** It is written for a fresh session and covers the
pipeline, the config schema, the traps already hit and the gaps still open.

`index.html` is the landing page: what the guides are, how the parks differ, and links into each,
grouped by division. Each ballpark folder holds `index.html` plus three downloadable data files
that the page links to. **All four files in a folder have to be uploaded together** or the
download links 404.

| Folder | Ballpark | Team | Division | Sections | Numbering | Facing the field, seat 1 is on your |
|---|---|---|---|---|---|---|
| `amfamfield/` | American Family Field | Brewers | National League Central | 151 | single sweep | left |
| `wrigleyfield/` | Wrigley Field | Cubs | National League Central | 194 | single sweep | left |
| `buschstadium/` | Busch Stadium | Cardinals | National League Central | 183 | single sweep | right |
| `greatamericanballpark/` | Great American Ball Park | Reds | National League Central | 157 | single sweep | right |
| `pncpark/` | PNC Park | Pirates | National League Central | 136 | single sweep | right |
| `daikinpark/` | Daikin Park | Astros | American League West | 142 | single sweep | left |
| `angelstadium/` | Angel Stadium | Angels | American League West | 202 | single sweep | left |
| `sutterhealthpark/` | Sutter Health Park | Athletics | American League West | 54 | single sweep | **not published** |
| `tmobilepark/` | T-Mobile Park | Mariners | American League West | 145 | single sweep | right |
| `globelifefield/` | Globe Life Field | Rangers | American League West | 168 | single sweep | left |
| `ratefield/` | Rate Field | White Sox | American League Central | 133 | single sweep | right |
| `progressivefield/` | Progressive Field | Guardians | American League Central | 178 | single sweep | right |
| `comericapark/` | Comerica Park | Tigers | American League Central | 123 | single sweep | right |
| `kauffmanstadium/` | Kauffman Stadium | Royals | American League Central | 174 | single sweep | left |
| `targetfield/` | Target Field | Twins | American League Central | 149 | single sweep | right |
| `truistpark/` | Truist Park | Braves | National League East | 181 | single sweep | right |
| `loandepotpark/` | loanDepot park | Marlins | National League East | 107 | single sweep | right |
| `citifield/` | Citi Field | Mets | National League East | 176 | single sweep | left |
| `citizensbankpark/` | Citizens Bank Park | Phillies | National League East | 153 | single sweep | right |
| `nationalspark/` | Nationals Park | Nationals | National League East | 129 | single sweep | right |
| `oraclepark/` | Oracle Park | Giants | National League West | 111 | single sweep | right |
| `petcopark/` | Petco Park | Padres | National League West | 132 | parity | left in odd, right in even |
| `chasefield/` | Chase Field | Diamondbacks | National League West | 138 | single sweep | right |
| `coorsfield/` | Coors Field | Rockies | National League West | 139 | single sweep | right |
| `dodgerstadium/` | Dodger Stadium | Dodgers | National League West | 276 | parity | right in odd, left in even |
| `yankeestadium/` | Yankee Stadium | Yankees | American League East | 181 | single sweep | right |
| `fenwaypark/` | Fenway Park | Red Sox | American League East | 273 | sweep + parity tiers | right |
| `oriolepark/` | Oriole Park at Camden Yards | Orioles | American League East | 163 | single sweep | right |
| `rogerscentre/` | Rogers Centre | Blue Jays | American League East | 155 | single sweep | right |
| `tropicanafield/` | Tropicana Field | Rays | American League East | 120 | parity | left |

Venue notes worth knowing: **Daikin Park** was Minute Maid Park until January 2025, **Rate Field**
was Guaranteed Rate Field until December 2024, **Sutter Health Park** in West Sacramento is the
Athletics&rsquo; temporary home through at least 2027, and **Dodger Stadium** is still Dodger
Stadium &mdash; UNIQLO bought the naming rights to the *field* in March 2026, not the building.

## The one thing to know before editing

**These parks do not share conventions.** The code must not assume they do.

- Nineteen number one way round the bowl. Three &mdash; Petco Park, Dodger Stadium, Tropicana
  Field &mdash; number *outward from home plate by parity*, odd one way and even the other.
  Fenway Park does both, sweeping on its lower tiers and using parity on the Pavilion tiers.
- Most state one seat-1 side for the whole park. Petco Park and Dodger Stadium have a different
  side on each half, which is one rule seen twice: seat 1 is the end of the row nearest home
  plate. Sutter Health Park publishes no side at all, and this guide does not invent one.
- Most tell tiers apart by a hundreds digit. Dodger Stadium uses a trailing letter (`23LR`,
  `1TD`); Fenway Park uses a leading one (`FB21`, `LB160`).

The seat-1 side is derived, not hardcoded:

```
seat1_toward_higher = (seat1_side == "left") == (numbers_increase_toward == "third")
```

Whether seat 1 is also the end *nearest home plate* is a separate question, answered against the
tier&rsquo;s anchor rather than by re-reading the prose the generator just wrote. Getting that
wrong inverted the sentence at eleven published parks once already; `PROCESS.md` has the detail.

## Two builders, on purpose

- **`amfamfield/build/`** &mdash; American Family Field has its own builder. Its location text is
  hand-authored per section, richer than a generic pass produces, and its Terrace-level row gaps
  and wheelchair platforms are encoded by hand. Left alone rather than flattened.
- **`_build/`** &mdash; everything else. `render.py` (geometry, prose normalisation, CSV output),
  `page.py` (the HTML template), `venues*.py` (per-park config and prose), `build_all.py` (driver),
  `mkindex.py` (landing page), `shared.css`, `auditall.js` (accessibility audit), and the three
  `*_BRIEF.md` files that were handed to the research agents.

`_build/research/<team>/` holds the raw researched data for each park &mdash; the discovery pass
plus one record per section, exactly as gathered, including the notes on how each fact was
obtained. The published pages are derived from these, so a correction goes in the JSON and
everything downstream regenerates. **Nothing under `_build/` is published.**

## Rebuilding

```
cd _build
python3 build_all.py     # the twenty-nine generated parks
python3 mkindex.py       # the landing page
cd ../amfamfield/build && python3 build.py && python3 build_layout.py && python3 build_page.py
```

Paths are derived from each file&rsquo;s own location, so this runs from a checkout on any machine.

## Auditing

```
npm install playwright axe-core
node auditall.js            # the landing page plus four representative parks, light and dark
node auditall.js --full     # all thirty-one pages, plus reflow at 320 CSS pixels
```

Every park page comes from one template, so the sample covers the branches that differ: an
ordinary park, a park that numbers by parity with suffixed tiers, the park where no seat-1 side is
published, and Fenway Park. Run `--full` when `page.py`, `shared.css` or `mkindex.py` change.

Current state: **0 violations, light and dark.** Reflow clean at 320px, one `h1` per page, no
skipped heading levels, every table captioned.

Two design decisions worth knowing:

- **Table headers are not sticky.** They were, and it looked useful on a 273-row table, but a
  header pinned to the viewport eats most of the screen at 400% zoom and covers the data
  underneath. `<th scope="col">` is announced per cell regardless.
- **Scrollable table wrappers are `role="group"`, not `role="region"`.** A container that scrolls
  must be reachable and scrollable by keyboard, and a focusable container needs an accessible name
  &mdash; but making each one a landmark cluttered the landmark list alongside real headings.
  `group` gives the name on focus without the landmark.

## Sourcing

Rows, entrance rows, ticket zones and seat-numbering direction come from RateYourSeats, one page
fetched per section, with A View From My Seat as a fallback. Orientation, dugouts, bullpens,
capacity and accessibility come from each team&rsquo;s own ballpark and accessibility guides,
cross-checked against independent guides.

Where a source does not state something, the data records that rather than guessing, and every
section row carries a confidence rating. Each park&rsquo;s `_notes.md` lists what could not be
confirmed. `PROCESS.md` lists the gaps that remain across the whole set.
