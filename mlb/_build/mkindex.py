#!/usr/bin/env python3
"""Build the MLB index page linking every completed ballpark guide."""
import csv, os, html

HERE = os.path.dirname(os.path.abspath(__file__))
CSS = open(os.path.join(HERE, 'shared.css'), encoding='utf-8').read()
OUT = os.path.dirname(HERE)          # the repo root, where the park folders live

PARKS = [
    dict(slug="amfamfield", venue="American Family Field", team="Milwaukee Brewers",
         city="Milwaukee, Wisconsin", opened="2001", capacity="41,900",
         seat1="left", toward="third base and left field", seat1_end="higher",
         rows="Numbers, with gaps on the Terrace level — rows 4, 6 and 7 do not exist",
         quirk="A wheelchair platform sits in the row gap between rows 3 and 5 in the "
               "even-numbered Terrace sections, which is visible in the row labels."),
    dict(slug="wrigleyfield", venue="Wrigley Field", team="Chicago Cubs",
         city="Chicago, Illinois", opened="1914", capacity="41,649",
         seat1="left", toward="first base and right field", seat1_end="lower",
         rows="Numbers",
         quirk="A 1914 steel-post ballpark. Support posts obstruct many Terrace-level seats from "
               "about row 7 back; rows 1 to 6 are the only pole-free rows."),
    dict(slug="buschstadium", venue="Busch Stadium", team="St. Louis Cardinals",
         city="St. Louis, Missouri", opened="2006", capacity="about 44,000",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Mixed — lettered rows in front, numbered rows behind a cross-aisle",
         quirk="Field-level infield sections read like &ldquo;F-L, 1-24&rdquo;. Row F is the front "
               "row and row 1 is behind row L, which catches people out."),
    dict(slug="greatamericanballpark", venue="Great American Ball Park", team="Cincinnati Reds",
         city="Cincinnati, Ohio", opened="2003", capacity="45,814",
         seat1="right", toward="first base and right field", seat1_end="higher",
         rows="Letters, running A to Z and then AA to GG",
         quirk="Accessible seating is in the last row of sections across nearly every price level, "
               "rather than at the front."),
    dict(slug="pncpark", venue="PNC Park", team="Pittsburgh Pirates",
         city="Pittsburgh, Pennsylvania", opened="2001", capacity="about 38,700",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Letters, running A to Z and then AA to KK",
         quirk="The Pirates dugout is on the third-base side — unusual in the majors, and done so "
               "the home team looks out over right field toward the skyline."),
    dict(slug="daikinpark", venue="Daikin Park", team="Houston Astros",
         city="Houston, Texas", opened="2000", capacity="about 41,000",
         seat1="left", toward="first base and right field", seat1_end="lower",
         rows="Numbers, with infield sections starting at row 5",
         quirk="Renamed from Minute Maid Park in January 2025. The Crawford Boxes, sections "
               "100-104, are the short porch in left field."),
    dict(slug="angelstadium", venue="Angel Stadium", team="Los Angeles Angels",
         city="Anaheim, California", opened="1966", capacity="45,517",
         seat1="left", toward="first base and right field", seat1_end="lower",
         rows="Letters at every level, with I, O and Q skipped",
         quirk="Fourth-oldest ballpark in the majors. Sections 214-220 are not sold as numbered "
               "seats at all - a club occupies that gap behind home plate."),
    dict(slug="sutterhealthpark", venue="Sutter Health Park", team="Athletics",
         city="West Sacramento, California", opened="2000", capacity="about 14,000",
         # `split` makes card() print the phrase instead of slotting the value into
         # "seat 1 is on your X - which puts it on the Y-numbered side", a sentence that
         # reads as gibberish when the answer is that nobody publishes it.
         split=True,
         seat1="not published by any source", toward="third base and left field",
         seat1_end="no source states which side seat 1 is on, so this guide does not either",
         t_seat1="not published", t_end="not documented",
         rows="Mixed - lettered front rows, numbered rows, and a WC accessible row on top",
         quirk="The Athletics' temporary home through at least 2027 and by far the smallest park "
               "here. It is also the one park where no source states which side seat 1 is on."),
    dict(slug="tmobilepark", venue="T-Mobile Park", team="Seattle Mariners",
         city="Seattle, Washington", opened="1999", capacity="about 47,400",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Numbers, but many sections start at row 5, 9, 17 or 23 rather than 1",
         quirk="The roof covers without enclosing, so it keeps rain off but never becomes an "
               "indoor stadium."),
    dict(slug="globelifefield", venue="Globe Life Field", team="Texas Rangers",
         city="Arlington, Texas", opened="2020", capacity="about 40,300",
         seat1="left", toward="first base and right field", seat1_end="lower",
         rows="Numbers",
         quirk="The Lower Level uses one- and two-digit numbers, so section 14 is a premium seat "
               "and section 114 is a tier up. Sections 27-33 break the sequence and sit in left "
               "field."),
    dict(slug="ratefield", venue="Rate Field", team="Chicago White Sox",
         city="Chicago, Illinois", opened="1991", capacity="40,615",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Numbers, many sections ending in a WCH wheelchair row",
         quirk="Renamed from Guaranteed Rate Field in December 2024. Premium seats behind the plate "
               "carry an S suffix - 130S, 131S, 133S, 134S. There is no 200 or 400 series."),
    dict(slug="progressivefield", venue="Progressive Field", team="Cleveland Guardians",
         city="Cleveland, Ohio", opened="1994", capacity="about 34,800",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Letters, A to Z then AA to HH",
         quirk="The 300-series Press Level runs only along the first-base side and never wraps "
               "behind the plate, so distances from home plate are left blank on that tier."),
    dict(slug="comericapark", venue="Comerica Park", team="Detroit Tigers",
         city="Detroit, Michigan", opened="2000", capacity="41,083",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Mixed letters and numbers - any row ending AC is the accessible row",
         quirk="The Tigers dugout is on the third-base side. The Mezzanine, 210-219, exists only "
               "down the right-field line. There is no section 335."),
    dict(slug="kauffmanstadium", venue="Kauffman Stadium", team="Kansas City Royals",
         city="Kansas City, Missouri", opened="1973", capacity="about 37,900",
         seat1="left", toward="first base and right field", seat1_end="lower",
         rows="Letters on every level, often ending in a VWC or WWC wheelchair row",
         quirk="The only park in its division whose numbers run the other way. Section 141's page "
               "contradicts the park's own seat-1 rule."),
    dict(slug="targetfield", venue="Target Field", team="Minnesota Twins",
         city="Minneapolis, Minnesota", opened="2010", capacity="38,544",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Numbers, with WC rows interleaved into the numbering rather than at one end",
         quirk="The Main Level wraps the whole way round - 128-131 are in left field but 132-140 "
               "come back around into right field."),
    dict(slug="truistpark", venue="Truist Park", team="Atlanta Braves",
         city="Atlanta, Georgia", opened="2017", capacity="about 41,100",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Numbers on every level, with no lettered rows anywhere",
         quirk="Opened as SunTrust Park and renamed in 2020. The Lower Level wraps the whole way "
               "round - 153-155 reach centre field and 156-160 come back into right field as the "
               "Chop House."),
    dict(slug="loandepotpark", venue="loanDepot park", team="Miami Marlins",
         city="Miami, Florida", opened="2012", capacity="37,442",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Mixed - lettered rows in front of numbered ones, with a WC row on top",
         quirk="Renamed from Marlins Park in 2021, and the only park here that closes its roof and "
               "air-conditions. Sections 212-218 do not exist, so the Legends level never reaches "
               "home plate."),
    dict(slug="citifield", venue="Citi Field", team="New York Mets",
         city="Flushing, New York", opened="2009", capacity="41,922",
         seat1="left", toward="third base and left field", seat1_end="higher",
         rows="Mixed - lettered rows sit in front of numbered row 1 at Field Level",
         quirk="There is no 200 series at all; the Empire Suite Level fills that band. Sources "
               "contradict each other on which side seat 1 is on, and the whole rule rests on it."),
    dict(slug="citizensbankpark", venue="Citizens Bank Park", team="Philadelphia Phillies",
         city="Philadelphia, Pennsylvania", opened="2004", capacity="42,901",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Numbers, with a WC suffix on the last row of accessible sections",
         quirk="Centre field has no numbered sections, so the run stops at 148 rather than wrapping. "
               "There are no sections 238-240 or 311, and the 400 level starts at 412."),
    dict(slug="nationalspark", venue="Nationals Park", team="Washington Nationals",
         city="Washington, D.C.", opened="2008", capacity="41,373",
         seat1="right", toward="first base and right field", seat1_end="higher",
         rows="Letters on every level, running past Z into AA and beyond",
         quirk="The only park in its division whose numbers run the other way. The press box splits "
               "the upper deck in two behind home plate, so sections 410-415 do not exist."),
    # --- National League West -------------------------------------------------------------
    # Dodger Stadium and Petco Park do not have one seat-1 side or one sweep direction, so they
    # carry split=True and the three t_* keys, which hold the shortened wording for the
    # comparison table. Everything without those keys is a simple one-rule park.
    dict(slug="dodgerstadium", venue="Dodger Stadium", team="Los Angeles Dodgers",
         city="Los Angeles, California", opened="1962", capacity="56,000",
         split=True,
         toward="outward from home plate rather than one way round the bowl &mdash; odd numbers run "
                "down the third-base side toward left field, even numbers down the first-base side "
                "toward right field",
         seat1="right in odd-numbered sections and left in even-numbered ones",
         seat1_end="on both halves that is the end of the row nearest home plate",
         t_toward="outward from home plate by parity &mdash; odd toward third base, even toward first",
         t_seat1="right in odd sections, left in even",
         t_end="the end of the row nearest home plate, on both halves",
         rows="Letters almost everywhere, with a DR drink rail behind row X in the home-plate sections",
         quirk="The largest capacity in the majors, held at 56,000 through every renovation. UNIQLO "
               "bought the naming rights to the field in March 2026, so the playing surface is "
               "UNIQLO Field and the building is still Dodger Stadium."),
    dict(slug="oraclepark", venue="Oracle Park", team="San Francisco Giants",
         city="San Francisco, California", opened="2000", capacity="40,260",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Mixed &mdash; lettered rows run straight into numbered ones inside one section",
         quirk="Opened as Pacific Bell Park, became SBC Park in 2004 and AT&amp;T Park in 2007. The "
               "Promenade series does not stop at the left-field corner but carries on round the "
               "outfield, so 145-152, the Arcade on top of the right-field wall, are the one place "
               "here where a high number means right field."),
    dict(slug="petcopark", venue="Petco Park", team="San Diego Padres",
         city="San Diego, California", opened="2004", capacity="39,860",
         split=True,
         toward="outward from home plate rather than one way round the bowl &mdash; odd numbers run "
                "up the first-base side toward right field, even numbers down the third-base side "
                "toward left field",
         seat1="left in odd-numbered sections and right in even-numbered ones",
         seat1_end="on both halves that is the end of the row nearest home plate",
         t_toward="outward from home plate by parity &mdash; odd toward first base, even toward third",
         t_seat1="left in odd sections, right in even",
         t_end="the end of the row nearest home plate, on both halves",
         rows="Numbers, with lettered front rows A and B in sections 126 and 128",
         quirk="The Upper Deck never reaches the outfield &mdash; the Upper Box sections 226-235 in "
               "left and right field sit on the 200 level instead, with Gallagher Square between "
               "them. The Western Metal Supply Co. Building stands in the left-field corner and its "
               "corner is the foul pole."),
    dict(slug="chasefield", venue="Chase Field", team="Arizona Diamondbacks",
         city="Phoenix, Arizona", opened="1998", capacity="48,330",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Numbers on the three numbered tiers, letters on the Field Level ring",
         quirk="Opened as Bank One Ballpark and renamed in 2005. The lettered Field Level ring A-S "
               "sits in front of the 100 Level, so the 100 Level infield starts at row 21 rather "
               "than row 1. Accessible rows repeat the row number with a C or W suffix."),
    dict(slug="coorsfield", venue="Coors Field", team="Colorado Rockies",
         city="Denver, Colorado", opened="1995", capacity="46,897",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Mixed &mdash; numbered rows from the field back, then a lettered block C to W behind them",
         quirk="Lower Level sections are entered at row W at the top, so you come in behind the "
               "lettered block and walk down as far as 38 rows. The Rockpile, 401-403, is a "
               "three-section bleacher block in straightaway centre field, about 600 feet from home "
               "plate."),
    # --- American League East -------------------------------------------------------------
    dict(slug="yankeestadium", venue="Yankee Stadium", team="New York Yankees",
         city="Bronx, New York", opened="2009", capacity="46,537 or 50,287",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Numbers on every tier, starting at row 1 at the front",
         quirk="Opened across the street from the 1923 ballpark of the same name, which was "
               "demolished, so anything written about that building describes a different place. "
               "The Bleachers, 201-204 and 235-239, share the 200 series with the Main Level "
               "without being part of it."),
    dict(slug="fenwaypark", venue="Fenway Park", team="Boston Red Sox",
         city="Boston, Massachusetts", opened="1912", capacity="37,775",
         split=True,
         toward="two ways at once &mdash; on the Field Box, Loge Box, Grandstand and Bleacher tiers "
                "they sweep from right field and first base, past home plate, on toward third base "
                "and left field, while on the Pavilion tiers they run outward from home plate by "
                "parity, odd down the first-base line and even down the third-base line",
         seat1="right",
         seat1_end="which puts it on the lower-numbered side of the section on the sweeping tiers; "
                   "the Pavilion tiers run out from the plate both ways, so they have no "
                   "lower- or higher-numbered side to be on",
         t_toward="two schemes at once &mdash; a sweep toward third base and left field on most "
                  "tiers, outward from home plate by parity on the Pavilion tiers",
         t_seat1="right",
         t_end="the lower-numbered side on the sweeping tiers; no such side on the Pavilion tiers",
         rows="Letters and numbers, differing tier by tier and section by section",
         quirk="The oldest ballpark in the majors. Every section identifier carries a letter prefix "
               "naming its tier, because the plain numbers repeat &mdash; there is a 42 in the Field "
               "Boxes, a 42 in the Bleachers and a 42 in the Grandstand, hundreds of feet apart."),
    dict(slug="oriolepark", venue="Oriole Park at Camden Yards", team="Baltimore Orioles",
         city="Baltimore, Maryland", opened="1992", capacity="42,455 for 2026",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Numbers on every tier, with an EAL entrance row in the even Field Level sections",
         quirk="The lower bowl runs one series 1-98 across two tiers &mdash; the even sections are the "
               "Field Level in front and the odd sections the Terrace Level directly behind them, "
               "so a count of numbers toward the plate counts both bands. Work between the 2025 and "
               "2026 seasons changed the seat count and put a new Premium Club behind home plate."),
    dict(slug="rogerscentre", venue="Rogers Centre", team="Toronto Blue Jays",
         city="Toronto, Ontario", opened="1989", capacity="39,150",
         seat1="right", toward="third base and left field", seat1_end="lower",
         rows="Numbers, with a lettered row at the back of many 100 Level sections",
         quirk="Opened as SkyDome and renamed after Rogers Communications bought the building in "
               "2005. The 300 and 400 levels are sold by suite and carry no section numbers at all. "
               "Accessible rows are labelled WCA and are usually the entrance row as well."),
    dict(slug="tropicanafield", venue="Tropicana Field", team="Tampa Bay Rays",
         city="St. Petersburg, Florida", opened=None, capacity="25,025",
         split=True,
         toward="outward from home plate rather than one way round the bowl &mdash; odd numbers run "
                "down the third-base side toward left field, even numbers down the first-base side "
                "toward right field",
         seat1="left, in every section of the ballpark",
         seat1_end="but the sections mirror about home plate and the seat numbers do not, so seat 1 "
                   "is the end of the row nearest home plate in an even-numbered section and the "
                   "end farthest from it in an odd-numbered one",
         t_toward="outward from home plate by parity &mdash; odd toward third base, even toward first",
         t_seat1="left, everywhere",
         t_end="nearest home plate in even sections, farthest from it in odd ones",
         rows="Letters everywhere, a single-letter series and then doubled AA to JJ and beyond",
         quirk="A fixed-roof dome, so no section here carries sun or shade advice. Hurricane Milton "
               "tore the roof off in October 2024 and the Rays played 2025 elsewhere; they opened at "
               "home again on 6 April 2026 with the roof rebuilt."),
]

