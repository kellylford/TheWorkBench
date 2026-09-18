#!/usr/bin/env python3
"""Shared renderer: turns researched section data into a CSV pair, a notes file and an
accessible HTML page. Used by every ballpark except American Family Field, which has its
own hand-authored builder (build.py / build_page.py)."""
import csv, json, html, os, re

def esc(t):
    return html.escape(str(t or ""), quote=False)

def clean(t):
    """Strip the stray wrapping quotes some sources return, collapse whitespace."""
    t = str(t or "").strip()
    if len(t) > 1 and t[0] == '"' and t[-1] == '"':
        t = t[1:-1]
    t = re.sub(r'\s+', ' ', t).strip()
    return t

NOT_NAMED = "not named by the source"
NOT_STATED = "not stated by the source"

def val(t, fallback):
    """Empty or a literal UNKNOWN both mean the source did not say."""
    t = clean(t)
    return fallback if (not t or t.upper().startswith("UNKNOWN")) else t

# Labels the research used to say where each fact came from. What follows the colon is
# usually worth keeping - "Rows T and above are under cover" is exactly what a reader wants
# - but the label in front of it is a note about the source's page furniture, not about the
# ballpark. So strip the label and keep the claim, rather than dropping the sentence whole.
_LABEL = re.compile(
    r'\A\s*(?:'
    # an ALL-CAPS field label the research used as a heading: "SEATS PER ROW:", "NETTING -"
    r'[A-Z][A-Z0-9 /&-]{2,34}(?=\s*[:\u2014-])'
    # the source's own page furniture
    r'|section insights?|seating notes?|rows? numbers? block|amenity description'
    r'|page heading|breadcrumb|verbatim'
    # "Zone-level (Reserve Level) prose repeated on every Lower Reserve page, NOT specific..."
    r'|(?:shared |generic |repeated )?zone(?:[- ]level)?(?:[ ][\w()/,-]+){0,4}? '
    r'(?:text|notes?|prose|block|blurb|description|statement|sentence|heading|bullet|'
    r'passage|paragraph)'
    r'|(?:shared|generic|zone[- ]level|boilerplate)[^:"\u201c]{0,50}'
    r'(?:text|prose|block|description|blurb|passage)'
    r'|rateyourseats(?:[ ]\w+){0,4}? (?:zone|expert|review|description|text|block)'
    # a trailing parenthetical that names the source: "Unobstructed views (zone text):"
    r'|[^:"\u201c()]{0,50}\((?:zone[^)]{0,40}|shared[^)]{0,40}|generic[^)]{0,40})\)'
    r')[^:"\u201c]{0,130}?\s*:\s*', re.I)

# The same source labels again, but anywhere in a sentence rather than only at its start.
# The sentence splitter cannot break inside a quotation, so a page that runs several quoted
# claims together leaves labels stranded mid-string: `... "Rows 1-32." Seating Notes: "For
# baseball games..."`. Removing the label leaves the quotations, which is the content.
_LABEL_MID = re.compile(
    r'\s*(?:section insights?|seating notes?|rows? numbers? block|zone bullets?(?: shown)?|'
    r'amenity description|expert review(?: block)?|zone (?:text|notes?|prose|block|bullets?))'
    r'(?:\s+(?:also\s+)?(?:lists?|flags?|shows?|states?|adds?|reads?|says?))?'
    r'[^:"\u201c.]{0,40}?\s*[:;]\s*', re.I)

# A parenthetical whose whole job is to say the quote came from the zone page rather than
# the section page. The caveat is already carried by the row's confidence rating.
_PLUMBING_PAREN = re.compile(
    r'\s*\([^)]{0,110}?(?:zone[- ]level|not written specifically|page contains no|'
    r'not section-specific|repeated on every|served on every|applies to sections)'
    r'[^)]{0,110}\)', re.I)

# Scaffolding that can be deleted mid-sentence without touching the claim around it.
_SCAFFOLD = re.compile(r',?\s*\bverbatim\b\s*[:,]?\s*|\s*\(verbatim\)\s*|'
                       r'\s*\[sic[^\]]*\]\s*|\s*\bas returned\b\s*|'
                       r'\s*\(not section-specific\)\s*|\s*\bUNKNOWN\.?\s*\Z', re.I)

