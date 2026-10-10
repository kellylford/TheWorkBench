#!/usr/bin/env python3
"""Per-ballpark configuration for the American League Central."""

RATE = dict(
    slug="ratefield", venue="Rate Field", team="Chicago White Sox", team_short="White Sox",
    research="whitesox",
    levels={1: "Lower Level (100s)", 3: "Club Level (300s)", 5: "Upper Level (500s)"},
    anchors={1: (130, 134), 3: (328, 336), 5: (529, 535)},
    numbers_increase_toward="third", seat1_side="right",
    placeholder="for example: 132, bleachers, dugout, upper",
    capacity_sentence="Rate Field &mdash; Guaranteed Rate Field until December 2024, and Comiskey "
        "Park before that &mdash; opened in 1991 and seats 40,615. Three ticketed tiers: the Lower "
        "Level 100s, the Club Level 300s and the Upper Level 500s.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side.",
    stack_note="The home-plate block sits at 130&ndash;134 on the Lower Level, 328&ndash;336 on the "
        "Club Level and 529&ndash;535 on the Upper Level. There are no 200 or 400 series here at "
        "all, so the tiers jump 100 to 300 to 500.",
    landmarks=[
        "<strong>White Sox (home) dugout:</strong> third-base side, fronted by sections "
        "137&ndash;142.",
        "<strong>Visiting dugout:</strong> first-base side, fronted by sections 122&ndash;127.",
        "<strong>Scout Seats</strong> are the premium block closest to the plate, labelled 130S, "
        "131S, 133S and 134S &mdash; the S suffix matters when you read a ticket.",
        "<strong>Sections 157 and 158 sit above the White Sox bullpen</strong>, and section 157 has "
        "a foul-pole obstruction on seat 1.",
        "<strong>The upper deck is famously steep</strong> &mdash; it is one of the steepest in the "
        "majors. Per-section notes below record what the source states.",
    ],
    rows_note="Rows are numbers here, with two wrinkles. Many Lower Level sections end in a row "
        "labelled <strong>WCH</strong>, which is the wheelchair-accessible row, and some sections "
        "(112&ndash;119, 147&ndash;150, 152) begin with a row labelled <strong>AA</strong> ahead of "
        "row 1.",
    access_summary="Accessible seating is spread across the tiers. The WCH row label makes it "
        "unusually legible from the row list on this park's sections.",
    access_list=[
        "A WCH row is stated on many Lower Level sections",
        "Sections 100, 114, 115, 116 and 117 state no WCH row",
        "Section 133 shows no WCH row on the seating source despite appearing in the club's own "
        "accessibility guidance &mdash; worth confirming with the ticket office",
    ],
    uncertain=[
        "The 300 and 500 series full extents differ between sources: one guide lists 301&ndash;359 "
        "and 501&ndash;559 while the ticketing source lists only the subsets documented here.",
        "Sections 330 and 334 have no stated entrance row or seat direction; their row range is "
        "only implied by a general Club Level line about five rows.",
        "Sections 516 and 548 each state rows labelled 6&ndash;21 while also stating an entrance at "
        "row 1. Both are recorded exactly as published rather than reconciled.",
        "No concert configuration is documented.",
    ],
    sources=[("Chicago White Sox ballpark guide", "https://www.mlb.com/whitesox/ballpark"),
             ("White Sox accessibility information", "https://www.mlb.com/whitesox/ballpark/accessibility"),
             ("RateYourSeats: Rate Field", "https://www.rateyourseats.com/rate-field"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Rate+Field/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/guaranteed-rate-field/")],
)

PROGRESSIVE = dict(
    slug="progressivefield", venue="Progressive Field", team="Cleveland Guardians",
    team_short="Guardians", research="guardians",
    levels={1: "Field Level (100s)", 3: "Mezzanine and Press Level (300s)",
            4: "Upper Level (400s)", 5: "Upper Level (500s)"},
    anchors={1: (152, 155), 4: (452, 452), 5: (553, 553)},
    numbers_increase_toward="third", seat1_side="right",
    placeholder="for example: 153, bleachers, dugout, upper",
    capacity_sentence="Progressive Field opened in 1994 and seats about 34,800 after a recent "
        "renovation, making it one of the smaller parks in the majors. Tiers run the Field Level "
        "100s, the Mezzanine and Press Level 300s, and the Upper Level 400s and 500s.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side.",
    stack_note="The home-plate block sits at 152&ndash;155 on the Field Level, around 452 on the "
        "Upper 400s and around 553 on the 500s. The 300-series Press Level runs mostly along the "
        "first-base side and never wraps behind the plate, so no home-plate anchor exists for that "
        "tier and distances there are left blank rather than guessed.",
    landmarks=[
        "<strong>Guardians (home) dugout:</strong> third-base side, fronted by sections "
        "160&ndash;164. Section 162 notes row F is the first row behind it.",
        "<strong>Visiting dugout:</strong> first-base side, fronted by sections 140&ndash;146.",
        "<strong>Wheelchair seating behind row EE</strong> is stated for the home-plate sections "
        "152&ndash;155.",
        "<strong>Bleachers</strong> are sections 180&ndash;185.",
        "<strong>Section 434 has a stated obstruction</strong> &mdash; a safety bar blocks the view "
        "of the mound and batter's box from rows A and B.",
    ],
    rows_note="<strong>Rows are letters here.</strong> Field Level sections run A to Z and then "
        "continue AA to HH, and infield sections often start mid-alphabet rather than at A because "
        "the rows in front belong to a different block. The 400 level runs A to F, the club A to T "
        "and the 500 level A to X.",
    access_summary="Accessible and companion seating is spread across the tiers. The clearest "
        "published anchor is the wheelchair seating behind row EE in the home-plate sections.",
    access_list=[
        "Wheelchair seating behind row EE in sections 152&ndash;155",
        "No full section-and-row accessible inventory is published in text form",
    ],
    uncertain=[
        "Capacity figures conflict: about 34,820 from one source and 34,631 from another.",
        "The compass orientation could not be resolved &mdash; one shade source is "
        "self-contradictory and street geometry suggests the batter faces roughly north-east. "
        "Marked uncertain rather than stated.",
        "No 300-level section is confirmed behind home plate; the behind-the-plate product at that "
        "tier is a named club rather than a numbered section.",
        "One widely used stadium guide inverted both the dugout sides and the numbering direction "
        "for this park. This guide follows the sources that agree with each other and with the "
        "official netting and gate statements.",
        "Seats per row is not published for essentially any section.",
    ],
    sources=[("Cleveland Guardians ballpark guide", "https://www.mlb.com/guardians/ballpark"),
             ("Guardians accessibility information", "https://www.mlb.com/guardians/ballpark/accessibility"),
             ("RateYourSeats: Progressive Field", "https://www.rateyourseats.com/progressive-field"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Progressive+Field/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/progressive-field/")],
)

COMERICA = dict(
    slug="comericapark", venue="Comerica Park", team="Detroit Tigers", team_short="Tigers",
    research="tigers",
    levels={1: "Lower Level (100s)", 2: "Mezzanine (200s)", 3: "Upper Level (300s)"},
    anchors={1: (127, 128), 3: (327, 328)},
    numbers_increase_toward="third", seat1_side="right",
    placeholder="for example: 128, bleachers, dugout, ferris wheel",
    capacity_sentence="Comerica Park opened in 2000 and seats 41,083. Three tiers: the Lower Level "
        "100s, a short Mezzanine in the 200s and the Upper Level 300s. There is no section 335.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side.",
    stack_note="The home-plate block sits at 127&ndash;128 on the Lower Level and 327&ndash;328 up "
        "top. <strong>The Mezzanine is the odd one out</strong> &mdash; sections 210&ndash;219 run "
        "only along the right-field and first-base side and never reach behind the plate, so "
        "distances on that tier are left blank rather than guessed.",
    landmarks=[
        "<strong>The Tigers dugout is on the THIRD-base side</strong>, fronted by sections "
        "131&ndash;136. The visiting dugout is on first base, at 120&ndash;124.",
        "<strong>Both bullpens sit behind the left-field wall</strong> &mdash; the Tigers at "
        "147&ndash;148 and the visitors at 149&ndash;150.",
        "<strong>Netting</strong> runs in front of sections 116&ndash;140, and the official "
        "statement describes a safety net running foul pole to foul pole.",
        "<strong>Section 328 has a stated obstruction</strong> &mdash; the source describes it as "
        "obstructed by railings and plexiglass.",
    ],
    rows_note="Rows are mixed here, and the ADA convention is unusually clear: <strong>any row "
        "label ending in AC is the accessible row</strong> &mdash; you will see 33AC, 44AC, DAC, "
        "TAC and HHAC. Premium and outfield blocks use letters (A to F, A to Z then AA to GG, and "
        "HHH to KKK), while the main bowl uses numbers.",
    access_summary="The AC row suffix marks accessible rows and appears directly in the published "
        "row labels, which makes them locatable without a separate inventory.",
    access_list=[
        "Rows 33AC and 44AC in sections 112, 113 and 114",
        "Row 33AC in section 121",
        "Row HHAC in section 144; row TAC in sections 147 and 148",
        "Rows DAC in sections 327, 333, 337 and 343",
    ],
    uncertain=[
        "The compass bearing is reported as south by some sources and south-east by others.",
        "The ticketing source states the Tigers dugout fronts sections 131&ndash;136 while the "
        "discovery pass recorded 131&ndash;135. Both are within a section of each other.",
        "Seats per row is not published for most sections.",
        "Entrance rows are not published for sections 121&ndash;140 at all.",
    ],
    sources=[("Detroit Tigers ballpark guide", "https://www.mlb.com/tigers/ballpark"),
             ("Tigers accessibility information", "https://www.mlb.com/tigers/ballpark/accessibility"),
             ("RateYourSeats: Comerica Park", "https://www.rateyourseats.com/comerica-park"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Comerica+Park/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/comerica-park/")],
)

KAUFFMAN = dict(
    slug="kauffmanstadium", venue="Kauffman Stadium", team="Kansas City Royals",
    team_short="Royals", research="royals",
    levels={1: "Field Level (100s)", 2: "Plaza Level (200s)", 3: "Loge Level (300s)",
            4: "View Level (400s)"},
    anchors={1: (126, 130), 2: (225, 230), 3: (313, 314), 4: (419, 421)},
    numbers_increase_toward="first", seat1_side="left",
    placeholder="for example: 128, fountains, dugout, crown",
    capacity_sentence="Kauffman Stadium opened in 1973 and seats about 37,900. Four tiers: the "
        "Field Level 100s, the Plaza Level 200s, the Loge Level 300s and the View Level 400s. There "
        "is no section 149.",
    numbering_summary="Section numbers increase from left field, up the third-base side, past home "
        "plate, down the first-base side and out to right field. Low numbers are the third-base and "
        "left-field side; high numbers are the first-base and right-field side. <strong>This is the "
        "opposite of the other four parks in this division.</strong>",
    stack_note="The home-plate block sits at 126&ndash;130 on the Field Level, 225&ndash;230 on the "
        "Plaza, around 313&ndash;314 on the Loge and 419&ndash;421 on the View Level.",
    landmarks=[
        "<strong>Royals (home) dugout:</strong> first-base side, fronted by sections "
        "136&ndash;139.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 116&ndash;119.",
        "<strong>The fountains and waterfall</strong> sit beyond the outfield wall &mdash; the "
        "signature feature of this ballpark.",
        "<strong>Bullpens:</strong> the visitors' is in left field near sections 104&ndash;106; the "
        "Royals' is in right field near 150&ndash;152.",
        "<strong>Crown Club and Diamond Box</strong> are the premium blocks directly behind the "
        "plate, lettered rather than numbered.",
    ],
    rows_note="<strong>Rows are letters on every level.</strong> The Field Level runs A to U or A "
        "to X, often ending in a wheelchair row labelled <strong>VWC</strong> or "
        "<strong>WWC</strong>; the Plaza runs AA to TT; the Loge A to J; and the View Level H to V "
        "and then AA to ZZ.",
    access_summary="Accessible rows appear directly in the published row labels on the Field Level "
        "as a VWC or WWC row at the back of the section, which makes them locatable.",
    access_list=[
        "Sections 130 and 136 end in row VWC; sections 124 and 131 end in row WWC",
        "Section 103's accessible row is labelled DWC rather than VWC",
        "Sections 126&ndash;129 state wheelchair seating behind row U",
    ],
    uncertain=[
        "<strong>Section 141 contradicts the rest of the park.</strong> Its page states seat 1 is "
        "the right-most seat facing the field, while every other section states seat 1 is on the "
        "left. This guide applies the park-wide rule; treat section 141 as unverified.",
        "The Loge Level home-plate anchor (313&ndash;314) is a geometric estimate. No source names "
        "the behind-the-plate sections on that tier.",
        "Section 111 has no row, entrance or seat-direction data; its page describes it only as a "
        "general admission area.",
        "The source places the Royals bullpen near section 148 on some pages and describes sections "
        "150&ndash;152 as sitting behind it on others.",
        "Capacity is reported as 37,903 by most references, with variants elsewhere.",
        "There has been public discussion of a future new Royals ballpark; this guide documents the "
        "current home only.",
    ],
    sources=[("Kansas City Royals ballpark guide", "https://www.mlb.com/royals/ballpark"),
             ("Royals accessibility information", "https://www.mlb.com/royals/ballpark/accessibility"),
             ("RateYourSeats: Kauffman Stadium", "https://www.rateyourseats.com/kauffman-stadium"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Kauffman+Stadium/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/kauffman-stadium/")],
)

TARGET = dict(
    slug="targetfield", venue="Target Field", team="Minnesota Twins", team_short="Twins",
    research="twins",
    levels={0: "Dugout Box and Champions Club (1-17)", 1: "Main Level (100s)",
            2: "Terrace Level (200s)", 3: "View Level (300s)"},
    anchors={0: (7, 10), 1: (112, 115), 2: (214, 216), 3: (314, 316)},
    numbers_increase_toward="third", seat1_side="right",
    # The Main Level wraps the whole way round: 128-131 are LEFT field but 132-140 come back
    # around into RIGHT field, so a distance-from-home-plate figure would mislead there.
    direction_overrides={str(n): "in right field - the Main Level wraps the whole way round, so "
                                 "these sections are back on the right-field side rather than "
                                 "continuing on toward left field"
                         for n in range(132, 141)},
    placeholder="for example: 114, overlook, dugout, cove",
    capacity_sentence="Target Field opened in 2010 and seats 38,544. Four tiers: the Dugout Box and "
        "Champions Club at field level numbered 1 to 17, the Main Level 100s, the Terrace Level "
        "200s and the View Level 300s. There is no roof, which in Minnesota makes overhang cover "
        "worth checking.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side.",
    stack_note="The home-plate block sits at 7&ndash;10 at field level, 112&ndash;115 on the Main "
        "Level, 214&ndash;216 on the Terrace and 314&ndash;316 on the View Level. <strong>The Main "
        "Level then wraps the whole way round</strong> &mdash; 128&ndash;131 are in left field, but "
        "132&ndash;140 come back around into right field, so the numbers do not simply keep "
        "travelling one way.",
    landmarks=[
        "<strong>Sections 132&ndash;135 are the Treasure Island Cove</strong>, under cover in right "
        "field. <strong>136&ndash;138 are the Overlook</strong>, completely open-air. "
        "<strong>139&ndash;140 are the Corona Porch</strong> down the right-field line.",
        "<strong>128&ndash;131 are the left-field bleachers.</strong>",
        "<strong>Rain cover matters here</strong> &mdash; there is no roof. Many View Level "
        "sections state that rows 3 and above are covered; the Overlook states it is fully open.",
        "<strong>Champions Club sections 7&ndash;10</strong> are the premium block behind the "
        "plate, and the only sections in the park using lettered rows.",
    ],
    rows_note="Rows are numbers nearly everywhere, with <strong>WC</strong> rows interleaved into "
        "the numbering behind home plate rather than placed at one end &mdash; sections read like "
        "&ldquo;1-24, WC-27, 25-WC&rdquo; with the entrance at row WC. The exception is Champions "
        "Club sections 7 to 10, which use lettered rows A to M.",
    access_summary="Wheelchair rows are labelled WC and appear in the published row lists, "
        "interleaved into the numbering on the infield sections.",
    access_list=[
        "WC rows interleaved in sections 106&ndash;109, 111, 115 and 119&ndash;122",
        "Section 104 states wheelchair seating behind row 40",
        "Sections 211 and 212 state wheelchair seating behind row 4, with entry at row WC",
    ],
    uncertain=[
        "Capacity is reported as 38,544 officially, with 39,021, 39,504 and about 40,000 elsewhere.",
        "The compass bearing is reported as east by some sources and east-north-east by others.",
        "Sections 235, 236 and 328 do not appear in the venue index and are not documented here.",
        "The source's page for section 125 contradicts itself on which baseline it sits on; both "
        "statements are recorded rather than reconciled.",
        "Sections 139 and 140 have no stated entrance row or seat direction.",
        "Seats per row is not published for essentially any section.",
    ],
    sources=[("Minnesota Twins ballpark guide", "https://www.mlb.com/twins/ballpark"),
             ("Twins accessibility information", "https://www.mlb.com/twins/ballpark/accessibility"),
             ("RateYourSeats: Target Field", "https://www.rateyourseats.com/target-field"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Target+Field/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/target-field/")],
)

ALL = [RATE, PROGRESSIVE, COMERICA, KAUFFMAN, TARGET]