# PARKS stays in the order the divisions were researched, because the slices below index into
# it. DIVISIONS controls the order everything is DISPLAYED in - the ballpark cards and the
# comparison table both iterate it - and that is the order a baseball fan expects to read:
# American League east, central, west, then the National League the same way. Reorder the tuples
# here to change the page; do not reorder PARKS, or every slice silently points at the wrong five
# ballparks.
DIVISIONS = [("American League East", PARKS[25:]),
             ("American League Central", PARKS[10:15]),
             ("American League West", PARKS[5:10]),
             ("National League East", PARKS[15:20]),
             ("National League Central", PARKS[:5]),
             ("National League West", PARKS[20:25])]


def count(slug):
    p = f"{OUT}/{slug}/{slug}_sections.csv"
    if not os.path.exists(p):
        p = f"{OUT}/{slug}/american_family_field_sections.csv"
    with open(p, encoding="utf-8") as f:
        return sum(1 for _ in csv.DictReader(f))


def esc(t):
    return html.escape(str(t), quote=False)


for p in PARKS:
    p["n"] = count(p["slug"])
TOTAL = sum(p["n"] for p in PARKS)

def card(p):
    # A park marked split has no single sweep direction, no single seat-1 side, or both, so its
    # toward and seat1_end values are whole phrases rather than one word and are written to read
    # after a shortened <dt>. They are not escaped, because like rows and quirk they carry entities.
    opened = f"opened {p['opened']}" if p["opened"] else "opening year not stated by the sources"
    if p.get("split"):
        direction = f"""<div><dt>Section numbers increase</dt><dd>{p['toward']}</dd></div>"""
        seat = (f"""<div><dt>Facing the field, seat 1 is on your</dt><dd>{p['seat1']} &mdash;\n"""
                f"""      {p['seat1_end']}</dd></div>""")
    else:
        direction = f"""<div><dt>Section numbers increase toward</dt><dd>{esc(p['toward'])}</dd></div>"""
        seat = (f"""<div><dt>Facing the field, seat 1 is on your</dt><dd>{p['seat1']} &mdash; which puts it on the\n"""
                f"""      {p['seat1_end']}-numbered side of the section</dd></div>""")
    return f"""
<div class="sec">
  <h4><a href="{p['slug']}/">{esc(p['venue'])}</a></h4>
  <p><strong>{esc(p['team'])}</strong> &middot; {esc(p['city'])} &middot; {opened}
  &middot; capacity {esc(p['capacity'])}</p>
  <dl class="kv">
    <div><dt>Sections documented</dt><dd>{p['n']}</dd></div>
    {direction}
    {seat}
    <div><dt>Rows are labelled with</dt><dd>{p['rows']}</dd></div>
    <div><dt>Worth knowing</dt><dd>{p['quirk']}</dd></div>
  </dl>
  <p><a href="{p['slug']}/">Read the full {esc(p['venue'])} guide &mdash; all {p['n']} sections</a></p>
</div>"""

