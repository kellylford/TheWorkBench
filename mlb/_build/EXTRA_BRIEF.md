# Filling the named-section gap

Twenty-one ballparks in this project have sections listed in the ticketing source's own venue
index that never got researched, because an early batch generator filtered to numeric identifiers
only. They are the **named and lettered areas**: clubs, suites, lounges, standing room, party
decks, bleacher blocks, and lettered field-level rows — `Bleachers`, `General Admission`,
`Field A`, `Crown 3`, `FL12`, `210A`, `130S`. 358 of them.

They are real ticket types. Somebody holding a "Comerica Park, General Admission" ticket has
nowhere to look on the current page. Your job is to give each one a row.

## Your job

1. Read `/home/claude/nlwest/mlb/_build/research/_extra/plan.json`. Find your park's slug. It
   gives the venue name, the team, the ticketing-source slug, and the batch lists.
2. Take the array under your batch key. That is your list, and only those.
3. For each, try
   `https://www.rateyourseats.com/<rys_slug>/seating/sections/<ID>` with the ID URL-encoded
   (spaces become `-` or `%20`; try the hyphenated form first, e.g. `general-admission`,
   `field-a`, `crown-3`). If that fails, find the identifier on
   `https://www.rateyourseats.com/<rys_slug>/seating/sections` and follow the link the index
   itself uses — **that is the reliable route, and it is worth loading the index page once at the
   start of your batch and reading every link off it.**
4. Write a JSON **array** to
   `/home/claude/nlwest/mlb/_build/research/_extra/<slug>_<NN>.json`, one object per identifier,
   in the order given.
5. Reply in **at most three lines**: park, batch key, count written, anything anomalous.

Plain `curl` to rateyourseats.com is blocked here. Use the web-fetch tool.

## Expect most of these to be zone pages, and say so

Many of these identifiers are links to a **zone description**, not a per-section page. That is a
finding, not a failure — and it is the single most useful thing you can record, because it tells a
reader why there is no row detail for their ticket. When it happens: record what the zone page
does say about **where the area is**, and set `rows`, `entrance_row`, `seats_per_row` and
`seat_direction` to `"UNKNOWN"`.

Do not pad. Do not infer a location from the name. `Field A` at one park is behind the plate and
at another is down the line; only a source can tell you which.

## THE NON-NEGOTIABLE RULE

> Record ONLY what a source states. Use the literal string `"UNKNOWN"` where nothing is stated.
> Never invent rows, entrance row, seats per row, or seat-numbering direction.

## Record shape (exactly these keys, all strings)

```json
{
  "section": "General Admission",
  "zone": "the zone or category name the source uses for this area",
  "location": "Verbatim sentences placing it in the ballpark. Quote the source.",
  "rows": "Verbatim row label line, or UNKNOWN",
  "entrance_row": "Verbatim entrance line, or UNKNOWN",
  "seat_direction": "Verbatim seat-numbering sentence, or UNKNOWN",
  "seats_per_row": "Only if stated, else UNKNOWN",
  "notes": "What the area is, what it includes, who it is sold to, obstructions, whether the page was a zone page rather than a section page.",
  "source": "The URL(s) actually fetched"
}
```

**`section` must be the identifier exactly as it appears in `plan.json`** — same spelling, same
capitalisation, same spacing. It is the join key.

Keep `zone` to a short label — `Clubs and suites`, `Standing room`, `Bleachers` — not a sentence
about the page. Keep `location` and `notes` about the ballpark, not about your research process;
a separate filter strips process commentary and it is better not to write it in the first place.
