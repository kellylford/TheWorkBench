#!/usr/bin/env python3
"""Per-ballpark configuration for the shared renderer."""

WRIGLEY = dict(
    slug="wrigleyfield", venue="Wrigley Field", team="Chicago Cubs", team_short="Cubs",
    levels={0: "Club Box Level (3-32)", 1: "Field Box Level (100s)", 2: "Terrace Level (200s)",
            3: "Upper Box (300s)", 4: "Upper Reserved (400s)", 5: "Budweiser Bleachers (500s)"},
    anchors={0: (13, 22), 1: (112, 122), 2: (213, 222), 3: (315, 318), 4: (415, 419)},
    numbers_increase_toward="first", seat1_side="left",
    placeholder="for example: 118, bleachers, third base, post",
    capacity_sentence="Wrigley Field opened in 1914 and seats 41,649. It has six seating tiers: the "
        "Club Box level closest to the field, the Field Box 100s, the Terrace 200s, the Upper Box "
        "300s and Upper Reserved 400s in the Southwest Airlines Deck, and the Budweiser Bleachers "
        "in the outfield.",
    numbering_summary="Section numbers increase from the left-field foul pole, around behind home "
        "plate, toward the first-base and right-field side. Low numbers are the third-base and "
        "left-field side; high numbers are the first-base and right-field side. This is the "
        "opposite of the direction used at several other parks, so do not carry a habit over.",
    stack_note="The home-plate block sits at different numbers on every tier &mdash; 13&ndash;22 on "
        "the Club Box level, 112&ndash;122 in the Field Box, 213&ndash;222 on the Terrace, "
        "315&ndash;318 in the Upper Box. Adding 100 to a section number does not put you above the "
        "same spot.",
    landmarks=[
        "<strong>Cubs (home) dugout:</strong> third-base side, the low-numbered side. Club Box "
        "sections 9&ndash;12 sit behind it.",
        "<strong>Visiting dugout:</strong> first-base side, fronted by Club Box sections "
        "23&ndash;27.",
        "<strong>Both bullpens are under the bleachers</strong>, off the field of play, moved there "
        "before the 2017 season. The Cubs bullpen is under the left-field bleachers, the visiting "
        "bullpen under the right-field bleachers, both with windows.",
        "<strong>Support posts are the signature obstruction here.</strong> Wrigley is a 1914 "
        "steel-post ballpark. On the Terrace 200 level, rows 1&ndash;6 are the only pole-free rows; "
        "from about row 7 back, posts are in play. Check the per-section notes below.",
        "<strong>Compass:</strong> a batter at home plate faces roughly east-northeast. The "
        "left-field wall runs along Waveland Avenue to the north, right field along Sheffield to "
        "the east.",
    ],
    rows_note="Rows are numbers at Wrigley, not letters. Club Box runs rows 1&ndash;15; Field Box "
        "1&ndash;15; Terrace rows 1&ndash;6 are Terrace Box and rows 7 and beyond are Terrace "
        "Reserved; Upper Box roughly 1&ndash;12; Upper Reserved roughly 1&ndash;9.",
    access_summary="The official Cubs accessibility guide does not publish a list of accessible "
        "section numbers. It places accessible seating by proximity to an elevator, lift or ramp, "
        "and allows a guest with a mobility disability up to three companions.",
    access_list=[
        "Marquee Gate elevator &mdash; Terrace Level and Southwest Airlines Deck",
        "Left Field Gate elevator &mdash; Terrace Level and Southwest Airlines Deck",
        "Wintrust Right Field Gate elevator &mdash; Terrace Level and Southwest Airlines Deck",
        "Left-field corner elevator &mdash; Field Box and the upper level of the Budweiser Bleachers",
        "Right-field corner elevator &mdash; Field Box",
        "Budweiser Bleacher Gate elevator &mdash; upper level of the Budweiser Bleachers",
    ],
    uncertain=[
        "<strong>The seat-1 side is not settled.</strong> RateYourSeats contradicts itself: its "
        "individual section pages say seat 1 is on the left facing the field, while its seating "
        "chart overview page says seat 1 is on the far right. This page follows the section pages, "
        "which is the more specific source, but the whole seat-1 rule above rests on it. Treat it "
        "as unverified and check your ticket.",
        "Bleacher sections 536, 537 and 538 are grouped with the Bleachers by one source and "
        "labelled Upper Reserved by another. Their real location is not confirmed.",
        "The left-field versus right-field split of bleacher sections 501&ndash;515 is inferred "
        "from the numbering direction, not stated directly.",
        "Sections 516, 517 and 518 have no individual section page; the URLs resolve to a zone "
        "page, so no row data exists for them.",
        "Seats per row is not published for any section at this park.",
    ],
    sources=[("Chicago Cubs ballpark guide", "https://www.mlb.com/cubs/ballpark"),
             ("Chicago Cubs accessibility guide", "https://www.mlb.com/cubs/ballpark/accessibility"),
             ("RateYourSeats: Wrigley Field", "https://www.rateyourseats.com/wrigley-field"),
             ("A View From My Seat: Wrigley Field", "https://aviewfrommyseat.com/venue/Wrigley+Field/"),
             ("Ballparks of Baseball: Wrigley Field", "https://www.ballparksofbaseball.com/ballparks/wrigley-field/")],
)

