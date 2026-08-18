#!/usr/bin/env python3
"""Shared accessible-page template for the ballpark guides."""
import json, html, os, re
from render import (esc, clean, norm_rows, norm_entrance, val, zone_short, prose,
                    NOT_NAMED, NOT_STATED)

CSS = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shared.css'),
           encoding='utf-8').read()

TPL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__VENUE__: an accessible guide to every section — The Idea Place</title>
<meta name="description" content="A guide in words to the layout, sections, rows, aisles and seat numbering at __VENUE__, home of the __TEAM__.">
<style>
__CSS__
</style>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>

<header class="site">
  <div class="wrap"><p><a href="../">Ballpark guides</a> &middot; The Idea Place</p></div>
</header>

<div class="wrap">
<main id="main">

<h1>__VENUE__: an accessible guide to every section</h1>

<div class="lede">
  <p>In order to assist in finding tickets for __TEAM_SHORT__ games, the following is an overview of
  the stadium, sections, and details about the location of each section in the stadium.</p>
</div>

<p class="prose">A seat map answers one question at a glance: <em>where would I actually be
sitting?</em> This page answers the same question in words &mdash; for all __NSEC__ sections at
__VENUE__. What the section number means, where it sits relative to home plate, how deep it is,
where the entrance is, and which end of the row seat 1 is on.</p>

<nav class="toc" aria-labelledby="toc-h">
  <h2 id="toc-h">On this page</h2>
  <ol>
    <li><a href="#orientation">How the ballpark is laid out</a></li>
    <li><a href="#seatnumbers">How seat numbers work at this park</a></li>
    <li><a href="#access">Accessibility landmarks</a></li>
    <li><a href="#levels">Levels and zones</a></li>
    <li><a href="#browse">Find a section</a></li>
    <li><a href="#glance">All __NSEC__ sections at a glance</a></li>
    <li><a href="#data">Get the underlying data</a></li>
    <li><a href="#sources">Sources, confidence and caveats</a></li>
  </ol>
</nav>

<h2 id="orientation">How the ballpark is laid out</h2>

<p class="prose">__CAPACITY_SENTENCE__</p>

<p class="prose"><strong>__NUMBERING_SUMMARY__</strong></p>

<p class="prose">The sections directly behind home plate are:</p>
<ul>
__HOMEPLATE_LIST__
</ul>

<div class="callout">
  <h3>How the tiers stack</h3>
  <p>__STACK_NOTE__</p>
</div>

<h3>Landmarks</h3>
<ul>
__LANDMARKS__
</ul>

<h2 id="seatnumbers">How seat numbers work at this park</h2>

__SEATBLOCK__

<h3>Rows</h3>
<p class="prose">__ROWS_NOTE__</p>

<h2 id="access">Accessibility landmarks</h2>
<p class="prose">__ACCESS_SUMMARY__</p>
<ul>
__ACCESS_LIST__
</ul>
<p class="prose">A complete section-and-row inventory of accessible seating was not available in
text form when this was compiled, so the list above is a set of landmarks rather than a complete
map. The ticket office can confirm specific seats.</p>

<h2 id="levels">Levels and zones</h2>

<div class="tablewrap" tabindex="0" role="group" aria-labelledby="cap-levels">
<table>
  <caption id="cap-levels">Every seating zone at __VENUE__</caption>
  <thead>
    <tr><th scope="col">Zone</th><th scope="col">Level</th><th scope="col">Sections</th>
        <th scope="col">Where it is</th><th scope="col">Rows</th><th scope="col">Entry row</th></tr>
  </thead>
  <tbody>
__ZONE_ROWS__
  </tbody>
</table>
</div>

<h2 id="browse">Find a section</h2>

<p class="prose">Type a section number, a zone name, or a place &mdash; and narrow by level. Every
section is listed here by default. Results are headings at level 3, so you can jump between them.</p>