# Sentences that are purely about the research or the source's page furniture. These are
# dropped even when they quote something, because the quote is of the page's own plumbing.
_META_HARD = re.compile(
    r'discovery\.json|page is largely generic|byte-identical|every page in this batch|'
    r'identical boilerplate|captured from the pages fetched|carries no link|'
    r'section index carries no|\bnot section-specific\b|page (?:heading )?is (?:titled|served|largely|only)|'
    r'venue index link|link(?:s)? to (?:one|a single) shared|shared zone (?:description )?page|'
    r'second (?:fetch|pass)|extraction pass|page-to-markdown|targeted re-?(?:read|fetch)|'
    r'recorded (?:as observed|but not|verbatim and)|not reconciled|'
    r'confirmed by (?:two|a second|another)|\bre-?verified\b|per the brief|'
    r'(?:returned|fetched) by the fetch|the fetch returned|a finding, not a failure', re.I)

# "No fan reviews." "No seats-per-row figure stated." "No netting or shade line." These
# report the absence of a source, not a fact about the ballpark, and there are thousands of
# them. The keyword list keeps genuine negatives - "No alcohol is sold in this section" has
# nothing to do with the page, so it stays.
_ABSENCE = re.compile(
    r'\A\s*fan (?:feedback|reviews?)\s*[:\-\u2013\u2014]?\s*(?:none|no(?:ne)? \w+|n/?a|nil)\b'
    r'(?=[^"\u201c]*\Z)|'
    r'\A\s*(?:no|none|nothing|neither)\b(?![^"“]*["“][^"”]{25,})\.{0,0}.{0,150}?\b(?:'
    r'pages?|sources?|index|stated|printed|published|listed|appears?|reviews?|feedback|'
    r'insights?|figures?|lines?|sentences?|statements?|mentions?|data|information|texts?|'
    r'warnings?|notes?|available|given|found|exists?|carr(?:y|ies)|blurb'
    r')\b', re.I)

# Anything the source is actually quoted as saying earns its place regardless.
_QUOTED = re.compile(r'["“][^"”]{30,}["”]')

# A sentence about the research that is kept when it carries a real quotation.
_META = re.compile(
    r'\bq&a\b|no per-section|\bboilerplate\b|no (?:sentence|line|text|prose) on (?:this|the) page|'
    r'no field-position sentence|no sentence (?:names|places|identifies)|'
    r'generic zone text|zone text only|\ANo\b.{0,80}\bUNKNOWN\.?\Z|'
    r'\bthis page (?:contains|carries|has|states) no\b|\bthe page (?:contains|carries) no\b|'
    r'no (?:such )?(?:line|sentence|statement|text) (?:is )?(?:printed|stated|found)|'
    r'\bzone-level text\b', re.I)

# Break after a full stop, and also after a full stop that sits inside a closing quote -
# `...watching the game." No sentence on the page places...` is two sentences, and without
# the second alternative the bookkeeping half rode along attached to the useful half.
_SENT = re.compile(r'(?<=[.!?])\s+(?=[A-Z"“(])|(?<=[.!?]["”’\')])\s+(?=[A-Z"“(])')