BUSCH = dict(
    slug="buschstadium", venue="Busch Stadium", team="St. Louis Cardinals", team_short="Cardinals",
    levels={1: "Field Level (100s)", 2: "Loge and Redbird Club Level (200s)",
            3: "Pavilion Level (300s)", 4: "Terrace Level (400s)"},
    anchors={1: (145, 155), 2: (249, 251), 3: (347, 353), 4: (447, 450)},
    numbers_increase_toward="third", seat1_side="right",
    placeholder="for example: 150, bleachers, dugout, first base",
    capacity_sentence="Busch Stadium opened in 2006 and seats about 44,000. It has four tiers: the "
        "Field Level 100s, the Loge and Redbird Club 200s, the Pavilion 300s and the Terrace 400s.",
    numbering_summary="Section numbers increase from right field, around the first-base side, past "
        "home plate, along the third-base side and out to left field. Low numbers are the "
        "first-base and right-field side; high numbers are the third-base and left-field side.",
    stack_note="The home-plate block sits at 145&ndash;155 on the Field Level, 249&ndash;251 on the "
        "Loge, 347&ndash;353 on the Pavilion and 447&ndash;450 on the Terrace. The tiers do not "
        "line up by number.",
    landmarks=[
        "<strong>Cardinals (home) dugout:</strong> first-base side, fronted by Home Field Box "
        "sections 141&ndash;144. Section 141 sits directly behind it.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 156&ndash;159.",
        "<strong>Bullpens are beyond the outfield fence, under the bleachers.</strong> The "
        "Cardinals bullpen is in right and right-center beneath bleacher sections 107&ndash;109; "
        "the visiting bullpen is in left field.",
        "<strong>Netting</strong> runs in front of roughly sections 142&ndash;158, the full infield "
        "arc from dugout to dugout.",
        "<strong>Compass:</strong> a batter at home plate faces east-northeast, with the downtown "
        "skyline and the Gateway Arch beyond the outfield.",
    ],
    rows_note="Rows are mostly numbers, but the field-level infield uses a mixed scheme: lettered "
        "rows closest to the field, then numbered rows behind a cross-aisle. Section 141, for "
        "example, is labelled &ldquo;F-L, 1-24&rdquo; &mdash; row F is the front row, and a walkway "
        "separates row L from row 1. Read the row label on your ticket carefully at this park.",
    access_summary="The Cardinals access guide identifies accessible seating by proximity to "
        "elevators, escalators and ramps rather than by a full section list. Eligible patrons may "
        "buy up to three companion seats alongside.",
    access_list=[
        "Elevators &mdash; Level 2: UMB Champions Club and the Party Suites",
        "Elevators &mdash; Level 3: sections 231 and 255",
        "Elevators &mdash; Level 4: sections 331, 348 and 357",
        "Escalators &mdash; Level 3: section 265; Level 4: section 334",
        "East ramp serves sections 132, 231 and 331 &mdash; one vertical stack on the first-base side",
        "West ramp serves sections 151, 255 and 354 &mdash; one vertical stack behind home plate",
    ],
    uncertain=[
        "Capacity is reported as 44,383 by one source and 43,975 by another; the Cardinals' own "
        "A-Z guide page returned a 404 and could not settle it.",
        "The exact dead-centre behind-home-plate sections on the Terrace 400 level are not stated; "
        "447&ndash;450 is the best-supported span but the source treats all of 441&ndash;454 as "
        "infield terrace.",
        "Ford Plaza appears in the venue index but no source describes its location or level.",
        "Seats per row is published for only a handful of sections.",
    ],
    sources=[("St. Louis Cardinals ballpark guide", "https://www.mlb.com/cardinals/ballpark"),
             ("Cardinals access guide for guests with disabilities", "https://www.mlb.com/cardinals/ballpark/accessibility"),
             ("RateYourSeats: Busch Stadium", "https://www.rateyourseats.com/busch-stadium"),
             ("A View From My Seat: Busch Stadium", "https://aviewfrommyseat.com/venue/Busch+Stadium/"),
             ("Ballparks of Baseball: Busch Stadium", "https://www.ballparksofbaseball.com/ballparks/busch-stadium/")],
)