<form class="filters" id="filters" role="search" aria-labelledby="filters-h">
  <h3 id="filters-h">Filter sections</h3>
  <div class="field">
    <label for="q">Search by section number, zone or location</label>
    <input type="search" id="q" name="q" autocomplete="off" aria-describedby="q-hint"
           placeholder="__PLACEHOLDER__">
    <p id="q-hint" class="vh">Results update automatically as you type. The number of matches is
    announced below.</p>
  </div>
  <fieldset>
    <legend>Limit to these levels</legend>
    <div class="checks">
__LEVEL_CHECKS__
    </div>
  </fieldset>
  <p><button type="button" id="reset" class="secondary">Reset filters</button></p>
</form>

<p class="status" id="count" role="status">Showing all __NSEC__ sections.</p>

<div id="results"></div>

<h2 id="glance">All __NSEC__ sections at a glance</h2>

<p class="prose">The same data in one table, for scanning. It scrolls sideways on narrow screens and
can be focused and scrolled with the arrow keys.</p>

<div class="tablewrap" tabindex="0" role="group" aria-labelledby="cap-glance">
<table>
  <caption id="cap-glance">Every numbered section at __VENUE__</caption>
  <thead>
    <tr><th scope="col">Section</th><th scope="col">Level</th><th scope="col">Zone</th>
        <th scope="col">Where it is</th><th scope="col">Rows</th><th scope="col">Entrance row</th></tr>
  </thead>
  <tbody>
__GLANCE_ROWS__
  </tbody>
</table>
</div>
<p class="backtop"><a href="#main">Back to the top of the page</a></p>

<h2 id="data">Get the underlying data</h2>
<p class="prose">Everything on this page is generated from these files. They are plain text and open
in any spreadsheet or text editor.</p>
<ul>
  <li><a href="__SLUG___sections.csv" download>Download the section-by-section data as a CSV
  spreadsheet &mdash; __NSEC__ sections, 13 columns (__SLUG___sections.csv, __SZ1__)</a></li>
  <li><a href="__SLUG___layout.csv" download>Download the seating-zone overview as a CSV spreadsheet
  (__SLUG___layout.csv, __SZ2__)</a></li>
  <li><a href="__SLUG___notes.md" download>Download the methodology and confidence notes as a
  Markdown text file (__SLUG___notes.md, __SZ3__)</a></li>
</ul>

<h2 id="sources">Sources, confidence and caveats</h2>

<p class="prose">Rows, entrance rows, zones and seat-numbering direction come from RateYourSeats
section pages, one page fetched per section, with A View From My Seat as a fallback. Orientation,
dugouts, bullpens, capacity and accessibility come from the team's own ballpark and disability
access guides, cross-checked against independent ballpark guides. Every row of the section CSV
carries its own confidence rating. Of __NSEC__ sections, __CONF_HIGH__ are high confidence,
__CONF_MED__ medium and __CONF_LOW__ low.</p>

<h3>Known gaps</h3>
<ul>
__UNCERTAIN__
</ul>

<h3>Sources</h3>
<ul>
__SOURCES__
</ul>

<h3>About this page</h3>
<p class="prose">Built to WCAG 2.2 Level AA: a skip link, one <code>h1</code> with a properly nested
heading outline, landmark regions, tables with captions and row and column headers, visible focus
indicators, form controls with persistent visible labels, a live region announcing filter results,
targets at least 24 by 24 CSS pixels, no information conveyed by colour alone, text that reflows at
320 pixels wide without horizontal scrolling, and support for the operating system's dark mode. No
JavaScript is required to read any content &mdash; the filter is an enhancement, and the full
section table is in the markup.</p>

</main>
</div>

<footer class="site">
  <div class="wrap">
    <p>Compiled August 2026 from public sources. Ballpark details change; verify anything that
    matters before you buy a ticket. <a href="../">All ballpark guides</a>.</p>
  </div>
</footer>

