# How this was built, and how to change it

Written for a fresh session — human or AI — picking this up cold with no memory of how it got
here. All thirty Major League ballparks are done. This file is the *procedure* and the *known
problems*; `README.md` in this folder is *what exists and how the code is wired*.

If you are here to make a change, read this file, then `README.md`, then the specific
`_build/venues_*.py` for the park you care about. You should not need to read anything else.

---

## What this is

Thirty accessible web pages, one per ballpark, that answer in words the question a seat map
answers visually: **where would I actually be sitting?** For every section: which tier, which
zone, how far from home plate and in which direction, how many rows, where the entrance is, and
which end of the row seat 1 is on.

Published at <https://theideaplace.net/projects/mlb/>. 4,723 sections.

**The whole value of this is that it does not guess.** Where a source does not state something,
the output says so. That principle costs a lot of tidiness and is worth every bit of it — see
"The two things the generator must never assume" below.

---

## The pipeline

Five phases per division. One division ≈ 5 discovery agents + 30–45 section agents + a build and
an audit. Every intermediate result is written to disk, which is what makes a crash or a usage
limit survivable: re-run only the dead batches, nothing else changes.

The agent briefs used to produce all of this are checked in as `_build/DISCOVERY_BRIEF.md`,
`_build/SECTION_BRIEF.md` and `_build/CONFIG_BRIEF.md`. **If you are adding or re-doing a park,
hand the agent the brief rather than re-deriving the instructions** — they encode a lot of hard-won
detail, including the failure modes below.

### Phase 1 — Discovery, one agent per park

Writes `_build/research/<team>/discovery.json`, replies in at most six lines. Do not let a
discovery agent report findings in chat; that is what exhausts the parent session's context.

Priorities, in order: **the venue name and whether it is even the right building**; which way the
numbers run *and whether the park sweeps at all*; the home-plate sections per tier; the seat-1
rule quoted verbatim; row conventions; then dugouts, bullpens, capacity, orientation, access,
obstructions.

### Phase 2 — Slice into batches

A helper writes `_build/research/<team>/batches.json` once — twenty section identifiers per key.
Each section agent then reads *its own key out of that file*. That indirection is what makes a
re-run after a usage limit trivial: re-issue the same batch key and nothing else changes.

Include **every** identifier the source's section index lists, not just the numeric ones. Filtering
with `str(x).isdigit()` is how 358 lettered and named sections were dropped from the first four
divisions and had to be researched again later. Assert the batch total against
`len(discovery["sections"])` before you spawn anything.

### Phase 3 — Section detail, one agent per batch

Each writes `_build/research/<team>/sections_NN.json` and replies in three lines. Run in rounds of
6–12. Then **validate before building**: every discovery section has a record, no unexpected
UNKNOWN rows, and the seat-1 statements are counted and grouped rather than skimmed.

### Phase 4 — Configure and build

Add a `venues_<division>.py` and register it in `build_all.py` (the import, the `for cfg in ...`
line and the `DIVISION` map), `mkindex.py` (`PARKS` and `DIVISIONS`), `auditall.js` (`ALL`) and
`README.md`. Then:

```
cd _build
python3 build_all.py                                    # the 29 generated parks
python3 mkindex.py                                      # the landing page
cd ../amfamfield/build && python3 build.py && python3 build_layout.py && python3 build_page.py
```

### Phase 5 — Audit, then hand over

```
npm install playwright axe-core
node auditall.js            # index + four representative parks, light and dark, desktop
node auditall.js --full     # all 31 pages plus reflow at 320px
```

Target: **0 violations**. Run `--full` when `page.py`, `shared.css` or `mkindex.py` change; the
sample is enough otherwise, because every park page comes out of one template.

---

## The config schema

Per park, in `_build/venues_*.py`. The first six divisions were built with a schema that grew
twice; the optional keys are inert when absent, so an older config that does not set them behaves
exactly as it always did.