cards = "\n".join(
    f'<h3 id="div-{i}">{esc(name)}</h3>\n' + "\n".join(card(p) for p in parks)
    for i, (name, parks) in enumerate(DIVISIONS))

def short(t):
    """The first clause of a rows description, for the table. Splits on the comma first, so a
    phrase whose own clauses contain commas must put its short label before the first one."""
    return t.split(",")[0].split(" —")[0].split(" &mdash;")[0]


def trow(p):
    # t_toward, t_seat1 and t_end are the shortened table wording, set only where the one-word
    # value would be wrong or missing. Everything else falls back to the plain rule.
    toward = p.get("t_toward") or "toward " + esc(p["toward"])
    seat1 = p.get("t_seat1") or p["seat1"]
    end = p.get("t_end") or f'the {p["seat1_end"]}-numbered side'
    return ("<tr>"
    f'<th scope="row"><a href="{p["slug"]}/">{esc(p["venue"])}</a></th>'
    f'<td>{esc(p["team"])}</td><td>{p["n"]}</td>'
    f'<td>{toward}</td><td>{seat1}</td>'
    f'<td>{end}</td>'
    f'<td>{short(p["rows"])}</td></tr>')

table = "\n".join(
    f'<tr><th scope="rowgroup" colspan="7">{esc(name)}</th></tr>\n' + "\n".join(trow(p) for p in parks)
    for name, parks in DIVISIONS)

HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ballpark seating guides — where every section actually is — The Idea Place</title>
<meta name="description" content="Guides in words to the layout, sections, rows and seat numbering at thirty Major League ballparks across six divisions.">
<style>
{CSS}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>

<header class="site">
  <div class="wrap"><p><strong>The Idea Place</strong> &middot; Projects</p></div>
</header>

<div class="wrap">
<main id="main">

<h1>Ballpark seating guides: where every section actually is</h1>

<div class="lede">
  <p>In order to assist in finding tickets for baseball games, these are overviews of each stadium,
  its sections, and details about the location of every section in the stadium.</p>
</div>

<p class="prose">A ticketing seat map answers one question at a glance: <em>where would I actually
be sitting?</em> These guides answer the same question in words. For every section in every park
covered here you get the level, where the section sits relative to home plate, how many rows deep it
is, which row the entrance is on, and which end of the row seat 1 is on.</p>

<p class="prose">{TOTAL} sections across {len(PARKS)} ballparks are documented so far, covering the whole of
the American League East, Central and West, and the National League East, Central and West.</p>

<h2 id="why">Why a section number on its own is not enough</h2>

<p class="prose">You might reasonably assume the conventions are the same everywhere. They are not.
Across the thirty parks here:</p>

<ul>
  <li><strong>Section numbers run in different directions.</strong> At seven parks they climb toward
  first base and right field, and at nineteen they climb the other way. At three more &mdash; Dodger
  Stadium, Petco Park and Tropicana Field &mdash; they do not sweep round the bowl at all: they run
  outward from home plate, odd numbers down one line and even numbers down the other. Fenway Park
  does both at once, sweeping on its lower tiers and numbering by parity on the Pavilion tiers.</li>
  <li><strong>Seat 1 is not on the same side.</strong> Facing the field it is on your left at eight
  parks and your right at nineteen. At Dodger Stadium and Petco Park it changes with the parity of
  the section, because seat 1 is the end of the row nearest home plate on both halves of the
  ballpark. At Sutter Health Park no source states it at all, and at Citi Field two sources state
  opposite rules.</li>
  <li><strong>Rows are numbers at some parks and letters at others.</strong> Angel Stadium, PNC Park,
  Great American Ball Park, Progressive Field, Kauffman Stadium, Nationals Park, Dodger Stadium and
  Tropicana Field use letters, running past Z into AA and beyond. Busch Stadium, Sutter Health Park,
  Comerica Park, Citi Field, loanDepot park, Oracle Park, Chase Field, Coors Field and Fenway Park
  use both at once. At most of those the lettered rows sit in front of the numbered ones; at Coors
  Field the numbers come first and a lettered block C to W sits behind them.</li>
  <li><strong>Even the dugouts move.</strong> The home dugout is on the first-base side at most of
  these parks, and the third-base side at Wrigley Field, PNC Park, Sutter Health Park, Rate Field,
  Progressive Field, Comerica Park, Oracle Park, Chase Field, Dodger Stadium and Rogers Centre. At
  loanDepot park and Yankee Stadium the sources contradict each other outright.</li>
  <li><strong>Accessible rows are labelled differently everywhere.</strong> WCH at Rate Field and
  again at Tropicana Field, VWC or WWC at Kauffman, an AC suffix at Comerica, WCA at Rogers Centre, a
  C or W suffix at Chase Field, WC interleaved mid-numbering at Target Field, a WC suffix on the last
  row at Citizens Bank Park, and at Nationals Park a WC suffix on the section number rather than the
  row. Oracle Park, Petco Park, Dodger Stadium and Fenway Park publish no convention at all, and at
  Oriole Park at Camden Yards there is no label either &mdash; section 336 reads 1&ndash;5,
  9&ndash;25 and the missing rows 6 to 8 are the wheelchair platform.</li>
  <li><strong>Numbering is not always continuous.</strong> Globe Life Field's lower level runs
  1&ndash;26 round the infield and then jumps to left field for 27&ndash;33. Target Field's Main
  Level wraps the whole way round, putting 132&ndash;140 back in right field, and Truist Park's,
  loanDepot park's and Oracle Park's lower levels do the same. American Family Field's Terrace rows
  skip 4, 6 and 7 entirely, and Nationals Park has no sections 410&ndash;415 because the press box
  sits there. At Oriole Park at Camden Yards one run of numbers, 1&ndash;98, alternates between two
  tiers, the even sections in front and the odd sections directly behind them.</li>