<script>
(function(){
  "use strict";
  var DATA = __DATA__;
  var LEVELS = __LEVELS__;

  function row(dt, dd){
    var w = document.createElement("div");
    var a = document.createElement("dt"); a.textContent = dt;
    var b = document.createElement("dd"); b.textContent = dd;
    w.appendChild(a); w.appendChild(b); return w;
  }
  function distText(d){
    if (d.off === "" || d.off === null) return d.dir;
    if (d.off === 0) return "Directly behind home plate.";
    return d.off + " section" + (d.off === 1 ? "" : "s") + " " + d.dir + " from the sections directly behind home plate.";
  }
  function card(d){
    var art = document.createElement("div");
    art.className = "sec";
    var h = document.createElement("h3");
    h.id = "sec-" + d.s;
    h.textContent = "Section " + d.s + " \\u2014 " + LEVELS[d.lv];
    art.appendChild(h);
    var dl = document.createElement("dl"); dl.className = "kv";
    dl.appendChild(row("Zone", d.z));
    dl.appendChild(row("Where it is", d.loc));
    dl.appendChild(row("Distance from home plate", distText(d)));
    dl.appendChild(row("Rows in this section", d.rows));
    dl.appendChild(row("Aisles and entry", d.aisle));
    dl.appendChild(row("How seats are numbered", d.seat));
    if (d.spr && d.spr !== "UNKNOWN") dl.appendChild(row("Seats per row", d.spr));
    if (d.notes) dl.appendChild(row("Notes", d.notes));
    dl.appendChild(row("Confidence in this data", d.conf));
    art.appendChild(dl);
    return art;
  }

  var results = document.getElementById("results");
  var count = document.getElementById("count");
  var q = document.getElementById("q");
  var boxes = Array.prototype.slice.call(document.querySelectorAll('input[name="lv"]'));
  var reset = document.getElementById("reset");
  var timer = null;

  function hay(d){ return (d.s+" "+d.z+" "+d.loc+" "+d.dir+" "+d.notes).toLowerCase(); }

  function render(){
    var term = q.value.trim().toLowerCase();
    var levels = boxes.filter(function(b){ return b.checked; }).map(function(b){ return b.value; });
    var list = DATA.filter(function(d){
      if (levels.indexOf(String(d.lv)) === -1) return false;
      if (!term) return true;
      return hay(d).indexOf(term) > -1;
    });
    var frag = document.createDocumentFragment();
    list.forEach(function(d){ frag.appendChild(card(d)); });
    results.replaceChildren(frag);
    if (list.length === DATA.length) count.textContent = "Showing all " + DATA.length + " sections.";
    else if (!list.length) count.textContent = "No sections match. Try a different word, or reset the filters.";
    else count.textContent = "Showing " + list.length + " of " + DATA.length + " sections.";
  }

  q.addEventListener("input", function(){ window.clearTimeout(timer); timer = window.setTimeout(render, 250); });
  boxes.forEach(function(b){ b.addEventListener("change", render); });
  reset.addEventListener("click", function(){
    q.value = ""; boxes.forEach(function(b){ b.checked = true; }); render(); q.focus();
  });
  document.getElementById("filters").addEventListener("submit", function(e){ e.preventDefault(); });
  render();
})();
</script>
</body>
</html>
"""


SEATBLOCK_TPL = """<p class="prose">Every section page for this ballpark states the same rule:
<strong>facing the field, seat 1 is on your __SEAT1SIDE__.</strong> Combined with the direction the
section numbers run, that resolves to one rule for the whole park:</p>

<blockquote class="callout">
  <p><strong>__SEAT_RULE_SUMMARY__</strong></p>
</blockquote>

