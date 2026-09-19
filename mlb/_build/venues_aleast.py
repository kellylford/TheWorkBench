#!/usr/bin/env python3
"""Per-ballpark configuration for the American League East.

Fenway Park is the most awkward ballpark in the set. Its identifiers put the letters in
front of the number rather than after it, its tiers reuse the same numbers, and it runs
two numbering schemes at once - most of the bowl sweeps one way while the Pavilion tiers
number outward from home plate by parity - which is what `parity_levels` is for.
Tropicana Field is a parity ballpark of the ordinary kind, but with a single seat-1 side
for the whole park rather than one per half: the sections mirror and the seats do not.
"""

YANKEE = dict(

    slug="yankeestadium", venue="Yankee Stadium", team="New York Yankees",
    team_short="Yankees", research="yankees",
    levels={
        0: "Legends and Champions Suites (11&ndash;29)",
        1: "Field Level (103&ndash;136)",
        2: "Main Level and Bleachers (201&ndash;239)",
        3: "Terrace Level (305&ndash;334)",
        4: "Grandstand Level (405&ndash;434)",
        5: "Audi Yankees Club (no numbered sections)",
    },
    # Lettered sub-sections - 114A, 320B, 434B and the rest - are the same tier as their bare
    # number, so their letters are deliberately NOT mapped here: 114A has to fall through to
    # the hundreds digit and land beside 114. The only entry needed is the one identifier with
    # no number in it at all, which the parser reduces to the tag 'AUDI CLUB'.
    suffix_levels={"AUDI CLUB": 5},
    # The Bleachers share the 200s with the Main Level and cannot be split off by a letter, so
    # the tier keeps the Main Level's anchor and the nine bleacher sections are overridden
    # individually below. The Audi Yankees Club gets no anchor at all.
    anchors={0: (18, 21), 1: (118, 121), 2: (218, 222), 3: (318, 322), 4: (419, 421)},
    numbers_increase_toward="third", seat1_side="right",
    direction_overrides={
        **{str(n): "in right field - the Bleachers are a separate outfield tier that shares the "
                   "200s with the Main Level, so counting sections from the Main Level home-plate "
                   "block would not describe where this section is"
           for n in (201, 202, 203, 204)},
        **{str(n): "in left field - the Bleachers are a separate outfield tier that shares the "
                   "200s with the Main Level, so counting sections from the Main Level home-plate "
                   "block would not describe where this section is"
           for n in (235, 236, 237, 238)},
        "239": "in the outfield bleachers - the source's layout sentence names 202-204 as right "
               "field and 235-238 as left field and omits 239 altogether, so no side is stated here",
    },
    placeholder="for example: 120A, bleachers, terrace, monument park",
    capacity_sentence="Yankee Stadium opened on 16 April 2009, across the street from the 1923 "
        "ballpark of the same name, which was demolished &mdash; anything written about that "
        "building describes a different place. The building carries no naming right and never has. "
        "Capacity is disputed: Wikipedia gives 46,537 for 2020 onward, Ballparks of Baseball gives "
        "50,287, and no current figure was found on the club&rsquo;s own site. Six ticketed "
        "groupings: the Legends and Champions Suites ring numbered 11&ndash;29 in front of the "
        "lower bowl, the Field Level 103&ndash;136, the Main Level 205&ndash;234, the Bleachers "
        "201&ndash;204 and 235&ndash;239 sharing the 200s with it, the Terrace Level "
        "305&ndash;334 and the Grandstand Level 405&ndash;434. The Audi Yankees Club is sold as a "
        "club rather than as numbered seats.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side. The club&rsquo;s "
        "own netting statement says as much &mdash; the net runs &ldquo;between Section 011 on the "
        "1st base/right field side of the Stadium and continues to Section 029 on the 3rd "
        "base/left field side&rdquo;. The same one-way sweep holds on every tier, and there is no "
        "odd/even split of the kind Petco Park and Dodger Stadium use.",
    stack_note="The home-plate block sits at 18&ndash;21B on the field-level ring, 118&ndash;121B "
        "at Field Level, 218&ndash;222 on the Main Level, 318&ndash;322 on the Terrace and "
        "419&ndash;421 in the Grandstand. <strong>The Bleachers never reach home plate.</strong> "
        "They share the 200s with the Main Level but are a separate outfield tier running from "
        "left-centre to right-centre field, so distances are left blank for 201&ndash;204 and "
        "235&ndash;239 rather than counted along a ring those sections are not part of. "
        "<strong>The Audi Yankees Club has no anchor either</strong> &mdash; it sits on the suite "
        "level between the 200 and 300 levels on the left-field line, so it is listed last here "
        "even though it is in the middle of the stack, and no distance is stated for it. Of the "
        "five anchors, the Field Level one is the softest: it is read off &ldquo;Home Plate "
        "View&rdquo; tags rather than stated outright, as the open questions below record.",
    landmarks=[
        "<strong>Which dugout is which is not settled, and this guide does not settle it.</strong> "
        "Ballparks of Baseball states &ldquo;Home Dugout: First Base&rdquo;, a dugout-side listing "
        "at Event Ticket Center puts the Yankees in the first-base dugout, and the ticketing "
        "source&rsquo;s own Legends pages agree with them &mdash; &ldquo;Sit in Sections 15-17 to "
        "be behind the Yankees&rsquo; dugout, or choose 23-25 for the visitors&rsquo; side&rdquo;, "
        "and 15&ndash;17 is the low-numbered first-base end. Against that, the same source prints "
        "on every Field MVP page that the 115&ndash;125 seats wrap &ldquo;from behind the "
        "visitors&rsquo; dugout to the home dugout&rdquo;, which read as an ordered sweep puts the "
        "visitors at the first-base end and the Yankees at third. Both readings are recorded; no "
        "club page states a side.",
        "<strong>Both bullpens are beyond the centre-field fence</strong>, flanking Monument Park "
        "rather than lying along the foul lines. The Yankees&rsquo; pen is in right-centre, beside "
        "section 103 and in front of bleachers 201 and 202; the visitors&rsquo; is in left-centre, "
        "beside section 136 and in front of bleachers 237 and 238, which look straight down into "
        "it. All of this comes from the ticketing source; no club page states bullpen sides.",
        "<strong>Protective netting spans the field-level ring only</strong>, from section 011 on "
        "the first-base side round to 029 on the third-base side. It stands 31 feet above the "
        "playing-field wall behind home plate at 018&ndash;021B, 11&rsquo;-6&rdquo; above the wall "
        "at 017B and 022 and behind the photo wells at 015A and 025, about 14 feet above the field "
        "at 014B&ndash;011 and 026&ndash;029, and 9 feet above the dugouts, retractable by up to "
        "three feet before games. The 100, 200, 300 and 400 level sections sit behind and above "
        "it.",
        "<strong>Monument Park is beyond the centre-field wall</strong>, directly below bleacher "
        "sections 237 and 238. The bleachers themselves are metal benches with no back support and "
        "no cover, and the centre-field sports bar and plaza block the higher rows &mdash; the "
        "source recommends row 10 and below in 202, 238 and 239, and calls 201 heavily obstructed.",
        "<strong>Section 104 is the Judge&rsquo;s Chambers</strong> in right field, and section 203 "
        "is home to the Bleacher Creatures and the first-inning roll call. The foul poles stand in "
        "front of sections 107 and 132, and the source lists them, along with the handicapped "
        "seating platforms, among the things fans complain of being blocked by.",
        "<strong>The premium products cut across the numbering rather than following it.</strong> "
        "Sections 11&ndash;13 and 27B&ndash;29 are tagged Champions Suite and 14A&ndash;27A "
        "Legends Suite, all of them in front of the 100 level; Field MVP covers 115&ndash;125, "
        "split into a club tier in rows 1&ndash;10 and ordinary seats from row 11; the Delta "
        "Sky360 Suite is at the top of 218&ndash;222; the Jim Beam Suite is Terrace sections "
        "319&ndash;321. The Pinstripe Pass and the Pepsi Lounge are standing tickets with no "
        "published section numbers at all.",
    ],
    rows_note="<strong>Rows are numbered everywhere at this park</strong>, starting at row 1 at the "
        "front and counting back. Depth varies by tier: the field-level ring runs 1&ndash;9, Field "
        "Level sections to about 1&ndash;21, the Main Level to 1&ndash;22, the Bleachers "
        "1&ndash;24, the Terrace 1&ndash;10 and the Grandstand 1&ndash;14, with the Audi Yankees "
        "Club at 1&ndash;3. <strong>The accessible row carries a letter suffix</strong> &mdash; "
        "8WC on the Terrace and in the Delta Sky360 sections, 21W in the Bleachers &mdash; and on "
        "the Terrace a standing-room row 9SR sits behind it and doubles as the entrance. Entry is "
        "at the back of the section on most tiers, at row 10 in section 103, row 18 in 104 and row "
        "24 in 201, but the Grandstand is entered near the front, at row 2.",
    access_summary="The club states that wheelchair-accessible and designated aisle-transfer seats "
        "are sold at various price points and locations throughout the stadium, but its guide does "
        "not list the sections, directing guests to Disabled Services instead. Sixteen public "
        "elevators and two indoor ramps serve the building. The nearest thing to a published list "
        "of accessible sections is the club&rsquo;s own list of accessible sections fitted with "
        "electrical outlets.",
    access_list=[
        "Disabled Services on (718) 579-4510, TTY (718) 579-4595, disabledservices@yankees.com",
        "Sixteen public elevators: eight in the Great Hall for the Main and Terrace/Grandstand "
        "levels, two at the Gate 2 lobby also reaching the Coupa Suite Level, the Audi Yankees "
        "Club and the Budweiser Hall of Fame Lounge, two at Gate 8 for the Field Level and the "
        "Bleachers, two at Gate 6 and two at the suite entrance near Gate 4",
        "Two indoor ramps, one beside Gate 2 on the left-field side and one beside Gate 6 on the "
        "right-field side",
        "Electrical outlets at Guest Relations booths and at accessible sections on every tier, "
        "among them 021B, 029, 104&ndash;106, 118&ndash;121B, 211, 225&ndash;226, 305&ndash;310, "
        "333&ndash;334 and Bleachers 203 and 235&ndash;237",
        "The accessible row is labelled WC, or W in the Bleachers, and is usually the entrance row",
    ],
    uncertain=[
        "<strong>The dugout sides are genuinely disputed and are left unresolved here.</strong> "
        "Ballparks of Baseball (&ldquo;Home Dugout: First Base&rdquo;), a dugout-side listing at "
        "Event Ticket Center, and the ticketing source&rsquo;s Legends pages (&ldquo;Sit in "
        "Sections 15-17 to be behind the Yankees&rsquo; dugout, or choose 23-25 for the "
        "visitors&rsquo; side&rdquo;) all put the Yankees on first base. The same ticketing "
        "source&rsquo;s Field MVP sentence, repeated on all of 115&ndash;125 and on the Legends "
        "pages beside it, says the zone wraps &ldquo;from behind the visitors&rsquo; dugout to the "
        "home dugout&rdquo;, which in a park whose numbers climb toward third base reads as the "
        "opposite arrangement. It may be describing extent rather than order. No club page states "
        "a side, so both readings stand.",
        "<strong>Capacity is contradicted between sources.</strong> Wikipedia gives 46,537 for "
        "2020 onward, within a year-stamped series; Ballparks of Baseball gives 50,287 with no "
        "year attached. No official 2026 figure was found. Both are recorded and neither is "
        "preferred.",
        "<strong>The Field Level home-plate anchor is inferred, not stated.</strong> "
        "118&ndash;121B comes from &ldquo;Home Plate View&rdquo; tags on 119, 120A, 120B, 121A and "
        "121B, from the 115&ndash;125 infield wrap, and from the club&rsquo;s accessibility page "
        "grouping 118&ndash;121B as one run. Nothing says it in as many words, unlike the netting "
        "page for 018&ndash;021B and the section 418 page for 419&ndash;421.",
        "<strong>Bleacher sections 235&ndash;238 publish no row, entrance or seat data at all.</strong> "
        "Their pages carry the zone review and the soccer supporters-section text but none of the "
        "row blocks every other page in the park carries, confirmed on two passes, so those four "
        "sections are recorded as unknown rather than filled in from their neighbours. Sections "
        "201 and 239 are treated as Bleachers because they share the 1&ndash;24 row form and the "
        "centre-field obstruction language, but the source&rsquo;s own layout sentence names only "
        "202&ndash;204 and 235&ndash;238.",
        "<strong>The same sections are spelled two ways.</strong> The ticketing source writes the "
        "field-level ring without leading zeros (11, 18, 21B, 29) and the club writes it with them "
        "(011, 018, 021B, 029). This guide uses the ticketing form; a ticket may not match "
        "character for character.",
        "The seat-1 rule is well evidenced on the numbered bowl but unverified on two products. "
        "The park-wide sentence &ldquo;lower number seats are on the right&rdquo; is corroborated "
        "by per-section statements at 103, 129, 136, 201, 233B, 308, 328 and 423 &mdash; both "
        "halves of the park, four tiers, no contradiction anywhere &mdash; but no per-section "
        "statement was found for the field-level ring 11&ndash;29 or for the Audi Yankees Club, so "
        "the rule is carried there on the boilerplate alone.",
        "<strong>&ldquo;Audi Club&rdquo; is a club, not a bowl section.</strong> The ticketing "
        "source lists it among the sections, which is why it appears here; it is an enclosed "
        "suite-level room on the left-field line with rows 1&ndash;3, no entrance row and no seats "
        "per row published, and its own review calls it more restaurant than seating section.",
        "No source consulted states a compass bearing for the ballpark, so none is given. A single "
        "rendering of the section 236 page calling the left-field bleachers west-facing was not "
        "confirmed as page text and is not relied on.",
        "The accessible sections are not published in full. The club&rsquo;s outlet-equipped list "
        "is the best available proxy but is a list of sections with outlets, not a list of "
        "accessible sections, and companion-seat counts and accessible-seat totals are stated "
        "nowhere. The source also names the accessible seating platforms themselves as a source of "
        "obstructed views, alongside the foul poles at 107 and 132.",
        "Bullpen sides rest on the ticketing source alone. Three of its statements &mdash; at "
        "sections 103, 136 and 237 &mdash; agree with each other and with the numbering direction, "
        "but no club page states them, and Wikipedia only says the Yankees&rsquo; pen connects to "
        "Monument Park by a door.",
    ],
    sources=[("Yankee Stadium guide for guests with disabilities",
              "https://www.mlb.com/yankees/ballpark/information/disabled-services"),
             ("Yankees protective netting", "https://www.mlb.com/yankees/ballpark/netting"),
             ("RateYourSeats: Yankee Stadium", "https://www.rateyourseats.com/yankee-stadium"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Yankee+Stadium/"),
             ("Ballparks of Baseball",
              "https://www.ballparksofbaseball.com/ballparks/yankee-stadium/"),
             ("Wikipedia: Yankee Stadium", "https://en.wikipedia.org/wiki/Yankee_Stadium")],
)

FENWAY = dict(

    slug="fenwaypark", venue="Fenway Park", team="Boston Red Sox", team_short="Red Sox",
    research="redsox",
    # Nothing at Fenway is a bare number. Every identifier carries a letter prefix naming its
    # tier, and the numbers underneath those prefixes repeat - there is a 42 in the Field Boxes,
    # a 42 in the Bleachers and a 42 in the Grandstand, hundreds of feet apart. The prefix is
    # therefore the only thing that says which tier a section is on, so every bucket here is
    # driven by the tag rather than by a hundreds digit.
    levels={
        0: "Field Box (FB1&ndash;FB82)",
        1: "Right Field Box (RFB87&ndash;RFB97)",
        2: "Loge Box (LB98&ndash;LB165)",
        3: "Grandstand (GS1&ndash;GS33)",
        4: "Bleachers (B34&ndash;B43)",
        5: "Green Monster Seats (M1&ndash;M10)",
        6: "Dell Technologies Club (EMCC1&ndash;EMCC6)",
        7: "Aura Club (HPPC1&ndash;HPPC5)",
        8: "Aura Pavilion Club (PC1&ndash;PC14)",
        9: "Pavilion Box (PB1&ndash;PB14)",
        10: "Pavilion Reserved (PR15&ndash;PR20)",
        11: "Right Field Roof Box (RB23&ndash;RB43, odd numbers only)",
        12: "Standing Room Only areas",
    },
    # EMCC and HPPC are the ticketing source's URL slugs, kept because they are the stable
    # identifiers; the areas themselves are now the Dell Technologies Club and the Aura Club.
    # The six standing-room slugs share one bucket because they are one ticket type sold in
    # several places, none of them a numbered section.
    suffix_levels={"FB": 0, "RFB": 1, "LB": 2, "GS": 3, "B": 4, "M": 5,
                   "EMCC": 6, "HPPC": 7, "PC": 8, "PB": 9, "PR": 10, "RB": 11,
                   "SRO": 12, "COCA_COLA_SRO": 12, "1B_PAVILION_SRO": 12,
                   "3B_PAVILION_SRO": 12, "ROOF_BOX_SRO": 12, "GREEN_MONSTER_SRO": 12},
    # Five tiers reach the plate and are anchored. Eight do not and are deliberately absent:
    # the Right Field Box, the Bleachers, the Green Monster Seats and the Roof Boxes are each
    # wholly at one end of the park, and the three Pavilion series begin beside the plate and
    # run outward down both lines rather than sitting behind it. Distances for those come out
    # blank.
    anchors={0: (39, 50), 2: (125, 134), 3: (18, 20), 6: (1, 6), 7: (1, 5)},
    numbers_increase_toward="third",
    # Only the two tiers where a source actually states the sides. The Aura Pavilion Club zone
    # page prints the rule outright and the PC2 page repeats it; the Pavilion Reserved pages
    # name the sides section by section and they follow the same parity. Pavilion Box and Roof
    # Box are left out - see the gaps below.
    parity_levels=(8, 10),
    parity_sides={"odd": "first", "even": "third"},
    seat1_side="right",
    # The standing-room areas have no assigned seats at all - the pages say so outright - so the
    # park-wide seat-1 rule is suppressed for them rather than applied to seats that do not exist.
    seat1_unknown_levels=(12,),
    direction_overrides={
        f"RFB{n}": "in right field, down the first base line - the Right Field Boxes break the "
                   "sweep, sitting beside the LOW-numbered Field Boxes while carrying numbers "
                   "above FB82 at the opposite, left-field end of the park, so no distance from "
                   "home plate is stated for them"
        for n in range(87, 98)},
    placeholder="for example: FB45, LB130, GS18, green monster, bleachers, pavilion",
    capacity_sentence="Fenway Park opened on 20 April 1912 and is the oldest ballpark in Major "
        "League Baseball. Capacity is 37,775 on the club&rsquo;s own 2026 figure, and Fenway is "
        "one of the few parks with a real day-and-night difference, because the centre-field "
        "bleachers are tarped over to form the batter&rsquo;s eye for afternoon games; three "
        "other published figures disagree and are recorded in the gaps below. <strong>Every "
        "section identifier here carries a letter prefix naming its tier</strong>, because the "
        "plain numbers repeat from tier to tier. The lower bowl runs Field Box FB1&ndash;FB82 "
        "with Right Field Box RFB87&ndash;RFB97 out in right field, Loge Box LB98&ndash;LB165 "
        "behind it, Grandstand GS1&ndash;GS33 behind that under the roof, and Bleachers "
        "B34&ndash;B43 beyond the outfield wall. Above them sit the Green Monster Seats "
        "M1&ndash;M10 on top of the left field wall, the Dell Technologies Club "
        "EMCC1&ndash;EMCC6 and Aura Club HPPC1&ndash;HPPC5 behind home plate, the Pavilion tiers "
        "&mdash; Aura Pavilion Club PC1&ndash;PC14, Pavilion Box PB1&ndash;PB14 and Pavilion "
        "Reserved PR15&ndash;PR20 &mdash; and the odd-numbered Right Field Roof Boxes "
        "RB23&ndash;RB43 on the top deck down the first-base line.",
    numbering_summary="Fenway Park runs two numbering schemes at once, and which one applies "
        "depends on the tier. On the lower tiers &mdash; Field Box, Loge Box, Grandstand and "
        "Bleachers &mdash; the numbers sweep one way round the bowl: they rise from right field "
        "and the first-base side, past home plate, and on toward third base and left field. On "
        "the Pavilion tiers they do not sweep at all: they run outward from home plate by "
        "parity, with odd-numbered sections along the first-base line and even-numbered sections "
        "along the third-base line, so PC1 and PC2 are neighbours beside the plate on opposite "
        "sides of the diamond rather than next to each other.",
    stack_note="The home-plate block sits at FB39&ndash;FB50 in the Field Boxes, LB125&ndash;LB134 "
        "on the Loge Level, GS18&ndash;GS20 in the Grandstand, EMCC1&ndash;EMCC6 in the Dell "
        "Technologies Club and HPPC1&ndash;HPPC5 in the Aura Club, so a number that means home "
        "plate on one tier means the outfield on another. <strong>Eight tiers have no home-plate "
        "block at all and their distances are left blank rather than guessed:</strong> the Right "
        "Field Box, the Bleachers, the Green Monster Seats and the Right Field Roof Boxes are "
        "each wholly at one end of the ballpark and never wrap behind the plate, and the three "
        "Pavilion series &mdash; Aura Pavilion Club, Pavilion Box and Pavilion Reserved &mdash; "
        "begin beside the plate and run outward down both foul lines, so no single centred "
        "section exists to measure from. The standing-room areas are not sections and carry no "
        "distance either. The Grandstand anchor is the weakest of the five: no source names the "
        "behind-the-plate grandstand range outright, and GS18&ndash;GS20 is the narrowest band "
        "consistent with everything that is stated.",
    landmarks=[
        "<strong>The Red Sox dugout is on the first-base side</strong>, behind Field Box "
        "sections FB21&ndash;FB28; the visiting dugout is on the third-base side behind "
        "FB62&ndash;FB68. That is what fixes the direction of the lower-bowl sweep, and it "
        "agrees with the club&rsquo;s own netting endpoints. The Jim Beam Dugout, a sunken "
        "field-level area, sits just past the Red Sox dugout on the same side.",
        "<strong>Both bullpens are in right and right-centre field</strong>, side by side in "
        "front of the Bleachers &mdash; Fenway has no left-field bullpen at all, because the "
        "Green Monster occupies that ground. The visiting bullpen is stated to be in front of "
        "Bleachers B42 and B43; a fan report puts the Red Sox bullpen in front of B40, which "
        "would place it on the centre-field side of the pair.",
        "<strong>The Green Monster</strong> is the 37-foot left field wall, 310 to 315 feet from "
        "home plate, with about 250 seats added on top of it before the 2003 season. Those are "
        "sections M1&ndash;M10, three rows deep at most, plus a standing-room walkway. No source "
        "found states which end of the wall M1 sits at.",
        "<strong>Protective netting</strong> runs, in the club&rsquo;s own words, from Field Box "
        "section 79 to Field Box section 9, at varying heights around 12 feet 8 inches above the "
        "field. So FB9 through FB79 sit behind netting; FB1&ndash;FB8, FB80&ndash;FB82 and the "
        "whole Right Field Box series do not.",
        "<strong>The Grandstand support poles are the defining obstruction of this ballpark</strong> "
        "and they are structural, not incidental: the 1912 roof stands on them. The section "
        "pages describe beams blocking home plate, the mound, second base or the outfield "
        "depending on the seat, and the per-section reports repeatedly place the beam toward the "
        "right-hand side of the section &mdash; GS18 has one &ldquo;just 4 seats in from the "
        "right aisle&rdquo;. Row 1 is the row most often described as clear.",
        "<strong>Pesky&rsquo;s Pole stands 302 feet down the right field line</strong> and the "
        "Triangle in right-centre is the deepest point at 420 feet. The Right Field Roof Deck, "
        "the Bleacher Overlook behind the right-field bleachers and the Hornitos Cantina under "
        "the right-field Grandstand overhang are all sold as areas rather than numbered "
        "sections.",
    ],
    rows_note="<strong>Row labelling changes from tier to tier and, at Fenway, from section to "
        "section within a tier</strong>, so the per-section row list below is the one to trust. "
        "Field Boxes use letters, generally up to row M where the main concourse walkway runs, "
        "but the premium Dugout Club rows sit in front of row A and are labelled numerically or "
        "with tripled letters &mdash; FB45 reads &ldquo;A1, 2-3, A-M&rdquo; and FB80 reads "
        "&ldquo;AAA, A-L&rdquo;. Right Field Boxes and Loge Boxes use doubled letters, and the "
        "Loge zone claim of AA&ndash;NN is a generalisation only: LB98 runs DD&ndash;RR, LB130 "
        "AA&ndash;NN and LB165 JJ&ndash;PP. The Grandstand, the Bleachers, the Green Monster "
        "Seats and the Aura Pavilion Club use numbers, with row 1 at the front; bleacher depth "
        "varies enormously, from 1&ndash;10 in B34 to 1&ndash;50 in B42 and B43. Pavilion Box, "
        "Pavilion Reserved and Roof Box use letters from row A at the front. <strong>No source "
        "states an accessible-row label convention for this ballpark</strong>, so none is given "
        "here.",
    access_summary="The club publishes a disability access guide naming the areas that hold "
        "wheelchair spaces, but no section numbers anywhere, so this page can list areas and "
        "gates and nothing finer. All five gates are accessible and any ticket may be used at "
        "any gate. The elevator geography is the most precise locational fact the guide gives.",
    access_list=[
        "Wheelchair spaces are stated in the Grandstand, Bleachers, Green Monster, Right Field "
        "Roof Deck, Loge Box, Field Box, Right Field Roof Box, Aura Club, Aura Pavilion and Dell "
        "Technologies Club areas &mdash; no section numbers are published for any of them",
        "Gate D has three elevators reaching the infield grandstand, the Green Monster, the Dell "
        "Technologies suite level and the Aura Pavilion level, and a wide ramp nearby serves all "
        "levels; Gate B&rsquo;s elevator serves the right-field grandstand, Roof Deck and Roof "
        "Box; Gate E&rsquo;s serves the left-field grandstand and the Green Monster",
        "Guests with hearing impairments are seated in the Loge Box and Right Field Boxes, "
        "guests with visual impairments in the Field Box, Loge Box and Grandstand, and guests "
        "with ambulatory impairments in the Grandstand, Right Field Box and Bleachers",
        "A sensory room is at Gate E; accessible restrooms serve every accessible seating area, "
        "with family restrooms including one at Gate E",
        "Guests with service animals should enter at Gate D, though a service animal needing "
        "relief may enter and exit by any gate",
    ],
    uncertain=[
        "<strong>The per-section boilerplate says seat 1 is on the left, and this guide does not "
        "follow it.</strong> The same sentence &mdash; &ldquo;when looking towards the "
        "field/field/stage, lower number seats are on the left&rdquo; &mdash; is printed "
        "byte-identically on every Fenway section page, so it carries no per-section authority. "
        "The same site&rsquo;s own Fenway seating-chart page says the opposite: &ldquo;Seat "
        "Numbers at Fenway Park go from right-to-left.&rdquo; Four independent fan reports on "
        "three different tiers agree with the chart page and against the boilerplate. Loge Box "
        "160: &ldquo;There are 12 seats in the row with a railing at the right side of the row, "
        "so if you&rsquo;re in seat 1 you&rsquo;ll be climbing over quite a few people to get to "
        "the only aisle which is at the left side of the row (at Seat 12).&rdquo; Grandstand 33: "
        "&ldquo;Seats 5 and higher have far superior views, but put you further from the lone "
        "aisle which is at the right side of the row (at Seat 1).&rdquo; Grandstand 27 puts the "
        "&ldquo;left aisle (higher numbered seats)&rdquo; and the reviewer &ldquo;in a very good "
        "position at Seat 18&rdquo;, and Grandstand 18 describes a beam &ldquo;just 4 seats in "
        "from the right aisle&rdquo; with &ldquo;Seats 1-4 seem to be safe but anything to the "
        "left will deal with the pole&rdquo;. Those four agree with each other and with the "
        "venue&rsquo;s own chart page, so this guide states seat 1 on the right throughout. They "
        "are fan reports rather than the source&rsquo;s own verified answers, which is a weaker "
        "kind of evidence than most parks in this set rest on, and it is the single item here "
        "most worth checking against your own ticket.",
        "<strong>Right Field Box sections RFB87&ndash;RFB97 break the sweep.</strong> They are "
        "physically in right field beside the low-numbered Field Boxes, yet they carry numbers "
        "above FB82, which is at the opposite, left-field end of the park. Numbers 83&ndash;86 "
        "are absent from the index entirely and no source explains the gap. No distance from "
        "home plate is given for them, and no source states which end of the run &mdash; RFB87 "
        "or RFB97 &mdash; is nearer the infield.",
        "<strong>Plain section numbers are reused across tiers and are ambiguous on their "
        "own.</strong> Numbers 1&ndash;14 exist simultaneously as Field Box, Grandstand, Monster, "
        "Aura Pavilion Club, Pavilion Box and Dell Technologies Club sections, and 34&ndash;43 as "
        "Field Box, Bleachers and Roof Box sections. The famous red seat marking Ted "
        "Williams&rsquo; 502-foot home run is in <em>Bleachers</em> 42, row 37, seat 21, out in "
        "right field &mdash; not Field Box 42, which is behind home plate. Always carry the "
        "prefix.",
        "<strong>Parity is stated for the Aura Pavilion Club and the Pavilion Reserved, and only "
        "inferred for the Pavilion Box and the Roof Box.</strong> The Aura Pavilion pages print "
        "the rule outright &mdash; &ldquo;Odd-numbered sections run along the first base "
        "line&rdquo;, &ldquo;Even-numbered sections run along the third base line&rdquo; &mdash; "
        "and the Pavilion Reserved pages name the sides section by section in the same pattern. "
        "The Pavilion Box pages state no side at all, and the odd sections PB3, PB5 and PB7 are "
        "tagged &ldquo;Top Pick for Visiting Team Fans&rdquo;, which would put them on the "
        "third-base side and invert the rule. The Roof Boxes are odd-numbered only and wholly on "
        "the first-base side, which is consistent with parity but is not a statement of it. Both "
        "tiers are therefore left out of the parity model, and no odd-or-even side is claimed for "
        "them here.",
        "<strong>Several identifiers in the venue index have no per-section content.</strong> "
        "&ldquo;Hornitos Cantina&rdquo;, &ldquo;Roof Deck Tables&rdquo;, &ldquo;Roof Deck "
        "SRO&rdquo; and &ldquo;Field Sections&rdquo; are index links that resolve to zone pages "
        "with no section behind them, so they are not listed as sections; the first three are "
        "real baseball ticket types all the same. Loge Box 156 is missing between LB155 and "
        "LB157, and Pavilion Reserved 17 and 19 are missing although the zone page describes "
        "&ldquo;Sections 15-20&rdquo;. No source explains any of these gaps. The six "
        "standing-room slugs do have pages, but they carry no rows, no seat numbers and largely "
        "identical text, so no seat-1 side is stated for them.",
        "<strong>The club&rsquo;s own seating map was unreachable, so the section list rests on "
        "one source.</strong> The MLB.com Red Sox seating-map page returns a 404, and the "
        "accessibility page does too at its published address. Every section identifier here "
        "comes from RateYourSeats alone, uncorroborated by an official source apart from Field "
        "Box 9 and 79 on the netting page and the broad area names in the disability access "
        "guide. The 82-section Field Box series in particular has no official confirmation of "
        "its extent.",
        "<strong>Three interior sponsor names are stale on that source.</strong> The section "
        "index still prints &ldquo;State Street Pavilion Club&rdquo; where the pages it links to "
        "are headed &ldquo;Aura Pavilion Club&rdquo;, and the slug EMCC is the legacy EMC Club, "
        "now the Dell Technologies Club, whose own review text calls the sections DTC 1&ndash;DTC "
        "6. The Aura Club sections are filed under the slug HPPC. The current names are used "
        "throughout this page and the slugs are kept as identifiers because they are what the "
        "underlying data is keyed on. The index&rsquo;s display labels are inconsistent in other "
        "ways too, printing bare &ldquo;Section PB1&rdquo; for some pavilion boxes and "
        "&ldquo;Pavilion Box 11&rdquo; for others.",
        "The Grandstand home-plate block is the least certain anchor in the park. GS18&ndash;GS20 "
        "is derived from the GS20 page placing that section behind home plate, bounded by "
        "&ldquo;Sections 1-6&rdquo; on the first-base side and sections 23&ndash;33 on the "
        "third-base side; no source names the range outright, so the true block may be wider. "
        "Grandstand 1&rsquo;s own placement is likewise inferred, from its being one of the "
        "sections that catch late afternoon sun, rather than quoted.",
        "Capacity is published as four different figures and no two agree: 37,775 by MLB.com in "
        "March 2026, 37,755 at night by Wikipedia, and 37,673 at night with 37,221 by day by "
        "Ballparks of Baseball. Because the centre-field bleachers are tarped for the "
        "batter&rsquo;s eye, no single number is fully correct.",
        "Which bullpen is which is medium confidence. The editorial note states the visiting "
        "bullpen is in front of Bleachers 42 and 43; that the Red Sox pen is the centre-field "
        "one rests on a single fan review of Bleachers 40. No official source found says.",
        "The Roof Box row description contradicts itself: &ldquo;Each section includes eight rows "
        "labeled A through G&rdquo;, and A to G is seven letters. Neither figure is relied on "
        "here. Orientation rests on one textual source giving &ldquo;northeast&rdquo;, "
        "corroborated only indirectly by shade behaviour and by the gate-and-elevator geography "
        "in the club&rsquo;s access guide.",
    ],
    sources=[("MLB.com Fenway Park guide",
              "https://www.mlb.com/news/featured/fenway-park-guide-capacity-seating-chart-parking-and-more"),
             ("Red Sox disability access guide",
              "https://www.mlb.com/redsox/ballpark/disability-access-guide"),
             ("Red Sox protective netting", "https://www.mlb.com/redsox/ballpark/netting"),
             ("RateYourSeats: Fenway Park", "https://www.rateyourseats.com/fenway-park"),
             ("Where&rsquo;s The Shade: Fenway Park",
              "https://wherestheshade.com/stadium/fenway-park"),
             ("Ballparks of Baseball",
              "https://www.ballparksofbaseball.com/ballparks/fenway-park/")],
)

ORIOLE = dict(

    slug="oriolepark", venue="Oriole Park at Camden Yards", team="Baltimore Orioles",
    team_short="Orioles", research="orioles",
    # The lower bowl is two concentric rings sharing one run of numbers: the even sections are
    # the Field Level, the odd sections the Terrace Level directly behind them. `ring_levels`
    # tells the generator that section 60's neighbours are 58 and 62, not 59 and 61.
    ring_levels=(0,),
    levels={0: "Field Level (even) and Terrace Level (odd), 1&ndash;98", 2: "Club Level (200s)",
            3: "Upper Level (300s)"},
    anchors={0: (33, 39), 3: (330, 342)},
    numbers_increase_toward="third", seat1_side="right",
    # The bleachers are the far end of the one-way sweep and the three sources that place them
    # disagree - right-centre field, centre field, and beyond right field along Eutaw Street - so
    # a distance from home plate would carry more precision than the sources support.
    direction_overrides={str(n): "in the outfield beyond the wall - the bleachers sit below the "
                                 "main scoreboard, but the sources place that at right-centre "
                                 "field, at centre field and beyond right field along Eutaw "
                                 "Street, so no distance is stated"
                         for n in (90, 92, 94, 96, 98)},
    placeholder="for example: 34, bleachers, dugout, terrace",
    capacity_sentence="Oriole Park at Camden Yards opened in 1992 and has never been renamed or "
        "sold naming rights. Capacity is published three ways &mdash; 42,455 scoped to 2026, "
        "44,970 by the club and 45,971 by an older guide &mdash; because work carried out between "
        "the 2025 and 2026 seasons changed the seat count. Three numbered tiers are ticketed: the "
        "lower bowl 1&ndash;98, where the even sections are the Field Level in front and the odd "
        "sections the Terrace Level directly behind them, with the bleachers at 90&ndash;98; the "
        "Club Level 204&ndash;288; and the Upper Level 306&ndash;388. A Premium Club opening in "
        "2026 sits behind home plate slightly below the Club Level and is sold as sections "
        "C31&ndash;C43, a range whose individual members no source lists.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past "
        "home plate, down the third-base side and out to left field. Low numbers are the "
        "first-base and right-field side; high numbers are the third-base and left-field side. "
        "Every series at the park runs that same way, and in the lower bowl the sweep carries on "
        "past the left-centre bullpens at 84&ndash;86 into the bleachers 90&ndash;98, which end up "
        "somewhere between centre and right-centre field.",
    stack_note="The home-plate block sits at 33&ndash;39 in the lower bowl &mdash; odd 33, 35, 37 "
        "and 39 on the Terrace Level with even 34 and 36 in front of them &mdash; and at "
        "330&ndash;342 on the Upper Level. <strong>The Club Level has no home-plate anchor for "
        "2026</strong> &mdash; sections 232 to 240, which older charts put behind the plate, are "
        "absent from the current index and the new Premium Club occupies that position, so 230 and "
        "242 are only the nearest indexed sections on either side and Club Level distances are "
        "left blank rather than guessed. One thing to allow for in the lower bowl: because the "
        "even front sections and the odd rear sections share a single run of numbers, a count of "
        "numbers between a section and the plate counts both bands rather than one.",
    landmarks=[
        "<strong>Orioles (home) dugout:</strong> first-base side, fronted by sections 22, 24 and "
        "26, with row 1 of section 24 directly behind the bench.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 48, 50 and 52.",
        "<strong>Both bullpens sit beyond the wall in left-centre field</strong>, stacked in two "
        "tiers, a design this park introduced. Section 86 looks straight at them &mdash; a fan "
        "note says both pens lie to the left of that section &mdash; and 84&ndash;86 are named the "
        "Bird Bath. Which of the two tiers is the Orioles&rsquo; is not stated by the source.",
        "<strong>Netting</strong> is described only once, in a 2019 announcement extending it down "
        "the foul lines and nearly to the foul poles. The ticketing source publishes no per-section "
        "netting note for this park at all, so no section numbers are given here.",
        "<strong>Eutaw Street and the B&amp;O Warehouse</strong> run beyond right field, with the "
        "flag court above them. The centre-field videoboard installed for 2026 is about two and a "
        "half times the size of the one it replaced, and the bleachers 90&ndash;98 sit below it "
        "beside the out-of-town scoreboard.",
        "<strong>The Left Field Club Level, sections 272&ndash;288</strong>, holds the "
        "all-inclusive Pepsi Picnic Perch; the Home Plate Club is section 228 on the first-base "
        "side of the same tier.",
    ],
    rows_note="Rows are numbers on every tier. <strong>The entrance row is labelled EAL</strong> in "
        "the even Field Level sections and in bleachers 96 and 98, and it is the only lettered row "
        "in the lower bowl. Depth varies sharply: Field Level sections run to row 23, 27 or 29, "
        "the odd Terrace sections behind them are much shallower at 1 to 13 and only 1 to 6 in the "
        "behind-the-plate block 33&ndash;39, the Club Level runs 1 to 5 in sections 204&ndash;210 "
        "and 1 to 9 elsewhere, the left-field Club sections 268&ndash;288 run 1 to 6 with a "
        "lettered row A or TB that doubles as the entrance, and the Upper Level reaches row 25. "
        "<strong>There is no WC or other accessible row label.</strong> Accessible positions show "
        "up instead as a gap in the numbering &mdash; section 336 reads &ldquo;1-5, 9-25&rdquo;, "
        "and the missing rows 6 to 8 are the wheelchair platform.",
    access_summary="The club states that accessible seats are located throughout the park in "
        "virtually all ticket categories, but publishes no list of which sections they are in. "
        "Elevators behind home plate and in left field reach the upper tiers, with escalators as "
        "an alternative. Accessible seating is bought in advance by phone or through the club "
        "ticket site rather than in the ordinary single-game flow.",
    access_list=[
        "Elevators are behind home plate near section 36 and in left field behind section 78",
        "Escalators to the upper levels are near first base and in the left-field area; the Club "
        "Level is reached by the home-plate elevators or those escalators",
        "Guest Services provides a complimentary wheelchair escort from the gates to drop-off "
        "points in the seating bowl, but wheelchairs cannot be kept for a whole game",
        "A limited number of wheelchairs is held at the Guest Services kiosk behind home plate and "
        "at the Club Level concierge desk",
        "Accessible seating is sold in advance on 888-848-BIRD or through the club ticket site",
    ],
    uncertain=[
        "<strong>2026 is a renovation year here, so older charts and figures are stale.</strong> "
        "Work begun after the 2025 season added a centre-field videoboard about two and a half "
        "times larger, a right-field wall display, new ribbon boards and a Premium Club behind "
        "home plate for about 380 people. Any seating chart, capacity figure or Club Level section "
        "list predating that work should be treated as out of date, and the capacity itself is "
        "given three ways &mdash; 42,455 scoped to 2026, 44,970 by the club and 45,971 by an "
        "older guide, which is the 2011 renovation figure.",
        "<strong>The bleachers 90&ndash;98 are placed three different ways.</strong> The ticketing "
        "source has them in right-centre field below the main scoreboard, Wikipedia has them "
        "lining Eutaw Street beyond right field, and a third guide calls them centre-field "
        "bleachers. All three land somewhere in the centre to right-centre arc but no closer "
        "together than that, so no distance from home plate is stated for those five sections.",
        "<strong>The ticketing source contradicts itself on sections 272&ndash;288.</strong> Its "
        "Club Level zone page puts &ldquo;242-280 along the third base side&rdquo;, while the "
        "section pages from 272 upward call the same block the Left Field Club Level, overlooking "
        "left field. Sections 272, 274, 276, 278 and 280 are described both ways on the same site.",
        "Club Level sections 232, 234, 236, 238 and 240 &mdash; the behind-the-plate stretch on "
        "older charts &mdash; are absent from the 2026 index, as are 224 and 266, with no "
        "explanation. The Premium Club appears to have taken that position over, but no source "
        "says so, and its own sections are given only as the range C31&ndash;C43, which may mean "
        "seven odd-numbered blocks or every number between. They are not enumerated here.",
        "<strong>Row labels are letters in one source and numbers in another.</strong> The "
        "ticketing source prints all-numeric rows, plus the EAL entrance row, on every section "
        "page checked; an independent guide describes lettered rows beginning at AA and running A "
        "to CCC. Both cannot be current. The ticketing source is followed here.",
        "The seat-1 rule rests on two guides and no official source. The ticketing source prints "
        "&ldquo;when looking towards the field, lower number seats are on the right&rdquo; on "
        "every page &mdash; the reverse of the sentence it prints at most parks &mdash; and "
        "sections 13, 54, 74, 76, 85 and 86 each add a statement of their own that agrees with it, "
        "on both halves of the park. Nothing contradicts it, but the Orioles publish no "
        "seat-numbering rule at all. Note that under this rule seat 1 is not always the "
        "home-plate end of the row.",
        "Section 381 is the only odd number in an otherwise even 300 series and its rows start at "
        "8 rather than 1. No source explains what it is. Upper Level sections 320, 338, 350, 358 "
        "and 366 publish row lists ending at 8 where every neighbour runs to 25, which is "
        "recorded as published rather than corrected.",
        "The club publishes no list of accessible sections, so per-section accessible locations "
        "are unknown apart from the row gap visible in Upper Level sections such as 336. Standing "
        "room is sold but its locations are not stated anywhere, and the Coors Light Center Field "
        "Roof Deck carries no section identifiers.",
        "Seats per row is published for only nine sections &mdash; 13, 54, 74, 76, 79, 85, 248, "
        "262 and 326 &mdash; and several of those are counts for a single row rather than the "
        "whole section.",
        "Gate letters conflict between the club&rsquo;s own pages: the accessibility guide names "
        "Gate G for the Family Wellness Rooms while the A-to-Z guide lists family gates as C, D "
        "and H. The compass orientation, centre field to the north-north-east, rests on one "
        "statement cross-checked against shade descriptions rather than on an official source.",
    ],
    sources=[("Baltimore Orioles ballpark A-to-Z guide",
              "https://www.mlb.com/orioles/ballpark/information/guide"),
             ("Orioles disability access guide",
              "https://www.mlb.com/orioles/ballpark/disability-access-guide"),
             ("RateYourSeats: Oriole Park at Camden Yards",
              "https://www.rateyourseats.com/oriole-park"),
             ("A View From My Seat",
              "https://aviewfrommyseat.com/venue/Oriole+Park+at+Camden+Yards/"),
             ("Ballparks of Baseball",
              "https://www.ballparksofbaseball.com/ballparks/camden-yards/"),
             ("Ballpark Digest: Oriole Park renovations for 2026",
              "https://ballparkdigest.com/2025/06/18/oriole-park-renovations-unveiled-for-2026/")],
)

ROGERS = dict(

    slug="rogerscentre", venue="Rogers Centre", team="Toronto Blue Jays", team_short="Blue Jays",
    research="bluejays",
    levels={0: "Field Level clubs (1-32)", 1: "100 Level (101-148)", 2: "200 Level (204-244)",
            5: "500 Level (508-540)", 6: "Accessible platform (W 11)"},
    # Buckets are the hundreds digit everywhere except the single index entry "W 11", which has a
    # space in it, parses as no number at all and would otherwise fall into the field-level bucket
    # and be labelled as a club section. The A and B sub-sections are deliberately NOT given a
    # suffix_levels entry: 144A is section 144 with an A on it and belongs on the same tier as 144,
    # and the same goes for 23A/23B, 224A/224B and 524A/524B.
    suffix_levels={"W 11": 6},
    anchors={0: (21, 26), 1: (122, 126), 2: (221, 227), 5: (522, 526)},
    numbers_increase_toward="third", seat1_side="right",
    # The W 11 page is the one section page in the park that carries no seat-numbering text at all,
    # not even the park-wide boilerplate the rule is drawn from, so the rule is not extended to it.
    seat1_unknown_levels=(6,),
    # Sections 1-5 are the TD Lounge, a five-row strip of its own sitting in front of 23-28 rather
    # than in line with the 16-32 ring the anchor is drawn from. Counting them against 21-26 would
    # report them as sixteen to twenty sections toward first base, which is nonsense, and no source
    # states which end of the strip section 1 is at.
    direction_overrides={
        str(n): "directly behind home plate - the TD Lounge is a separate five-row strip in front "
                "of sections 23-28, not part of the 16-32 ring, and no source states which end of "
                "it section 1 sits at, so no count is offered"
        for n in (1, 2, 3, 4, 5)},
    placeholder="for example: 124, banner club, bullpen, terrace",
    capacity_sentence="Rogers Centre opened in 1989 as SkyDome and took its present name after "
        "Rogers Communications bought the building outright in 2005. <strong>Capacity is "
        "disputed.</strong> Wikipedia gives 39,150 as the figure after the second phase of the "
        "2023&ndash;24 renovation; Ballparks of Baseball still prints 41,500, which its own prose "
        "identifies as the phase-one number; and no Blue Jays page states a capacity at all. Four "
        "ticketed tiers carry section numbers: the field-level clubs 1&ndash;5 and 16&ndash;32 "
        "beneath the bowl, the 100 Level 101&ndash;148, the 200 Level 204&ndash;244 and the 500 "
        "Level 508&ndash;540. The 300 and 400 levels are sold by suite and have no numbered "
        "sections, and the roof is retractable, so sun and shade apply only when it is open.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side. All four numbered "
        "series run the same way, and none of them wraps back round the outfield &mdash; the 100 "
        "Level stops at 148 in left field rather than carrying on into right. The lettered "
        "sub-sections are front and rear halves of one numbered section, the A half nearer the "
        "field and the B half behind it, so 144A and 144B are both section 144 and both sit on the "
        "same tier as a bare number would.",
    stack_note="The home-plate block sits at 21&ndash;26 among the field-level clubs, "
        "122&ndash;126 on the 100 Level, 221&ndash;227 on the 200 Level as the Home Plate Terrace, "
        "and 522&ndash;526 on the 500 Level. The club&rsquo;s own elevator table stacks the tiers "
        "for you: Gate 7 serves sections 121, 221 and 521, Gate 9 serves 127, 227 and 527, and the "
        "premium entrance at Gate 8 sits between them, so the plate falls between 121 and 127 on "
        "every level. <strong>Sections 1&ndash;5, the TD Lounge, are given no distance</strong> "
        "&mdash; they are a separate strip in front of 23&ndash;28 and no source says which end of "
        "it section 1 is at. <strong>The 300 and 400 levels never appear here at all</strong>, "
        "having no numbered sections to anchor, and <strong>W 11</strong>, the one "
        "accessible-platform identifier in the index, has no published level or position, so its "
        "distance is left blank rather than guessed. Counts for the outfield sections "
        "101&ndash;103 and 142&ndash;148 are counts round the ring past the foul poles, not "
        "distances along a foul line.",
    landmarks=[
        "<strong>Blue Jays (home) dugout:</strong> third-base side, with field-level Banner Club "
        "sections 29&ndash;32 directly behind it and 100 Level sections 129 and 131 stated to be "
        "just above it.",
        "<strong>Visiting dugout:</strong> first-base side, with field-level sections 16&ndash;19 "
        "behind it and the Blueprint Club 16&ndash;22 just behind that. Row 8 is given as the "
        "first row behind the visiting dugout in section 118.",
        "<strong>Both bullpens are beyond the outfield wall</strong>, raised and ringed by seating "
        "since the first phase of the renovation &mdash; the Blue Jays&rsquo; in left field in "
        "front of sections 142&ndash;144B, the visitors&rsquo; in right field near 103A and 103B, "
        "with Schneiders Porch and The Catch Bar looking down on it.",
        "<strong>Netting is stated twice and the two do not match.</strong> The Blue Jays say it "
        "runs down both baseline walls &ldquo;to Sections 113C &amp; 130C&rdquo;, identifiers that "
        "no longer exist; fan data on the ticketing source says the front of sections "
        "117&ndash;126 is behind it, with height and coverage varying by section.",
        "<strong>Three premium clubs sit beneath the bowl</strong>, all products of the 2024 "
        "rebuild: the TD Lounge 1&ndash;5 behind the plate at five rows apiece, the Blueprint Club "
        "16&ndash;22 on the first-base side with views into the visiting batting cage, and the "
        "Banner Club 23&ndash;32 running from behind the plate to behind the Blue Jays dugout, all "
        "of it within fifteen rows of the field.",
        "<strong>The standing-room and social spaces carry no section numbers</strong> &mdash; "
        "Schneiders Porch on drink rails above the visiting bullpen in right field, the WestJet "
        "Flight Deck in centre, the HR Zone in left on the 200 Level, and the Corona Rooftop Patio "
        "and TD Park Social on the 500 Level.",
    ],
    rows_note="Rows are numbers at every tier, but the 100 Level adds a letter at the back and "
        "several of its sections do not start at row 1. Sections 113, 122 and 126 read &ldquo;1-36, "
        "A&rdquo; or &ldquo;1-15, A&rdquo; with the entrance at row A, while 116 and 132 read "
        "&ldquo;1-6, 7-40, 41D&rdquo; and 118, 119, 129 and 130 end at a D-suffixed row; sections "
        "108, 109, 110, 139, 140 and 141 begin at row 22, 21, 7, 12, 22 and 32 respectively, and "
        "111 puts a lettered row F in front of everything else. The field-level clubs are shallow "
        "&mdash; five rows in 1&ndash;5, eight in 20&ndash;28 and eleven in 16&ndash;19 and "
        "29&ndash;32, with no entrance row published for any of them. The 200 Level runs seven to "
        "thirteen rows and enters at the last row; the 500 Level runs thirteen to thirty-seven and "
        "enters at row 5, near the front, the opposite way round. <strong>Accessible rows are "
        "labelled WCA</strong> and are the entry row where they appear, in sections 102B, 111, 112 "
        "and 207 &mdash; and sections 131 and 147B give WCA as their entrance without listing it "
        "among their rows.",
    access_summary="Elevators at Gates 3, 7, 9 and 13 reach every level of the building, and Gate 7 "
        "is the accessible support entrance. The Blue Jays publish no list of accessible sections, "
        "saying only that accessible seating varies by event; the section-by-section detail below "
        "comes from the ticketing source, which puts most of it at the back of selected 100 Level "
        "sections with one field-level area at the front of section 111.",
    access_list=[
        "The accessible support entrance is Gate 7, and the four elevators serve the 100, 200, 300, "
        "400 and 500 levels together &mdash; Gate 3 at sections 108, 208 and 508, Gate 7 at 121, "
        "221 and 521, Gate 9 at 127, 227 and 527, Gate 13 at 141, 240 and 539",
        "Wheelchair seating is stated behind row 36 in section 108, behind row 39 in 109, 111 and "
        "112, and behind row 7 in 147B, with a field-level accessible area in front of row 7 in "
        "section 111",
        "Fan Services are near sections 123 and 141 on the 100 Level, 212 and 236 on the 200 Level "
        "and 508 and 532 on the 500 Level; first aid rooms are near 140, 238 and 538 and "
        "multi-purpose washrooms near 142, 238 and 538",
        "The ticketing source names 100 Level sections 108&ndash;115, 117, 121&ndash;127, 131 and "
        "134&ndash;139 as accessible locations, and 207 and 241 on the 200 Level as more limited "
        "&mdash; none of this is confirmed by the club",
    ],
    uncertain=[
        "<strong>The seat-1 rule is the least corroborated thing on this page, and one section "
        "flatly contradicts it.</strong> The only statement available is the ticketing "
        "source&rsquo;s park-wide boilerplate, &ldquo;when looking towards the field/ring/stage, "
        "lower number seats are on the right&rdquo;, printed identically on every Rogers Centre "
        "section page checked and absent altogether from two of them. Across all 155 sections not "
        "one page carries a plain per-section answer naming seat 1&rsquo;s aisle for a baseball "
        "game, so the boilerplate cannot be tested the way it can at other parks. The one answer "
        "that bears on it directly, on <strong>section 524A</strong> and stamped Verified Feb 2026, "
        "says the opposite: row 15 seat 9 is &ldquo;the 9th seat in from the aisle on the left side "
        "of the section (as you face the field)&rdquo;, which puts seat 1 on the left. That answer "
        "is about a concert and is a single data point, and the only other text naming seat 1 "
        "&mdash; section 239&rsquo;s answer that the right-hand half of that section starts at seat "
        "1 on its aisle &mdash; agrees with the boilerplate. &ldquo;Right&rdquo; is kept here "
        "because one contradiction does not overturn a rule found everywhere else, but it is a real "
        "contradiction and it is not resolved. Check the seat numbers on your own ticket.",
        "<strong>The 2023&ndash;24 renovation renumbered the seating and no source publishes an "
        "old-to-new map.</strong> Phase one rebuilt the outfield for 2023 and phase two demolished "
        "and rebuilt the entire lower-level seating structure for 2024. The field-level club series "
        "1&ndash;5 and 16&ndash;32 and the A/B outfield sub-sections did not exist beforehand. "
        "<strong>The club&rsquo;s own netting page still cites suffixes that no longer "
        "exist</strong>, giving the endpoints as sections 113C and 130C, and the ticketing source "
        "still serves a question-and-answer describing 113 and 130 as splitting into 130A, 130B, "
        "130C and so on &mdash; while the same page, stamped Verified Feb 2026, gives section 130 a "
        "single undivided row series with one entrance. C and D suffixes appear nowhere in the "
        "current index. Any pre-2023 seating source is unusable here for section identifiers.",
        "<strong>Capacity is 39,150 against 41,500 and there is no club figure at all.</strong> "
        "Wikipedia dates 39,150 to after phase two and 41,500 to after phase one; Ballparks of "
        "Baseball prints 41,500 as current, though its own prose ties that number to the phase-one "
        "upper-deck reseating, so it looks one phase stale. Neither figure is confirmed by the Blue "
        "Jays, whose ballpark pages state no capacity.",
        "<strong>The netting range is stated twice and differently</strong> &mdash; the club&rsquo;s "
        "&ldquo;to Sections 113C &amp; 130C&rdquo; against the fan-reported &ldquo;front of sections "
        "117-126 are behind the netting&rdquo;. The official statement predates the rebuild and uses "
        "dead identifiers; the fan note is narrower and unofficial. No post-renovation official "
        "netting statement was found.",
        "Numbers missing from the index, which no source explains: 6&ndash;15 between the TD Lounge "
        "and the Blueprint Club, 106 and 107, 208 and 209 &mdash; though the club&rsquo;s own "
        "elevator table names section 208, so that one does exist &mdash; and 501&ndash;507. The "
        "sub-section suffixes are uneven too: 104 and 104B appear with no 104A, 142 and 143 have no "
        "A/B split while 144&ndash;148 all do, and 23, 224 and 524 each appear both bare and with A "
        "and B halves.",
        "<strong>Two pages disagree about where the 23 series is.</strong> The section 23A page "
        "assigns it to the Blueprint Club behind the visiting dugout on the first-base side, while "
        "the 23 and 23B pages put the 23 series in the Banner Club behind home plate. The 23A page "
        "never names 23A in its own location sentences, so the club text may simply have bled onto "
        "it, but neither reading is adopted here.",
        "<strong>Section 126 is placed in two incompatible ways.</strong> Its own page and the "
        "site&rsquo;s best-seats list put it behind home plate, but the section 131 page carries "
        "&ldquo;row 8 is the first row behind the Blue Jays dugout in Section 126&rdquo;, and that "
        "dugout is on the third-base side by every other source. The same list stops at 125 where "
        "the anchor used here runs to 126, and section 126&rsquo;s page recommends rows 32&ndash;37 "
        "when its own row labels stop at 15 and A. Section 113 has the same fault, an insight "
        "citing rows 36&ndash;40 against a row list ending at 36 and A.",
        "<strong>W 11 is carried because the index lists it, and nothing else about it is "
        "known.</strong> Its page is a stub with no rows, no entrance, no level and no seat-numbering "
        "text of any kind, so every column for it is blank. The fan-photo source spells it W11, "
        "calls it accessible seating and ties it to Club 328 on the 300 Level, while the ticketing "
        "source&rsquo;s accessible page suggests a W prefix relates to section 111 on the 100 "
        "Level; the two point at different parts of the building. A bare &ldquo;General "
        "Admission&rdquo; entry in the same index has no geometry at all and is not carried here.",
        "The internal order of the TD Lounge, sections 1&ndash;5, is not stated anywhere. The "
        "16&ndash;32 series is well attested as increasing toward third base, but 1&ndash;5 are a "
        "physically separate strip and no source says which end of it is section 1, so no distance "
        "is offered for those five.",
        "The compass bearing rests on one source, which says the batter faces north, making the "
        "first-base side the sunny side and the third-base side the shade side. Neither the club "
        "nor Wikipedia states a bearing, and that same source&rsquo;s section numbers are "
        "pre-renovation and were not used. With a retractable roof, no source publishes which "
        "sections are covered when it is closed, so no coverage rule is given.",
        "Seats per row is not published for any section in the park. Two 200 Level answers describe "
        "sections splitting into L and R halves on real tickets, with the left half numbered from "
        "101 &mdash; but the section 230 and section 239 answers put that 101 series on opposite "
        "sides of the aisle, and no such split is documented for any other tier. The pages for "
        "104B and W 11 carry no seat-numbering text at all.",
    ],
    sources=[("Toronto Blue Jays ballpark A-Z guide",
              "https://www.mlb.com/bluejays/ballpark/information/guide"),
             ("Blue Jays know before you go", "https://www.mlb.com/bluejays/ballpark/know-before-you-go"),
             ("Blue Jays netting", "https://www.mlb.com/bluejays/ballpark/netting"),
             ("RateYourSeats: Rogers Centre", "https://www.rateyourseats.com/rogers-centre"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Rogers+Centre/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/rogers-centre/")],
)

TROPICANA = dict(

    slug="tropicanafield", venue="Tropicana Field", team="Tampa Bay Rays",
    team_short="Rays", research="rays",
    levels={
        0: "DEX Imaging Home Plate Club (HPC103-HPC108)",
        1: "100 Level (101-150)",
        2: "200 Level (203-224)",
        3: "300 Level and MaintenX SkyDeck (300-324, 341-355 odd)",
        4: "The Baldwin Group Club (106C-126C even)",
    },
    # Two premium products carry letters and would otherwise fall into the 100 Level with
    # the plain numbers they share: the Home Plate Club is a field-level block in FRONT of
    # sections 101-110, and the Baldwin Group Club is its own tier. The SkyDeck has no
    # letter to key on, so 341-355 sit in bucket 3 with the 300 Level whether or not they
    # belong there physically; direction_overrides below keeps that from inventing distances.
    suffix_levels={"HPC": 0, "C": 4},
    # A parity park counts outward from the innermost odd/even pair on each tier. The Home
    # Plate Club is the exception: all four of its sections are described as directly behind
    # the plate, so the whole block is the anchor rather than a pair with 107 and 108 counted
    # outward from it - 105 and 106 do not exist in that club. Two tiers have no anchor at
    # all and are named in the stack note.
    anchors={0: (103, 108), 1: (101, 102), 2: (203, 204), 3: (300, 301)},
    numbering_mode="parity",
    parity_sides={"odd": "third", "even": "first"},
    numbers_increase_toward=None,
    seat1_side="left",
    direction_overrides={
        **{str(n): "above the left field line - the MaintenX SkyDeck is a separate deck that "
                   "only shares the 300 Level's hundreds digit, and the source places 341-345 "
                   "down the left field line in foul territory, so a count of sections from the "
                   "300 Level anchor would mean nothing"
           for n in (341, 343, 345)},
        **{str(n): "above left field beyond the fence - the MaintenX SkyDeck is a separate deck "
                   "that only shares the 300 Level's hundreds digit, and the source places "
                   "347-355 beyond the outfield fence, so a count of sections from the 300 Level "
                   "anchor would mean nothing"
           for n in (347, 349, 351, 353, 355)},
    },
    placeholder="for example: 126, skydeck, home plate club, bullpen",
    capacity_sentence="Tropicana Field is a fixed-roof dome at 1 Tropicana Drive in St "
        "Petersburg, and 2026 is a return rather than an ordinary season: Hurricane Milton tore "
        "the fabric roof off in October 2024, the Rays played the whole of 2025 at Steinbrenner "
        "Field in Tampa, and the club opened at home again on 6 April 2026 with the roof rebuilt. "
        "Capacity is 25,025, the figure every source has carried since a 2019 reconfiguration "
        "closed the 300 Level and tarped it over; the club&rsquo;s own 2026 guide states no "
        "capacity at all, and the tarps are described as removable for high-demand games, which "
        "would take the building back above 42,000. Because the roof is fixed there is no sun "
        "anywhere in the bowl, so no section in this guide carries sun or shade advice. Five "
        "ticketed groupings: the 100 Level 101&ndash;150 right round the lower bowl, the 200 "
        "Level 203&ndash;224 above the infield, the 300 Level 300&ndash;324 that has not been "
        "sold since 2019, the all-odd MaintenX SkyDeck 341&ndash;355 above left field, and two "
        "premium blocks &mdash; the DEX Imaging Home Plate Club behind the backstop and The "
        "Baldwin Group Club along the first-base line.",
    numbering_summary="<strong>Tropicana Field does not number one way round the bowl.</strong> "
        "Numbering starts at home plate and runs outward in both directions at once, split by "
        "parity: <strong>odd-numbered sections run down the third-base side and on into left "
        "field, even-numbered sections run down the first-base side and on into right "
        "field</strong>, and within each side the number rises with distance from the plate. The "
        "club states it in those words, and its own netting page proves it &mdash; the netted run "
        "is one unbroken list from 101 to 138 ending at the two foul poles, which the club places "
        "in sections 137 and 138 on opposite sides of the field. The all-odd SkyDeck above left "
        "field says the same thing again. <strong>The sections mirror about home plate; the seat "
        "numbers do not.</strong> Facing the field, seat 1 is on your left in every section of "
        "the ballpark &mdash; the ticketing source prints that on every page, and its own "
        "per-section answers confirm it on both halves, at even 126, 148, 150 and 210 and at odd "
        "133 and 141 &mdash; so seat 1 is the end of the row nearest home plate in an "
        "even-numbered section and the end farthest from home plate in an odd-numbered one.",
    stack_note="Distances are counted outward from the innermost odd/even pair on each tier: 101 "
        "and 102 on the 100 Level, 203 and 204 on the 200 Level, 300 and 301 on the 300 Level. "
        "The block that is genuinely behind the plate is wider than that pair &mdash; the source "
        "puts sections 101&ndash;108 behind home plate, sitting about ten rows off the field "
        "because the Home Plate Club is in front of them, and on the 200 Level a press box "
        "occupies the middle, so 203 and 204 are the first sections either side of it. The four "
        "DEX Imaging Home Plate Club sections, 103, 104, 107 and 108, are all described as "
        "directly behind the plate, so the whole block is treated as the anchor. <strong>Two "
        "tiers never reach home plate, and for them distances are left blank rather than "
        "guessed.</strong> The Baldwin Group Club runs 106C&ndash;126C along the first-base line "
        "only, and the MaintenX SkyDeck is an all-odd deck above left field. The SkyDeck also "
        "shares a hundreds digit with the 300 Level without being part of it, so its sections "
        "carry a note in place of a distance.",
    landmarks=[
        "<strong>The Rays dugout is on the first-base side</strong>, the even-numbered side, in "
        "front of sections 112&ndash;118, with the visiting dugout opposite in front of odd "
        "111&ndash;117. Section 118 is described as sitting behind the Rays dugout and "
        "111&ndash;117 as above the visitors&rsquo;. The club, Ballparks of Baseball and the "
        "ticketing source all agree on the side.",
        "<strong>Both bullpens are in foul territory down the lines</strong>, in front of the "
        "seats rather than beyond the wall &mdash; the Rays&rsquo; in front of even sections 128 "
        "and 130, the visitors&rsquo; in front of odd 127 and 129. Anyone in those four sections "
        "has a bullpen between them and the field.",
        "<strong>Netting</strong> runs from home plate to the foul poles, which the club places "
        "in sections 137 and 138, and the club&rsquo;s netted list is every section from 101 to "
        "138 &mdash; the whole lower bowl on both sides. Only the outfield sections "
        "139&ndash;150 are outside it. The club adds that height and coverage vary by section, "
        "and its list uses plain numbers, so it says nothing about the letter-suffixed premium "
        "sections in front of them.",
        "<strong>The 200 Level overhang is the real obstruction here; the catwalks are "
        "not.</strong> The source says to avoid rows WW and XX in the lower bowl and calls rows "
        "VV&ndash;YY in sections 107&ndash;131 limited by the overhang, but it only bites in the "
        "sections whose row lists carry a PP&ndash;XX block &mdash; a section ending at row JJ "
        "has no such rows. Those same deep sections have a walkway between rows LL and PP. The "
        "four catwalk rings hanging over fair territory are a playing rule rather than a "
        "sightline problem: the two inner rings are in play and a ball striking either outer ring "
        "in fair territory is a home run, though a high ball can be hard to follow from the seats.",
        "<strong>The MaintenX SkyDeck is an all-inclusive deck above left field</strong>, "
        "sections 341&ndash;355 odd, with 341&ndash;345 down the left-field line in foul "
        "territory and 347&ndash;355 beyond the outfield fence. Rows are short, A&ndash;F or "
        "A&ndash;J, wheelchair positions sit behind the last lettered row, and the deck has its "
        "own Guest Services desk and is reached by the Gate 6 elevator.",
        "<strong>The ray tank sits beyond the fence in right-centre field</strong>, alongside "
        "section 150 &mdash; the source says the seat next to it is seat 9 in the short rows and "
        "seat 12 in the rest. Both commemorative golden seats are in the right-field sections "
        "too: 148, where the first Devil Rays home run landed, and 144, marking Wade "
        "Boggs&rsquo; 3,000th hit.",
    ],
    rows_note="<strong>Rows are lettered everywhere at Tropicana Field.</strong> The lower bowl "
        "runs a single-letter series and then doubles &mdash; section 126 reads &ldquo;A-Z, "
        "AA-JJ&rdquo; &mdash; and the deeper down-the-line sections add a third block, &ldquo;G-Z, "
        "AA-JJ, PP-XX&rdquo;. Where a section starts varies widely, at A, B, G, K, L or T, so do "
        "not assume a first row of A: the outfield sections 141&ndash;150 begin at row T, and the "
        "source confirms outright that row T is the row closest to the field in section 148. The "
        "200 Level is a short tier of eight rows, A&ndash;H. The 300 Level runs A&ndash;Z and "
        "then on to DD, EE, JJ or NN depending on the section; the SkyDeck runs A&ndash;F or "
        "A&ndash;J; the Home Plate Club is D&ndash;J and The Baldwin Group Club PP&ndash;UU. "
        "<strong>Accessible positions are a row labelled WCH</strong>, appended after the last "
        "lettered row, so it is at the back of the section by the concourse rather than at the "
        "front, and it is often given as the entrance row as well. Entry is generally at the "
        "back &mdash; row JJ, KK, UU or WCH &mdash; and several corner and outfield sections list "
        "two entrances, one part-way down at row W and one at the rear.",
    access_summary="The club states that accessible and companion seating is available throughout "
        "Tropicana Field at a variety of price levels, but it publishes no list of accessible "
        "section numbers, so this guide states none. The only per-section evidence is the WCH "
        "row, which the ticketing source shows in lower-bowl sections 120, 122 and 135 and in "
        "SkyDeck sections 341, 345, 349 and 353, always behind the last lettered row. The "
        "building is a fixed dome and fully climate-controlled throughout, which matters more "
        "here than at any open-air park in this set.",
    access_list=[
        "Accessible and companion seating throughout the park at a range of prices; no list of "
        "accessible sections is published, so ask the ticket office for specific locations",
        "Elevators at Gates 1, 2, 4 and 6 &mdash; Gate 1 for the Cownose Clubhouse and section "
        "150, Gate 2 for section 132, Gate 4 for the DEX Home Plate Club and section 101, Gate 6 "
        "for section 131, the Webull Suite Level and the MaintenX SkyDeck. No 300 Level stop is "
        "listed",
        "All gates are wheelchair accessible, and the Rolling Rays wheelchair transport service "
        "works from Gates 1 and 5 on a first-come, first-served basis",
        "Accessible parking in Lots 1 and 7, most of it in Lot 7, just outside the gates and "
        "subject to availability",
        "Sensory bags with noise-cancelling headphones and fidget items from Guest Services at "
        "Gates 1, 3 and 4 and on the SkyDeck, plus a sensory room; service animals are welcome",
    ],
    uncertain=[
        "<strong>Whether the 300 Level is sold at all in 2026 is unresolved.</strong> The upper "
        "deck has been tarped and unsold since the 2019 reconfiguration that set capacity at "
        "25,025, and the club&rsquo;s 2026 elevator list names no 300 Level stop &mdash; yet the "
        "club&rsquo;s own 2026 guide still lists a 300 Level among its levels and the ticketing "
        "source still serves live per-section pages for 300&ndash;324. No 2026-dated official "
        "statement was found either way, and both 2026 upgrade announcements are silent on it. "
        "There is precedent for opening parts of the upper deck for a single series, and the "
        "tarps are described as removable for the postseason. The sections are documented here "
        "and should be treated as unavailable for ordinary games unless the club says otherwise.",
        "<strong>The 300 Level pages carry no zone name and no location text at all.</strong> Not "
        "one of the twenty-five pages says which side of the ballpark its section is on or names "
        "a tier: two reads of the section index labelled the group &ldquo;Club Level&rdquo; once "
        "and &ldquo;Upper Deck&rdquo; the other, and neither label appears on the pages "
        "themselves. The parity rule is nowhere quoted on this tier &mdash; it is carried over "
        "from the club&rsquo;s park-wide sentence, supported only by section 301 being described "
        "as a view from behind home plate. Seventeen of the pages also give the entrance row as "
        "row E identically, which reads as a template value rather than seventeen observations, "
        "and 324 as the last section is the weakest item in the whole section list.",
        "<strong>The building was rebuilt after Hurricane Milton, and no source republishes the "
        "seating bowl.</strong> The roof was torn off in October 2024 and the Rays played 2025 in "
        "Tampa; five dated sources confirm the return, and the 2026 home opener was played here "
        "on 6 April. But the club states no 2026 capacity &mdash; 25,025 is a 2019 figure carried "
        "by everyone else &mdash; and nobody republished a section list after the rebuild, so if "
        "any section was added, merged or retired, no consulted source says so. No source "
        "consulted gives the ballpark&rsquo;s opening year either, which is why none is stated "
        "above.",
        "<strong>The 200 Level has two names and two row counts.</strong> The ticketing source "
        "calls sections 203&ndash;224 the Press Level; the club&rsquo;s own guide lists a 200 "
        "Level, a Club Level and the Webull Suite Level, and never uses Press Level as a ticketed "
        "tier. On the same pages the zone text says these sections have seven rows, A&ndash;G, "
        "with row A closest to the field, while each section&rsquo;s own row line says A&ndash;H "
        "and puts the entrance at row H. Neither pair has been reconciled by any source.",
        "<strong>The Baldwin Group Club is placed in three different spots by three "
        "sources.</strong> The ticketing source&rsquo;s zone page puts it at sections "
        "106&ndash;126 along the first-base line, its own per-section pages say &ldquo;just above "
        "the 100 Level seating&rdquo;, and the club&rsquo;s February 2026 article puts the club "
        "on the fourth floor. They may be describing a seating product and a lounge of the same "
        "name, but no source says so.",
        "<strong>The premium identifiers are the ticketing source&rsquo;s URL forms, not "
        "necessarily what is printed on a ticket.</strong> The Home Plate Club sections are "
        "addressed as HPC103, HPC104, HPC107 and HPC108 but headed &ldquo;Home Plate Club "
        "103&rdquo;; the Baldwin Group Club sections are addressed as 106C to 126C and headed "
        "&ldquo;Rays Club 106&rdquo;. Note also that the Home Plate Club skips 105 and 106 "
        "altogether, and that plain-numbered sections 103, 104, 107 and 108 exist as well, one "
        "step back from them.",
        "One &ldquo;verified&rdquo; answer for section 210 contradicts itself, saying the rows "
        "hold 22 seats and then that the last seat in each row is 24. Only the arithmetic is in "
        "doubt &mdash; the side is not, since it puts seat 1 on the left and the high numbers on "
        "the right, as everywhere else. Seats per row are not published for most of the park.",
        "The obstruction range printed on the lower-bowl pages, rows VV&ndash;YY, runs past the "
        "last row several of those sections actually list, and the advice to avoid rows WW and XX "
        "is carried generically onto sections that have no such rows. The same zone text tells "
        "readers to &ldquo;sit in an odd section for the best view of the scoreboard&rdquo; on "
        "even-numbered pages, and says elsewhere that the outfield scoreboard cannot be seen from "
        "the even-numbered outfield sections at all.",
        "Direct access to the ticketing source was blocked while this was compiled, so its "
        "quotes were read through a summarising tool. Short sentences repeated identically across "
        "many pages, so the parity rule, the seat-1 rule, the bullpens and the row labels are "
        "solid; the long section index is the item most exposed. The compass orientation is "
        "single-sourced &mdash; the batter facing roughly north-east &mdash; and in a domed park "
        "with no sun it drives nothing here.",
    ],
    sources=[("Tampa Bay Rays ballpark guide",
              "https://www.mlb.com/rays/ballpark/information/guide"),
             ("Rays Tropicana Field accessibility guide",
              "https://www.mlb.com/rays/ballpark/information/accessibility-guide"),
             ("Rays protective netting", "https://www.mlb.com/rays/ballpark/netting"),
             ("RateYourSeats: Tropicana Field", "https://www.rateyourseats.com/tropicana-field"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Tropicana+Field/"),
             ("Ballparks of Baseball",
              "https://www.ballparksofbaseball.com/ballparks/tropicana-field/")],
)

ALL = [YANKEE, FENWAY, ORIOLE, ROGERS, TROPICANA]
