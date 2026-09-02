#!/usr/bin/env python3
"""Per-ballpark configuration for the National League West.

Two of these five parks broke assumptions the first twenty were built on. Petco Park and
Dodger Stadium number outward from home plate by parity rather than sweeping one way
round the bowl, and Dodger Stadium tells four of its tiers apart by a letter suffix
rather than a hundreds digit. The extra keys - numbering_mode, parity_sides,
suffix_levels, seat1_unknown_levels, and a dict-valued seat1_side - are absent from the
older configs and every branch they drive is inert without them.
"""

GIANTS = dict(

    slug="oraclepark", venue="Oracle Park", team="San Francisco Giants", team_short="Giants",
    research="giants",
    levels={1: "Promenade Level (101-152)", 2: "Alaska Airlines Club Level (202-234)",
            3: "View Level (302-336)"},
    anchors={1: (112, 119), 2: (213, 218), 3: (313, 318)},
    numbers_increase_toward="third", seat1_side="right",
    # The Promenade series is a full loop, not a foul-pole-to-foul-pole sweep. It runs 101 in the
    # right-field corner, up the first-base line, past the plate, down the third-base line to 135
    # in the left-field corner, then keeps going round the outfield: 136-144 are bleachers beyond
    # the wall and 145-152 are the Arcade, back on top of the RIGHT-field wall. A distance counted
    # along the third-base side would mislead once the numbers have passed centre.
    direction_overrides={
        **{str(n): "in centre field - the Promenade series keeps going round the outfield past the "
                   "left-field corner, so these bleacher sections sit in straightaway centre rather "
                   "than further along the third-base side"
           for n in (142, 143, 144)},
        **{str(n): "in right field - the Outfield Arcade on top of the right-field wall above "
                   "McCovey Cove, where the Promenade series has wrapped the whole way round, so "
                   "these high numbers are back on the first-base side rather than out in left field"
           for n in (145, 146, 147, 148, 149, 150, 151, 152)},
    },
    placeholder="for example: 119, arcade, bleachers, dugout",
    capacity_sentence="Oracle Park opened in 2000 as Pacific Bell Park, became SBC Park in 2004 and "
        "AT&amp;T Park in 2007, and has carried its present name since 2019 under a twenty-year "
        "agreement. The Giants give capacity as 40,260 and Ballparks of Baseball matches them "
        "exactly; Wikipedia prints 41,331 for 2021 onward, and the gap of about a thousand seats is "
        "unexplained by either. Three ticketed tiers carry section numbers: the Promenade Level "
        "101&ndash;152, the Alaska Airlines Club Level 202&ndash;234 and the View Level "
        "302&ndash;336. The Promenade series holds three zones at once &mdash; Lower Box "
        "101&ndash;135 round the infield and both foul lines, the Bleachers 136&ndash;144 beyond "
        "the outfield wall and the Outfield Arcade 145&ndash;152 on top of the right-field wall "
        "&mdash; while the lettered Blue Shield Field Club and Audi Dugout Club rows sit at the "
        "front of sections 107&ndash;124 rather than in a number series of their own. The Airwallex "
        "Suite Level on Level 4 is sold by suite number and has no seating-bowl sections at all.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side. All three numbered "
        "series run the same way and none is reversed. <strong>The Promenade series then keeps "
        "going.</strong> It does not stop at the left-field corner but carries on round the "
        "outfield through the bleachers and closes the circle at the Outfield Arcade, so "
        "145&ndash;152 are the one place in the park where a high number means right field. The "
        "Club and View levels run foul pole to foul pole and do not wrap.",
    stack_note="The home-plate block sits at 112&ndash;119 on the Promenade Level, 213&ndash;218 on "
        "the Club Level and 313&ndash;318 on the View Level, taken in each case from the sections "
        "the ticketing source flags with a home-plate view; the three arcs line up, each centred "
        "between the fifteenth and sixteenth section of its series. <strong>The Promenade anchor is "
        "disputed.</strong> That source centres the arc between 115 and 116, while the Giants' own "
        "pages repeatedly put the behind-the-plate concourse point at 118 and 119 &mdash; Guest "
        "Services, Ticket Services, assistive listening and a water refill station are all listed "
        "there &mdash; and two fan notes place the Giants on-deck circle immediately in front of "
        "117 and 119, which would put the plate lower still. All three readings are recorded and "
        "none is settled. The exact centred section on the Club and View levels is not stated "
        "either, and 316 has no page at all, so 313&ndash;318 has a hole in the middle of it. "
        "<strong>The Airwallex Suite Level never appears here</strong> &mdash; it has no numbered "
        "sections, so no anchor is configured and no distance is offered for it.",
    landmarks=[
        "<strong>Giants (home) dugout:</strong> third-base side. Field Club sections "
        "121&ndash;123 are stated to sit directly behind it and 122&ndash;124 to be near it, with a "
        "fan note giving row B of section 123 as the first row behind the bench. The same review "
        "also says 110&ndash;121 sit between the dugouts, which puts 121 in both places at once.",
        "<strong>Visiting dugout:</strong> first-base side, with Field Club sections 107&ndash;109 "
        "behind it and the sixteen-seat Dugout Box alongside.",
        "<strong>Both bullpens are behind the centre-field wall</strong>, one either side of The "
        "Garden, where they were moved for the 2020 season from foul territory. Only one source "
        "says which is which &mdash; the visitors' pen nearer Triples Alley in right-centre, the "
        "Giants' nearer left field &mdash; and standing-room terraces about three feet above them "
        "are built into the bleachers on both sides.",
        "<strong>Netting is given two different ranges.</strong> The Giants' own seat map says it "
        "extends across sections 101&ndash;135, foul pole to foul pole; the ticketing source still "
        "serves an older note saying the front of sections 105&ndash;126 is screened. Both add that "
        "height and coverage vary by section, and both are recorded here.",
        "<strong>The Outfield Arcade, sections 145&ndash;152</strong>, runs along the top of the "
        "right-field wall above McCovey Cove and is only three to seven rows deep, on benches with "
        "backs rather than individual seats. The park's most popular standing room is the strip "
        "behind it, between those sections and the water.",
        "<strong>The Bleachers, 136&ndash;144</strong>, are backless benches with seat numbers "
        "painted along them, the first five rows sold as Premium Bleachers. Sections 136&ndash;141 "
        "are in left and left-centre below the Coca-Cola Fan Lot and the outsized three-fingered "
        "glove; 142&ndash;144 are in centre, with 144 under the scoreboard.",
    ],
    rows_note="Rows are both letters and numbers, and on the Promenade and View levels the two run "
        "consecutively inside one section, letters at the front and numbers continuing behind them. "
        "On the Promenade infield the Field Club rows A to R sit in front of the numbered rows "
        "through sections 107&ndash;124, and the Audi Dugout Club's triple-letter rows AAA to DDD "
        "sit in front of those again in sections 112, 113, 115, 117, 119 and 121, so the numbered "
        "rows in that block start at 23 rather than 1. Sections 114, 116 and 118 have no lettered "
        "block at all and are numbers only, and the left-field corner sections 132&ndash;134 begin "
        "behind 131 and 135 rather than at the field, so they start at row 12 or row 28. The "
        "Bleachers and the Arcade are numbers, with oddities &mdash; section 140 reads &ldquo;A, "
        "0-26&rdquo; and section 141 reads &ldquo;A, 0-29, B-C&rdquo;, lettered at both ends of the "
        "sequence. The Club Level is letters only, row A first and row M the usual last. The View "
        "Level puts lettered View Box rows in front and numbered View Reserve rows behind, split by "
        "the entry tunnel. <strong>No accessible-row label convention is published anywhere in this "
        "park</strong> &mdash; no WC or equivalent suffix appears on any row list.",
    access_summary="Elevators at Willie Mays Plaza and at Second and King reach every level of the "
        "ballpark, and both those gates have ramps and escalators as well; the Lefty O'Doul and "
        "Seals Plaza elevators reach the Promenade Level only. All restrooms are stated to be fully "
        "accessible. The Giants publish no list of accessible sections for baseball &mdash; their "
        "own advice is to look at Lower Box rows 30 and above, Club Level ADA seats, or the back of "
        "a section &mdash; so this guide names only the two individual placements the sources state.",
    access_list=[
        "Guest Services is behind home plate on the Promenade Level near section 119 &mdash; "
        "wheelchair requests, free wheelchair storage, assistive listening devices and same-day "
        "accessible relocations are all handled there",
        "Section 118's row 42 is stated to be the last row, at the top by the entry tunnel, and "
        "normally reserved for accessible seating",
        "Outfield sections are described as having a row 0 of folding chairs set up in front of the "
        "permanent seating and generally reserved for accessible seating; section 150 is the "
        "section quoted, and its own row list stops at 3",
        "A free accessibility shuttle runs between Lot A at Pier 48 and the O'Doul Gate, and there "
        "is a drop-off zone on Third Street between that gate and the Dugout Store",
        "Windows 1 to 3 at the King Street box office are accessible, and open captioning of all "
        "public-address content runs on a board below the DiamondVision in left-centre field",
    ],
    uncertain=[
        "<strong>The Promenade home-plate block is disputed by about three sections.</strong> The "
        "ticketing source flags a home-plate view on 112&ndash;119 and centres the arc between 115 "
        "and 116; the Giants' own pages put the behind-the-plate point at 118 and 119 four separate "
        "times; two row-AA fan notes put the Giants on-deck circle in front of 117 and 119, which "
        "would place the plate lower still. 112&ndash;119 is used here because it is the only "
        "reading stated as a range and the only one consistent with the dugout statements, but the "
        "conflict is not resolved.",
        "<strong>Capacity is stated twice and differently.</strong> The Giants and Ballparks of "
        "Baseball both give 40,260; Wikipedia gives 41,331 for 2021 onward, against 41,915 before "
        "the 2020 fence move and 40,930 in 2000&ndash;01. 40,260 is used as the club's own figure.",
        "<strong>The Club Level anchor rests on a thin base.</strong> The park-level research "
        "confirmed the home-plate flag on section 217 alone and recorded the true range as unknown; "
        "the per-section pass then found the same flag on 213 through 218 and explicitly not on 212 "
        "or 219, so 213&ndash;218 is used. The centred section itself is named by no source.",
        "Eleven numbers have no page in the index: 111, 120, 201, 206, 301, 303, 306, 309, 316, 322 "
        "and 329. No source says whether they do not exist or are merely missing, though a second "
        "ticketing source does list 111. Section 316 falls inside the stated View Level home-plate "
        "range 313&ndash;318.",
        "<strong>The netting range is stated twice and differently</strong> &mdash; the Giants' "
        "seat map says sections 101&ndash;135, the ticketing source says the front of "
        "105&ndash;126. The official figure is preferred but the older note is still being served.",
        "No baseball-configuration list of accessible seating locations was found on any official "
        "page. The only list that names sections &mdash; 123&ndash;131 except 128 and 130 &mdash; "
        "comes from a football-configuration review, so it is not recorded here as a baseball fact, "
        "and the widely quoted line about accessible rows at the top of most sections could not be "
        "verified word for word on the club's own site.",
        "The seat-1 rule comes from one source family only. The sentence &ldquo;lower number seats "
        "are on the right&rdquo; was checked on twenty-four section pages across every tier and "
        "every part of the bowl with no variation, and two separate question-and-answer entries for "
        "sections 112 and 302 agree with it. No official Giants page states a seat rule at all, so "
        "there is no contradiction but no independent confirmation either.",
        "Which bullpen belongs to which team is single-sourced to one 2020 news report. The "
        "official releases say only that the pens sit either side of The Garden. Pre-2020 text is "
        "still live on both sites &mdash; the Giants' pen in front of 126&ndash;128 and the "
        "visitors' in front of 105&ndash;106, both in foul ground &mdash; and neither describes the "
        "current arrangement.",
        "The compass orientation is not stated by the club or by Wikipedia. Two other sources agree "
        "the batter looks east or east-south-east toward McCovey Cove, which makes the first-base "
        "side the shade side and the third-base line and outfield the sunny side, but &ldquo;due "
        "east&rdquo; and &ldquo;ESE&rdquo; are not the same bearing.",
        "The View Level row labels contradict themselves. Sections 302 and 336 label rows &ldquo;A-D, "
        "1-18&rdquo; yet give the entrance as row E, which is not in the range; 313 and 318 have a "
        "numbered row 0 and the other sections do not; and the two priced products, View Box and "
        "View Reserve, share the same section number but are listed as separate levels with VB and "
        "VR prefixes by the fan-photo source.",
        "The Coors Light Silver Seats are placed in two different parts of the outfield &mdash; the "
        "Giants put them in section 145 of the Arcade in right field, the ticketing source puts "
        "them in deep centre field with a photo captioned right-centre. They may be the same place "
        "described from different angles; neither is preferred.",
    ],
    sources=[("San Francisco Giants ballpark A-Z guide",
              "https://www.mlb.com/giants/ballpark/information/guide"),
             ("Giants accessible services",
              "https://www.mlb.com/giants/ballpark/accessible-services"),
             ("Giants seat map and netting", "https://www.mlb.com/giants/ballpark/seat-map"),
             ("RateYourSeats: Oracle Park", "https://www.rateyourseats.com/oracle-park"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Oracle+Park/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/oracle-park/")],
)

PETCO = dict(

    slug="petcopark", venue="Petco Park", team="San Diego Padres", team_short="Padres",
    research="padres",
    levels={0: "Field Level boxes (0-13)", 1: "Field Level (100s)",
            2: "Toyota Terrace and Upper Box Outfield (200s)", 3: "Upper Deck (300s)"},
    # Petco numbers outward from the plate by parity, so an anchor here is the innermost
    # PAIR on the tier - one odd, one even - and every other section counts its distance
    # against whichever half of that pair shares its own parity.
    anchors={0: (0, 1), 1: (101, 102), 2: (201, 202), 3: (300, 301)},
    numbering_mode="parity",
    parity_sides={"odd": "first", "even": "third"},
    numbers_increase_toward=None,
    seat1_side={"odd": "left", "even": "right"},
    placeholder="for example: 117, terrace, dugout, gallagher square",
    capacity_sentence="Petco Park opened on 8 April 2004 in the East Village, downtown San Diego. "
        "Capacity is 39,860, which MLB's own guide describes as fixed seats only, excluding "
        "accessible seating, standing room and the Gallagher Square lawn. Four numbered tiers: the "
        "field-level dugout and club boxes 0&ndash;13, the Field Level 100s, the Toyota Terrace "
        "200s &mdash; which also carries the Upper Box outfield sections 226&ndash;235 &mdash; and "
        "the Upper Deck 300s. The lettered Premier Club A to L sits at field level behind the "
        "home-plate boxes and is the only lettered run in the ballpark.",
    numbering_summary="<strong>Section numbers do not sweep one way round the bowl.</strong> They "
        "run outward from home plate by parity: odd numbers go up the first-base side and on into "
        "right field, even numbers go down the third-base side and on into left field, so the two "
        "runs climb away from the plate at the same time and the low numbers on every tier are the "
        "ones behind the plate. The rule is stated outright by the club's own netting page, which "
        "names &ldquo;Sections 111-115 on the first base side and Sections 112-116 on the 3rd base "
        "side&rdquo;, and again as a park-wide rule by Petco Park Insider. The lettered Premier "
        "Club A to L is the one exception &mdash; a single sweep from A at the third-base end to L "
        "at the first-base end, with F and G dead centre.",
    stack_note="The behind-the-plate groups named by the sources are 0&ndash;6 in the field-level "
        "club boxes, 101&ndash;106 on the Field Level, 201&ndash;204 on the Toyota Terrace and "
        "300&ndash;305 on the Upper Deck, the four blocks stacking on top of one another. Distances "
        "are counted outward from the innermost pair on each tier: 101 and 102 at Field Level, the "
        "only pair a source names outright, and 0/1, 201/202 and 300/301 elsewhere, which follow "
        "from the parity rule rather than from any statement. <strong>The Upper Deck never reaches "
        "the outfield.</strong> There are no 300-level sections behind the fence at all &mdash; the "
        "left-field and right-field Upper Box sections 226&ndash;235 sit on the 200 level instead, "
        "and Gallagher Square fills the gap between them.",
    landmarks=[
        "<strong>Padres (home) dugout:</strong> first-base side, the odd-numbered side, fronted by "
        "sections 107 and 109, with row 8 in section 107 the first row behind it. The field-level "
        "First Base VIP Box sections 7, 9 and 11 sit beside it, in front of that block.",
        "<strong>Visiting dugout:</strong> third-base side, the even-numbered side, fronted by "
        "sections 108 and 110, with row 8 in section 108 the first row behind it. The Third Base "
        "Coach's Box is sold as sections 8 and 10; Petco Park Insider describes the same seats as "
        "the first three rows of 108 and 110, and no source reconciles the two descriptions.",
        "<strong>Both bullpens sit beyond the wall in left-centre field</strong>, stacked, with the "
        "visiting pen behind the Padres' since the 2013 alterations. Both are immediately beside "
        "section 134 at field level and below section 230 on the 200 level. Whether they lie left "
        "or right of section 134 is stated both ways by different sources.",
        "<strong>Netting</strong>, on the club's own list, covers all Home Plate Club sections and "
        "Field VIP 101&ndash;106, with full square coverage at 109&ndash;110 and angled coverage "
        "out to 111&ndash;115 on the first-base side and 112&ndash;116 on the third-base side. The "
        "ticketing source's fan note repeats a wider-sounding &ldquo;sections 101-116&rdquo; that "
        "leaves the club boxes out.",
        "<strong>The Western Metal Supply Co. Building</strong> is the 1909 brick warehouse in the "
        "left-field corner; its corner is the left-field foul pole, 336 feet from the plate. The "
        "ballpark was turned slightly north to accommodate it, so the batter faces due north, the "
        "third-base side is the west and shaded side and the first-base side is the sunny one. The "
        "Rail drink-rail seats are inside the building, section 226 is at the foul pole beside it "
        "and section 328 sits above.",
        "<strong>Gallagher Square</strong>, formerly the Park at the Park, is the 2.8-acre "
        "general-admission lawn beyond the centre-field wall, with the Sycuan Stage behind the "
        "batter's eye. It has no rows or seat numbers; fan reports simply use &ldquo;Row GA&rdquo;. "
        "The other standing areas are Toyota Beach beyond right-centre and The Point in left field, "
        "whose rows read &ldquo;1, SRO&rdquo;.",
    ],
    rows_note="Rows are numbers almost everywhere. Petco Park Insider states the general rule "
        "&mdash; &ldquo;Section rows start at 1 (closest to the field) and radiate back "
        "consecutively&rdquo; &mdash; but many sections do not start at row 1 and several are split "
        "by a mid-section walkway: section 101 runs 8&ndash;20, section 110 runs 5&ndash;22 then "
        "26&ndash;46, and section 300 begins at row 5. Depth varies from 44 rows in the biggest "
        "Field Level sections to no more than 15 on the Toyota Terrace, three in section 13 and a "
        "single row in section 329. The handful of non-numeric labels are lettered front rows A and "
        "B ahead of row 1 in sections 126 and 128, a row &ldquo;BRS&rdquo; at the back of 128, an "
        "unexplained &ldquo;1D&rdquo; between rows 25 and 27 in section 115, &ldquo;SRO&rdquo; in "
        "The Point and the Agave Club's table and drink-rail rows. <strong>The accessible-row "
        "label convention is unknown</strong> &mdash; no source consulted states a WC-style suffix "
        "anywhere in this ballpark.",
    access_summary="The Padres publish seat categories rather than section numbers: wheelchair "
        "accessible, semi-ambulatory and transfer seats are described in the accessibility guide, "
        "but no per-level list of accessible sections is published anywhere. Accessible seating is "
        "bought through the ticket office by telephone, and guests with disabilities have priority "
        "on every public elevator.",
    access_list=[
        "Three seat categories are named &mdash; wheelchair accessible, semi-ambulatory and "
        "transfer &mdash; with no sections listed for any of them",
        "Accessible seating is sold by the Padres ticket office on 619.795.5555",
        "Elevators are stated near sections 111, 114, 117, 137, 201, 217, 226, 235, 300, 311, 314, "
        "317 and 328, inside the Western Metal Supply Co. Building and at four gates; the list does "
        "not say which elevator serves which level",
        "Guest Service Centers are at sections 108, 131 and 303, with wheelchair storage given as "
        "108 and 135 on the same page; family restrooms are at 109, 202, 219, 310 and 311",
        "Wheelchair escorts to and from seats are available on request, assistive listening devices "
        "come from the section 108 Guest Service Center, and sensory bags are offered with "
        "KultureCity",
    ],
    uncertain=[
        "<strong>The ticketing source's park-wide boilerplate contradicts its own per-section "
        "answers, and is wrong on half the ballpark.</strong> Every section page prints the same "
        "sentence, &ldquo;when looking towards the field, lower number seats are on the right&rdquo;, "
        "with no variation anywhere. But seven of that source's own questions and answers, each "
        "marked verified in February 2026, split by parity: sections 123, 203, 207 and 211 &mdash; "
        "odd, so the first-base side and right field &mdash; put seat 1 on the fan's left, while "
        "sections 110, 112 and 310 &mdash; even, so the third-base side and left field &mdash; put "
        "it on the right, section 112 adding that this is the end &ldquo;closer to home "
        "plate&rdquo;. Section 203's page carries both statements at once. Those seven answers are "
        "one rule, seat 1 is the end of the row nearest home plate, and Petco Park Insider states "
        "exactly that rule in words. This guide follows the seven; the boilerplate is recorded as "
        "contradicted, not reconciled, and it is the even-numbered half where the two happen to "
        "agree.",
        "<strong>Twelve sections have no page of their own.</strong> Sections 0, 1, 2, 3, 4, 5 and "
        "6 redirect to the Home Plate Club zone page, 7, 9 and 11 to the First Base VIP Box and 8 "
        "and 10 to the Third Base Coach's Box, so no row list, entrance row, seats-per-row figure "
        "or seat direction is published for any of them. What is recorded comes from the zone text "
        "and from fan data on A View From My Seat &mdash; seat tags, photo captions and comments "
        "&mdash; and several of those pages have no photographs at all. Section 224's own page "
        "exists but its row block is empty, and its fan reviews disagree, one citing a row A and "
        "another saying the section has only one row.",
        "The single most centred section on a tier is named only at Field Level, where 101 and 102 "
        "are called the most centred of the 101&ndash;106 group. The pairs used for the other three "
        "tiers &mdash; 0/1, 201/202 and 300/301 &mdash; follow from the parity rule and from which "
        "pages carry a home-plate-view note, not from any statement, so distances counted outward "
        "from them may be a section out.",
        "Numbers are missing from the runs and nobody explains them: there is no section 12, no "
        "136, and no 232 or 234. Section 225 is listed by Petco Park Insider but not by the "
        "ticketing index. Section 314 certainly exists &mdash; it is on the club's own elevator "
        "list and has an A View From My Seat page &mdash; but it has no ticketing page, apparently "
        "because it is sold only with the Skyline Patio, so it is not documented here.",
        "<strong>The lettered Premier Club A to L does not follow the parity rule</strong>, running "
        "instead as one sweep from A at the third-base end to L at the first-base end. Two "
        "non-official sources agree on that and no official one states it. Those twelve sections "
        "carry no per-section record and are not documented here, and neither are the named areas "
        "Gallagher Square, The Landing, The Point, the Rail Seats, the Agave Club, Coronado Club "
        "206, 208 and 210 or Gallagher Chairman's Club A and B.",
        "No official list of accessible or wheelchair sections exists for this ballpark, and no "
        "accessible-row label convention is published. The club's accessibility page also "
        "contradicts itself within a few lines, giving Guest Service Centers as 108, 131 and 303 "
        "and then wheelchair storage as 108 and 135.",
        "Seats per row is published for six sections only &mdash; 112, 123, 203, 207, 211 and 310 "
        "&mdash; and each figure is for a single named row rather than the section.",
        "Capacity of 39,860 counts fixed seats only. The same Ballparks of Baseball page that "
        "prints it still carries the 2004-era &ldquo;42,000-seat ballpark&rdquo; and &ldquo;42,500 "
        "blue seats&rdquo; figures in its narrative, and which bullpen lies to which side of "
        "section 134 is stated both ways by two sources.",
    ],
    sources=[("San Diego Padres ballpark guide", "https://www.mlb.com/padres/ballpark"),
             ("Padres disability access guide", "https://www.mlb.com/padres/ballpark/disability-access-guide"),
             ("Padres protective netting", "https://www.mlb.com/padres/ballpark/netting"),
             ("RateYourSeats: Petco Park", "https://www.rateyourseats.com/petco-park"),
             ("Petco Park Insider seating chart", "https://www.petcoparkinsider.com/padres-seating-chart"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Petco+Park/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/petco-park/")],
)

CHASE = dict(

    slug="chasefield", venue="Chase Field", team="Arizona Diamondbacks",
    team_short="Diamondbacks", research="dbacks",
    levels={0: "Field Level (lettered A-S)", 1: "100 Level (100s)", 2: "Club Level (200s)",
            3: "Upper Deck (300s)"},
    anchors={1: (122, 122), 2: (210, 210), 3: (316, 316)},
    numbers_increase_toward="third", seat1_side="right",
    placeholder="for example: 122, bleachers, dugout box, pool",
    capacity_sentence="Chase Field opened in 1998 as Bank One Ballpark and took its current name in "
        "2005. Capacity is 48,330, though published figures conflict. It was the first stadium in "
        "the United States built with a retractable roof over natural grass; the surface has been "
        "artificial since 2019 and the roof is now kept mostly closed, opening only when the "
        "weather allows. Four ticketed tiers: the lettered Field Level ring A&ndash;S closest to "
        "the field, the 100 Level bowl 101&ndash;144 with bleachers behind both outfield walls, the "
        "Club Level &mdash; also called the Diamond Level &mdash; 200&ndash;223, and the 300 Level "
        "upper deck 300&ndash;332.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side. The lettered Field "
        "Level ring runs the same way, A at the first-base end and S at the third-base end. The "
        "bowl is a horseshoe broken at dead centre field by the 25-foot batter&rsquo;s-eye wall, so "
        "each series ends at the outfield rather than wrapping back round.",
    stack_note="The home-plate block sits at 122 on the 100 Level, across the whole "
        "210A&ndash;210I block on the Club Level and at 316 in the upper deck. The club&rsquo;s own "
        "elevator list brackets the tiers identically &mdash; 105, 200 and 300 together at the "
        "right-field end, then 117, 209 and 310, then 127, 211 and 321, then 139, 223 and 332 "
        "&mdash; so the tiers are genuinely stacked rather than offset. <strong>The lettered Field "
        "Level ring is the exception.</strong> It does reach behind the plate, at sections "
        "G&ndash;M, but those sections carry letters rather than numbers, so there is nothing to "
        "count a distance in sections against and the figures for that tier are left blank rather "
        "than guessed.",
    landmarks=[
        "<strong>Diamondbacks (home) dugout:</strong> third-base side, fronted by the lettered "
        "Dugout Box sections N&ndash;Q. This is the less common arrangement and is easy to get "
        "backwards, so it was confirmed against two independent sources.",
        "<strong>Visiting dugout:</strong> first-base side, fronted by lettered sections "
        "C&ndash;F. Rows behind both dugouts run 6 to 18, with row 6 closest to the bench, and the "
        "dugouts sit below field level so those seats look slightly down on the players.",
        "<strong>Both bullpens sit beyond the outfield fences</strong> at the foot of the two "
        "bleacher blocks &mdash; the visitors&rsquo; in right field beside section 105, the "
        "Diamondbacks&rsquo; in left field beside 139, each on the same side of the park as its own "
        "dugout. Whether either pen is raised or at field level is not stated.",
        "<strong>Netting</strong> is stated in front of sections 115&ndash;129 and across all of "
        "the Dugout Box sections C&ndash;F and N&ndash;Q. Press reporting from 2019 and 2020 says "
        "the netting was later carried out to both foul poles, which would cover far more than "
        "that; the two accounts are recorded rather than reconciled.",
        "<strong>The swimming pool</strong> sits behind the right-centre field fence, 415 feet from "
        "home plate, and is rented as a suite rather than sold as seats. Beside it the 25-foot "
        "centre-field wall is the batter&rsquo;s eye and carries the videoboard, replaced for 2026 "
        "with a 9,600 square foot screen.",
        "<strong>The Cold Beer &amp; Cheeseburgers Terrace</strong> is a restaurant and seating "
        "hybrid beyond the left-field wall, its table rows labelled T and sold by the whole table. "
        "The ticketing source gives it no section numbers at all.",
    ],
    rows_note="Rows are numbers on the three numbered tiers. The 100 Level infield starts at row "
        "21, because rows 1 to 20 belong to the lettered ring in front of it &mdash; sections 122 "
        "and 128 read &ldquo;21-39, 40C-40W&rdquo; &mdash; while the bleachers and corner sections "
        "start lower and run to about 40. The Club Level is short, mostly rows 1 to 11, and the "
        "210A&ndash;210I sections behind the plate have no more than two rows each. The 300 Level "
        "runs long, to row 40 on the infield and 32 in the corners, and is entered near the front "
        "at row 4 rather than at the back. Field level mixes the two schemes: the Dugout Box "
        "sections C&ndash;F and N&ndash;Q run numbered rows 6 to 18, while the Clubhouse Box in "
        "G&ndash;M is limited to lettered rows A to F. <strong>Accessible rows are the same row "
        "number with a C or W suffix</strong> &mdash; 40C and 40W at the top of the 100 Level, 4C "
        "and 4W on the 300 Level, 1C and 1W on the Club Level. There is no WC label anywhere in "
        "this park.",
    access_summary="Accessible seating is integrated on every level and in every price range, "
        "including the Dugout Box, using removable tandems of stadium chairs that any section usher "
        "can take out. All of it is either front row or has a line of sight to the field and "
        "scoreboard over standing spectators, and folding chairs are provided where they are "
        "needed. Limited Mobility seats are sold as well, for guests who have difficulty with "
        "stairs but do not use a wheelchair or mobility device.",
    access_list=[
        "Elevators sit across from sections 105, 200 and 300; 117, 209 and 310; 127, 211 and 321; "
        "and 139, 223 and 332, the middle two pairs giving priority to guests with disabilities",
        "A wide ramp near Gate J serves all levels; the official page gives the main-level ramp as "
        "across from section 111 in one list and section 110 in another",
        "Walkers, wheelchairs and scooters can be checked at the Guest Relations Centers across "
        "from section 128 on the main concourse and 322 on the upper concourse",
        "Upper concourse wheelchair sections have electrical outlets for charging batteries or "
        "running medical equipment",
        "One to three companion seats may be bought with each wheelchair seat; the staffed drop-off "
        "point is on Jefferson Street by Gate K, at the north-east corner",
    ],
    uncertain=[
        "<strong>The netting extent is contradicted between sources.</strong> The ticketing "
        "source&rsquo;s fan feedback puts netting in front of sections 115&ndash;129; press "
        "reporting from 2019 and 2020 says the Diamondbacks carried it out to each foul pole, which "
        "would cover roughly 106&ndash;138 and the whole lettered ring. No current official netting "
        "diagram was retrievable and the fan note may simply be stale, so both are recorded.",
        "<strong>Each behind-the-plate block rests on a single flagged section.</strong> Only 122 "
        "on the 100 Level and 316 on the 300 Level carry a home-plate note, so those single "
        "sections are the anchors here. The wider arcs &mdash; roughly 118&ndash;127 below and "
        "314&ndash;318 up top &mdash; are inferred from the netting range and the flanking "
        "elevators, and 121, 123 and 315 are not individually sourced.",
        "The lettered Field Level ring is documented at zone level only. Sections A to S were never "
        "fetched individually, so their rows, entry portals and seat-1 side rest on the park-wide "
        "pattern rather than their own pages. No source names a single letter as dead centre behind "
        "the plate: G&ndash;M is the sourced block and J is merely its arithmetic middle.",
        "<strong>The field-level row scheme is mixed and only partly explained.</strong> The "
        "Clubhouse Box in G&ndash;M is stated as rows A to F and the Dugout Box in C&ndash;F and "
        "N&ndash;Q as rows 6 to 18, yet the ticketing source&rsquo;s own photo captions show a row "
        "G in sections A, B and R and a row M in G and L. How lettered and numbered rows coexist "
        "inside one section is not published.",
        "Several sections have no per-section data at all: the wheelchair-suffixed 100W, 145W, "
        "224W, 300W, 332W, AW, BW and RFW; the two &ldquo;L&rdquo; sections 214L and 215L, which "
        "the club&rsquo;s own mention of Limited Mobility seats would explain but which no source "
        "connects to it; and the nine Club Level sections 210A&ndash;210I, which are described "
        "as a block behind home plate and never singly.",
        "<strong>The official ramp list contradicts itself.</strong> The same accessibility page "
        "gives the main-level ramp as across from section 111 in one list and across from section "
        "110 in another. Both are recorded.",
        "No source defines the C and W row suffixes. Reading W as the wheelchair row and C as the "
        "adjoining companion row fits every observation, including section 316&rsquo;s note that "
        "there is wheelchair seating between rows 4W and 8, but nothing states it, so this guide "
        "publishes the labels and not the expansion.",
        "Seats per row is unpublished for all but five sections &mdash; 104, 307, 308, 319 and 326 "
        "&mdash; and three of those give a figure for a single row rather than the section.",
        "The Club Level is stated to run 200&ndash;220, yet 221, 222 and 223 sell All You Can Eat "
        "seats on the same tier in the left-field corner and 224W exists with no description at "
        "all. Whether those four belong to the Club or Diamond Level is not stated.",
        "Capacity is 48,330 against 48,633. The lower figure is used here; the higher one matches a "
        "published 2011&ndash;2014 number and is probably stale. A state-funded renovation "
        "programme was approved in September 2025, so names, section numbers and capacity are all "
        "liable to move.",
        "The compass bearing is low confidence &mdash; one source says the park faces north and "
        "another north-east, and neither gives degrees. With the roof usually closed it rarely "
        "matters in practice.",
    ],
    sources=[("Arizona Diamondbacks ballpark guide", "https://www.mlb.com/dbacks/ballpark"),
             ("D-backs access guide for guests with disabilities", "https://www.mlb.com/dbacks/ballpark/information/ada"),
             ("RateYourSeats: Chase Field", "https://www.rateyourseats.com/chase-field/seating"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Chase+Field/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/chase-field/")],
)

COORS = dict(

    slug="coorsfield", venue="Coors Field", team="Colorado Rockies", team_short="Rockies",
    research="rockies",
    levels={0: "Toyota Clubhouse (A-F)", 1: "Lower Level (105-160)",
            2: "Mezzanine and Club Level (200s)", 3: "Upper Reserve Level (300s)",
            4: "The Rockpile (401-403)"},
    anchors={1: (126, 135), 3: (330, 331)},
    numbers_increase_toward="third", seat1_side="right",
    # The six lettered Toyota Clubhouse sections fall in bucket 0. The ticketing source states its
    # seat-1 rule on numbered section pages only; A-F have no pages, and no source says which end
    # of the block is the first-base end, so no seat-1 side is asserted for that tier.
    seat1_unknown_levels=(0,),
    placeholder="for example: 130, rockpile, rooftop, bullpen",
    capacity_sentence="Coors Field opened in 1995 in the LoDo district of Denver and has seated "
        "46,897 since the 2018 alterations, or 50,144 counting standing room. Ballparks of Baseball "
        "still prints 50,398, which is the superseded 2012&ndash;2017 figure. The ticketed tiers "
        "are the Toyota Clubhouse field seats lettered A&ndash;F behind the plate, the Lower Level "
        "105&ndash;160, the Mezzanine and Club Level in the 200s &mdash; Right Field Mezzanine "
        "201&ndash;209 and the Wells Fargo Club 214&ndash;227 and 234&ndash;247 &mdash; the Upper "
        "Reserve Level 301&ndash;347 and the Rockpile bleachers 401&ndash;403. The Legacy Club and "
        "the PNC Press Club sit behind home plate on the suite and press tiers and are sold by "
        "name rather than by number, as are the Casamigos Sky Deck sections 200A&ndash;200C, the "
        "Mountain Ranch Club and the Rooftop.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past "
        "home plate, down the third-base side and out to left field. Low numbers are the "
        "first-base and right-field side; high numbers are the third-base and left-field side. "
        "All three numbered series run the same way and none is reversed. The Rockpile, "
        "401&ndash;403, is a three-section block in straightaway centre field and takes no part in "
        "the sweep.",
    stack_note="The home-plate block sits at 126&ndash;135 on the Lower Level and 330&ndash;331 on "
        "the Upper Reserve Level, with the lettered Toyota Clubhouse sections A&ndash;F at field "
        "level in front of 126&ndash;135. The two tiers line up: the club's own listings put a "
        "first aid station behind 133 and another behind 330, and the official netting run, "
        "&ldquo;the front of Sections 112-147&rdquo;, is symmetric about 129.5. <strong>Three "
        "tiers never reach the plate at all.</strong> The Club Level is sold as two separate "
        "blocks, 214&ndash;227 and 234&ndash;247, with the suite and press tiers filling the arc "
        "behind the plate and no sections 228&ndash;233 in the index; the Right Field Mezzanine "
        "201&ndash;209 is an outfield deck; and the Rockpile is centre-field bleachers. Distances "
        "on all three are left blank rather than guessed.",
    landmarks=[
        "<strong>Rockies (home) dugout:</strong> first-base side, fronted by sections "
        "121&ndash;125.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 136&ndash;140.",
        "<strong>Both bullpens sit behind the right-field fence</strong>, beside the landscaped "
        "rock, tree and fountain area. The Rockies' pen is the one immediately beside section 105, "
        "and Right Field Mezzanine sections 202&ndash;204 look straight down on both. Which pen is "
        "nearer the foul line, and whether the two are side by side or stacked, is not stated by "
        "any source.",
        "<strong>Netting</strong> is stated by the club to run from the front of sections "
        "112&ndash;147. The ticketing source gives a much narrower 122&ndash;139, which appears to "
        "be the older dugout-to-dugout screen; both are recorded here.",
        "<strong>The Rockpile</strong> is the centre-field bleacher block, sections "
        "401&ndash;403, bench seating without backs and the furthest seats from home plate in the "
        "league at about 600 feet. Dinger's Playground sits directly below it on the outfield "
        "concourse.",
        "<strong>The Rooftop</strong> is a 38,000-square-foot two-tier standing-room plaza in the "
        "upper level in right field, with bar rails and cabanas rather than seats. Sections "
        "310&ndash;314 are sometimes opened to Rooftop ticket holders, announced on the day "
        "depending on attendance.",
    ],
    rows_note="Rows are mixed, and the pattern differs by tier. <strong>Lower Level sections run "
        "numbered rows from the field back and then a lettered block C to W behind them</strong> "
        "&mdash; section 130 reads &ldquo;4-38, C-W&rdquo; and section 142 &ldquo;1-38, C-W&rdquo; "
        "&mdash; with the entrance at row W, so fans enter at the top and walk down as far as 38 "
        "rows. The numbered rows do not all start at 1: 105 starts at 2 and 130 at 4. The Upper "
        "Reserve Level uses a split range, typically &ldquo;1-5, C-W, 10-25&rdquo;, where rows 1 "
        "to 5 are Lower Reserved, rows 10 and above are Upper Reserved behind a walkway, and the "
        "entrance is at row 5 rather than at the top. Club Level sections are short, no more than "
        "13 rows, with section 241 reading &ldquo;1-10, W&rdquo;, and the Rockpile is benches. "
        "<strong>Accessible rows carry a WC label</strong> &mdash; section 142's own recommendation "
        "reads &ldquo;rows 36-WC&rdquo; &mdash; and on the upper level the platform sits between "
        "lettered row C and row 10 in sections 328 and 330. Beyond that, the accessible-row "
        "convention is not published.",
    access_summary="The club states about 1,000 accessible and companion seats spread through the "
        "ballpark, every one of them either in a front row or given a line of sight over standing "
        "spectators. All five gates are accessible, and ramps and elevators reach every level. The "
        "club publishes no list of accessible section numbers.",
    access_list=[
        "About 1,000 accessible and companion seats, all front row or with a sight line over "
        "standing spectators; no section list is published",
        "Elevators at Gate A by section 105, Gate B by 111, Gate D by 130, Gate E by 147, and one "
        "beneath the Rockpile in centre field",
        "Two access ramps &mdash; the east ramp from Gate A to the main concourse, Mezzanine and "
        "Upper Level, and the west ramp from Gate E to the Wells Fargo Club, Suite Level and "
        "Upper Level",
        "About 300 accessible parking spaces in the front of Lot A, immediately beside Gate A",
        "The Guest Relations Center on the main concourse across from section 127 issues assistive "
        "listening and captioning devices; first aid is behind sections 133 and 330",
    ],
    uncertain=[
        "<strong>The section index is not a complete list of the sections that exist.</strong> The "
        "Club Level zone page gives the tier as 214&ndash;227 and 234&ndash;247, but 220, 224, 237 "
        "and 240 have no page; the 300 series likewise skips 320, 322, 324, 337, 339 and 341. "
        "Those ten numbers are probably real sections and are simply not documented here.",
        "The six lettered Toyota Clubhouse sections A&ndash;F have no per-section data at all "
        "&mdash; no rows, no seat counts, and no statement of which end of the block is the "
        "first-base end. Only that they sit directly behind the plate within about six rows of the "
        "field is sourced, so no seat-1 side and no distance are stated for them.",
        "<strong>The ruling that the Club Level never reaches home plate rests on one "
        "sentence.</strong> It is supported by the absence of 228&ndash;233 from the index and by "
        "the Legacy Club and PNC Press Club both sitting directly behind the plate on the tiers "
        "immediately above and below, but no official document says outright that 228&ndash;233 do "
        "not exist. If they do, the 200-level anchor would be about 230&ndash;231.",
        "<strong>The netting range is contradicted.</strong> The club states the front of sections "
        "112&ndash;147; the ticketing source's fan note says 122&ndash;139. The club's figure is "
        "used here and the narrower one is thought to predate the 2018 extension, but no source "
        "gives the current net height by section.",
        "<strong>Capacity is reported four ways</strong> &mdash; 46,897 for the current fixed "
        "seating, 50,144 with standing room, and 50,398 from Ballparks of Baseball, which is the "
        "superseded 2012&ndash;2017 figure. The first is used here.",
        "The exact centred section on each tier is medium confidence. The ticketing source calls "
        "126&ndash;135 the behind-the-plate block, whose midpoint is 130.5, while the official "
        "netting run is symmetric about 129.5. Upstairs, both 330 and 331 carry the home-plate "
        "view note, and a shade guide instead describes the home-plate block as 330&ndash;335. The "
        "side is certain in both cases; the centre is not.",
        "<strong>Club Level row labels conflict on a single page.</strong> The zone page recommends "
        "&ldquo;Rows 8 and higher&rdquo; for cover and then &ldquo;Rows H and above&rdquo;, but the "
        "one club section with published labels, 241, reads &ldquo;1-10, W&rdquo; and has no row "
        "H. Unresolved.",
        "No source states whether sections 101&ndash;104 exist; the index begins the series at 105 "
        "and a request for a 103 page redirects away. If they exist they would be further into "
        "right field than 105, which would not change the direction of the numbering.",
        "The Mountain Ranch Club is described only as being on the 200 level in the right-field "
        "corner. The index gap at 210&ndash;213 is exactly where it would sit, but no source "
        "assigns it those numbers, so none are recorded.",
        "The purple row marking one mile above sea level is described as the twentieth row of the "
        "upper deck. Because the 300-level labels are split into 1&ndash;5, C&ndash;W and "
        "10&ndash;25, it is not established whether that means the row labelled 20 or the "
        "twentieth row counted from the front.",
        "The seat-1 side rests on one source family. Twelve section pages state &ldquo;when "
        "looking towards the field, lower number seats are on the right&rdquo; identically, and a "
        "fan note on section 105 corroborates it by tying &ldquo;the right side&rdquo; to the "
        "bullpen, but no independent guide states any seat rule for this park.",
        "Seats per row is published for only 27 of the 133 documented sections, and mostly as the "
        "zone-level &ldquo;about 14 seats per row&rdquo; rather than a count for the section in "
        "hand.",
    ],
    sources=[("Colorado Rockies ballpark guide", "https://www.mlb.com/rockies/ballpark"),
             ("Rockies access guide for guests with disabilities", "https://www.mlb.com/rockies/ballpark/disability-access-guide"),
             ("RateYourSeats: Coors Field", "https://www.rateyourseats.com/coors-field"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Coors+Field/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/coors-field/")],
)

DODGER = dict(

    slug="dodgerstadium", venue="Dodger Stadium", team="Los Angeles Dodgers",
    team_short="Dodgers", research="dodgers",
    levels={
        -1: "Dugout Club (1DC&ndash;15DC)",
        0: "Field Level (1&ndash;53)",
        1: "Loge Level (101&ndash;168)",
        2: "Executive Club (229&ndash;261 odd)",
        3: "Pavilion (301&ndash;316)",
        4: "Club Suites (201LS&ndash;233LS, E1, E2)",
        5: "Reserve Level (1&ndash;61, tagged IR, LR or R)",
        6: "Top Deck (1TD&ndash;13TD)",
    },
    # Bare numbers carry their own tier in the hundreds digit; the lettered tiers are mapped
    # explicitly. IR, LR and R all point at one bucket because they are one physical tier -
    # the Reserve Level, numbered 1-61 straight through - that the ticketing source splits
    # into three zone tags. Keeping them together is what lets 21R find 19IR and 23LR as its
    # neighbours instead of floating alone.
    # The keys are what parse_section() returns as the tag, which for E1 and E2 is the bare
    # letter E - writing "E1" here matched nothing and quietly dropped both suites into the
    # Field Level bucket, where they picked up a seat-1 rule this park does not publish.
    suffix_levels={"DC": -1, "LS": 4, "E": 4,
                   "IR": 5, "LR": 5, "R": 5, "TD": 6},
    # Anchors are the innermost odd/even pair on each tier that reaches the plate. Three tiers
    # are deliberately absent: the Executive Club begins in shallow left field and never wraps
    # behind the plate, the Pavilion is entirely beyond the outfield wall, and no source names
    # which suites are centred.
    anchors={-1: (1, 2), 0: (1, 2), 1: (101, 102), 5: (1, 2), 6: (1, 2)},
    numbering_mode="parity",
    parity_sides={"odd": "third", "even": "first"},
    seat1_side={"odd": "right", "even": "left"},
    seat1_unknown_levels=(4,),
    numbers_increase_toward=None,
    placeholder="for example: 1DC, 130, top deck, pavilion, bullpen",
    capacity_sentence="Dodger Stadium opened in Chavez Ravine in 1962 and seats 56,000 &mdash; the "
        "largest capacity in Major League Baseball, and a figure the club has deliberately held "
        "constant through every renovation. In March 2026 UNIQLO bought the naming rights to the "
        "<em>field</em> rather than the building: the playing surface is now UNIQLO Field, and the "
        "ballpark is still Dodger Stadium. Eight ticketed tiers: the Dugout Club in front of the "
        "infield, the Field Level numbered 1&ndash;53, the Loge Level 101&ndash;168, the Club Suites "
        "and the odd-numbered Executive Club seats sharing the Suite Level, the Reserve Level "
        "1&ndash;61, the Top Deck 1TD&ndash;13TD, and the Pavilion bleachers 301&ndash;316 beyond "
        "the outfield wall.",
    numbering_summary="<strong>Dodger Stadium does not number one way round the bowl.</strong> "
        "Numbering starts at home plate and runs outward in both directions at once, split by "
        "parity: <strong>odd-numbered sections run down the third-base side toward left field, "
        "even-numbered sections run down the first-base side toward right field</strong>, and "
        "within each side the number rises as you move away from the plate. Sections 40 and 41 are "
        "the same distance from home plate on opposite sides of the diamond, which is how the "
        "club&rsquo;s own netting statement describes them. The rule holds on every tier, so the "
        "useful question about a Dodger Stadium section number is not &ldquo;how high is it&rdquo; "
        "but &ldquo;is it odd or even, and how far above the middle&rdquo;.",
    stack_note="Every tier that reaches the plate is anchored on its innermost odd/even pair: "
        "1 and 2 at Field Level, 101 and 102 on the Loge, 1 and 2 again on the Reserve Level and "
        "the Top Deck, and 1DC and 2DC in the Dugout Club. <strong>Three tiers never reach home "
        "plate at all.</strong> The Executive Club begins in shallow left field and runs out to the "
        "foul pole &mdash; the behind-the-plate part of that level is private suites, so there are "
        "no ticketed Executive Club seats near the middle. The Pavilion sits entirely beyond the "
        "outfield wall. And no source names which of the Club Suites are the centred ones. For all "
        "three, distances from home plate are left blank rather than guessed. Note also that the "
        "Pavilion is not part of the vertical stack at all: the tiers pile up as Dugout Club, "
        "Field, Loge, Suite, Reserve, Top Deck, with the Pavilion out in the outfield on its own.",
    landmarks=[
        "<strong>The Dodgers dugout is on the third-base side</strong>, which puts the home dugout "
        "in front of the odd-numbered Field Level sections 15&ndash;27 and the visiting dugout in "
        "front of the even 14&ndash;26. This is the minority arrangement in Major League Baseball "
        "and it is worth checking twice, because the ticketing source&rsquo;s Dugout Club page "
        "states the exact opposite. Five sources including the club&rsquo;s own netting page and "
        "the geography of the bullpens say third base.",
        "<strong>Both bullpens sit beyond the outfield wall</strong>, below the Pavilion rather "
        "than along the foul lines &mdash; the Dodgers&rsquo; in left field near sections 53, 167 "
        "and 301, the visitors&rsquo; in right field near 52, 168 and 302. Raised overlooks were "
        "added behind each of them in 2014.",
        "<strong>Protective netting</strong> runs from behind home plate out to the end of baseline "
        "section 40 on the first-base side and section 41 on the third-base side, per the "
        "club&rsquo;s own netting statement.",
        "<strong>The deck overhangs are the main obstruction</strong>, and they hide the "
        "scoreboards rather than the field. There is no centre-field board &mdash; two hexagonal "
        "boards sit behind the bleachers in left and right field &mdash; so from the back rows of "
        "the lower tiers the overhang cuts off the replay screens and high fly balls.",
        "<strong>The Pavilion is bleacher seating with backrests</strong>, odd 301&ndash;315 in "
        "left field and even 302&ndash;316 in right. The right-field side is on the east side of "
        "the stadium and takes the most sun of anywhere in the ballpark. Two rows of padded bar "
        "stools on a drink rail, the Home Run Seats, sit in front of the Pavilion in each corner.",
        "<strong>The Baseline Club and the Dugout Club are front-row products, not tiers.</strong> "
        "The Dugout Club is its own set of sections between the dugouts, all within nine rows of "
        "the field and with its own lounge and elevator; the Baseline Club is the first six rows "
        "of Field Level sections 26&ndash;43. Because the Dugout Club sits in front of Field Level "
        "sections 1&ndash;25, the first row of those sections is about ten rows back from the field.",
    ],
    rows_note="<strong>Rows are lettered almost everywhere at Dodger Stadium</strong>, which makes "
        "it the opposite of most parks in this set. Field Level runs from row A, with an extra "
        "leading AA in some outfield-corner sections and a trailing DR &mdash; the drink rail "
        "&mdash; behind row X in the home-plate sections. The Loge Level runs A&ndash;T then "
        "U&ndash;W, with a handful of Preferred Loge Box sections ending in a row labelled PB or "
        "BOX instead. Lower and Infield Reserve run A&ndash;V with row I skipped; Value Reserve "
        "uses doubled letters from AA. The Dugout Club also uses doubled letters. <strong>Entry is "
        "usually at the back of the section</strong> &mdash; you come in from the concourse behind "
        "and walk down &mdash; but the Pavilion and the Value Reserve sections are entered at the "
        "front instead, at row A and row AA respectively.",
    access_summary="Accessible seating is available on every level of the ballpark, and the club "
        "sells it through an ADA ticket link on its own website or by phone. Nine elevators serve "
        "the stadium, including three behind home plate and one in centre field reaching all three "
        "Pavilion levels. Accessible spaces on the Loge Level sit at the top of the section, with "
        "companion seats on ordinary stadium chairs beside them.",
    access_list=[
        "Accessible seating on every level; ADA tickets via the club website or 866-DODGERS ext. 8",
        "Nine elevators, three of them behind home plate; escalators between the Field, Loge, "
        "Suite, Reserve and Top Deck levels",
        "Wheelchairs may be checked and stored at the Left and Right Field plazas on Field Level, "
        "or behind home plate on every other level; escorts available from any gate",
        "Sensory bags at any Fan Services Station and a sensory room on the first level of the "
        "Right Field Pavilion",
        "An adult changing table in the all-gender restroom at section 32 on the Reserve Level, "
        "and device-charging outlets at selected accessible seats",
        "A courtesy shuttle runs from the parking lots to the gates for guests needing mobility "
        "assistance, arranged by phone once you have parked",
    ],
    uncertain=[
        "<strong>The ticketing source&rsquo;s park-wide seat-1 sentence is wrong on half the "
        "ballpark.</strong> Every section page prints &ldquo;lower number seats are on the "
        "right&rdquo;. Thirteen of the same source&rsquo;s own per-section answers say otherwise, "
        "and they split perfectly by parity: sections 41, 47, 53, 161 and 43LR (odd) put seat 1 on "
        "the right, while 26, 106, 144, 158, 168, 16IR, 42R and 52LR (even) put it on the left, two "
        "of them adding &ldquo;closer to home plate&rdquo;. Those are one rule &mdash; seat 1 is "
        "the end of the row nearest home plate &mdash; and this guide follows the per-section "
        "answers. No per-section answer anywhere contradicts that reading.",
        "<strong>The section identifiers here are the ticketing source&rsquo;s, not necessarily "
        "the ones printed on a ticket.</strong> The club appears to use suffixes FD, LG, RS, TD and "
        "DC; the source uses bare numbers for the Field, Loge, Executive Club and Pavilion tiers "
        "and its own tags IR, LR and R on the Reserve Level, and its own expert answers admit a "
        "real ticket may read &ldquo;30RS&rdquo; or &ldquo;8FD&rdquo;. Check the suffix on your "
        "ticket against the tier, not just the number.",
        "<strong>The same bare number means different seats on different tiers.</strong> Sections "
        "1&ndash;53 exist at Field Level, 1&ndash;61 on the Reserve Level, 1&ndash;15 in the Dugout "
        "Club and 1&ndash;13 on the Top Deck; and on the Suite Level the bare Executive Club "
        "numbers 229, 231 and 233 collide with suites 229LS, 231LS and 233LS. A ticket reading "
        "&ldquo;section 8&rdquo; is ambiguous without its tier.",
        "<strong>The Reserve Level zone split may be hiding a second block.</strong> The source "
        "assigns Lower Reserve to sections of the form 4k+3 and 4k+4 and Value Reserve to the "
        "others, in a strict alternating pattern, while also saying Value Reserve sits "
        "<em>above</em> Lower Reserve. That pattern suggests the physical level has both a lower "
        "and an upper block at most section numbers, flattened into one identifier each. The "
        "sections are listed as the source lists them.",
        "The Baseline Club is quoted as rows 1&ndash;6 of sections 26&ndash;43, but the same "
        "sections&rsquo; own pages give lettered rows, and sections 41&ndash;43 print a row list "
        "beginning &ldquo;3-6&rdquo;. The front-row product and the row labels have not been "
        "reconciled by any source.",
        "<strong>No seat numbering is published for the Club Suites at all</strong>, so this guide "
        "states none for them. Whether the odd/even rule even applies to suites 201LS&ndash;233LS, "
        "which run consecutively in both parities, is not stated anywhere, and E1 and E2 are "
        "unexplained by every source consulted.",
        "One fan note on section 301 says the Dodgers bullpen is to the right of the section and "
        "then advises sitting in higher-numbered seats to be near it, which contradicts itself. The "
        "equivalent note on section 53 is self-consistent and agrees with the rule used here.",
        "Sections 12DC and 14DC are absent from the venue index, as are the Home Run Seats and the "
        "bullpen overlooks, which are sold as lettered zones with no per-section pages. No source "
        "states a compass bearing for home plate; that right field is on the east side of the "
        "stadium is the sourced fact and the rest is inference.",
    ],
    sources=[("Los Angeles Dodgers ballpark guide",
              "https://www.mlb.com/dodgers/ballpark/information/guide"),
             ("Dodgers protective netting", "https://www.mlb.com/dodgers/ballpark/netting"),
             ("RateYourSeats: UNIQLO Field at Dodger Stadium",
              "https://www.rateyourseats.com/uniqlo-field-at-dodger-stadium"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Dodger+Stadium/"),
             ("Ballparks of Baseball",
              "https://www.ballparksofbaseball.com/ballparks/dodger-stadium/")],
)

ALL = [GIANTS, PETCO, CHASE, COORS, DODGER]