<div class="tablewrap" tabindex="0" role="group" aria-labelledby="cap-flip">
<table>
  <caption id="cap-flip">Where seat 1 sits, by half of the ballpark</caption>
  <thead>
    <tr><th scope="col">Where you are</th><th scope="col">Seat 1 is&hellip;</th>
        <th scope="col">Higher seat numbers are&hellip;</th></tr>
  </thead>
  <tbody>
    <tr><th scope="row">__HALF_A__</th><td>closest to home plate</td>
        <td><strong>farther</strong> from home plate</td></tr>
    <tr><th scope="row">Directly behind home plate</th>
        <td>on the __HP_SIDE__ side of the section</td><td>toward the other side</td></tr>
    <tr><th scope="row">__HALF_B__</th><td>farthest from home plate</td>
        <td><strong>closer</strong> to home plate</td></tr>
  </tbody>
</table>
</div>

<p class="prose">So a single rule of thumb will not cover the whole park. Each section entry below
spells out which end of its row seat 1 is on.</p>"""


SIDE_WORDS = {"first": "first base and right field", "third": "third base and left field"}


def strip_html(t):
    """Level names are written for the page; inline them into prose without markup."""
    return re.sub(r"<[^>]+>", "", str(t)).strip()

PARITY_SEATBLOCK_TPL = """<p class="prose"><strong>This ballpark does not have a single seat-1
side.</strong> Section numbers here do not sweep one way round the bowl. They run outward from home
plate by parity &mdash; odd numbers toward __ODD_DIR__, even numbers toward __EVEN_DIR__ &mdash; so
the two halves of the park are mirror images of each other rather than a continuous sequence.</p>

<p class="prose">The ticketing source's own per-section answers put seat 1 on your __ODD_SIDE__ in
odd-numbered sections and on your __EVEN_SIDE__ in even-numbered ones. Those are two descriptions of
one rule:</p>

<blockquote class="callout">
  <p><strong>Seat 1 is the end of the row nearest home plate, and seat numbers count up away from
  home plate.</strong></p>
</blockquote>

<div class="tablewrap" tabindex="0" role="group" aria-labelledby="cap-flip">
<table>
  <caption id="cap-flip">Where seat 1 sits, by half of the ballpark</caption>
  <thead>
    <tr><th scope="col">Where you are</th><th scope="col">Facing the field, seat 1 is on your&hellip;</th>
        <th scope="col">Higher seat numbers are&hellip;</th></tr>
  </thead>
  <tbody>
    <tr><th scope="row">An odd-numbered section (__ODD_DIR__)</th><td>__ODD_SIDE__</td>
        <td><strong>farther</strong> from home plate</td></tr>
    <tr><th scope="row">Directly behind home plate</th>
        <td>either side, depending on the section's parity</td><td>toward the other side</td></tr>
    <tr><th scope="row">An even-numbered section (__EVEN_DIR__)</th><td>__EVEN_SIDE__</td>
        <td><strong>farther</strong> from home plate</td></tr>
  </tbody>
</table>
</div>

<p class="prose">One consequence is worth stating plainly: the same source also prints a boilerplate
sentence on every section page claiming a single seat-1 side for the whole ballpark. That sentence is
correct on one half of the park and wrong on the other. This guide follows the per-section answers
instead, because they are specific, dated and agree with one another. Each section entry below spells
out which end of its row seat 1 is on.</p>"""


PARITY_SINGLE_SEATBLOCK_TPL = """<p class="prose"><strong>Section numbers here run outward from
home plate by parity</strong> rather than sweeping one way round the bowl &mdash; odd numbers toward
__ODD_DIR__, even numbers toward __EVEN_DIR__ &mdash; so the two halves of the park are mirror images
of each other. The seat numbering, though, does <em>not</em> mirror. Every section page states the
same thing, and the ticketing source's own per-section answers confirm it on both halves:</p>

<blockquote class="callout">
  <p><strong>Facing the field, seat 1 is on your __SEAT1SIDE__, in every section of the
  ballpark.</strong></p>
</blockquote>

<p class="prose">Because the sections mirror and the seats do not, what that means relative to home
plate flips between the two halves:</p>

