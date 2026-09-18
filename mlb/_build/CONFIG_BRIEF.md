# Writing a ballpark config dict for the NL West

You are writing one park's entry for `venues_nlwest.py` in an accessible-ballpark-guide generator.

## Read first

1. `/home/claude/nlwest/mlb/_build/venues_nleast.py` — five finished examples. **Match their voice,
   density and HTML-entity conventions exactly.** This is the single most important instruction:
   the output has to read as if the same person wrote all thirty parks.
2. `/home/claude/nlwest/mlb/_build/render.py` and `page.py` — how each key is consumed.
3. Your park's research: `/home/claude/nlwest/mlb/_build/research/<TEAM>/discovery.json` (the facts)
   and `sections_*.json` (per-section detail). **Everything you write must trace to these.**

## Write

A single file `/home/claude/nlwest/mlb/_build/_frag_<TEAM>.py` containing exactly one statement:

```python
CFG = dict(
    slug=..., venue=..., team=..., team_short=..., research="<TEAM>",
    ...
)
```

No imports, no other names, no `ALL` list. It will be concatenated into a larger module.

## Keys

| Key | What |
|---|---|
| `slug` | folder name, lowercase, no punctuation (given to you below) |
| `venue` | the ballpark's current name |
| `team` | full team name |
| `team_short` | what fans call them, e.g. "Giants" |
| `research` | the research directory name (given to you below) |
| `levels` | `{bucket: "display name"}`. Bucket is `section_number // 100` unless the park uses letter suffixes. Include a section-number range in the name, as the NL East configs do. |
| `anchors` | `{bucket: (lo, hi)}` — the behind-home-plate sections for that tier. **Omit a bucket entirely if that tier genuinely never wraps behind the plate.** Never invent one. |
| `numbers_increase_toward` | `"first"` or `"third"` |
| `seat1_side` | `"left"`, `"right"`, or `None` if no source states it |
| `direction_overrides` | optional `{"34": "in right field - reason"}` for numbering breaks |
| `placeholder` | search-box hint, e.g. `"for example: 117, promenade, bullpen"` |
| `capacity_sentence` | 3–5 sentences: opening year, capacity, and the ticketed tiers with their number ranges |
| `numbering_summary` | which way the numbers run, in plain words |
| `stack_note` | where the home-plate block sits on each tier, and **any tier with no anchor, naming it and saying distances are left blank rather than guessed** |
| `landmarks` | list of 4–6 HTML strings, each opening with a `<strong>` lead — dugouts, bullpens, netting, distinctive features, standing-room areas |
| `rows_note` | letters or numbers, per-tier variation, accessible-row label convention |
| `access_summary` | 2–3 sentences on accessible seating |
| `access_list` | 3–5 short bullet strings |
| `uncertain` | list of the **real** open questions, most important first. Contradictions between sources, tiers with no data, anything single-sourced. Be specific and name sections. |
| `sources` | list of `(title, url)` tuples — team ballpark guide, team accessibility guide, RateYourSeats, A View From My Seat, Ballparks of Baseball |

## House style, non-negotiable

- **HTML entities, not raw characters**, in every prose string: `&mdash;` `&ndash;` `&ldquo;`
  `&rdquo;` `&rsquo;` `&amp;`. Section ranges use `&ndash;`. (`build_all.py` strips tags for the
  Markdown notes, so write for the HTML page and let it downgrade.)
- `<strong>` for the lead of each landmark and each `uncertain` entry that states a conflict.
- **Never state something no source states.** If the sources disagree, say they disagree and record
  both — do not pick one. If a tier has no data, say so. The whole project's value is that it does
  not guess. A short honest config beats a rich invented one.
- No commentary about MLB, ticketing companies or the state of the industry. Describe the ballpark.
- British-ish register, plain words, no marketing adjectives. Look at the NL East file and copy it.

## Reply

At most three lines: the file you wrote, the bucket→level map, and anything you could not source.
Do not paste the config into chat.
