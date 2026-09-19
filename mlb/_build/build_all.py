#!/usr/bin/env python3
"""Build every ballpark folder: CSVs, notes and the accessible page."""
import json, glob, os, sys, collections
from render import Venue, clean, norm_rows, norm_entrance, compress
from page import build_html
import venues, venues_alwest, venues_alcentral, venues_nleast, venues_nlwest, venues_aleast
import venues_extra

DIVISION = {s: "National League Central" for s in
            ["amfamfield","wrigleyfield","buschstadium","greatamericanballpark","pncpark"]}
DIVISION.update({s: "American League West" for s in
            ["daikinpark","angelstadium","sutterhealthpark","tmobilepark","globelifefield"]})
DIVISION.update({s: "American League Central" for s in
            ["ratefield","progressivefield","comericapark","kauffmanstadium","targetfield"]})
DIVISION.update({s: "National League East" for s in
            ["truistpark","loandepotpark","citifield","citizensbankpark","nationalspark"]})
DIVISION.update({s: "National League West" for s in
            ["dodgerstadium","oraclepark","petcopark","chasefield","coorsfield"]})
DIVISION.update({s: "American League East" for s in
            ["yankeestadium","fenwaypark","oriolepark","rogerscentre","tropicanafield"]})

# Paths are resolved relative to this file so the build runs from a checkout on any machine.
SIDE_WORDS = {"first": "first base and right field", "third": "third base and left field"}

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # the repo root, which is also where the park folders live
RESEARCH = os.path.join(HERE, "research")
OUT = ROOT


def load_research(slug, rdir):
    """Research lives in one of two shapes.

    The working shape is a directory per park - research/<rdir>/discovery.json plus
    research/<rdir>/sections_NN.json - which is what the research agents write.
    The archived shape is a single consolidated research/<slug>.json holding
    {"discovery": {...}, "sections": [...]}, which is how the earlier divisions were
    checked in. Prefer the directory; fall back to the consolidated file.
    """
    d = os.path.join(RESEARCH, rdir)
    if os.path.isfile(os.path.join(d, "discovery.json")):
        disc = json.load(open(os.path.join(d, "discovery.json"), encoding="utf-8"))
        got = {}
        for f in sorted(glob.glob(os.path.join(d, "sections_*.json"))):
            for o in json.load(open(f, encoding="utf-8")):
                got[str(o["section"])] = o
        return disc, got

    p = os.path.join(RESEARCH, f"{slug}.json")
    if os.path.isfile(p):
        blob = json.load(open(p, encoding="utf-8"))
        return blob["discovery"], {str(o["section"]): o for o in blob["sections"]}

    raise SystemExit(f"no research found for {slug}: looked in {d}/ and {p}")


def kb(p):
    n = os.path.getsize(p)
    return f"{n/1024:.0f} KB" if n >= 1024 else f"{n} bytes"


NOTES = """# {venue} — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/{slug}/>.

A guide in words to {venue}, home of the {team}: what each section number means, where it sits,
how deep it is, where the entrance is, and how the seats are numbered. Part of a set covering the
{division}.

## Files

| File | What |
|---|---|
| `index.html` | The page |
| `{slug}_sections.csv` | {nsec} sections, 13 columns — the primary dataset |
| `{slug}_layout.csv` | {nzone} seating zones — the layout overview |
| `{slug}_notes.md` | This file |

## Orientation

{numbering}

Home-plate blocks by level:

{hp}

**Dugouts and bullpens.** {dug}

**Rows.** {rows}

## The seat-numbering rule

{seatrule_block}

## Confidence

{nhigh} sections are rated high confidence, {nmed} medium and {nlow} low. Rows, entrance rows,
zones and seat direction come from RateYourSeats section pages — one page fetched per section —
with A View From My Seat as a fallback. Orientation, dugouts, bullpens, capacity and accessibility
come from the team's own ballpark and accessibility guides cross-checked against independent
ballpark guides.

### Known gaps

{uncertain}

## Sources

{sources}
"""