<div class="tablewrap" tabindex="0" role="group" aria-labelledby="cap-flip">
<table>
  <caption id="cap-flip">Where seat 1 sits, by half of the ballpark</caption>
  <thead>
    <tr><th scope="col">Where you are</th><th scope="col">Facing the field, seat 1 is on your&hellip;</th>
        <th scope="col">Which end of the row is that?</th></tr>
  </thead>
  <tbody>
    <tr><th scope="row">An odd-numbered section (__ODD_DIR__)</th><td>__SEAT1SIDE__</td>
        <td>the end __ODD_HP__ home plate</td></tr>
    <tr><th scope="row">An even-numbered section (__EVEN_DIR__)</th><td>__SEAT1SIDE__</td>
        <td>the end __EVEN_HP__ home plate</td></tr>
  </tbody>
</table>
</div>

<p class="prose">Each section entry below spells out which end of its row seat 1 is on, so you do not
have to work it out.</p>"""


MIXED_SEATBLOCK_TPL = """<p class="prose"><strong>This ballpark uses two numbering schemes at
once.</strong> Most of it sweeps one way round the bowl: __SWEEP_SUMMARY__. But __PARITY_TIERS__
number outward from home plate by parity instead &mdash; odd numbers toward __ODD_DIR__, even
numbers toward __EVEN_DIR__ &mdash; so a section number means something different depending on which
tier it is on. That is a property of the ballpark, not a mistake in the data.</p>

<p class="prose">The seat numbering is the one thing that is consistent throughout:</p>

<blockquote class="callout">
  <p><strong>Facing the field, seat 1 is on your __SEAT1SIDE__.</strong></p>
</blockquote>

