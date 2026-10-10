#!/usr/bin/env python3
"""Per-ballpark configuration for the National League East."""

TRUIST = dict(
    slug="truistpark", venue="Truist Park", team="Atlanta Braves", team_short="Braves",
    research="braves",
    levels={0: "Field Level (1-42)", 1: "Lower Level (100s)", 2: "Terrace Level (200s)",
            3: "Vista Level (300s)", 4: "Grandstand Level (400s)"},
    anchors={0: (25, 26), 1: (125, 126), 2: (226, 226), 3: (325, 327), 4: (425, 427)},
    numbers_increase_toward="third", seat1_side="right",
    # The Lower Level ring does not stop at the left-field corner. It keeps climbing round the
    # outfield, so 153-155 are in centre field and 156-160 are back in RIGHT field; 257 and 259
    # are the Terrace equivalents. A distance-from-home-plate figure would mislead in all of them.
    direction_overrides={
        **{str(n): "in centre field - the Lower Level ring keeps climbing round the outfield, so "
                   "these sections have passed the left-field corner rather than continuing on "
                   "toward third base"
           for n in (153, 154, 155)},
        **{str(n): "in right field - the Chop House, where the Lower Level ring has wrapped the "
                   "whole way round, so these high numbers are back on the first-base side rather "
                   "than out in left field"
           for n in (156, 157, 158, 159, 160)},
        "257": "in right field - Chop House Deck, above the restaurant, so this high Terrace number "
               "sits back on the first-base side rather than out in left field",
        "259": "in right field - Chop House Deck, above the restaurant, so this high Terrace number "
               "sits back on the first-base side rather than out in left field",
    },
    placeholder="for example: 126, chop house, dugout, vista",
    capacity_sentence="Truist Park opened in 2017 as SunTrust Park and took its current name in "
        "January 2020. Capacity is about 41,084, though published figures conflict. Five ticketed "
        "tiers: the Field Level premium clubs numbered 1&ndash;42, the Lower Level 100s, the "
        "Terrace Level 200s, the Vista Level 300s and the Grandstand Level 400s.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side.",
    stack_note="The home-plate block sits at 25&ndash;26 at field level, around 125&ndash;126 on the "
        "Lower Level, 226 on the Terrace, 325&ndash;327 on the Vista Level and 425&ndash;427 up top. "
        "<strong>The Lower Level then wraps the whole way round</strong> &mdash; 144&ndash;152 run "
        "out through left field, 153&ndash;155 reach centre and 156&ndash;160 come back around into "
        "right field as the Chop House, so the numbers do not simply keep travelling one way.",
    landmarks=[
        "<strong>Braves (home) dugout:</strong> first-base side, fronted by field-level sections "
        "17&ndash;21.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 31&ndash;35. One "
        "source gives 31&ndash;34, so treat the far end as approximate.",
        "<strong>Both bullpens sit beneath the Home Run Porch</strong> beyond the outfield wall "
        "&mdash; the Braves' below sections 153&ndash;154 and the visitors' below 144&ndash;145.",
        "<strong>Netting</strong> is stated in front of field-level sections 10&ndash;42 and Lower "
        "Level sections 118&ndash;133, with height and coverage varying by section.",
        "<strong>The Chop House</strong> is the right-field social block &mdash; sections "
        "156&ndash;160 are five rows of high-top bar seating with table ledges, topped by the "
        "single-row Chop House Deck at 257 and 259.",
        "<strong>Truist Club sections 1&ndash;9</strong> form a separate innermost arc about 58 feet "
        "from the plate, with section 5 dead centre &mdash; they sit in front of the 22&ndash;30 "
        "block rather than in line with it.",
    ],
    rows_note="<strong>Rows are numbers everywhere at this park</strong> &mdash; no section uses "
        "lettered rows, though a few premium blocks carry prefixed labels, such as the Xfinity Club "
        "sections 222&ndash;230 reading &ldquo;1-7, TB1-TB9&rdquo;. Depth varies sharply by tier: "
        "Truist Club sections have four rows, Lower Level sections run to about row 20, Terrace "
        "Infield sections about 19 with entry tunnels at the very top, Vista sections 7 to 13 and "
        "Grandstand sections 1 to 12.",
    access_summary="Wheelchair spaces and companion seats are spread across every level, sited near "
        "elevators or ramps. This park does not use a row-label suffix for accessible rows &mdash; "
        "the source describes accessible positions relative to the last numbered row instead.",
    access_list=[
        "Wheelchair seating is stated behind row 18 in Lower Level sections 111, 113, 118, 122, "
        "130, 133, 138 and 141",
        "Accessible parking is in Lot N29, with a shuttle to the Third Base Gate on Battery Avenue",
        "A complimentary wheelchair escort service runs from the gates to seats and back, and "
        "elevator priority goes to guests with disabilities",
    ],
    uncertain=[
        "<strong>Eight sections have no row or seat-direction data at all.</strong> Section 250 is "
        "general admission and states outright that seats and rows are not assigned; sections 437, "
        "438, 439, 440, 442, 443 and 444 have no row list published on their pages and are recorded "
        "as unknown rather than filled in from their neighbours.",
        "The Lower Level home-plate anchor of 125&ndash;126 is a geometric estimate. The source "
        "names the Delta Sky360 block 122&ndash;130 as the behind-the-plate product but never names "
        "a single centred section on that tier.",
        "The venue section index omits numbers that its own zone pages imply exist, among them 129, "
        "221, 319, 321, 332, 419, 421 and 432. Only sections the index actually lists are documented "
        "here.",
        "Capacity is reported as 41,084, 41,500 and 41,147 by different sources; no primary Braves "
        "figure was retrieved.",
        "Bullpen and visiting-dugout extents disagree between sources &mdash; the Braves bullpen at "
        "153&ndash;154 against 152&ndash;153, and the visiting dugout at 31&ndash;35 against "
        "31&ndash;34.",
        "The compass orientation could not be resolved. Two sources put centre field to the "
        "south-east and a third contradicts them outright, so no bearing is stated here.",
        "Seats per row is not published for any section in the park.",
    ],
    sources=[("Atlanta Braves ballpark guide", "https://www.mlb.com/braves/ballpark"),
             ("Braves disability access guide", "https://www.mlb.com/braves/ballpark/disability-access-guide"),
             ("RateYourSeats: Truist Park", "https://www.rateyourseats.com/truist-park"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Truist+Park/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/truist-park/")],
)

LOANDEPOT = dict(
    slug="loandepotpark", venue="loanDepot park", team="Miami Marlins", team_short="Marlins",
    research="marlins",
    levels={0: "Promenade Level (1-40)", 1: "Home Run Porch (100s)",
            2: "Lexus Legends Level (200s)", 3: "Vista Level (300s)"},
    anchors={0: (13, 18), 3: (311, 318)},
    numbers_increase_toward="third", seat1_side="right",
    # The lower bowl wraps past the left-field corner and picks up again in right field, so
    # 34-40 sit under the Home Run Porch rather than beyond 32 in left field.
    direction_overrides={str(n): "in right field - the lower bowl's numbering wraps past the "
                                 "left-field corner and picks up again beneath the Home Run Porch, "
                                 "so these sections are back on the first-base side"
                         for n in (34, 35, 36, 38, 39, 40)},
    placeholder="for example: 15, home run porch, bullpen, vista",
    capacity_sentence="loanDepot park opened in 2012 as Marlins Park and was renamed in March 2021. "
        "Capacity is 37,442. A three-panel retractable roof parks behind the first-base grandstand "
        "and opens in about thirteen minutes, and six retractable glass panels behind left field "
        "open onto the downtown skyline. Four ticketed tiers: the Promenade Level lower bowl "
        "numbered 1&ndash;40, the Home Run Porch 134&ndash;141, the Lexus Legends Level 200s and "
        "the Vista Level 300s.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side.",
    stack_note="The home-plate block sits at 13&ndash;18 in the lower bowl and 311&ndash;318 on the "
        "Vista Level. <strong>Two tiers never reach the plate at all.</strong> Sections "
        "212&ndash;218 do not exist &mdash; suites and the press box fill that arc &mdash; so the "
        "Lexus Legends Level runs 201&ndash;211 and 219&ndash;228 with no behind-the-plate section, "
        "and the Home Run Porch is a right-field deck that never reaches the infield. Distances on "
        "both are left blank rather than guessed.",
    landmarks=[
        "<strong>The dugout sides are genuinely disputed.</strong> Ballparks of Baseball and the "
        "ticketing source's Promenade Infield review put the Marlins on the third-base side, "
        "fronted by sections 19&ndash;21, with the visitors at 8&ndash;10. The same ticketing "
        "source's Dugout Club page says the opposite. The club's own guide names the dugout clubs "
        "without assigning teams, so this guide does not settle it.",
        "<strong>Bullpens beyond the outfield walls</strong> &mdash; one behind the left-field "
        "fence at sections 29&ndash;31, the other in right field beneath the Home Run Porch at "
        "38&ndash;39. Which pen belongs to which team is contradicted between the expert review and "
        "the fan notes on the very same pages.",
        "<strong>Netting</strong> stands 30 feet high at the ends of each dugout and tapers down "
        "each foul line, reaching the end of section 3 in right field.",
        "<strong>The retractable roof and glass panels</strong> mean this is the one park in the set "
        "that can be fully air-conditioned; the six left-field panels are 240 feet long and 60 feet "
        "high combined.",
        "<strong>The Social and AutoNation Alley</strong> are the standing-room areas &mdash; drink "
        "rails above sections 1&ndash;3 down the right-field line, and a multi-tiered deck in left "
        "field.",
    ],
    rows_note="Rows are mixed and vary by section. Promenade infield sections usually run lettered "
        "rows in front of numbered ones &mdash; sections 12 and 18 read &ldquo;A-E, 1-27&rdquo; "
        "&mdash; while some corner sections are numbers only and do not start at 1, as section 1 "
        "does at row 9. The Legends Level is numbers only and no more than ten rows deep, and the "
        "Dugout Club uses rows AA to DD. <strong>Accessible rows are labelled WC</strong> and sit "
        "at the top of the section, doubling as the entrance.",
    access_summary="Wheelchair-accessible and semi-ambulatory seats are available on every level, "
        "generally at the top of the section by the concourse entrance. The WC row label makes them "
        "visible directly in the published row list.",
    access_list=[
        "The accessible row is labelled WC and is also the section entrance",
        "Eight public elevators serve every seating level, with ramps as an alternative",
        "Electrical outlets for medical devices are provided in designated seating areas on the "
        "Promenade, Legends and Vista levels",
        "Sensory kits and a sensory room are on the Legends Level",
    ],
    uncertain=[
        "<strong>Which side the home dugout is on is not settled.</strong> Three sources put the "
        "Marlins on third base and one puts them on first. The club's own guide declines to say. "
        "Both readings are recorded rather than reconciled.",
        "<strong>The Bullpen Bar &amp; Grill sells its own &ldquo;sections 1-3&rdquo;</strong>, "
        "which collide by number with lower-bowl sections 1&ndash;3 down the right-field line. A "
        "ticket reading section 2 could mean either.",
        "The lower-bowl wrap is medium confidence. Two sources place sections 34&ndash;40 in right "
        "field beneath the Home Run Porch; an older review from the same ticketing source calls "
        "38&ndash;39 left field.",
        "Bullpen ownership is contradicted within single pages &mdash; the expert review and the fan "
        "notes on the same section disagree about which team warms up where.",
        "Fourteen field-level premium sections labelled FL1 to FL16 appear in the venue index but "
        "carry no per-section data, and FL12, FL13, lower-bowl 33 and 37, Legends 212&ndash;218 and "
        "Vista 301 do not exist at all.",
        "Capacity is 37,442 against a seated-only figure of 36,742, and no source states which "
        "compass direction the batter faces.",
        "Seats per row is not published for any section in the park.",
    ],
    sources=[("Miami Marlins ballpark guide", "https://www.mlb.com/marlins/ballpark"),
             ("Marlins disability access guide", "https://www.mlb.com/marlins/ballpark/disability-access-guide"),
             ("RateYourSeats: loanDepot park", "https://www.rateyourseats.com/loandepot-park"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/loanDepot+park/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/loandepot-park/")],
)

CITI = dict(
    slug="citifield", venue="Citi Field", team="New York Mets", team_short="Mets",
    research="mets",
    levels={0: "Clover Home Plate Club (11-19)", 1: "Field Level (100s)",
            3: "Excelsior Level (300s)", 4: "Promenade Level (400s)",
            5: "Promenade Level (500s)"},
    anchors={0: (11, 19), 1: (117, 118), 3: (317, 321), 4: (413, 417), 5: (512, 517)},
    numbers_increase_toward="third", seat1_side="left",
    placeholder="for example: 117, promenade, apple, bullpen",
    capacity_sentence="Citi Field opened in 2009 in Flushing, Queens and seats 41,922. Five "
        "ticketed tiers: the Clover Home Plate Club numbered 11&ndash;19, the Field Level 100s, the "
        "Excelsior Level 300s and the two Promenade decks in the 400s and 500s. The Empire Suite "
        "Level sits between the Field and Excelsior tiers and sells suites only, so there is no 200 "
        "series here at all.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side.",
    stack_note="The home-plate block sits at 11&ndash;19 in the Clover Club, 117&ndash;118 on the "
        "Field Level, 317&ndash;321 on the Excelsior Level, 413&ndash;417 on the 400 deck and "
        "512&ndash;517 on the 500 deck. The club's own elevator listings bracket each tier "
        "identically &mdash; first base at 114, 315, 411 and 511, third base at 121, 324, 418 and "
        "518 &mdash; so the tiers are genuinely stacked rather than offset.",
    landmarks=[
        "<strong>Mets (home) dugout:</strong> first-base side, fronted by sections 111&ndash;114, "
        "with the Hyundai Club sections just inside them.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 121&ndash;124.",
        "<strong>Both bullpens sit in right-centre field</strong> at Bullpen Plaza, beneath and in "
        "front of the Shea Bridge, with section 143 directly behind them. Which pen is the home pen "
        "is not stated by the source.",
        "<strong>Netting</strong> fronts sections 111&ndash;124, and a lower protective fence "
        "continues down both lines out to sections 107 and 128.",
        "<strong>The Home Run Apple</strong> stands in centre field beyond the wall, with the Big "
        "Apple Reserved sections 140&ndash;142 just to its right.",
        "<strong>The Jackie Robinson Rotunda</strong> is the main entrance behind home plate, with "
        "the Piazza 31 Club built above it on the Excelsior Level.",
    ],
    rows_note="The Field Level mixes letters and numbers, with lettered rows A to E sitting "
        "<em>in front of</em> numbered row 1 in sections such as 107, 109, 110, 125, 126 and 128. "
        "The Clover, Excelsior and both Promenade tiers use numbers only. Depth falls sharply by "
        "tier &mdash; up to 39 rows at Field Level, no more than 12 on the Excelsior Level, five to "
        "eight on the 400 deck and 17 on the 500 deck. A park-wide accessible-row convention is not "
        "published; a WC suffix appears on a handful of sections, such as row 10WC in section 16 "
        "and row 5WC in sections 410 and 411, but it is observed rather than stated.",
    access_summary="Every location at Citi Field is step-free, served by eleven elevators reaching "
        "all levels plus a ramp in the left-field corner. Accessible seating is sold through the "
        "normal single-game channels, with up to three companion seats per accessible seat.",
    access_list=[
        "The club publishes a full list of accessible sections on every tier, from Sterling Level "
        "16&ndash;18 through Promenade 403 to 434",
        "The Left Field Ramp behind sections 129, 329 and 429 reaches every level and is open to "
        "all guests",
        "Aisle seats with one liftable armrest are flagged under &ldquo;More seat details&rdquo; "
        "when booking",
        "The Bullpen Gate on Seaver Way is the recommended accessible drop-off point",
    ],
    uncertain=[
        "<strong>The seat-1 side is the largest open item at this park.</strong> The ticketing "
        "source states &ldquo;when looking towards the field, lower number seats are on the "
        "left&rdquo; identically on all 166 section pages. An independent guide states instead that "
        "&ldquo;seat 1 in any row is closest to home plate&rdquo;. The two agree on the first-base "
        "and right-field side and invert each other on the third-base and left-field side. This "
        "guide follows the per-section source, which is corroborated by section 328's own question "
        "and answer describing a third-base-side row starting at seat 1 on the left, and by section "
        "506's. The contradiction is real and unresolved.",
        "Seats per row is missing park-wide. Only sections 328 and 506 publish a figure.",
        "Entrance rows are not published for Excelsior Gold sections 314, 315, 316, 317, 321, 322, "
        "323 and 324.",
        "The Hyundai Club's section numbers conflict between sources: the ticketing source places "
        "the club at 115&ndash;120, while the club's own guide puts its first-base entrance at "
        "section 114 and its third-base entrance at 121, which are adjacent to that range rather "
        "than inside it.",
        "The Excelsior home-plate anchor of 317&ndash;321 is derived from which pages carry a "
        "home-plate view note, not from a positional statement. The side is certain; the exact "
        "centred section is not.",
        "Boilerplate is repeated across pages &mdash; the netting note describing sections "
        "107&ndash;128 appears verbatim on the Clover pages 11&ndash;19, which are outside that "
        "range.",
        "Which bullpen belongs to the home team is not stated by the source.",
    ],
    sources=[("New York Mets ballpark guide", "https://www.mlb.com/mets/ballpark"),
             ("Mets accessibility guide", "https://www.mlb.com/mets/ballpark/disability-access-guide"),
             ("RateYourSeats: Citi Field", "https://www.rateyourseats.com/citi-field"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Citi+Field/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/citi-field/")],
)

CITIZENS = dict(
    slug="citizensbankpark", venue="Citizens Bank Park", team="Philadelphia Phillies",
    team_short="Phillies", research="phillies",
    levels={1: "Field Level (100s)", 2: "Club and Hall of Fame Club (200s)",
            3: "Lower Terrace (300s)", 4: "Upper Terrace (400s)"},
    anchors={1: (119, 128), 2: (220, 224), 3: (319, 322), 4: (419, 422)},
    numbers_increase_toward="third", seat1_side="right",
    placeholder="for example: 123, ashburn alley, dugout, terrace",
    capacity_sentence="Citizens Bank Park opened in 2004 and seats 42,901. Four numbered tiers: the "
        "Field Level 100s, the Club Level 200s including the Hall of Fame Club, the Lower Terrace "
        "300s and the Upper Terrace 400s, plus the lettered field-level club sections A to G behind "
        "the plate. The numbering has unexplained holes &mdash; there are no sections 238&ndash;240 "
        "or 311, and the 400 level begins at 412.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side. Straightaway centre "
        "field has no numbered sections, so the run ends at 148 rather than wrapping back round.",
    stack_note="The home-plate block sits at 119&ndash;128 on the Field Level, 220&ndash;224 in the "
        "Hall of Fame Club, 319&ndash;322 on the Lower Terrace and 419&ndash;422 on the Upper "
        "Terrace, the four blocks stacking almost squarely on top of one another. Closer still are "
        "the lettered club sections A to G, which line the backstop wall at field level in front of "
        "119&ndash;128.",
    landmarks=[
        "<strong>Phillies (home) dugout:</strong> first-base side, fronted by sections "
        "115&ndash;118.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 129&ndash;132.",
        "<strong>Both bullpens sit in right-centre field</strong> in a split-level stack directly "
        "below section 101. Which team occupies the upper deck is not stated by the source.",
        "<strong>Netting</strong> runs in front of sections 115&ndash;132 and across the lettered "
        "club rows behind the backstop.",
        "<strong>Ashburn Alley</strong> is the 625-foot outfield concourse behind centre field, with "
        "a bullpen viewing platform and the Rooftop Bleachers above it looking back at the "
        "Philadelphia skyline.",
        "<strong>The Liberty Bell</strong> hangs in right-centre, 100 feet above street level, and "
        "swings and rings after every Phillies home run. The videoboard behind the left-field fence "
        "is the opposite landmark &mdash; it blocks the view from the furthest left-field field-level "
        "seats.",
    ],
    rows_note="Rows are numbers on every tier &mdash; short up top, where Lower Terrace sections "
        "mostly run 1 to 8 and Upper Terrace 1 to 16, and long at field level, where several "
        "sections reach row 40. Many field-level sections do not start at row 1: sections "
        "119&ndash;128 begin at row 21 or 24. <strong>Accessible seating carries a WC suffix on the "
        "last row number</strong> &mdash; row 37WC in sections 109, 111, 112, 139 and 143, row 34WC "
        "in 116, 117, 130 and 131, and row 21WC in 140, 144 and 147. Section 132 is the lone "
        "exception to the numbers-only rule, carrying lettered rows A and B ahead of row 1.",
    access_summary="Accessible seating sits in accessible rows at the top of most sections on every "
        "level except the 400 Level, which is reachable only by stairs. The WC row suffix makes the "
        "accessible row visible directly in the published row list.",
    access_list=[
        "Accessible rows sit at the top of most sections; the 400 Level has none and is stairs-only",
        "Companion seating runs at a maximum three-to-one ratio, with folding chairs provided",
        "Guest Services desks in sections 122 and 318 hold courtesy wheelchairs",
        "Elevators serve guests with disabilities behind sections 103, 112, 119, 123, 133, 137 and "
        "141, with ramps at the First Base and Left Field gates",
    ],
    uncertain=[
        "<strong>The lettered field-level club sections A to G appear to run the opposite way to "
        "the numbered sections.</strong> A single source states that F and G sit closest to the "
        "Phillies on-deck circle and A and B closest to the visitors', which with the Phillies on "
        "first base would reverse the 101-to-148 sweep. It is uncorroborated, so no seat-1 rule is "
        "stated for those sections and they are not documented here.",
        "Capacity is disputed &mdash; 42,901 against 43,035. The lower figure is used here; the "
        "higher one matches an older published number and is probably stale.",
        "A multiyear renovation is in progress, so premium-area names, capacity and some section "
        "labels are moving targets.",
        "The section-number gaps at 238&ndash;240, 311 and everything below 412 are unexplained. No "
        "source states whether those numbers do not exist, are suites, or are merely absent from "
        "the index.",
        "Section 132 publishes lettered rows A and B ahead of row 1, the only lettered rows found "
        "anywhere in the park, contradicting the general numbers-only rule. It is recorded as "
        "published.",
        "Six Lower Terrace sections &mdash; 318 and 323 to 326 and 330 &mdash; publish a row hint "
        "that exceeds their own stated row range. The stated range is used and the conflict is kept "
        "in the section notes.",
        "The compass orientation is inferred rather than quoted, and the split-level bullpen "
        "assignment is not stated by the source.",
    ],
    sources=[("Philadelphia Phillies ballpark guide", "https://www.mlb.com/phillies/ballpark"),
             ("Phillies disability access guide", "https://www.mlb.com/phillies/ballpark/disability-access-guide"),
             ("RateYourSeats: Citizens Bank Park", "https://www.rateyourseats.com/citizens-bank-park"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Citizens+Bank+Park/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/citizens-bank-park/")],
)

NATIONALS = dict(
    slug="nationalspark", venue="Nationals Park", team="Washington Nationals",
    team_short="Nationals", research="nationals",
    levels={1: "Main Level (100s)", 2: "Mezzanine (200s)", 3: "Gallery (300s)",
            4: "Upper Gallery (400s)"},
    anchors={1: (119, 126), 2: (212, 215), 3: (310, 316)},
    numbers_increase_toward="first", seat1_side="right",
    placeholder="for example: 122, gallery, dugout, scoreboard",
    capacity_sentence="Nationals Park opened in 2008 and seats 41,373. Four ticketed tiers: the "
        "Main Level 100s, the Mezzanine 200s, the Gallery 300s and the Upper Gallery 400s. The "
        "Upper Gallery is split in two behind home plate by the press box, so it runs 401&ndash;409 "
        "and 416&ndash;420 with no sections 410&ndash;415 at all.",
    numbering_summary="Section numbers increase from left field, up the third-base side, past home "
        "plate, down the first-base side and out to right field. Low numbers are the third-base and "
        "left-field side; high numbers are the first-base and right-field side. <strong>This is the "
        "opposite of the other four parks in this division.</strong>",
    stack_note="The home-plate block sits at 119&ndash;126 on the Main Level, 212&ndash;215 on the "
        "Mezzanine and 310&ndash;316 in the Gallery. <strong>The Upper Gallery is the odd one "
        "out</strong> &mdash; the Shirley Povich Media Center splits it in two behind the plate and "
        "sections 410&ndash;415 simply do not exist, so that tier never reaches home plate and "
        "distances there are left blank rather than guessed. The split is a deliberate nod to "
        "Griffith Stadium.",
    landmarks=[
        "<strong>Nationals (home) dugout:</strong> first-base side, fronted by sections "
        "127&ndash;131, with 128&ndash;129 directly behind it. Row D is the first row behind the "
        "bench.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 114&ndash;118, with "
        "116&ndash;117 directly behind it.",
        "<strong>Bullpens:</strong> one in left field in front of sections 101&ndash;102, the other "
        "in right field beside 138&ndash;139. Sit in row L or higher in left field to be behind "
        "rather than beside the pen.",
        "<strong>Netting</strong> is stated in front of the Terra Club, the Diamond Club sections "
        "119&ndash;126 and sections 109&ndash;118 and 127&ndash;135.",
        "<strong>The split upper deck</strong> behind home plate is this park's signature quirk "
        "&mdash; the press box divides the 400 level in two.",
        "<strong>The Scoreboard Pavilion, sections 237&ndash;243</strong>, sits in right and "
        "right-centre directly in front of the main videoboard, so fans there turn around to watch "
        "replays.",
    ],
    rows_note="<strong>Rows are letters on every level.</strong> The Main Level runs long alphabetic "
        "sequences that double up, A to Z and then AA to WW in the deepest sections, with A to U "
        "across the Diamond Club block 119&ndash;126. The Mezzanine runs A to P, the Right Field "
        "Terrace A to X, the Gallery A to J or A to L and the Upper Gallery A to N. The accessible "
        "convention here is a <strong>WC suffix on the section number rather than the row</strong> "
        "&mdash; section 114's accessible block is sold as 114WC.",
    access_summary="Accessible seating is sold on every level, with a companion seat available next "
        "to each accessible seat. Locations are described section by section rather than by row "
        "label, generally at the top of a section next to the concourse.",
    access_list=[
        "Elevators behind sections 113 and 134 reach all levels; the one behind 120 serves the "
        "clubs and press box only",
        "Section 114's accessible block sits at the very top of the section and is sold as 114WC",
        "In-park exchanges to accessible seating are handled at Advanced Ticket Sales behind "
        "section 104",
        "The accessible ticket window is window 8 at the main box office outside the Center Field "
        "gates",
    ],
    uncertain=[
        "Capacity is reported five different ways &mdash; 41,373, 41,565, 41,339, 41,313 and 41,888 "
        "at opening. The first is used here.",
        "<strong>Which bullpen is on which side rests on a single source.</strong> No official "
        "Nationals page read states the sides, and section 100's own fan note places the visiting "
        "pen somewhere that does not sit cleanly with the rest.",
        "Sections 222 and 236 belong to no zone in the venue's own zone pages. Their individual "
        "pages call them Right Field Terrace, which is the better answer but is unconfirmed.",
        "<strong>The 200-level right-field range splits by parity and no source explains why.</strong> "
        "Even sections 222 to 236 are Right Field Terrace with rows A to X entered at row A; the odd "
        "sections between them are Mezzanine with rows A to P entered at row P.",
        "The 400-level side assignment is unverified. The directly fetched pages for 401, 409, 416, "
        "419 and 420 carry no first-base or third-base statement at all.",
        "Row ranges conflict between the zone text and the individual pages on the 200 and 300 "
        "levels &mdash; A to J against A to L on sections 317, 318 and 320, and section 316 "
        "recommends rows H to L in a section it says ends at J. Both are recorded as published.",
        "The lettered Terra Club sections A to E, the Diamond Club tables and the standing-room "
        "inventory appear in the venue index but have no per-section data, so they are not "
        "documented here.",
    ],
    sources=[("Washington Nationals ballpark guide", "https://www.mlb.com/nationals/ballpark"),
             ("Nationals accessibility information", "https://www.mlb.com/nationals/ballpark/accessibility"),
             ("RateYourSeats: Nationals Park", "https://www.rateyourseats.com/nationals-park"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Nationals+Park/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/nationals-park/")],
)

ALL = [TRUIST, LOANDEPOT, CITI, CITIZENS, NATIONALS]
