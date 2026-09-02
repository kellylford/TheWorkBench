# Ballpark discovery brief — American League East

You are doing the **discovery pass** for one ballpark in an accessible-seating-guide project.
Twenty-five ballparks are already done; this is the last division. Your output is the foundation
every later step rests on, so getting a single fact backwards silently corrupts hundreds of rows.

## Write

`/home/claude/nlwest/mlb/_build/research/<TEAM>/discovery.json` — one JSON object with exactly
these top-level keys:

```
venue, team, rateyourseats_slug, sections, concert_only_sections, capacity, orientation,
numbering_direction, home_plate_sections, levels, dugouts, bullpens, special_areas,
accessibility, row_seat_conventions, seat1_side_verbatim, known_obstructions, uncertain
```

`sections` must be a **flat array of every baseball seating-section identifier the ticketing
source's section index lists**, as strings, exactly as the source writes them — including any
letter suffix (`23LR`, `1DC`, `201LS`). Concert-floor sections and zone links with no per-section
page go in `concert_only_sections` with a note, not in `sections`.

`levels` is an array of `{name, sections, notes, source}`. `orientation`, `numbering_direction`
and `dugouts` are objects; the rest may be strings. Quote sources **verbatim** and give URLs.

Then reply in **at most six lines**. Do not summarise findings in chat — that is what blows up
the parent session's context. The file is the deliverable.

## What discovery must establish, in priority order

1. **The venue name, and whether it is even the right building.** This has bitten four times in
   this project. Minute Maid Park is now Daikin Park. Guaranteed Rate Field is now Rate Field.
   The Athletics do not play in Oakland. UNIQLO bought the *field* naming rights at Dodger Stadium
   without renaming the *ballpark*. **Confirm the team's current home park for the 2026 season
   before researching anything about it**, and distinguish a field naming right from a stadium
   one. Say explicitly which sources are stale.
2. **Which direction section numbers increase** — toward first base or toward third base. Demand
   at least three confirmed anchors: one section in right field, one behind home plate, one in
   left field. **Getting this backwards silently inverts every seat-1 statement for the park.**
   *And*: report whether the park sweeps one way round the bowl at all. Two NL West parks number
   **outward from home plate by parity** — odd one way, even the other — which changes the
   generator's config schema, not just its values. If you see a netting or zone statement of the
   form "sections 111-115 on the first base side and 112-116 on the third base side", that is the
   parity signature. Say so loudly.
3. **Home-plate sections per level.** One anchor range per tier. If a tier genuinely never wraps
   behind the plate, record that and say so — the config omits the anchor and distances come out
   blank rather than wrong.
4. **The seat-1 rule, quoted verbatim** from a section page — and a warning if you cannot check
   it. Note that the ticketing source prints a park-wide boilerplate sentence that at two parks so
   far was **correct on one half of the ballpark and wrong on the other**. Where per-section
   question-and-answer text exists, it beats the boilerplate. Flag any disagreement; do not
   reconcile it.
5. **Rows** — letters or numbers, per tier, and any accessible-row label convention.
6. Dugouts (which side is home), bullpens, capacity, compass orientation, accessibility
   provisions, known obstructions and netting extent.

## The rule that matters more than completeness

> Record ONLY what a source states. Use the literal string `"UNKNOWN"` where nothing is stated.
> Never invent a section, a row range, a capacity or a direction.

Where two sources conflict, record **both** verbatim with their URLs and put the conflict in
`uncertain`. One popular stadium guide inverted both the dugouts and the numbering direction at
Progressive Field; cross-check geometry against official netting, gate and elevator statements,
which are the hardest facts available.

Useful source order: the team's own ballpark guide, netting page and accessibility guide on
mlb.com; `rateyourseats.com/<slug>/seating/sections` for the section index and the zone pages;
`ballparksofbaseball.com`; `aviewfrommyseat.com` as fan-data fallback.
