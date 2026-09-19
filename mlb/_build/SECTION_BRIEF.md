# Section research brief — one batch of sections at one ballpark

## Your job

1. Read `/home/claude/nlwest/mlb/_build/research/<TEAM>/discovery.json`. **Read it properly** —
   `numbering_direction`, `dugouts`, `bullpens`, `row_seat_conventions`, `seat1_side_verbatim`,
   `known_obstructions` and `uncertain` are the park facts you need to interpret what you fetch,
   and its `rateyourseats_slug` is the URL slug to use.
2. Read `/home/claude/nlwest/mlb/_build/research/<TEAM>/batches.json` and take the array under
   your batch key. That is your list of section identifiers, and only those.
3. For each identifier, fetch
   `https://www.rateyourseats.com/<slug>/seating/sections/<ID>` — the ID exactly as given,
   including any letter prefix or suffix. If it 404s or redirects to a zone page, say so in
   `notes` and fall back to `https://www.aviewfrommyseat.com/venue/<Venue+Name>/<N>/`. Record
   what you actually fetched in `source`.
4. Write a JSON **array** to
   `/home/claude/nlwest/mlb/_build/research/<TEAM>/sections_<NN>.json`, one object per section,
   in the order given.
5. Reply in **at most three lines**: batch key, count written, anything anomalous. Do not
   summarise findings in chat.

Note: plain `curl` to rateyourseats.com is blocked by egress policy in this environment. Use the
web-fetch tool.

## THE NON-NEGOTIABLE RULE

> Record ONLY what a source states. Use the literal string `"UNKNOWN"` where nothing is stated.
> Never invent rows, entrance row, seats per row, or seat-numbering direction. A section with
> five honest UNKNOWNs is worth more than one with five plausible guesses.

## Record shape (exactly these keys, all strings)

```json
{
  "section": "127",
  "zone": "the RateYourSeats zone / page heading for this section",
  "location": "Verbatim sentences placing it in the ballpark. Quote the source.",
  "rows": "Verbatim row label line, e.g. \"Rows in Section 127 are labeled A-V\", or UNKNOWN",
  "entrance_row": "Verbatim entrance line, e.g. \"An entrance to this section is located at Row V\", or UNKNOWN",
  "seat_direction": "Verbatim seat-numbering sentence(s) — see below — or UNKNOWN",
  "seats_per_row": "Only if stated, else UNKNOWN",
  "notes": "Section Insights, Seating Notes, netting and obstruction lines, shade, fan feedback, contradictions. Verbatim where it matters.",
  "source": "The URL(s) actually fetched"
}
```

## Seat direction — the part that has gone wrong before

RateYourSeats prints a **park-wide boilerplate** line in its "Row Numbers" block, of the form
*"When looking towards the field/stage, lower number seats are on the right"* (or left). It is
identical on every section page.

**At two ballparks in this project that boilerplate turned out to be wrong on half the park**, and
only the per-section question-and-answer text revealed it. So:

- Record the boilerplate verbatim when you see it, labelled as boilerplate.
- **Then look specifically for per-section Q&A, expert answers or fan feedback that name a side
  for THIS section** — anything of the form "Seat 1 is on the aisle at the left", "there are 22
  seats in Row A, with seat 1 on the right", "seat 1 … closer to home plate". Quote it verbatim in
  `seat_direction` alongside the boilerplate, and say which is which.
- If the two disagree, say so explicitly in `notes`. **Do not reconcile them.** That judgement is
  made later, once every section's evidence is on the table.
- If there is no per-section statement, say that in as many words. "No per-section statement" is
  itself a finding and is used to decide how far the boilerplate can be trusted.

## Other things worth capturing in `notes`

- Netting or screening lines, obstructed-view warnings, overhang and shade statements.
- Any sentence that contradicts `discovery.json` — especially about which side a dugout, bullpen
  or team is on. Record it verbatim and flag it; discovery has already identified one guide that
  inverts sides, and a repeat is worth knowing about.
- Where the page says a real ticket prints a different identifier than the URL uses.
- Where a page serves generic zone content rather than section content. That is a finding, not a
  failure. Record `UNKNOWN` for rows, entrance row, seats per row and seat direction, note the
  redirect, and move on. Do not pad.