</ul>

<p class="prose">So a habit learned at one ballpark will mislead you at the next one. Each guide
below states the rule for that park and then applies it section by section, so you do not have to
work it out from the number alone.</p>

<div class="tablewrap" tabindex="0" role="group" aria-labelledby="cap-compare">
<table>
  <caption id="cap-compare">How the ballparks compare</caption>
  <thead>
    <tr>
      <th scope="col">Ballpark</th><th scope="col">Team</th><th scope="col">Sections</th>
      <th scope="col">How the numbers run</th>
      <th scope="col">Facing the field, seat 1 is on your</th>
      <th scope="col">Which end of the row that is</th>
      <th scope="col">Rows labelled with</th>
    </tr>
  </thead>
  <tbody>
{table}
  </tbody>
</table>
</div>

<h2 id="parks">The ballparks</h2>
<p class="prose">Grouped by division. Each links to a full guide.</p>
{cards}

<h2 id="method">How these were built</h2>

<p class="prose">Rows, entrance rows, ticket zones and seat-numbering direction come from
RateYourSeats, one page fetched per section, with A View From My Seat as a fallback. Orientation,
dugouts, bullpens, capacity and accessibility come from each team's own ballpark and accessibility
guides, cross-checked against independent ballpark guides.</p>

<p class="prose">Where a source does not state something, the data says so rather than guessing.
Every section carries a confidence rating, and every guide lists what could not be confirmed. The
underlying CSV and notes files are linked for download from each ballpark's page, so you can check
the working or reuse the data.</p>