def strip_tags(t):
    import re
    t = re.sub(r"<[^>]+>", "", str(t))
    return (t.replace("&mdash;", "—").replace("&ndash;", "–").replace("&rsquo;", "'")
             .replace("&ldquo;", '"').replace("&rdquo;", '"').replace("&amp;", "&"))


def main():
    os.makedirs(OUT, exist_ok=True)
    summary = []
    for cfg in (venues.ALL + venues_alwest.ALL + venues_alcentral.ALL
                + venues_nleast.ALL + venues_nlwest.ALL + venues_aleast.ALL):
        slug = cfg["slug"]
        # The named areas - clubs, suites, standing room - live in their own module and are
        # merged in here rather than smeared across the six venues_*.py files, which describe
        # the numbered bowl and nothing else.
        ex = venues_extra.EXTRA.get(slug)
        if ex:
            cfg = dict(cfg)
            cfg["levels"] = {**cfg["levels"], ex["level"]: venues_extra.NAME}
            cfg["extra_level"] = ex["level"]
            cfg["extra_sections"] = frozenset(ex["sections"])
        rdir = cfg.get("research", slug)
        disc, secs = load_research(slug, rdir)
        V = Venue(cfg, disc, secs)
        d = f"{OUT}/{slug}"
        os.makedirs(d, exist_ok=True)

        p_sec = f"{d}/{slug}_sections.csv"
        p_lay = f"{d}/{slug}_layout.csv"
        p_not = f"{d}/{slug}_notes.md"
        V.write_sections_csv(p_sec)
        V.write_layout_csv(p_lay)

        conf = collections.Counter(V.confidence(s).split(" - ")[0] for s in V.order)
        toward_higher = ((cfg["seat1_side"] == "left")
                         == ((cfg.get("numbers_increase_toward") or "third") == "third"))
        if cfg.get("numbering_mode") == "parity" and isinstance(cfg["seat1_side"], str):
            # A parity ballpark whose seat-1 side really is one side park-wide. The sections
            # mirror about home plate; the seats do not. So which end of the row seat 1 is on
            # relative to the plate flips between the two halves, and saying only "seat 1 is
            # on your left" would hide that.
            ps, side = cfg["parity_sides"], cfg["seat1_side"]
            ends = {par: ("nearest home plate" if not ((side == "left") == (ps[par] == "third"))
                          else "farthest from home plate") for par in ("odd", "even")}
            seatrule_block = (
                "Section numbers here run outward from home plate by parity rather than "
                f"sweeping one way round the bowl &mdash; odd numbers toward {SIDE_WORDS[ps['odd']]}, "
                f"even numbers toward {SIDE_WORDS[ps['even']]} &mdash; so the two halves of the park "
                "are mirror images. The seat numbering does not mirror:\n\n"
                f"> Facing the field, seat 1 is on your {side}, in every section of the ballpark.\n\n"
                f"Because of that, seat 1 is the end of the row {ends['odd']} in an odd-numbered "
                f"section and the end {ends['even']} in an even-numbered one. The `seat_numbering` "
                "column in the CSV spells out the result for every section.")
        elif cfg.get("parity_levels"):
            # Fenway Park: most tiers sweep, the Pavilion tiers number by parity.
            ps = cfg["parity_sides"]
            tiers = " and ".join(strip_tags(cfg["levels"][b]) for b in sorted(cfg["parity_levels"]))
            seatrule_block = (
                "**This ballpark uses two numbering schemes at once.** Most of it sweeps one way "
                f"round the bowl toward {SIDE_WORDS[cfg.get('numbers_increase_toward') or 'third']}, "
                f"but {tiers} number outward from home plate by parity instead &mdash; odd numbers "
                f"toward {SIDE_WORDS[ps['odd']]}, even numbers toward {SIDE_WORDS[ps['even']]}. A "
                "section number therefore means something different depending on its tier.\n\n"
                f"> Facing the field, seat 1 is on your {cfg['seat1_side']}.\n\n"
                "Which end of the row that is relative to home plate changes from one half of the "
                "park to the other, and on the parity tiers between odd and even sections. The "
                "`seat_numbering` column in the CSV states the answer for every section.")
        elif cfg.get("numbering_mode") == "parity":
            ps, s1 = cfg["parity_sides"], cfg["seat1_side"]
            seatrule_block = (
                "**This ballpark does not have a single seat-1 side.** Section numbers run "
                "outward from home plate by parity rather than sweeping one way round the "
                f"bowl &mdash; odd numbers toward {SIDE_WORDS[ps['odd']]}, even numbers "
                f"toward {SIDE_WORDS[ps['even']]}. The ticketing source's own per-section "
                f"answers put seat 1 on your {s1['odd']} in odd-numbered sections and on "
                f"your {s1['even']} in even-numbered ones. Those are two descriptions of "
                "one rule:\n\n> Seat 1 is the end of the row nearest home plate, and seat "
                "numbers count up away from home plate.\n\nNote that this contradicts the "
                "boilerplate sentence the same source prints on every section page, which "
                "states a single side for the whole park and is correct on only one half "
                "of it. The per-section answers are followed here because they are "
                "specific, dated and mutually consistent. The `seat_numbering` column in "
                "the CSV spells out the result for every section.")
        elif cfg["seat1_side"] is None:
            seatrule_block = (
                "**No source publishes which side seat 1 is on at this ballpark.** At every other "
                "park in this set the ticketing sites state the rule outright; here they do not, "
                "and this guide does not guess. Seat 1 is against one side aisle and the numbers "
                "count up to the other, but which side is not documented. Check the seat numbers "
                "on your own ticket, or ask the ticket office.")
        else:
            rule = ("Seat 1 sits on the edge of the section facing the next HIGHER section number; "
                    "seat numbers count up toward the next LOWER section number."
                    if toward_higher else
                    "Seat 1 sits on the edge of the section facing the next LOWER section number; "
                    "seat numbers count up toward the next HIGHER section number.")
            seatrule_block = (
                f"Every section page for this park states: **facing the field, seat 1 is on your "
                f"{cfg['seat1_side']}.** Combined with the direction the section numbers run, that "
                f"gives one rule for the whole park:\n\n> {rule}\n\nBecause of that, the "
                "relationship to home plate reverses at home plate. On one half of the park seat 1 "
                "is the end of the row nearest home plate; on the other half it is the end farthest "
                "away. The `seat_numbering` column in the CSV spells it out per section, so you do "
                "not have to work it out.")
        hp = "\n".join(f"- **{cfg['levels'][b]}:** sections {a[0]}–{a[1]}"
                       for b, a in sorted(cfg["anchors"].items()))
        dug = strip_tags(" ".join(x for x in cfg["landmarks"][:3]))
        open(p_not, "w", encoding="utf-8").write(NOTES.format(
            venue=cfg["venue"], slug=slug, team=cfg["team"], nsec=len(V.order),
            nzone=len(V.zones()), numbering=strip_tags(cfg["numbering_summary"]), hp=hp,
            dug=dug, rows=strip_tags(cfg["rows_note"]), seatrule_block=seatrule_block,
            division=DIVISION.get(slug, "guide"),
            nhigh=conf["HIGH"], nmed=conf["MEDIUM"], nlow=conf["LOW"],
            uncertain="\n".join(f"{i+1}. {strip_tags(u)}" for i, u in enumerate(cfg["uncertain"])),
            sources="\n".join(f"- [{t}]({u})" for t, u in cfg["sources"]),
        ))

        html = build_html(V, [kb(p_sec), kb(p_lay), kb(p_not)])
        open(f"{d}/index.html", "w", encoding="utf-8").write(html)
        summary.append((cfg["venue"], len(V.order), len(V.zones()), dict(conf), len(html)))

    for s in summary:
        print(f"{s[0]:<28} sections={s[1]:<4} zones={s[2]:<3} conf={s[3]} html={s[4]//1024}KB")


if __name__ == "__main__":
    main()
