#!/usr/bin/env python3
"""Per-ballpark configuration for the American League West."""

DAIKIN = dict(
    slug="daikinpark", venue="Daikin Park", team="Houston Astros", team_short="Astros",
    research="astros",
    levels={1: "Field Level (100s)", 2: "Club and Mezzanine (200s)",
            3: "Terrace Level (300s)", 4: "Upper Deck (400s)"},
    anchors={1: (118, 120), 2: (219, 221), 3: (319, 321), 4: (419, 421)},
    numbers_increase_toward="first", seat1_side="left",
    placeholder="for example: 118, crawford, dugout, bullpen",
    capacity_sentence="Daikin Park &mdash; known as Minute Maid Park until January 2025 &mdash; "
        "opened in 2000 and seats about 41,000 under a retractable roof. Four tiers: the Field "
        "Level 100s, the Club and Mezzanine 200s, the Terrace 300s and the Upper Deck 400s.",
    numbering_summary="Section numbers increase from left field, up the third-base side, past home "
        "plate, down the first-base side and out to right field. Low numbers are the third-base and "
        "left-field side; high numbers are the first-base and right-field side.",
    stack_note="The home-plate block sits at 118&ndash;120 on the Field Level, 219&ndash;221 on the "
        "Club Level, 319&ndash;321 on the Terrace and 419&ndash;421 on the Upper Deck. Handily, the "
        "last two digits do roughly line up at this park &mdash; but that is a coincidence of this "
        "ballpark, not a rule you can carry anywhere else.",
    landmarks=[
        "<strong>Astros (home) dugout:</strong> first-base side, fronted by sections 122&ndash;126.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 112&ndash;116.",
        "<strong>The Crawford Boxes</strong> are sections 100&ndash;104 &mdash; the short porch in "
        "left field, close to the wall and a magnet for home runs.",
        "<strong>Bullpen Boxes</strong> are sections 150&ndash;156, out past the outfield.",
        "<strong>Retractable roof.</strong> When it is closed the park is fully enclosed and "
        "air-conditioned, so sun and shade stop mattering &mdash; which is most of the summer.",
    ],
    rows_note="Rows are numbers at this park. Infield sections generally start at row 5 rather than "
        "row 1, because the rows in front are sold as a separate premium block; outfield sections "
        "start at row 1.",
    access_summary="Accessible seating is spread across all levels. The Astros' guide identifies it "
        "by elevator and ramp proximity rather than publishing a section-by-section list.",
    access_list=[
        "Elevator on the third-base side near section 109",
        "Elevator on the first-base side near section 128",
        "Wheelchair seating behind row 20 is stated for bullpen sections 151 and 154",
    ],
    uncertain=[
        "Capacity is reported as 40,963 by the Astros and 41,168 by Wikipedia.",
        "One guide reverses the dugouts; three independent sources place the Astros on first base "
        "and the visitors on third, which is what this page follows.",
        "Seats per row is not published for most sections.",
        "Zone names are missing from the source for a handful of upper-deck sections.",
    ],
    sources=[("Houston Astros ballpark guide", "https://www.mlb.com/astros/ballpark"),
             ("Astros disability access guide", "https://www.mlb.com/astros/ballpark/disability-access-guide"),
             ("RateYourSeats: Daikin Park", "https://www.rateyourseats.com/daikin-park"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Daikin+Park/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/minute-maid-park/")],
)

ANGEL = dict(
    slug="angelstadium", venue="Angel Stadium", team="Los Angeles Angels", team_short="Angels",
    research="angels",
    levels={1: "Field Level (100s)", 2: "Terrace Level (200s)", 3: "Club Level (300s)",
            4: "View Level (400s)", 5: "Upper View Level (500s)"},
    anchors={1: (114, 122), 2: (213, 221), 3: (320, 332), 4: (418, 421), 5: (519, 522)},
    numbers_increase_toward="first", seat1_side="left",
    placeholder="for example: 118, diamond club, dugout, rocks",
    capacity_sentence="Angel Stadium opened in 1966 and seats 45,517, making it the fourth-oldest "
        "ballpark in the majors. Five tiers: Field 100s, Terrace 200s, Club 300s, View 400s and "
        "Upper View 500s.",
    numbering_summary="Section numbers increase from the third-base and left-field side, past home "
        "plate, toward the first-base and right-field side. Low numbers are the third-base side; "
        "high numbers are the first-base side.",
    stack_note="The home-plate block sits at 114&ndash;122 on the Field Level, 213&ndash;221 on the "
        "Terrace, 320&ndash;332 on the Club Level, 418&ndash;421 on the View Level and "
        "519&ndash;522 above that. There is no consistent offset between tiers.",
    landmarks=[
        "<strong>Dugout:</strong> the dugout sits in front of sections 110&ndash;112.",
        "<strong>Netting</strong> is stated in front of sections 110&ndash;126.",
        "<strong>The rock formation and waterfall</strong> sit beyond the left-centre field wall.",
        "<strong>Shade:</strong> the source repeats that on the Club Level, rows E and above are "
        "shaded during most day games &mdash; useful in southern California.",
    ],
    rows_note="<strong>Rows are letters at every level of this park &mdash; there are no numbered "
        "rows.</strong> Field Level sections run AA and BB, then A to Z, with row A nearest the "
        "field and the entrance at row Z at the back. The letters I, O and Q are skipped. Club "
        "sections run A to H, View Level A to J, and the 500s A to R.",
    access_summary="Accessible seating is available across the levels, with companion seating "
        "alongside. The Angels' guide does not publish a full section-and-row inventory.",
    access_list=[
        "Gates 1 (section 107) and 2 (section 114) serve the third-base side",
        "Gates 3 (section 122) and 4 (section 129) serve the first-base side",
        "Gate 6 (section 236) serves right field",
    ],
    uncertain=[
        "Capacity is reported as 45,517 officially, 45,483 and 45,050 elsewhere.",
        "Concert floor sections could not be verified &mdash; the ticketing venue page refused "
        "automated access, so no concert configuration is documented here.",
        "Sections 214&ndash;220 are not sold as numbered seats; the Don Julio Club occupies that "
        "gap behind home plate on the Terrace Level.",
        "Zone names are missing from the source for a handful of sections.",
    ],
    sources=[("Los Angeles Angels ballpark guide", "https://www.mlb.com/angels/ballpark"),
             ("Angels accessibility information", "https://www.mlb.com/angels/ballpark/accessibility"),
             ("RateYourSeats: Angel Stadium", "https://www.rateyourseats.com/angel-stadium"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Angel+Stadium/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/angel-stadium/")],
)

SUTTER = dict(
    slug="sutterhealthpark", venue="Sutter Health Park", team="Athletics", team_short="Athletics",
    research="athletics",
    levels={1: "Lower Bowl (100 level)", 2: "Club and Suite Level (200 level)"},
    anchors={1: (109, 113)},
    numbers_increase_toward="third", seat1_side=None,
    placeholder="for example: 111, lawn, dugout, shade",
    capacity_sentence="Sutter Health Park in West Sacramento is the Athletics' temporary home for "
        "2025 through 2027, with an option for 2028, while a Las Vegas ballpark is built. It is a "
        "converted minor-league park and at about 14,000 it is comfortably the smallest venue in "
        "the majors &mdash; roughly a third the size of every other park in this guide. Some 2026 "
        "home games are reportedly scheduled at Las Vegas Ballpark rather than here, so check the "
        "venue on your ticket.",
    numbering_summary="Section numbers increase from the first-base and right-field side, past home "
        "plate, toward the third-base and left-field side. Low numbers are the first-base side; "
        "high numbers are the third-base side.",
    stack_note="There are effectively two tiers here rather than four. The lower bowl runs "
        "101&ndash;125 with home plate at 109&ndash;113; the 200 level is suites, press box and "
        "club space, and no numbered 200-level section is confirmed as sitting behind the plate.",
    landmarks=[
        "<strong>The home dugout is on the THIRD-base side</strong> at this park, fronted by "
        "sections 116&ndash;120. The visiting dugout is on first base, behind sections "
        "102&ndash;108.",
        "<strong>Shade is the thing to get right here.</strong> Sacramento summers are severe and "
        "this is a small park with limited overhang, so the per-section shade notes below matter "
        "more than they would elsewhere.",
        "<strong>Home Run Hill</strong> is a grass berm rather than seating, so it has no rows or "
        "seat numbers at all.",
        "<strong>Most sections end in a row labelled &ldquo;WC&rdquo;</strong> at the top &mdash; "
        "that is the wheelchair-accessible row, and it is unusually legible from the row labels "
        "compared with most parks.",
    ],
    rows_note="Rows are mixed here. Most sections use numbers, but several lower-bowl sections have "
        "lettered front rows &mdash; AA, BB, CC &mdash; ahead of the numbered rows, and most "
        "sections finish with a row labelled &ldquo;WC&rdquo;. Numbered rows do not always start at "
        "1 or run consecutively.",
    access_summary="The &ldquo;WC&rdquo; row that tops most sections is the accessible row, which "
        "makes accessible seating easier to locate here than at the larger parks. No official "
        "section-and-row inventory was retrievable.",
    access_list=[
        "A &ldquo;WC&rdquo; row is recorded at the top of most lower-bowl sections",
        "Sections 102, 106, 109, 115 and 118 do not show a WC row in the available data",
    ],
    uncertain=[
        "<strong>This park has materially weaker data than the others in this guide.</strong> "
        "RateYourSeats has no per-section pages for it &mdash; every section URL serves a generic "
        "page &mdash; so all of it comes from fan-submitted data on A View From My Seat. Entrance "
        "rows, ticket zone names and seats per row are unavailable for every section.",
        "<strong>No source states which side seat 1 is on.</strong> Unlike every other park here, "
        "this guide does not state a seat-1 rule, because none is published.",
        "Sections 200&ndash;204 and 206 have no row data at all.",
        "Capacity is about 14,014, including grass berms and standing room; it was roughly 14,611 "
        "before the MLB conversion.",
        "Some 2026 Athletics home games are reportedly at Las Vegas Ballpark, which is not covered "
        "by this guide.",
    ],
    sources=[("Athletics ballpark information", "https://www.mlb.com/athletics/ballpark"),
             ("A View From My Seat: Sutter Health Park", "https://aviewfrommyseat.com/venue/Sutter+Health+Park/"),
             ("RateYourSeats: Sutter Health Park", "https://www.rateyourseats.com/sutter-health-park/seating/seating-chart")],
)

TMOBILE = dict(
    slug="tmobilepark", venue="T-Mobile Park", team="Seattle Mariners", team_short="Mariners",
    research="mariners",
    levels={0: "Diamond Club (field level)", 1: "Main Level and Bleachers (100s)",
            2: "Terrace Club (200s)", 3: "View Level (300s)"},
    anchors={0: (25, 35), 1: (127, 132), 2: (224, 236), 3: (328, 332)},
    numbers_increase_toward="third", seat1_side="right",
    placeholder="for example: 128, bleachers, the pen, roof",
    capacity_sentence="T-Mobile Park opened in 1999 and seats about 47,400. Four tiers: the Diamond "
        "Club at field level, the Main Level and Bleachers in the 100s, the Terrace Club 200s and "
        "the View Level 300s.",
    numbering_summary="Section numbers increase from right field, up the first-base side, past home "
        "plate, down the third-base side and out to left field. Low numbers are the first-base and "
        "right-field side; high numbers are the third-base and left-field side.",
    stack_note="The home-plate block sits at 127&ndash;132 on the Main Level (there is no 130), "
        "224&ndash;236 on the Terrace Club and 328&ndash;332 on the View Level. The Terrace numbers "
        "in the middle of that arc are suites rather than seats.",
    landmarks=[
        "<strong>Mariners (home) dugout:</strong> first-base side, fronted by sections "
        "121&ndash;124.",
        "<strong>Visiting dugout:</strong> third-base side, fronted by sections 136&ndash;139.",
        "<strong>Both bullpens</strong> sit beyond the left-centre field fence, under the "
        "bleachers.",
        "<strong>Netting:</strong> a 27-foot net arc covers roughly sections 126&ndash;134.",
        "<strong>The roof covers but does not enclose.</strong> It keeps rain off the seats but the "
        "park stays open at the sides, so it does not become an indoor stadium the way Houston's or "
        "Texas's does.",
    ],
    rows_note="Rows are numbers on every level. What catches people out here is that many infield "
        "sections do not start at row 1 &mdash; they start at row 5, 9, 17 or even 23, because the "
        "rows in front belong to a different priced block. Section 108, for instance, is labelled "
        "rows 23 to 41.",
    access_summary="Accessible and companion seating is spread across the levels. No "
        "section-level wheelchair inventory is published.",
    access_list=[
        "Ramps at section 114 in right field and section 143 in left field",
        "Roof coverage keeps rain off but the park is not enclosed",
    ],
    uncertain=[
        "No official capacity figure is published; sources range from 47,368 to 47,574.",
        "No section-level wheelchair seating list is published.",
        "A few sections publish self-contradictory row strings &mdash; 223, 227, 306, 308, 345 and "
        "347 &mdash; and are recorded exactly as the source states them rather than tidied.",
        "Seats per row is unavailable for many sections.",
    ],
    sources=[("Seattle Mariners ballpark guide", "https://www.mlb.com/mariners/ballpark"),
             ("Mariners accessibility information", "https://www.mlb.com/mariners/ballpark/accessibility"),
             ("RateYourSeats: T-Mobile Park", "https://www.rateyourseats.com/t-mobile-park"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/T-Mobile+Park/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/t-mobile-park/")],
)

GLOBE = dict(
    slug="globelifefield", venue="Globe Life Field", team="Texas Rangers", team_short="Rangers",
    research="rangers",
    levels={0: "Lower Level (1-33)", 1: "Mezzanine Level (100s)", 2: "Pavilion Level (200s)",
            3: "Upper Level (300s)"},
    anchors={0: (12, 15), 1: (112, 115), 2: (214, 220), 3: (313, 314)},
    numbers_increase_toward="first", seat1_side="left",
    # The Lower Level numbering breaks: 27-33 sit in LEFT field rather than continuing
    # round into right, so a distance-from-home-plate figure would be misleading there.
    direction_overrides={str(n): "in left field - the Lower Level numbering breaks here rather "
                                 "than continuing round from the first-base side"
                         for n in range(27, 34)},
    placeholder="for example: 114, all you can eat, pavilion, roof",
    capacity_sentence="Globe Life Field opened in 2020 and seats about 40,300 under a retractable "
        "roof. Four tiers: the Lower Level 1&ndash;33, the Mezzanine 100s, the Pavilion 200s and "
        "the Upper Level 300s. Not to be confused with Globe Life Park, the previous ballpark next "
        "door, which is now a football stadium.",
    numbering_summary="Section numbers increase from the third-base and left-field side, past home "
        "plate, toward the first-base and right-field side. Low numbers are the third-base side; "
        "high numbers are the first-base side.",
    stack_note="The home-plate block sits at roughly 12&ndash;15 on the Lower Level, "
        "112&ndash;115 on the Mezzanine, 214&ndash;220 on the Pavilion and 313&ndash;314 on the "
        "Upper Level. The Lower Level uses one- and two-digit numbers rather than 100s, so a "
        "&ldquo;section 14&rdquo; ticket is the best seat in the house and a &ldquo;section "
        "114&rdquo; ticket is a tier up.",
    landmarks=[
        "<strong>Netting</strong> extends in front of sections 1 through 25 on the Lower Level.",
        "<strong>The All You Can Eat seats are sections 27&ndash;33, in left field.</strong> "
        "Sections 27 and 28 sit above the visiting bullpen.",
        "<strong>Corner Boxes</strong> are 21&ndash;26, in the first-base corner.",
        "<strong>Right Field Pavilion</strong> is 233&ndash;239 and <strong>Left Field "
        "Pavilion</strong> is 240&ndash;244.",
        "<strong>The roof is usually closed</strong> for heat, so the park is normally an "
        "air-conditioned indoor stadium and sun and shade rarely matter.",
    ],
    rows_note="Rows are numbers at this park, on every level. Lower Level sections typically run 1 "
        "to 16, Mezzanine infield 1 to 20, Pavilion 1 to 13 and Upper Level 1 to 14.",
    access_summary="Accessible and companion seating is available across the levels. The ballpark's "
        "own map and accessibility pages are JavaScript-rendered and could not be read "
        "automatically, so the detail here is thinner than at the other parks.",
    access_list=[
        "No section-level accessible seating inventory was retrievable in text form",
        "The Rangers' disability access guide is the place to confirm a specific seat",
    ],
    uncertain=[
        "The exact home-plate sections on the Lower Level are inferred from the midpoint of the "
        "1&ndash;26 run plus the Balcones Speakeasy anchor at sections 13&ndash;14, not stated "
        "outright.",
        "The Lower Level numbering is discontinuous &mdash; sections 27&ndash;33 sit in left field "
        "rather than continuing round into right, which breaks the otherwise steady progression.",
        "The ballpark's official map, A&ndash;Z guide and accessibility pages are "
        "JavaScript-rendered and could not be read; the team's disability access guide was used "
        "instead.",
        "Sections 134 and 135 are table seating with no published row range.",
        "Entrance rows and seats per row are unavailable for the Lower Level sections.",
    ],
    sources=[("Texas Rangers ballpark guide", "https://www.mlb.com/rangers/ballpark"),
             ("Rangers disability access guide", "https://www.mlb.com/rangers/ballpark/disability-access-guide"),
             ("RateYourSeats: Globe Life Field", "https://www.rateyourseats.com/globe-life-field"),
             ("A View From My Seat", "https://aviewfrommyseat.com/venue/Globe+Life+Field/"),
             ("Ballparks of Baseball", "https://www.ballparksofbaseball.com/ballparks/globe-life-field/")],
)

ALL = [DAIKIN, ANGEL, SUTTER, TMOBILE, GLOBE]