| Key | What |
|---|---|
| `slug`, `venue`, `team`, `team_short` | identity; `slug` is the folder and file prefix |
| `research` | the `_build/research/` directory name, if it differs from the slug |
| `levels` | `{bucket: "display name"}` — bucket is `section // 100` unless overridden |
| `anchors` | `{bucket: (lo, hi)}` behind-the-plate range. **Omit the bucket entirely if that tier never reaches the plate.** |
| `numbers_increase_toward` | `"first"` or `"third"`; `None` in a pure parity park |
| `seat1_side` | `"left"`, `"right"`, `None`, or `{"odd": …, "even": …}` |
| `direction_overrides` | `{"34": "in right field — reason"}`, for numbering breaks; suppresses the distance |
| `suffix_levels` | `{tag: bucket}` for parks that tell tiers apart by a letter rather than a hundreds digit |
| `numbering_mode` | `"parity"` if the whole park numbers outward from the plate by parity |
| `parity_sides` | `{"odd": "third", "even": "first"}` — required with parity |
| `parity_levels` | `(bucket, …)` when only *some* tiers use parity (Fenway Park) |
| `seat1_unknown_levels` | `(bucket, …)` where no seat numbering is published at all |
| `ring_levels` | `(bucket, …)` where the tier is two concentric rings sharing one run of numbers, so neighbours and distances count same-parity only |
| `extra_level`, `extra_sections` | injected by `build_all.py` from `venues_extra.py`; the tier holding named areas, which get no derived distance and a seat-1 rule read from their own page |
| prose blocks | `placeholder`, `capacity_sentence`, `numbering_summary`, `stack_note`, `landmarks`, `rows_note`, `access_summary`, `access_list`, `uncertain`, `sources` |

`suffix_levels` keys are **whatever `render.parse_section()` returns as the tag**, which is the
letters with the digits removed. Writing `"E1"` rather than `"E"` matched nothing and silently
dropped two Dodger Stadium suites into the Field Level bucket, where they picked up a seat-1 rule
that park does not publish. When you add a key, assert it matches something.

---

## The two things the generator must never assume

### 1. Seat 1 is derived, not looked up

```
seat1_toward_higher = (seat1_side == "left") == (numbers_increase_toward == "third")
```

Facing the field, your left always points the same way around the bowl. Whether that lands seat 1
on the higher- or lower-numbered edge depends on which way the numbers run at that park. Both
inputs come from research; the wording for all 4,723 sections follows.

Whether seat 1 is the end *nearest home plate* is a second question and must be answered against
the **anchor**, never by re-reading the direction string the code just wrote:

```python
anchor = self.c["anchors"].get(self.bucket(sec))
hp_higher = bool(anchor) and parse_section(sec)[0] < anchor[0]
toward_hp = (toward_higher == hp_higher)
```

Deriving it from the prose was correct only in a `"first"` park, and inverted the sentence at
**eleven already-published ballparks** for weeks. Busch Stadium 141 read *"seat 1 is on the edge
facing section 140 … Seat 1 is the end of the row closest to home plate"* — but 140 is *further*
from the plate than 142, so the sentence contradicted itself inside one cell.

**Sanity-check both halves of that sentence after every build**, at a section on each side of the
plate, at a `"third"` park and a `"first"` park. The near/far clause being right is not evidence
that the closest/farthest clause is.

### 2. When a source does not say, the output must say so

`seat1_side = None` produces an explicit "no source publishes this" block on the page, in the notes
and in every CSV row. `seat1_unknown_levels` does the same for one tier. An omitted anchor produces
"not established for this level" rather than a fabricated distance. Missing values read "not stated
by the source". Contradictions are recorded verbatim in `uncertain` rather than reconciled.

Do not fill any of these in to make a comparison table tidy.

---

## Traps already hit