GABP = dict(
    slug="greatamericanballpark", venue="Great American Ball Park", team="Cincinnati Reds",
    team_short="Reds",
    levels={0: "Field Level - Diamond and Scout Seats (1-25)", 1: "Lower Bowl (100s)",
            2: "Club Home (200s)", 3: "Champions Club (300s)",
            4: "Mezzanine and View Level Box (400s)", 5: "View Level (500s)"},
    anchors={0: (1, 25), 1: (122, 126), 2: (220, 228), 3: (301, 307), 4: (422, 426), 5: (521, 525)},
    numbers_increase_toward="first", seat1_side="right",
    placeholder="for example: 124, bleachers, dugout, sun deck",
    capacity_sentence="Great American Ball Park opened in 2003. The Reds list capacity as 45,814 "
        "including standing room and group areas. Seating runs from the Diamond and Scout Seats at "
        "field level up through the 100s, the Club Home 200s, the Champions Club 300s, the "
        "Mezzanine and View Level Box 400s, and the View Level 500s.",
    numbering_summary="Section numbers increase from left field, around the third-base side, past "
        "home plate, along the first-base side and out to right field. Low numbers are the "
        "third-base and left-field side; high numbers are the first-base and right-field side.",
    stack_note="The home-plate block sits at 122&ndash;126 in the lower bowl, 422&ndash;426 on the "
        "400 level and 521&ndash;525 on the View Level. The Club Home 200s and Champions Club 300s "
        "sit behind the plate in their entirety.",
    landmarks=[
        "<strong>Reds (home) dugout:</strong> first-base side, fronted by lower-bowl sections "
        "127&ndash;132. The Dugout Box seats directly behind it are rows F&ndash;J of "
        "127&ndash;131.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 114&ndash;119.",
        "<strong>Reds bullpen is in left-centre field</strong> behind the wall; the "
        "<strong>visiting bullpen is in the right-field corner</strong> near the foul pole.",
        "<strong>Netting</strong> is listed in front of sections 1&ndash;5, 22&ndash;25 and "
        "111&ndash;135, with height and coverage varying by section.",
        "<strong>Compass:</strong> a batter at home plate faces east-southeast, putting left field "
        "to the northeast and right field toward the Ohio River to the south.",
    ],
    rows_note="<strong>Rows are letters at this park, not numbers.</strong> Lower-bowl infield "
        "sections run A&ndash;Z and then continue AA&ndash;GG. Diamond Club sections 1&ndash;5 use "
        "A&ndash;I, Scout Seats 22&ndash;25 use A&ndash;H. Some sections start part-way through the "
        "alphabet because the rows in front are sold as a separate premium block &mdash; section "
        "119 starts at F because A&ndash;E are Dugout Box.",
    access_summary="The Reds describe the park as fully accessible. Wheelchair and companion "
        "seating sits in the <strong>last row</strong> of sections across essentially every price "
        "level &mdash; Infield Box, Field Box, Terrace Line, Terrace Outfield, Mezzanine, Outer "
        "Mezzanine and View Level Box.",
    access_list=[
        "Seven public elevators, behind sections 101, 110, 121, 127 and 135",
        "Escalators at Gapper's Alley (Terrace to View Level) and the First Star Fan Zone "
        "(Terrace to Club Level)",
        "Street-level accessible entrances at Gates A, B, C and H",
        "Gates D and E reach the Suite Level by ramp, elevator or escalator",
        "Fan Accommodation Stations near section 119 on the 100 level and section 420 on the 400 level",
    ],
    uncertain=[
        "Capacity is reported as 45,814 by the Reds and 42,319 seated by Wikipedia; the higher "
        "figure most likely includes standing room and group areas. Not reconciled.",
        "The home-plate spans on the 400 and 500 levels are interpolated. Only 424 and 523 are "
        "explicitly documented as behind home plate; 422&ndash;426 and 521&ndash;525 are inferred "
        "around those anchors.",
        "Redlegs Landing appears as a ticketed area in the venue index but no source states where "
        "it is.",
        "Section 435's page contradicts itself, saying both &ldquo;labelled A-F&rdquo; and "
        "&ldquo;only 5 total rows&rdquo;. Recorded as stated.",
        "Seats per row is published for only two sections.",
    ],
    sources=[("Cincinnati Reds ballpark guide", "https://www.mlb.com/reds/ballpark/information/guide"),
             ("Reds disability access guide", "https://www.mlb.com/reds/ballpark/disability-access-guide"),
             ("RateYourSeats: Great American Ball Park", "https://www.rateyourseats.com/great-american-ball-park"),
             ("A View From My Seat: Great American Ball Park", "https://aviewfrommyseat.com/venue/Great+American+Ball+Park/"),
             ("Ballparks of Baseball: Great American Ball Park", "https://www.ballparksofbaseball.com/ballparks/great-american-ball-park/")],
)