def prose(t, fallback, limit=520):
    """Reader-facing text, with the research bookkeeping taken out.

    The research files record how each fact was obtained as well as the fact itself, which
    is right for a dataset meant to be auditable - but that bookkeeping was reaching the
    published page. Three kinds of it, handled three ways:

    - **Source labels** - "Seating Notes:", "Section Insights:", "Zone-level description
      printed on the section page:" - are stripped off the front, and the claim after the
      colon is kept. That is the case where dropping the whole sentence would lose real
      information.
    - **Absence reports** - "No fan reviews.", "No seats-per-row figure stated." - are
      dropped. They describe the source, not the ballpark.
    - **Process notes** - "byte-identical zone prose", "not reconciled" - are dropped even
      when quoted, because what they quote is the page's plumbing.

    Everything else survives, and a sentence quoting the source at any length survives the
    softer tests outright. Nothing is lost either way: `_build/research/<team>/` ships in
    the repository with the full text, and each park's notes file says so.
    """
    t = val(t, "")
    if not t:
        return fallback
    keep = []
    for part in _SENT.split(t):
        part = original = part.strip()
        for _ in range(3):                       # labels sometimes nest: "Zone note (RYS): "
            stripped = _LABEL.sub("", part, count=1).strip()
            if stripped == part:
                break
            part = stripped
        if not part or _META_HARD.search(part) or _META_HARD.search(original) \
                or _ABSENCE.match(part):
            continue
        if _META.search(part) and not _QUOTED.search(part):
            continue
        part = _PLUMBING_PAREN.sub(" ", part)
        part = _LABEL_MID.sub(" ", part)
        part = _SCAFFOLD.sub(" ", part).strip(' -–—;,:')
        part = re.sub(r'\s{2,}', ' ', part)
        if len(part) < 3 or re.fullmatch(r'[\W_]+', part):
            continue
        keep.append(part)
        if sum(len(x) + 1 for x in keep) >= limit:
            break
    out = " ".join(keep).strip()
    if out.count('"') % 2:
        # An odd number of quote marks means one end of a quotation was in a sentence that
        # did not survive. Drop a dangling closer, otherwise close an open quotation.
        out = out[:-1].rstrip() if out.endswith('"') and not out.startswith('"') else out + '"'
    return out or fallback


def zone_short(t, sec=None, venue=None):
    """A tidy label for the zone column; the section CSV keeps the full researched text.

    Research records the zone in whatever form the source published it, and across thirty
    ballparks that varied enormously. Some agents wrote the bare zone name, some wrote the
    page's own H1, and some wrote a paragraph about both - `Page heading: "Field Box 1 at
    Fenway Park". The zone review block served on this page is headed "Right Field
    Boxes"...`; or `Section 104 at Yankee Stadium - "Field Level Outfield"`. Left alone that
    gives every section its own zone: Fenway came out with 234 "zones" across 273 sections,
    which is no aggregation at all.

    So generate candidate labels in order of how likely they are to be the zone name - the
    leading fragment, the fragment after a dash, the string with a `Page heading:` wrapper
    unpicked, then the whole first sentence - and take the first that survives cleaning.
    Cleaning strips the two things a page heading carries that a zone name should not: the
    venue name and the section's own identifier. A candidate that reduces to no more than
    the word "section" is not a zone name, so it is rejected and the next one tried; if
    they all reduce to that, the honest answer is that the source did not name a zone.
    """
    raw = val(t, NOT_NAMED)
    if raw == NOT_NAMED:
        return raw
    first = re.split(r'(?<=[.!"”])\s+(?=[A-Z])', raw)[0]
    SPLIT = r'\s*[(—;]|\s+[-–]\s+'
    CLEAN = re.compile(r"[A-Za-z0-9][A-Za-z0-9 &'/.\-]{0,58}")

    def tidy(x):
        x = x.strip().strip('.').strip()
        x = re.sub(r'^["“‘\']\s*', '', x)
        x = re.sub(r'["”’\']\s*\)?\s*[.,]?\s*$', '', x).strip()
        x = re.sub(r'\s*\([^)]*\)\s*$', '', x).strip() or x
        x = re.sub(r'\s*\([^)]*$', '', x).strip() or x
        if venue:
            x = re.sub(r'\s+at\s+.{0,40}?' + re.escape(venue) + r'\s*$', '', x, flags=re.I)
        if sec is not None:
            n = parse_section(sec)[0]
            for tail in [str(sec)] + ([str(n)] if n is not None else []):
                cut = re.sub(r'[\s#–—-]*' + re.escape(tail) + r'\s*$', '', x, flags=re.I)
                if cut != x and cut.strip(' -–—,'):
                    x = cut
                    break
        x = x.strip(' -–—,")”')
        return "" if re.fullmatch(r'(?:the\s+)?sections?', x, re.I) else x

    parts = re.split(SPLIT, first, maxsplit=1)
    head = parts[0].strip(' .,')
    rest = parts[1] if len(parts) > 1 else ""
    unwrapped = re.sub(r'^.{0,60}?\b(?:heading|title|name)s?\b[^:"]{0,40}'
                       r'(?::|\s+(?:is|reads|was))\s*', '', first, flags=re.I)
    for cut in [" - page heading", " (page heading", ";", " - RateYourSeats", " - rateyourseats"]:
        if cut in unwrapped:
            unwrapped = unwrapped.split(cut)[0]

    # A candidate that still talks about headings, titles or the source's own page
    # furniture is research bookkeeping, not a zone name. Rejecting it here is what stops
    # cells reading `Page heading: "Section` - 288 of them across five ballparks.
    ARTEFACT = re.compile(r'\b(?:page|block|zone|tier|category|expert[- ]review)?\s*'
                          r'(?:heading|title)s?\b|\bh1\b|\bbreadcrumb\b|\bno zone name\b'
                          r'|\bdoes not name a zone\b|\brateyourseats\b|\bverbatim\b'
                          # A sport name is the event type the source filed the zone under,
                          # not a place to sit. Tropicana Field prints "Lower Level Infield
                          # (Baseball)" and stripping the parenthetical left "Baseball".
                          r'|\A\s*(?:baseball|football|concerts?|soccer)\s*\Z', re.I)
    for cand, needs_clean in ((head, True), (head.strip('"\u201c\u201d\u2018\u2019\''), True),
                              (rest, False), (unwrapped, False), (first, False)):
        if not cand or ARTEFACT.search(cand):
            continue
        if needs_clean and not CLEAN.fullmatch(cand.strip()):
            continue
        got = tidy(cand)
        if got and not ARTEFACT.search(got):
            return got
    return NOT_NAMED