| Trap | What happened |
|---|---|
| **Venue renamed or relocated** | Four of thirty. Minute Maid → Daikin Park. Guaranteed Rate → Rate Field. The Athletics are at Sutter Health Park, not Oakland. UNIQLO bought the *field* naming rights at Dodger Stadium without renaming the *ballpark* — ask discovery to distinguish the two. |
| **A park that does not sweep** | Petco Park, Dodger Stadium and Tropicana Field number outward from the plate by parity. The signature is a netting or zone sentence naming two consecutive numbers on opposite sides: *"Sections 111-115 on the first base side and Sections 112-116 on the 3rd base side"*. This changes the config *schema*, not just its values, so discovery must report it. |
| **A park that does both** | Fenway Park sweeps on its lower tiers and uses parity on the Pavilion tiers. That is what `parity_levels` is for. |
| **Letters in the identifier** | Dodger Stadium puts them after the number (`23LR`, `1TD`); Fenway puts them in front (`FB21`, `LB160`). `parse_section()` returns `(number, tag, tag_leads)` and handles both. A numeric-only filter silently dropped 122 of Dodger Stadium's 276 identifiers, including two entire tiers. |
| **Boilerplate that outranks itself** | The ticketing source prints a park-wide seat-1 sentence on every section page. At **Petco Park, Dodger Stadium and Fenway Park it is wrong on half the ballpark or wrong outright**, and only the per-section answers revealed it. Prefer the source that had to think about the individual section. At Citi Field the same contest resolved the other way, because there the repeated string was the per-section one. |
| **A tier that never reaches home plate** | Comerica's Mezzanine, Progressive's Press Level, Dodger Stadium's Executive Club and Pavilion, Sutter Health Park's 200 level. Omit the anchor. |
| **Numeric gaps mistaken for distance** | `sections_from_home_plate` used to subtract section numbers. On any tier that skips numbers — Oriole Park's all-even upper deck, Progressive Field's press level — that overstated the distance by up to 2×, and in nine cases gave a figure larger than the whole tier. It now counts sections that actually exist. |
| **An unreliable guide** | One popular stadium guide inverted both the dugouts and the numbering direction at Progressive Field, and the ticketing source's own Dugout Club page inverts the sides at Dodger Stadium. Cross-check geometry against official netting, gate and elevator statements — those are the hardest facts available. |
| **Research bookkeeping reaching the reader** | The research files record *how* each fact was obtained, which is right for an auditable dataset. Three quarters of section rows were carrying "No per-section Q&A block on page" and "Recorded, not reconciled" onto the published page. `render.prose()` strips it in three ways &mdash; source labels off the front and out of the middle, absence reports dropped, process notes dropped even when quoted &mdash; while keeping attribution ("Fan review:") because a reader should know who claimed what. The full text stays in `_build/research/`. One trap inside the trap: the sentence splitter has to break after `."` as well as after `.`, or a bookkeeping sentence rides along attached to a useful quotation. |
| **Double-escaped entities** | Config prose is written with `&mdash;` and `&ndash;`. Passing a level name through `esc()` printed `FB1&ndash;FB82` at the reader, 816 times at Fenway. `page.py` unescapes before escaping. |
| **Reflow at 320px** | Long unbreakable tokens in CSS grid tracks. Fixed with `min-width: 0` and `overflow-wrap: anywhere` on `dl.kv` children. |
| **Sticky table headers** | Removed. They eat the viewport at 400% zoom and cover the data. |
| **Landmark clutter** | Scrollable tables need `tabindex="0"` and an accessible name so a keyboard user can scroll them (WCAG 2.1.1). They were `role="region"`, which made every one a landmark alongside real headings. They are `role="group"` now: same name on focus, no landmark noise. |

---

## Known gaps — read before promising anything

1. **Fenway Park's Pavilion Box and Roof Box tiers are left out of `parity_levels`** because no
   source states the parity rule for them, so they are described as if they sweep. It is recorded
   in that park's `uncertain`, but it is a guess by omission rather than a sourced statement.
2. **Rogers Centre's seat-1 rule is the least corroborated in the set** — the park-wide boilerplate
   only, across 155 sections, with section 524A stating the opposite. Flagged on the page.
3. **Wrigley Field's seat-1 side** remains contradicted between the source's section pages and its
   own seating chart. Recorded, not resolved.
4. **The named areas carry a lot of honest blanks.** 358 clubs, suites, lounges and standing-room
   areas now have rows, but only 199 of them have a published row range and 190 a published seat
   side, because the source serves one shared zone page for whole families of them — all fourteen
   Globe Life Field home-plate suites point at the same page, and Sutter Health Park has no
   per-area page at all. Those rows say so rather than guessing.