<p class="prose">These pages are built to WCAG 2.2 Level AA and audited with axe-core in both light
and dark mode. No JavaScript is required to read any of the content.</p>

<h2 id="caveats">Before you buy</h2>

<p class="prose">Ballparks change. Netting gets extended, sections get renamed, construction blocks
sightlines that were fine last season. Everything here was compiled in August 2026 from public
sources and is not a substitute for the team's own ticket office, which can confirm a specific seat
and is the right place to arrange accessible seating.</p>

<p class="prose">If something here is wrong &mdash; a section placed on the wrong side of the park, a
row range that does not match the ticket in your hand, a seat-numbering rule that reads backwards
&mdash; please <a href="https://github.com/kellylford/TheWorkBench/issues">file an issue on
GitHub</a>. Corrections from people who know a ballpark first-hand are the fastest way this gets
better, and the underlying data files linked from every ballpark page are there so you can check the
working.</p>

</main>
</div>

<footer class="site">
  <div class="wrap">
    <p>Compiled August 2026 from public sources. Part of
    <a href="../">The Idea Place projects</a>.</p>
  </div>
</footer>
</body>
</html>
"""

open(f"{OUT}/index.html", "w", encoding="utf-8").write(HTML)
print("index written:", len(HTML), "bytes |", TOTAL, "sections across", len(PARKS), "parks")
for p in PARKS:
    s1 = p.get("t_seat1") or p["seat1"]
    print(f"  {p['venue']:<28} {p['n']:>4} sections  seat1={s1}")