def norm_rows(t):
    t = clean(t)
    m = re.match(r'First Row:\s*([A-Za-z0-9]+)\s*\|\s*Last Row:\s*([A-Za-z0-9]+)', t, re.I)
    if m:
        a, b = m.group(1), m.group(2)
        return f"{a} to {b}" + (" (WC is the wheelchair-accessible row)" if b.upper() == "WC" else "")
    t = re.split(r'"\s*;|\s*;\s*aviewfrommyseat|\s*\|\s*Source:', t)[0].strip().rstrip('";,')
    m = re.search(r'labell?ed\s+(.+)$', t, re.I)
    if m:
        t = m.group(1).strip().rstrip('.')
    t = re.sub(r'^Rows?\s+in\s+Section\s+\S+\s+are\s+', '', t, flags=re.I)
    t = re.sub(r'^Rows?\s+', '', t, flags=re.I)
    return t or "UNKNOWN"

def norm_entrance(t):
    t = clean(t)
    if not t or t.upper().startswith("UNKNOWN"):
        return "UNKNOWN"
    m = re.search(r'Row\s+([A-Za-z0-9]+)', t)
    return m.group(1) if m else t

SECTION_RE = re.compile(r'^([A-Za-z]*)(\d+)([A-Za-z]*)$')


def parse_section(sec):
    """Split a section identifier into (number, tag, tag_leads).

    '105' -> (105, '', False); '23LR' -> (23, 'LR', False); 'FB21' -> (21, 'FB', True);
    'SRO' -> (None, 'SRO', True).

    Most parks distinguish their tiers by a hundreds digit, so the tag is empty and
    nothing here matters. Two do not. Dodger Stadium's Reserve, Top Deck and Dugout Club
    tiers all restart at 1 and are told apart only by a trailing letter. Fenway Park goes
    further and puts the letters in front - FB21, LB160, GS18 - so an identifier's letters
    may sit on either side of its number and the two halves have to be available
    separately, along with which way round they go.
    """
    m = SECTION_RE.match(str(sec).strip())
    if not m:
        return None, str(sec).strip().upper(), True
    pre, num, suf = m.group(1).upper(), int(m.group(2)), m.group(3).upper()
    return num, (pre or suf), bool(pre)


def fmt_section(num, tag, tag_leads):
    """Put an identifier back together the way its ballpark writes it."""
    return f"{tag}{num}" if tag_leads else f"{num}{tag}"


def _runs(nums, step, tag="", tag_leads=False):
    out, i = [], 0
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] == nums[j] + step:
            j += 1
        a = fmt_section(nums[i], tag, tag_leads)
        out.append(a if i == j else f"{a}-{fmt_section(nums[j], tag, tag_leads)}")
        i = j + 1
    return out