5. **Some named areas are concert-only.** Wrigley's `Field A`–`Field Z` and Great American's
   `Field 1`–`Field 18` are temporary chairs on the playing surface for concerts, not baseball
   inventory. They appear because the venue index lists them; their rows say what they are.
6. American Family Field has **its own builder** (`amfamfield/build/`) with hand-authored location
   text and a fourteenth CSV column. It does not share `render.py`. When you change the shared
   generator, check that builder too — it was missed once and crashed.

### Fixed, and what it took — so the same ground is not re-dug

- **358 missing sections** across 21 parks, dropped by a `str.isdigit()` filter in the early batch
  generators. Closed by regenerating batches from each park's full `discovery.json` section list
  and running 25 agents against `EXTRA_BRIEF.md`. They live in a tier of their own
  (`venues_extra.py`) because they have no place in the numbered geometry.
- **Oriole Park's lower bowl** is two concentric rings sharing one run of numbers — even sections
  are the Field Level, odd are the Terrace Level behind. `ring_levels` now makes 60's neighbours
  58 and 62 rather than 59 and 61, and keeps the other ring out of the distance count.
- **The distance column** subtracted section numbers, which overstated by up to 2× on any tier that
  skips numbers. It counts sections that exist.
- **Research bookkeeping** was reaching the reader on three quarters of rows. `render.prose()`
  strips it; the full text stays in `_build/research/`.

---

## Publishing

Everything under `mlb/` **except `_build/`** goes to the web server. Every path needs
`-RemoteSubDir`, or `publish-site.ps1` uses the bare filename and drops files into `projects/`,
overwriting the projects page.

```powershell
# the landing page
.\scripts\publish-site.ps1 -RemoteSubDir mlb -Path 'mlb\index.html'

# one ballpark, all four files
$p = 'fenwaypark'
$files = "mlb\$p\index.html", "mlb\$p\${p}_sections.csv",
         "mlb\$p\${p}_layout.csv", "mlb\$p\${p}_notes.md"
.\scripts\publish-site.ps1 -DryRun -RemoteSubDir "mlb/$p" -Path $files
.\scripts\publish-site.ps1         -RemoteSubDir "mlb/$p" -Path $files
```

**All four files in a folder must be uploaded together** or the download links 404. American Family
Field's data files use the `american_family_field_*` prefix rather than the folder slug.

Dry-run first and check the `Directory:` line reads `public_html/theideaplace/projects/mlb/<slug>`.
Use `-Command` rather than `-File` when passing several paths — with `-File` a comma-separated
`-Path` arrives as one string and the script reports "Not found". Verify with a cache buster; the
host caches. The site redirects `www.theideaplace.net` to the bare domain.

---

## What "done" looks like

- Every section in the venue index has a row in the CSV. No gaps. *(Currently true: 4,723 rows
  against 4,723 listed identifiers across all thirty parks.)*
- The seat-1 sentence is hand-verified against the park's geometry for at least one section per
  level, **checking both halves of the sentence**.
- axe-core: 0 violations, light and dark. One `h1`, no skipped heading levels, every table
  captioned. 0 reflow overflow at 320px on the `--full` sweep.
- Anything a source did not state reads as "not stated by the source", never as a guess.
- Each park's `uncertain` list names the real open questions, and the confidence column reflects
  them rather than flattering them.
- No research bookkeeping in any reader-facing column.

---

## If you are an AI picking this up

Work in this order and you will not get lost:

1. Read this file and `README.md`. Do not read the research files yet — they are 4 MB.
2. Run the build (`python3 build_all.py`) before changing anything, so you know it was working
   when you arrived.
3. Make one change. Rebuild. Diff the output. The generator is shared by thirty parks, so a change
   that looks local usually is not — the zone normaliser and the distance calculation both moved
   numbers on all thirty.
4. Hand-verify the seat-1 sentence at a parity park and a sweep park before you call anything done.
   That is the defect class this project keeps producing.
5. Spawn subagents for anything that needs fetching, tell them to **write to disk and reply in
   three lines**, and give them the relevant `_build/*_BRIEF.md`. Findings returned in chat are
   what kills a session.
