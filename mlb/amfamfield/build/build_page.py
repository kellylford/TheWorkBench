#!/usr/bin/env python3
"""Build the accessible HTML page from the same source data as the CSVs."""
import json, csv, html
import os
# Paths resolve from this file, not the working directory, so the build works from a
# checkout on any machine. Outputs land in the parent folder - the published ballpark
# directory - rather than beside the scripts.
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
def outpath(name): return os.path.join(OUT, name)
import build as B

LEVELNAME = {1:"Field Level (100s)",2:"Loge Level (200s)",3:"Club Level (300s)",4:"Terrace Level (400s)"}

data = []
for s in sorted(B.ROWS):
    rows, ent, walk, wc = B.ROWS[s]
    off, direction = B.offset(s)
    lvl = s//100
    same = [x for x in B.ROWS if x//100 == lvl]
    lo = [x for x in same if x < s]; hi = [x for x in same if x > s]
    data.append({
        "s": s, "lv": lvl, "z": B.ZONE.get(s,""), "loc": B.LOC.get(s,""),
        "side": B.SIDE.get(s,""), "off": off, "dir": direction,
        "rows": rows, "ent": ent, "walk": walk, "wc": wc,
        "spr": B.SEATS_PER_ROW.get(s,""), "notes": B.notes_for(s),
        "conf": B.confidence(s),
        "lo": max(lo) if lo else None, "hi": min(hi) if hi else None,
    })

layout = list(csv.DictReader(open(outpath("american_family_field_layout.csv"), encoding="utf-8")))

def esc(t): return html.escape(t, quote=False)

layout_rows = "\n".join(
    "<tr>"
    f'<th scope="row">{esc(r["zone"])}</th>'
    f'<td>{esc(r["level_name"])}</td>'
    f'<td>{esc(r["sections"])}</td>'
    f'<td>{esc(r["where_it_is"])}</td>'
    f'<td>{esc(r["typical_rows"])}</td>'
    f'<td>{esc(r["entry_row"])}</td>'
    f'<td>{esc(r["notes"])}</td>'
    "</tr>" for r in layout)

glance_rows = "\n".join(
    "<tr>"
    f'<th scope="row">{d["s"]}</th>'
    f'<td>{esc(LEVELNAME[d["lv"]])}</td>'
    f'<td>{esc(d["z"])}</td>'
    f'<td>{esc(d["loc"])}</td>'
    f'<td>{esc(d["rows"])}</td>'
    f'<td>{esc(d["ent"])}</td>'
    "</tr>" for d in data)

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>American Family Field: an accessible guide to every section — The Idea Place</title>
<meta name="description" content="A non-visual, WCAG-conforming guide to the layout, sections, rows, aisles and seat numbering at American Family Field, home of the Milwaukee Brewers.">
<style>
:root{
  --bg:#ffffff; --fg:#1b1b1b; --muted:#4a4a4a; --line:#8a8a8a; --soft:#f2f4f7;
  --link:#0b4f9e; --visited:#6b2fa0; --focus:#b34700; --accent:#0b4f9e; --flag:#8a3d00;
  --zebra:#f7f8fa;
}
@media (prefers-color-scheme: dark){
  :root{ --bg:#121212; --fg:#f1f1f1; --muted:#c9c9c9; --line:#7a7a7a; --soft:#1e1e1e;
         --link:#8fc0ff; --visited:#d3a9ff; --focus:#ffb266; --accent:#8fc0ff; --flag:#ffb266;
         --zebra:#181818; }
}
*{box-sizing:border-box}
html{font-size:100%}
body{margin:0;background:var(--bg);color:var(--fg);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:1.0625rem;line-height:1.65;overflow-wrap:break-word}
a,code{overflow-wrap:anywhere}
.wrap{max-width:78rem;margin:0 auto;padding:0 1rem}
.prose{max-width:70ch}
a{color:var(--link);text-decoration:underline;text-underline-offset:.15em}
a:visited{color:var(--visited)}
a:hover{text-decoration-thickness:.18em}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:2px}
h1,h2,h3,h4{line-height:1.25;margin:2rem 0 .5rem}
h1{font-size:2rem;margin-top:1rem}
h2{font-size:1.5rem;border-bottom:2px solid var(--line);padding-bottom:.3rem}
h3{font-size:1.2rem}
p,li{max-width:70ch}
.skip{position:absolute;left:-9999px;top:0;background:var(--bg);color:var(--fg);
  padding:.75rem 1rem;border:3px solid var(--focus);z-index:10}
.skip:focus{left:.5rem;top:.5rem}
header.site{border-bottom:1px solid var(--line);padding:.75rem 0}
nav.toc ol{padding-left:1.4rem}
.lede{background:var(--soft);border-left:.35rem solid var(--accent);padding:1rem 1.25rem;margin:1.5rem 0}
.lede p{margin:.5rem 0}
.callout{border:2px solid var(--line);padding:1rem 1.25rem;margin:1.5rem 0;background:var(--soft)}
.tablewrap{overflow-x:auto;border:1px solid var(--line);margin:1rem 0}
.tablewrap:focus-visible{outline:3px solid var(--focus);outline-offset:0}
table{border-collapse:collapse;width:100%;font-size:.95rem}
caption{text-align:left;font-weight:700;padding:.6rem;background:var(--soft);border-bottom:1px solid var(--line)}
th,td{border:1px solid var(--line);padding:.5rem .6rem;text-align:left;vertical-align:top}
thead th{background:var(--soft)}
tbody th{background:var(--soft);white-space:nowrap}
tbody tr:nth-child(even) td{background:var(--zebra)}
form.filters{border:2px solid var(--line);padding:1rem 1.25rem;margin:1.5rem 0;background:var(--soft)}
fieldset{border:1px solid var(--line);margin:1rem 0 0;padding:.75rem 1rem}
legend{font-weight:700;padding:0 .35rem}
label{display:inline-block}
.field{margin:.5rem 0}
.field label{display:block;font-weight:700;margin-bottom:.25rem}
input[type=search],select{font:inherit;padding:.55rem .6rem;min-height:2.75rem;width:100%;max-width:28rem;
  border:2px solid var(--line);background:var(--bg);color:var(--fg);border-radius:3px}
.checks{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem}
.checks label{display:flex;align-items:center;gap:.5rem;min-height:2.75rem;font-weight:400}
input[type=checkbox]{width:1.35rem;height:1.35rem;min-width:1.35rem;accent-color:var(--accent)}
button{font:inherit;min-height:2.75rem;padding:.55rem 1rem;border:2px solid var(--accent);
  background:var(--accent);color:var(--bg);border-radius:3px;cursor:pointer}
button.secondary{background:var(--bg);color:var(--link);border-color:var(--link)}
.status{margin:1rem 0;font-weight:700}
.sec{border:1px solid var(--line);border-left:.35rem solid var(--accent);
  padding:.75rem 1.25rem 1rem;margin:1rem 0;background:var(--bg)}
.sec h3{margin-top:.5rem}
dl.kv{margin:0}
dl.kv>div{display:grid;grid-template-columns:14rem 1fr;gap:.25rem 1rem;
  padding:.4rem 0;border-top:1px solid var(--line)}
dl.kv dt{font-weight:700;margin:0}
dl.kv dt,dl.kv dd{min-width:0;overflow-wrap:anywhere}
dl.kv dd{margin:0;max-width:70ch}
@media (max-width:40rem){ dl.kv>div{grid-template-columns:1fr} dl.kv dt{margin-bottom:0} }
.flag{color:var(--flag);font-weight:700}
.vh{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
footer.site{border-top:1px solid var(--line);margin-top:3rem;padding:1.5rem 0 3rem;color:var(--muted)}
.backtop{margin:.5rem 0 0}
@media print{ .filters,.skip,nav.toc{display:none} }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>

<header class="site">
  <div class="wrap"><p><a href="../">Ballpark guides</a> &middot; The Idea Place</p></div>
</header>

<div class="wrap">
<main id="main">

<h1>American Family Field: an accessible guide to every section</h1>

<div class="lede">
  <p>In order to assist in finding tickets for Brewers games, the following is an overview of the
  stadium, sections, and details about the location of each section in the stadium.</p>
</div>

<p class="prose">A seat map answers one question at a glance: <em>where would I actually be
sitting?</em> This page answers the same question in words &mdash; for all 151 sections, on all four
levels. What the section number means, where it sits relative to home plate, how deep it is, where
the aisles and entrances are, and which end of the row seat 1 is on.</p>

<nav class="toc" aria-labelledby="toc-h">
  <h2 id="toc-h">On this page</h2>
  <ol>
    <li><a href="#orientation">How the ballpark is laid out</a></li>
    <li><a href="#seatnumbers">How seat numbers work &mdash; and where the rule flips</a></li>
    <li><a href="#rows">Rows and aisles</a></li>
    <li><a href="#access">Accessibility landmarks</a></li>
    <li><a href="#levels">Levels and zones</a></li>
    <li><a href="#browse">Find a section</a></li>
    <li><a href="#glance">All 151 sections at a glance</a></li>
    <li><a href="#data">Get the underlying data</a></li>
    <li><a href="#sources">Sources, confidence and caveats</a></li>
  </ol>
</nav>

<h2 id="orientation">How the ballpark is laid out</h2>

<p class="prose">American Family Field seats 41,900 across four levels. Section numbers run
<strong>counter-clockwise, starting in right field</strong>. They begin in the right-field corner,
rise up the first-base side, cross home plate, and continue up the third-base side into left field.
On every level:</p>

<ul>
  <li><strong>Lower number</strong> = toward first base and right field.</li>
  <li><strong>Higher number</strong> = toward third base and left field.</li>
</ul>

<p class="prose">The sections directly behind home plate are
<strong>117&ndash;120</strong> on the Field Level,
<strong>216&ndash;221</strong> on the Loge Level,
<strong>328&ndash;331</strong> on the Club Level, and
<strong>420&ndash;423</strong> on the Terrace Level.</p>

<div class="callout">
  <h3>The levels do not stack by number</h3>
  <p>Sections 118, 218, 328 and 422 are all roughly behind home plate. But 318 and 418 are
  <em>not</em> &mdash; 418 is well down the first-base side. There is no &ldquo;just add 100&rdquo;
  rule at this ballpark, so when you move between levels, use that level&rsquo;s own home-plate
  range from the list above rather than assuming the last two digits carry over.</p>
</div>

<h3>Landmarks</h3>
<ul>
  <li><strong>Brewers (home) dugout:</strong> first-base side, fronting Field Level sections
  112&ndash;114.</li>
  <li><strong>Visiting dugout:</strong> third-base side, fronting Field Level sections
  121&ndash;123.</li>
  <li><strong>Bullpens are on opposite sides.</strong> The Brewers bullpen is in left / left-center
  field; the visiting bullpen is in right field, beneath sections 101&ndash;102.</li>
  <li><strong>Netting:</strong> there is screening in front of Field Level sections 112&ndash;123.
  The backstop net <em>ends part-way through section 119</em>, so that one section is half behind
  net and half not.</li>
  <li><strong>Compass:</strong> a batter at home plate faces roughly southeast. Left field is
  northeast, right field southwest. That makes the third-base side the sunny side in the afternoon
  and the first-base side the shade side.</li>
</ul>

<h2 id="seatnumbers">How seat numbers work &mdash; and where the rule flips</h2>

<p class="prose">Every source states the same per-section rule: <strong>facing the field, seat 1 is
on your left.</strong> Combined with counter-clockwise section numbering, that resolves to one
global rule:</p>

<blockquote class="callout">
  <p><strong>Seat 1 sits on the edge of the section facing the next higher section number. Seat
  numbers count up toward the edge facing the next lower section number.</strong></p>
</blockquote>

<p class="prose">Which means the relationship to home plate <strong>reverses at home plate</strong>:</p>

<div class="tablewrap" tabindex="0" role="region" aria-labelledby="cap-flip">
<table>
  <caption id="cap-flip">Where seat 1 sits, by half of the ballpark</caption>
  <thead>
    <tr><th scope="col">Where you are</th><th scope="col">Seat 1 is&hellip;</th>
        <th scope="col">Higher seat numbers are&hellip;</th></tr>
  </thead>
  <tbody>
    <tr><th scope="row">First-base / right-field half (below the home-plate sections)</th>
        <td>closest to home plate</td><td><strong>farther</strong> from home plate</td></tr>
    <tr><th scope="row">Directly behind home plate</th>
        <td>on the third-base side of the section</td><td>toward the first-base side</td></tr>
    <tr><th scope="row">Third-base / left-field half (above the home-plate sections)</th>
        <td>farthest from home plate</td><td><strong>closer</strong> to home plate</td></tr>
  </tbody>
</table>
</div>

<p class="prose">So &ldquo;a higher seat number is farther from home plate&rdquo; is true in section
112 and false in section 124. One rule of thumb will not cover the whole park, so check the entry
for the section you are actually buying &mdash; each one below spells out which end of the row seat
1 is on.</p>

<h2 id="rows">Rows and aisles</h2>

<p class="prose">Rows are <strong>numbers, not letters</strong>, throughout the seating bowl. Letters
appear only on concert-floor sections.</p>

<ul>
  <li><strong>Field Level:</strong> the deepest rows in the park &mdash; up to row 27 in the wide
  infield sections and up to row 30 in parts of the outfield. Dugout-adjacent sections stop at row
  21. Some sections start part-way: section 106 begins at row 17, section 131 at row 20, because the
  bowl geometry cuts them off.</li>
  <li><strong>Loge Level:</strong> the six sections directly behind home plate (216&ndash;221) are
  only <strong>10 rows</strong> deep. Everything else runs 14 to 21.</li>
  <li><strong>Club Level:</strong> <strong>seven rows, every section.</strong> The most predictable
  level in the park.</li>
  <li><strong>Terrace Level:</strong> rows have <strong>gaps</strong>. A typical section reads
  &ldquo;1&ndash;3, 5, 8&ndash;24&rdquo;. <strong>Rows 4, 6 and 7 do not exist.</strong> A walkway
  crosses between row 5 and row 8, and in the even-numbered sections a wheelchair platform occupies
  the space between rows 3 and 5. Sections 404 and 442 use row 4 instead of row 5 for that break.</li>
</ul>

<h3>Aisles</h3>
<p class="prose">Stairway aisles run along both side edges of every section. Rows are not split by a
mid-row aisle, so seat numbers run continuously from one side aisle to the other &mdash; seat 1 is
against one aisle and the highest-numbered seat is against the other. Each section&rsquo;s entry
portal sits at a specific row, listed for every section below: Field and Loge sections are entered
from the <strong>top</strong> (the entrance row is the last row), Club sections at row 7 or 8, and
Terrace sections at row 5.</p>

<h2 id="access">Accessibility landmarks</h2>

<ul>
  <li>Accessible seating is available <strong>on all four levels</strong>, and
  <strong>three companion seats</strong> accompany each accessible seat.</li>
  <li><strong>Elevators</strong> at the left-field corner and at the Clock Tower, both serving every
  level.</li>
  <li><strong>Wheelchair lifts</strong> at Associated Bank Power Alley, J. Leinenkugel&rsquo;s
  Barrel Yard, Miller Lite Landing, and <strong>Loge section 221</strong>.</li>
  <li><strong>Guest Relations kiosks</strong> &mdash; one per level, all near home plate: Field near
  section 116, Loge behind section 221, Terrace behind section 419.</li>
  <li>Removable armrests are available on aisle seats in various locations.</li>
</ul>

<p class="prose">The Terrace Level is the one level where the accessible positions can be worked out
from the published row labels &mdash; the even-numbered sections have the platform between rows 3
and 5. A full section-and-row inventory of accessible seating was not available in text form when
this was compiled, so the list here is a set of landmarks rather than a complete map. The ticket
office can confirm specific seats.</p>

<h2 id="levels">Levels and zones</h2>

<div class="tablewrap" tabindex="0" role="region" aria-labelledby="cap-levels">
<table>
  <caption id="cap-levels">The general layout: every seating zone at American Family Field</caption>
  <thead>
    <tr>
      <th scope="col">Zone</th><th scope="col">Level</th><th scope="col">Sections</th>
      <th scope="col">Where it is</th><th scope="col">Typical rows</th>
      <th scope="col">Entry row</th><th scope="col">Notes</th>
    </tr>
  </thead>
  <tbody>
__LAYOUT_ROWS__
  </tbody>
</table>
</div>

<h2 id="browse">Find a section</h2>

<p class="prose">Type a section number, a zone name, or a place &mdash; &ldquo;118&rdquo;,
&ldquo;bleachers&rdquo;, &ldquo;third base&rdquo;, &ldquo;dugout&rdquo; &mdash; and narrow by level.
Every section is listed here by default.</p>

<form class="filters" id="filters" role="search" aria-labelledby="filters-h">
  <h3 id="filters-h">Filter sections</h3>
  <div class="field">
    <label for="q">Search by section number, zone or location</label>
    <input type="search" id="q" name="q" autocomplete="off"
           aria-describedby="q-hint" placeholder="for example: 118, dugout, left field">
    <p id="q-hint" class="vh">Results update automatically as you type. The number of matches is
    announced below.</p>
  </div>
  <fieldset>
    <legend>Limit to these levels</legend>
    <div class="checks">
      <label><input type="checkbox" name="lv" value="1" checked> Field Level (100s)</label>
      <label><input type="checkbox" name="lv" value="2" checked> Loge Level (200s)</label>
      <label><input type="checkbox" name="lv" value="3" checked> Club Level (300s)</label>
      <label><input type="checkbox" name="lv" value="4" checked> Terrace Level (400s)</label>
    </div>
  </fieldset>
  <p><button type="button" id="reset" class="secondary">Reset filters</button></p>
</form>

<p class="status" id="count" role="status">Showing all 151 sections.</p>

<div id="results"></div>

<h2 id="glance">All 151 sections at a glance</h2>

<p class="prose">The same data in a single sortable-by-eye table, for scanning. The table scrolls
sideways on narrow screens; it can be focused and scrolled with the arrow keys.</p>

<div class="tablewrap" tabindex="0" role="region" aria-labelledby="cap-glance">
<table>
  <caption id="cap-glance">Every numbered section at American Family Field</caption>
  <thead>
    <tr>
      <th scope="col">Section</th><th scope="col">Level</th><th scope="col">Zone</th>
      <th scope="col">Where it is</th><th scope="col">Rows</th><th scope="col">Entrance row</th>
    </tr>
  </thead>
  <tbody>
__GLANCE_ROWS__
  </tbody>
</table>
</div>
<p class="backtop"><a href="#main">Back to the top of the page</a></p>

<h2 id="data">Get the underlying data</h2>

<p class="prose">Everything on this page is generated from these three files. They are plain text,
open in any spreadsheet or text editor, and are free to reuse.</p>

<ul>
  <li><a href="american_family_field_sections.csv" download>Download the section-by-section data as
  a CSV spreadsheet &mdash; 151 sections, 14 columns
  (american_family_field_sections.csv, __SIZE_SECTIONS__)</a><br>
  One row per section: level, zone, location, side of the ballpark, distance from home plate, rows,
  entrance row, aisle and walkway positions, seat-numbering explanation, seats per row, notes and a
  confidence rating.</li>
  <li><a href="american_family_field_layout.csv" download>Download the stadium layout overview as a
  CSV spreadsheet &mdash; 13 seating zones
  (american_family_field_layout.csv, __SIZE_LAYOUT__)</a><br>
  One row per seating zone: which level it is on, which sections it covers, where it sits, typical
  rows and entry row.</li>
  <li><a href="american_family_field_notes.md" download>Download the methodology and confidence
  notes as a Markdown text file (american_family_field_notes.md, __SIZE_NOTES__)</a><br>
  How the data was gathered, which sources were used for what, and every known gap or
  contradiction.</li>
</ul>

<h2 id="sources">Sources, confidence and caveats</h2>

<p class="prose">Per-section rows, entrance rows and seat-numbering direction come from RateYourSeats
section pages, one page per section, with AViewFromMySeat as a fallback. Orientation, dugouts,
bullpens, capacity and accessibility come from the Brewers&rsquo; own ballpark A&ndash;Z guide and
disability access guide, cross-checked against independent ballpark guides. Of the 151 sections, 143
are rated high confidence, 2 medium and 6 low. Known soft spots:</p>

<ol>
  <li><strong>Sections 302&ndash;305</strong> (Party Deck and Miller High Life Loft): the row range
  comes from a secondary source and contradicts itself.</li>
  <li><strong>Sections 237 and 238</strong> appear in some venue indexes as left-field Loge sections
  but not on the primary source&rsquo;s index. Listed for completeness only.</li>
  <li><strong>Sections 324 and 335</strong>: the source lists rows 1&ndash;8 while the same page says
  seven rows per section.</li>
  <li><strong>Seats per row</strong> is not published for almost any section. Where one specific
  row&rsquo;s seat count was reported, it is recorded; otherwise the field says so rather than
  guessing.</li>
  <li><strong>Compass orientation</strong> (southeast) is corroborated by three shade-analysis sites
  and is internally consistent with reported sun behaviour, but is not confirmed against a primary
  source.</li>
  <li><strong>Position within a zone</strong> &mdash; for example that section 101 sits deeper toward
  right-center than 104 &mdash; is derived from the counter-clockwise numbering rule rather than
  quoted per section. The rule itself is confirmed at three anchor points: 101 in right field, 118
  behind home plate, 131 in left field.</li>
  <li><strong>Section 228</strong> is the one section where the source did not state a
  seat-numbering direction; the global rule is applied.</li>
  <li>Fan reviews from October 2025 report that <strong>sections 407 and 408</strong> now have a
  significantly restricted view of right field because of new office construction.</li>
</ol>

<h3>Sources</h3>
<ul>
  <li><a href="https://www.mlb.com/brewers/ballpark/information/guide">Milwaukee Brewers ballpark
  A&ndash;Z guide</a></li>
  <li><a href="https://www.mlb.com/brewers/ballpark/disability-access-guide">Milwaukee Brewers
  disability access guide</a></li>
  <li><a href="https://www.rateyourseats.com/american-family-field">RateYourSeats: American Family
  Field</a></li>
  <li><a href="https://aviewfrommyseat.com/venue/American+Family+Field/">A View From My Seat:
  American Family Field</a></li>
  <li><a href="https://www.ballparksofbaseball.com/ballparks/american-family-field/">Ballparks of
  Baseball: American Family Field</a></li>
</ul>

<h3>About this page</h3>
<p class="prose">Built to WCAG 2.2 Level AA: a skip link, one <code>h1</code> with a properly nested
heading outline, landmark regions, tables with captions and row and column headers, visible focus
indicators, form controls with persistent visible labels, a live region announcing filter results,
targets at least 24 by 24 CSS pixels, no information conveyed by colour alone, text that reflows at
320 pixels wide without horizontal scrolling, and support for the operating system&rsquo;s dark mode.
No JavaScript is required to read any of the content on this page &mdash; the filter is an
enhancement, and the full section table is in the markup.</p>

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
  var LEVELNAME = {1:"Field Level (100s)",2:"Loge Level (200s)",3:"Club Level (300s)",4:"Terrace Level (400s)"};

  function seatRule(d){
    var a = d.hi ? "the edge facing section " + d.hi
                 : "the far edge of the section, with no higher-numbered section beyond it";
    var b = d.lo ? "the edge facing section " + d.lo
                 : "the far edge of the section, with no lower-numbered section beyond it";
    var t = "Seat 1 is on " + a + ". Seat numbers count up toward " + b +
            ". Facing the field, seat 1 is on your left. ";
    if (d.dir.indexOf("first base") > -1){
      t += "Because this section is on the first-base and right-field half of the park, seat 1 is the end of the row closest to home plate, and higher seat numbers are farther from home plate.";
    } else if (d.dir.indexOf("third base") > -1){
      t += "Because this section is on the third-base and left-field half of the park, the rule flips: seat 1 is the end of the row farthest from home plate, and higher seat numbers are closer to home plate.";
    } else {
      t += "This section is behind home plate, so seat 1 is on its third-base side and the highest seat number is on its first-base side.";
    }
    return t;
  }

  function aisleText(d){
    var p = ["Stairway aisles run along both side edges of the section. Rows are not split by a mid-row aisle, so seat numbers run continuously from one side aisle to the other."];
    p.push(d.ent && d.ent !== "UNKNOWN"
      ? "The entry portal and cross-aisle are at row " + d.ent + "."
      : "The entry portal row is not published.");
    if (d.walk) p.push("A walkway crosses the section " + d.walk + ".");
    if (d.wc)   p.push("A wheelchair seating platform sits " + d.wc + ".");
    return p.join(" ");
  }

  function distText(d){
    if (d.off === 0) return "Directly behind home plate.";
    return d.off + " section" + (d.off === 1 ? "" : "s") + " " + d.dir + " from the sections directly behind home plate.";
  }

  function row(dt, dd){
    var w = document.createElement("div");
    var a = document.createElement("dt"); a.textContent = dt;
    var b = document.createElement("dd"); b.textContent = dd;
    w.appendChild(a); w.appendChild(b); return w;
  }

  function card(d){
    var art = document.createElement("div");
    art.className = "sec";
    var h = document.createElement("h3");
    h.id = "sec-" + d.s;
    h.textContent = "Section " + d.s + " \\u2014 " + LEVELNAME[d.lv];
    art.appendChild(h);
    var dl = document.createElement("dl");
    dl.className = "kv";
    dl.appendChild(row("Zone", d.z));
    dl.appendChild(row("Where it is", d.loc));
    dl.appendChild(row("Side of the ballpark", d.side));
    dl.appendChild(row("Distance from home plate", distText(d)));
    dl.appendChild(row("Rows in this section", d.rows));
    dl.appendChild(row("Aisles, walkways and entry", aisleText(d)));
    dl.appendChild(row("How seats are numbered", seatRule(d)));
    if (d.spr) dl.appendChild(row("Seats per row", d.spr));
    if (d.notes) dl.appendChild(row("Notes", d.notes));
    dl.appendChild(row("Confidence in this data", d.conf));
    art.appendChild(dl);
    return art;
  }

  var results = document.getElementById("results");
  var count   = document.getElementById("count");
  var q       = document.getElementById("q");
  var boxes   = Array.prototype.slice.call(document.querySelectorAll('input[name="lv"]'));
  var reset   = document.getElementById("reset");
  var timer   = null;

  function haystack(d){
    return (d.s + " " + d.z + " " + d.loc + " " + d.side + " " + d.dir + " " + d.notes).toLowerCase();
  }

  function render(){
    var term = q.value.trim().toLowerCase();
    var levels = boxes.filter(function(b){ return b.checked; })
                      .map(function(b){ return parseInt(b.value, 10); });
    var list = DATA.filter(function(d){
      if (levels.indexOf(d.lv) === -1) return false;
      if (!term) return true;
      return haystack(d).indexOf(term) > -1;
    });
    var frag = document.createDocumentFragment();
    list.forEach(function(d){ frag.appendChild(card(d)); });
    results.replaceChildren(frag);
    if (list.length === DATA.length) {
      count.textContent = "Showing all " + DATA.length + " sections.";
    } else if (list.length === 0) {
      count.textContent = "No sections match. Try a different word, or reset the filters.";
    } else {
      count.textContent = "Showing " + list.length + " of " + DATA.length + " sections.";
    }
  }

  q.addEventListener("input", function(){
    window.clearTimeout(timer);
    timer = window.setTimeout(render, 250);
  });
  boxes.forEach(function(b){ b.addEventListener("change", render); });
  reset.addEventListener("click", function(){
    q.value = "";
    boxes.forEach(function(b){ b.checked = true; });
    render();
    q.focus();
  });
  document.getElementById("filters").addEventListener("submit", function(e){ e.preventDefault(); });

  render();
})();
</script>
</body>
</html>
"""

import os
def kb(p):
    n = os.path.getsize(p)
    return f"{n/1024:.0f} KB" if n >= 1024 else f"{n} bytes"

out = (PAGE.replace("__LAYOUT_ROWS__", layout_rows)
           .replace("__GLANCE_ROWS__", glance_rows)
           .replace("__SIZE_SECTIONS__", kb(outpath("american_family_field_sections.csv")))
           .replace("__SIZE_LAYOUT__", kb(outpath("american_family_field_layout.csv")))
           .replace("__SIZE_NOTES__", kb(outpath("american_family_field_notes.md")))
           .replace("__DATA__", json.dumps(data, ensure_ascii=False, separators=(",", ":"))))

with open(outpath("index.html"), "w", encoding="utf-8") as f:
    f.write(out)
print("bytes:", len(out.encode("utf-8")))