<p class="prose">Which end of the row that puts you on relative to home plate therefore changes from
one half of the park to the other, and on the parity tiers it changes between odd and even sections.
Every section entry below states the answer for that section, which is the only reliable way to read
this park.</p>"""


def build_html(V, sizes):
    c, order = V.c, V.order

    def lvl(b):
        """A level name for the HTML.

        Config prose is written with HTML entities, so level names already contain
        `&ndash;`. Passing them through esc() turned the ampersand into `&amp;` and printed
        `FB1&ndash;FB82` at the reader - 816 times at Fenway alone. Escape only what is not
        already an entity.
        """
        return esc(html.unescape(str(c["levels"][b])))

    def lvl_plain(b):
        """The same name with entities resolved, for JSON handed to JavaScript.

        The filter writes level names with textContent, which does not decode entities, so
        the JSON blob needs real characters rather than markup."""
        return html.unescape(str(c["levels"][b]))

    data, glance = [], []
    conf = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for sec in order:
        r = V.s[sec]
        off, direction = V.offset(sec)
        cf = V.confidence(sec)
        conf[cf.split(" - ")[0]] += 1
        b = V.bucket(sec)
        data.append({
            "s": sec, "lv": b, "z": zone_short(r.get("zone"), sec, c.get("venue")),
            "loc": prose(r.get("location"), NOT_STATED),
            "off": "" if off is None else off, "dir": direction,
            "rows": norm_rows(r.get("rows")), "aisle": V.aisle(sec), "seat": V.seat_rule(sec),
            "spr": val(r.get("seats_per_row"), ""), "notes": prose(r.get("notes"), "", limit=700), "conf": cf,
        })
        glance.append(
            "<tr>"
            f'<th scope="row">{esc(sec)}</th><td>{lvl(b)}</td>'
            f'<td>{esc(zone_short(r.get("zone"), sec, c.get("venue")))}</td>'
            f'<td>{esc(prose(r.get("location"), NOT_STATED))}</td>'
            f'<td>{esc(norm_rows(r.get("rows")))}</td>'
            f'<td>{esc(norm_entrance(r.get("entrance_row")))}</td></tr>')

    zone_rows = "\n".join(
        "<tr>"
        f'<th scope="row">{esc(z["zone"])}</th><td>{esc(z["level"])}</td>'
        f'<td>{esc(z["sections"])}</td><td>{esc(z["where"])}</td>'
        f'<td>{esc(z["rows"])}</td><td>{esc(z["entry"])}</td></tr>' for z in V.zones())

    used = sorted({V.bucket(s) for s in order})
    checks = "\n".join(
        f'      <label><input type="checkbox" name="lv" value="{b}" checked> {lvl(b)}</label>'
        for b in used)
    hp = "\n".join(f'  <li><strong>{lvl(b)}:</strong> sections '
                   f'{esc(str(c["anchors"][b][0]))}&ndash;{esc(str(c["anchors"][b][1]))}.</li>'
                   for b in used if c["anchors"].get(b))

    # Three shapes of ballpark, and the park-level explanation differs for each. A single
    # sweep with one seat-1 side is the ordinary case. A parity park mirrors its sections
    # about home plate, and its seat-1 side may be stated as one side for the whole park
    # (Tropicana Field) or as one side per half (Petco Park, Dodger Stadium) - which are
    # two different physical rules, not two ways of saying the same thing. Fenway Park runs
    # both schemes at once, tier by tier.
    is_parity = c.get("numbering_mode") == "parity"
    parity = is_parity and isinstance(c["seat1_side"], dict)
    parity_single = is_parity and isinstance(c["seat1_side"], str)
    mixed = bool(c.get("parity_levels"))
    increase = c.get("numbers_increase_toward") or "third"
    toward_higher = (c["seat1_side"] == "left") == (increase == "third")
    seat_summary = (
        "Seat 1 sits on the edge of the section facing the next HIGHER section number, and seat "
        "numbers count up toward the next LOWER section number."
        if toward_higher else
        "Seat 1 sits on the edge of the section facing the next LOWER section number, and seat "
        "numbers count up toward the next HIGHER section number.")
    if increase == "third":
        half_lower, half_higher = "first base / right field", "third base / left field"
    else:
        half_lower, half_higher = "third base / left field", "first base / right field"
    if toward_higher:
        half_a = f"The {half_lower} half (sections numbered below the home-plate block)"
        half_b = f"The {half_higher} half (sections numbered above the home-plate block)"
    else:
        half_a = f"The {half_higher} half (sections numbered above the home-plate block)"
        half_b = f"The {half_lower} half (sections numbered below the home-plate block)"

    if parity:
        ps, s1 = c["parity_sides"], c["seat1_side"]
        seatblock = PARITY_SEATBLOCK_TPL
        for kk, vv in {
            "__ODD_DIR__": SIDE_WORDS[ps["odd"]], "__EVEN_DIR__": SIDE_WORDS[ps["even"]],
            "__ODD_SIDE__": s1["odd"], "__EVEN_SIDE__": s1["even"],
        }.items():
            seatblock = seatblock.replace(kk, vv)
    elif parity_single:
        ps, side = c["parity_sides"], c["seat1_side"]
        # In a parity park every section is numbered above the anchor, so home plate always
        # lies toward the LOWER numbers. Seat 1 is therefore the end nearest the plate
        # exactly when it faces the lower-numbered neighbour.
        hp_end = {par: ("nearest" if not ((side == "left") == (ps[par] == "third"))
                        else "farthest from")
                  for par in ("odd", "even")}
        seatblock = PARITY_SINGLE_SEATBLOCK_TPL
        for kk, vv in {
            "__ODD_DIR__": SIDE_WORDS[ps["odd"]], "__EVEN_DIR__": SIDE_WORDS[ps["even"]],
            "__SEAT1SIDE__": side,
            "__ODD_HP__": hp_end["odd"], "__EVEN_HP__": hp_end["even"],
        }.items():
            seatblock = seatblock.replace(kk, vv)
    elif mixed:
        ps = c["parity_sides"]
        tiers = " and ".join(strip_html(lvl_plain(b)) for b in sorted(c["parity_levels"]))
        seatblock = MIXED_SEATBLOCK_TPL
        for kk, vv in {
            "__SWEEP_SUMMARY__": (
                f"the numbers rise from {SIDE_WORDS['first' if increase == 'third' else 'third']} "
                f"round past home plate toward {SIDE_WORDS[increase]}"),
            "__PARITY_TIERS__": tiers,
            "__ODD_DIR__": SIDE_WORDS[ps["odd"]], "__EVEN_DIR__": SIDE_WORDS[ps["even"]],
            "__SEAT1SIDE__": c["seat1_side"],
        }.items():
            seatblock = seatblock.replace(kk, vv)
    elif c["seat1_side"] is None:
        seatblock = (
            '<div class="callout">\n<p><strong>No source publishes which side seat 1 is on at this '
            'ballpark.</strong> At every other park in this set the ticketing sites state the rule '
            'outright; here they do not, and this guide will not guess at it. Seat 1 is against one '
            'side aisle and the numbers count up to the other, but which side is not documented. '
            'Check the seat numbers printed on your own ticket, or ask the ticket office.</p>\n'
            '<p>One fan report for section 112 describes the seats running '
            '&ldquo;4, 3, 2, 1 from center to aisle&rdquo;, which is a single data point for a '
            'single section and is not enough to state a rule for the park.</p>\n</div>')
    else:
        seatblock = SEATBLOCK_TPL
        for kk, vv in {
            "__SEAT1SIDE__": c["seat1_side"], "__SEAT_RULE_SUMMARY__": seat_summary,
            "__HALF_A__": half_a, "__HALF_B__": half_b,
            "__HP_SIDE__": "third-base" if c["seat1_side"] == "left" else "first-base",
        }.items():
            seatblock = seatblock.replace(kk, vv)

    out = TPL
    for k, v in {
        "__CSS__": CSS, "__VENUE__": esc(c["venue"]), "__TEAM__": esc(c["team"]),
        "__TEAM_SHORT__": esc(c["team_short"]), "__NSEC__": str(len(order)),
        "__SLUG__": c["slug"], "__CAPACITY_SENTENCE__": c["capacity_sentence"],
        "__NUMBERING_SUMMARY__": c["numbering_summary"],
        "__HOMEPLATE_LIST__": hp, "__STACK_NOTE__": c["stack_note"],
        "__LANDMARKS__": "\n".join(f"  <li>{x}</li>" for x in c["landmarks"]),
        "__SEATBLOCK__": seatblock,
        "__ROWS_NOTE__": c["rows_note"],
        "__ACCESS_SUMMARY__": c["access_summary"],
        "__ACCESS_LIST__": "\n".join(f"  <li>{x}</li>" for x in c["access_list"]),
        "__ZONE_ROWS__": zone_rows, "__GLANCE_ROWS__": "\n".join(glance),
        "__PLACEHOLDER__": esc(c["placeholder"]),
        "__LEVEL_CHECKS__": checks,
        "__SZ1__": sizes[0], "__SZ2__": sizes[1], "__SZ3__": sizes[2],
        "__CONF_HIGH__": str(conf["HIGH"]), "__CONF_MED__": str(conf["MEDIUM"]),
        "__CONF_LOW__": str(conf["LOW"]),
        "__UNCERTAIN__": "\n".join(f"  <li>{x}</li>" for x in c["uncertain"]),
        "__SOURCES__": "\n".join(f'  <li><a href="{u}">{esc(t)}</a></li>' for t, u in c["sources"]),
        "__LEVELS__": json.dumps({str(b): lvl_plain(b) for b in used}),
        "__DATA__": json.dumps(data, ensure_ascii=False, separators=(",", ":")),
    }.items():
        out = out.replace(k, v)
    return out