def compress(secs, step=1):
    """Collapse a list of sections into ranges.

    step=1 is the ordinary case and is what every park built before the National League
    West uses. step=2 is for the parity parks: at Petco Park and Dodger Stadium the
    sections in a zone alternate, so 111, 113, 115 are neighbours on the ground even
    though their numbers are not consecutive, and a step of 1 would list them singly.
    Suffixed identifiers are grouped by suffix, so Dodger Stadium's Top Deck reads
    '1TD-13TD' instead of collapsing into a bare numeric range shared with Field Level.
    """
    parsed = [parse_section(s) for s in secs]
    if any(n is None for n, _, _ in parsed):
        return ", ".join(str(s) for s in secs)
    groups = {}
    for n, tag, leads in parsed:
        groups.setdefault((tag, leads), []).append(n)
    out = []
    for tag, leads in sorted(groups):
        nums = sorted(set(groups[(tag, leads)]))
        if step == 2:
            for par in (1, 0):
                out += _runs([n for n in nums if n % 2 == par], 2, tag, leads)
        else:
            out += _runs(nums, 1, tag, leads)
    return ", ".join(out)


class Venue:
    def __init__(self, cfg, discovery, sections):
        self.c = cfg
        self.d = discovery
        self.s = sections  # dict: section string -> record
        self.order = sorted(self.s, key=self._sortkey)

    # ---- geometry -------------------------------------------------------
    def _sortkey(self, sec):
        n, tag, _ = parse_section(sec)
        return (self.bucket(sec), 0 if n is None else n, tag)

    def parity(self, sec=None):
        """Whether numbering runs outward from home plate by parity.

        Park-wide at Petco Park, Dodger Stadium and Tropicana Field. Fenway Park is the
        awkward case: its lower tiers sweep one way round the bowl while the Pavilion
        tiers number by parity, so there the question can only be answered per tier and
        `parity_levels` names the buckets that do.
        """
        if self.c.get("numbering_mode") == "parity":
            return True
        pl = self.c.get("parity_levels")
        return bool(pl) and sec is not None and self.bucket(sec) in pl

    def bucket(self, sec):
        """Which tier a section belongs to.

        Normally the hundreds digit. A park that reuses the same numbers on several
        tiers and tells them apart by a letter supplies `suffix_levels`, a map from that
        letter tag to a bucket - it covers leading letters as well as trailing ones, so
        Fenway's FB21 and Dodger Stadium's 23LR are handled the same way. Bare numeric
        identifiers still fall through to the hundreds digit, so a park can mix both
        schemes as Dodger Stadium does.
        """
        if str(sec) in (self.c.get("extra_sections") or ()):
            return self.c["extra_level"]
        n, tag, _ = parse_section(sec)
        sl = self.c.get("suffix_levels")
        if sl and tag in sl:
            return sl[tag]
        return (0 if n is None else n) // 100

    def level(self, sec):
        return self.c["levels"][self.bucket(sec)]

    def seat1_side(self, sec):
        """Which side seat 1 is on, facing the field.

        A plain string at most parks, None where no source states it, and a
        {"odd": ..., "even": ...} map at Petco Park and Dodger Stadium, where the
        ticketing source's own per-section answers give one side on each half of the
        ballpark - which amounts to saying seat 1 is always the end nearest home plate.

        `seat1_unknown_levels` suppresses the rule for named tiers. A park-wide rule
        evidenced on the ordinary bowl is not evidence about a tier the sources never
        describe - Dodger Stadium's private Club Suites, whose pages carry no seat
        numbering at all. Extending the rule there would be a guess wearing the park's
        authority, so those sections get the same honest block as an undocumented park.
        """
        if self.bucket(sec) in (self.c.get("seat1_unknown_levels") or ()):
            return None
        side = self.c["seat1_side"]
        if isinstance(side, dict):
            n = parse_section(sec)[0]
            return None if n is None else side["odd" if n % 2 else "even"]
        return side

    def increase_toward(self, sec):
        """Which way the numbers run past THIS section.

        In a parity park the answer depends on the section: the odd run and the even run
        travel away from home plate in opposite directions, so there is no single
        park-wide value the way there is everywhere else.
        """
        if self.parity(sec):
            n = parse_section(sec)[0]
            if n is not None:
                return self.c["parity_sides"]["odd" if n % 2 else "even"]
        return self.c.get("numbers_increase_toward") or "third"

    def rings(self, sec):
        """Whether this tier is two concentric rings sharing one run of numbers.

        Oriole Park's lower bowl numbers 1-98 straight through, but the odd numbers are the
        Terrace Level and the even numbers are the Field Level in front of it. So section 60's
        neighbours on the ground are 58 and 62, not 59 and 61 - 59 and 61 are behind it, one
        tier up. Without this the guide tells a reader the section beside them is the one
        over their shoulder, and counts the other ring's sections into the distance.
        """
        return self.bucket(sec) in (self.c.get("ring_levels") or ())

    def _tier_numbers(self, sec, parity_of=None):
        """The section numbers that actually exist on this section's tier.

        The column is called sections_from_home_plate, so it has to count sections, not
        subtract numbers. Plenty of tiers skip numbers - Oriole Park's upper deck is all
        even, Progressive Field's press level has gaps - and subtracting gave figures up
        to twice the truth, in nine cases larger than the whole tier.
        """
        b = self.bucket(sec)
        out = []
        for x in self.s:
            if self.bucket(x) != b:
                continue
            xn = parse_section(x)[0]
            if xn is None:
                continue
            if parity_of is not None and xn % 2 != parity_of % 2:
                continue
            out.append(xn)
        return sorted(set(out))

    def _count_between(self, sec, n, edge, parity_of=None):
        """How many sections lie between this one and the anchor edge, inclusive of it."""
        nums = self._tier_numbers(sec, parity_of)
        lo, hi = (n, edge) if n < edge else (edge, n)
        return max(0, sum(1 for x in nums if lo <= x <= hi) - 1)

    def offset(self, sec):
        if self.bucket(sec) == self.c.get("extra_level"):
            return None, "not part of the numbered seating bowl"
        ov = (self.c.get("direction_overrides") or {}).get(str(sec))
        if ov:
            return None, ov
        anchor = self.c["anchors"].get(self.bucket(sec))
        n = parse_section(sec)[0]
        if not anchor or n is None:
            return None, "not established for this level"
        lo, hi = anchor
        if self.parity(sec):
            return self._parity_offset(sec, n, lo, hi)
        toward_third = self.c["numbers_increase_toward"] == "third"
        ring = n if self.rings(sec) else None
        if lo <= n <= hi:
            return 0, "behind home plate"
        if n < lo:
            return self._count_between(sec, n, lo, ring), (
                "toward first base / right field" if toward_third
                else "toward third base / left field")
        return self._count_between(sec, n, hi, ring), (
            "toward third base / left field" if toward_third
            else "toward first base / right field")

    def _parity_offset(self, sec, n, lo, hi):
        """Distance in a park that numbers outward from home plate by parity.

        The two anchor sections straddle the plate and have opposite parity - Petco's
        (101, 102). A section counts its distance against whichever anchor edge shares
        its own parity, and two consecutive same-parity numbers are one section apart on
        the ground, hence the halving. If neither edge matches the parity the distance
        would be a guess, so it is left blank rather than fabricated.
        """
        if lo <= n <= hi:
            return 0, "behind home plate"
        edge = lo if lo % 2 == n % 2 else hi
        if edge % 2 != n % 2:
            return None, "not established for this level"
        side = self.c["parity_sides"]["odd" if n % 2 else "even"]
        return self._count_between(sec, n, edge, parity_of=n), (
            "toward third base / left field" if side == "third"
            else "toward first base / right field")

    def neighbours(self, sec):
        """The sections physically either side of this one, within the same tier.

        In a parity park that means the same-parity neighbours: Petco's 111 sits between
        109 and 113, not between 110 and 112.
        """
        b, n = self.bucket(sec), parse_section(sec)[0]
        step2 = self.parity(sec) or self.rings(sec)
        same = []
        for x in self.s:
            if self.bucket(x) != b:
                continue
            xn = parse_section(x)[0]
            if xn is None or n is None:
                continue
            if step2 and xn % 2 != n % 2:
                continue
            same.append((xn, x))
        lo = [t for t in same if t[0] < n]
        hi = [t for t in same if t[0] > n]
        return ((max(lo, key=lambda t: t[0])[1] if lo else None),
                (min(hi, key=lambda t: t[0])[1] if hi else None))

    SEAT1_RE = [re.compile(r'lower(?:[- ]| )number(?:ed)? seats? (?:are|is) on the (left|right)', re.I),
                re.compile(r'seat 1 (?:is|will be|sits)[^.]{0,40}?\b(?:on|at)\b[^.]{0,20}?\b(left|right)\b', re.I),
                re.compile(r'\b(left|right)\b[^.]{0,30}?\blower(?:est)? (?:seat )?numbers?\b', re.I)]

    def extra_seat_rule(self, sec):
        """Seat numbering for an area outside the numbered bowl.

        The park-wide rule is derived from which way the section numbers run, and these areas
        have no place in that sequence - a club behind the plate or a standing-room deck is
        not "between section 114 and 116". So the answer, if there is one, has to come from
        the area's own page, and where that page says nothing the honest output is that
        nothing is published.
        """
        sd = val(self.s[sec].get("seat_direction"), "")
        for rx in self.SEAT1_RE:
            m = rx.search(sd)
            if m:
                return (f"Facing the field, seat 1 is on your {m.group(1).lower()}. That is "
                        "stated on this area's own page. It sits outside the numbered seating "
                        "bowl, so there is no neighbouring section to describe it against.")
        return ("This area sits outside the numbered seating bowl and no seat numbering is "
                "published for it. Check the seat numbers printed on your own ticket, or ask "
                "the ticket office.")

    def seat_rule(self, sec):
        if self.bucket(sec) == self.c.get("extra_level"):
            return self.extra_seat_rule(sec)
        side = self.seat1_side(sec)
        if side is None:
            return ("No source publishes which side seat 1 is on at this ballpark, so this guide "
                    "does not state one. Seat 1 is against one side aisle of the section and the "
                    "numbers count up to the other; check the seat numbers on your own ticket.")
        toward_higher = (side == "left") == (self.increase_toward(sec) == "third")
        lo, hi = self.neighbours(sec)
        near = hi if toward_higher else lo
        far = lo if toward_higher else hi
        a = (f"the edge facing section {near}" if near
             else "the far edge of the section, with no further section beyond it on that side")
        b = (f"the edge facing section {far}" if far
             else "the far edge of the section, with no further section beyond it on that side")
        base = (f"Facing the field, seat 1 is on your {side}. That puts seat 1 on {a}, "
                f"with seat numbers counting up toward {b}.")
        off, direction = self.offset(sec)
        if off == 0:
            extra = (f" This section is behind home plate, so seat 1 is on its "
                     f"{'third-base' if side == 'left' else 'first-base'} side.")
        elif off is None:
            extra = ""
        else:
            # Which way home plate lies is a question about NUMBERS, not about compass
            # words. Deriving it from the direction string only works when the numbers
            # increase toward first base; in a "third" park the same phrase means the
            # opposite side of the anchor, which inverted this sentence at eleven parks.
            # Compare against the anchor instead - correct in both regimes and for both
            # parities.
            anchor = self.c["anchors"].get(self.bucket(sec))
            hp_higher = bool(anchor) and parse_section(sec)[0] < anchor[0]
            toward_hp = (toward_higher == hp_higher)
            extra = (" Seat 1 is the end of the row closest to home plate, and higher seat "
                     "numbers run away from home plate." if toward_hp else
                     " Seat 1 is the end of the row farthest from home plate, and higher seat "
                     "numbers run back toward home plate.")
        return base + extra

    def aisle(self, sec):
        if self.bucket(sec) == self.c.get("extra_level"):
            ent = norm_entrance(self.s[sec].get("entrance_row"))
            return ("The source describes this as a named area rather than a numbered section, "
                    "so it publishes no aisle layout for it."
                    + (f" The entry portal is at row {ent}." if ent != "UNKNOWN" else ""))
        ent = norm_entrance(self.s[sec].get("entrance_row"))
        p = ["Stairway aisles run along both side edges of the section; rows are not split by a "
             "mid-row aisle, so seat numbers run continuously from one side aisle to the other."]
        p.append(f"The entry portal is at row {ent}." if ent != "UNKNOWN"
                 else "The entry portal row is not published for this section.")
        return " ".join(p)

    def confidence(self, sec):
        """How much of this section the sources actually pin down.

        Rows are the load-bearing fact, so no rows is LOW. Above that, three things can be
        missing while the rows are known: the ticket zone, a sentence placing the section
        in the ballpark, and - on a tier the sources never describe - the seat-numbering
        rule. Any of those caps the rating at MEDIUM, because a row calling itself HIGH
        while the page says "not stated by the source" three columns over is the kind of
        quiet overstatement this project exists to avoid.
        """
        r = self.s[sec]
        if norm_rows(r.get("rows")).upper().startswith("UNKNOWN"):
            return "LOW - no row data published for this section"
        if self.seat1_side(sec) is None:
            return "MEDIUM - rows confirmed, no seat numbering published for this section"
        if zone_short(r.get("zone"), sec, self.c.get("venue")) == NOT_NAMED:
            return "MEDIUM - rows confirmed, ticket zone not named by the source"
        if prose(r.get("location"), NOT_STATED) == NOT_STATED:
            return "MEDIUM - rows and zone confirmed, the source does not place this section"
        return "HIGH - zone, rows, location and seat direction stated by the source"

    # ---- outputs --------------------------------------------------------
    HDR = ["section", "level", "zone", "location_in_stadium", "sections_from_home_plate",
           "direction_from_home_plate", "rows_in_section", "entrance_row",
           "aisle_and_walkway_locations", "seat_numbering", "seats_per_row", "notes",
           "confidence"]

    def rows_out(self):
        for sec in self.order:
            r = self.s[sec]
            off, direction = self.offset(sec)
            yield [
                sec, html.unescape(self.level(sec)),
                zone_short(r.get("zone"), sec, self.c.get("venue")),
                prose(r.get("location"), NOT_STATED),
                "" if off is None else off, direction,
                norm_rows(r.get("rows")), norm_entrance(r.get("entrance_row")),
                self.aisle(sec), self.seat_rule(sec),
                val(r.get("seats_per_row"), "not published"),
                prose(r.get("notes"), "", limit=700), self.confidence(sec),
            ]

    def write_sections_csv(self, path):
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(self.HDR)
            for row in self.rows_out():
                w.writerow(row)

    def zones(self):
        """Aggregate sections into zone bands for the layout table."""
        seen = {}
        for sec in self.order:
            z = zone_short(self.s[sec].get("zone"), sec, self.c.get("venue"))
            key = (self.bucket(sec), z)
            seen.setdefault(key, []).append(sec)
        out = []
        for (b, z), secs in sorted(seen.items(),
                                   key=lambda kv: (kv[0][0], parse_section(kv[1][0])[0] or 0)):
            locs = [prose(self.s[x].get("location"), "", limit=300) for x in secs]
            locs = [l for l in locs if l]
            rws = sorted({norm_rows(self.s[x].get("rows")) for x in secs})
            ents = sorted({norm_entrance(self.s[x].get("entrance_row")) for x in secs})
            out.append({
                # Level names are authored with entities for the page; the layout CSV and
                # the zone table both want plain text, and the page escapes what it gets.
                "zone": z, "level": html.unescape(str(self.c["levels"][b])),
                "sections": compress(secs, 2 if self.parity(secs[0]) else 1),
                "count": len(secs),
                "where": (max(locs, key=len) if locs else NOT_STATED),
                "rows": (rws[0] if len(rws) == 1 else f"{len(rws)} different row ranges - see the section table"),
                "entry": (ents[0] if len(ents) == 1 else "varies by section"),
            })
        return out

    def write_layout_csv(self, path):
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["zone", "level", "sections", "section_count", "where_it_is",
                        "typical_rows", "entry_row"])
            for z in self.zones():
                w.writerow([z["zone"], z["level"], z["sections"], z["count"],
                            z["where"], z["rows"], z["entry"]])