PNC = dict(
    slug="pncpark", venue="PNC Park", team="Pittsburgh Pirates", team_short="Pirates",
    levels={0: "Field Level (1-32)", 1: "Lower Bowl (100s)", 2: "Club Level (200s)",
            3: "Grandstand Level (300s)"},
    anchors={0: (15, 18), 1: (116, 117), 2: (216, 219), 3: (316, 318)},
    numbers_increase_toward="third", seat1_side="right",
    placeholder="for example: 117, bleachers, skyline, dugout",
    capacity_sentence="PNC Park opened in 2001 and seats about 38,700 across four tiers: the Field "
        "Level 1&ndash;32, the Lower Bowl 100s, the Club Level 200s and the Grandstand 300s. It is "
        "one of the smallest parks in the majors, so no seat is far from the field.",
    numbering_summary="Section numbers increase from the right-field and first-base side toward the "
        "third-base and left-field side, then keep going around the outfield from left field "
        "through centre and back to right field &mdash; a full loop. Low numbers are the first-base "
        "side; the highest numbers come back around to right field.",
    stack_note="The home-plate block sits at 15&ndash;18 on the Field Level, 116&ndash;117 in the "
        "Lower Bowl, 216&ndash;219 on the Club Level and 316&ndash;318 in the Grandstand. Note "
        "there is no section 118 or section 3.",
    landmarks=[
        "<strong>The Pirates dugout is on the THIRD-base side</strong> &mdash; unusual in the "
        "majors, and deliberate, so the home team looks out over right field toward the downtown "
        "skyline. Field Level sections 20&ndash;24 front it.",
        "<strong>Visiting dugout:</strong> first-base side, fronted by Field Level sections "
        "9&ndash;13.",
        "<strong>Both bullpens are beyond the left-centre field wall</strong>, stacked one behind "
        "the other, with the visiting bullpen nearer the field. The left-field Bleacher Reserved "
        "seats beside section 138 are closest.",
        "<strong>Netting</strong> runs in front of Lower Bowl Infield Box sections 109&ndash;124.",
        "<strong>Compass:</strong> a batter at home plate faces east-southeast on a 120-degree "
        "orientation, which is what puts the skyline beyond right field.",
    ],
    rows_note="<strong>Rows are letters at PNC Park, not numbers</strong> &mdash; confirmed on every "
        "level. Field Level sections run A&ndash;M. Lower Bowl Infield Box sections run A&ndash;Z "
        "and then double letters AA&ndash;KK; section 117 has 53 rows that way. Where a section "
        "starts at F rather than A, the rows in front are a separate premium block.",
    access_summary="The Pirates provide accessible seating in more than 45 sections across every "
        "level and price point, with adjacent companion seats. The interactive map on pirates.com "
        "has a real-time accessible-seating filter.",
    access_list=[
        "Main Guest Relations &mdash; bottom of the Home Plate Rotunda, with sensory bags available",
        "Upper-level Guest Relations kiosk &mdash; near section 319",
        "Information kiosks &mdash; Left Field Rotunda and Center Field Gate",
        "Right Field elevator at section 101",
        "Mazeroski Way elevator at sections 113&ndash;114",
        "Press Entrance elevator at section 117, behind home plate",
    ],
    uncertain=[
        "Capacity is reported as 38,747 by MLB and 38,362 by other guides.",
        "A number of section numbers are absent from the venue index (102, 104, 106, 111, 122, 126, "
        "206, 215, 218, 224, 226, 229&ndash;234, 304, 306, 324, 326, 334). Sections 3 and 118 were "
        "spot-checked and confirmed not to exist; the rest were not individually verified.",
        "The exact boundary between the left-field Bleacher Reserved run and the centre and "
        "right-field Outfield Reserved run on the 100 level is not stated.",
        "The source applies a generic &ldquo;behind the right field wall&rdquo; blurb to sections "
        "139&ndash;147 even though 139 sits in left-centre by the bullpens. Quoted as written, with "
        "the discrepancy noted on those sections.",
        "Seats per row is published for only a handful of sections.",
    ],
    sources=[("Pittsburgh Pirates ballpark guide", "https://www.mlb.com/pirates/ballpark/information/guide"),
             ("Pirates accessibility information", "https://www.mlb.com/pirates/ballpark/accessibility"),
             ("RateYourSeats: PNC Park", "https://www.rateyourseats.com/pnc-park"),
             ("A View From My Seat: PNC Park", "https://aviewfrommyseat.com/venue/PNC+Park/"),
             ("Ballparks of Baseball: PNC Park", "https://www.ballparksofbaseball.com/ballparks/pnc-park/")],
)

ALL = [WRIGLEY, BUSCH, GABP, PNC]
