#!/usr/bin/env python3
"""The named areas: clubs, suites, lounges, standing room, concert floor seating.

Twenty-one ballparks list these in the ticketing source's own venue index alongside the
numbered sections, and an early batch generator that filtered on str.isdigit() dropped all 358
of them. They are real ticket types - a Comerica Park "General Admission", a Wrigley
"Bleachers" - so they belong in the guide, but they do not belong in the numbered geometry:
they have no place in the sweep, no neighbouring section, and no distance from home plate.

So they get their own tier at the end of each park, and `render.py` treats that tier
differently - no derived distance, and a seat-1 rule taken verbatim from the section's own
page rather than derived from a numbering direction that does not apply to it.

`build_all.py` merges this into each park config at load time, which keeps it out of the six
venues_*.py files that describe the numbered bowl.
"""

NAME = "Clubs, suites and other named areas"

EXTRA = {
    "angelstadium": dict(level=6, sections=[
        "Don Julio Club", "Dugout Suites", "Suites"
    ]),
    "buschstadium": dict(level=5, sections=[
        "200 Level Party Suites", "300 Level Party Suites", "703 Club A", "703 Club B",
        "703 Club C", "703 Club D", "703 Club E", "703 Club F", "Branch Rickey Balcony",
        "Budweiser Brew House Deck", "Cardinals Club 1", "Cardinals Club 2",
        "Cardinals Club 3", "Cardinals Club 4", "Cardinals Club 5", "Cardinals Club 6",
        "Cardinals Club 7", "Cardinals Club 8", "Champions Club", "Coca Cola Rooftop Deck",
        "Coca Cola Scoreboard Patio", "Commissioners Box", "Field Sections",
        "Freese's Landing", "Left Field Landing", "MVP Deck", "Powerade Bridge",
        "Red Jacket Club", "Rooftop 1", "Rooftop 2", "Standing Room Only"
    ]),
    "chasefield": dict(level=4, sections=[
        "100W", "145W", "210A", "210B", "210C", "210D", "210E", "210F", "210G", "210H", "210I",
        "214L", "215L", "224W", "300W", "332W", "A", "AW", "B", "BW", "C", "D", "E", "F", "G",
        "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "RFW", "S"
    ]),
    "citifield": dict(level=6, sections=[
        "A", "AA", "B", "C", "D", "E", "F", "G", "H", "HH"
    ]),
    "citizensbankpark": dict(level=5, sections=[
        "A", "B", "C", "D", "E", "F", "G", "Rooftop Bleachers"
    ]),
    "comericapark": dict(level=4, sections=[
        "General Admission", "Jungle Bleachers", "Lower Suites", "Priority Club 1",
        "Priority Club 2", "Priority Club 3", "Priority Club 4", "Priority Club 5",
        "Right Field Balcony 1", "Right Field Balcony 2", "Right Field Balcony 3",
        "Terrace 116", "Terrace 117", "Terrace 118", "Terrace 136", "Terrace 137",
        "Terrace 138", "Terrace 139", "Terrace 140", "Terrace 141", "Tiger Den 120",
        "Tiger Den 121", "Tiger Den 122", "Tiger Den 123", "Tiger Den 124", "Tiger Den 125",
        "Tiger Den 126", "Tiger Den 127", "Tiger Den 128", "Tiger Den 129", "Tiger Den 130",
        "Tiger Den 131", "Tiger Den 132", "Tiger Den 133", "Tiger Den 134", "Tiger Den 135",
        "Upper Suites"
    ]),
    "coorsfield": dict(level=5, sections=[
        "A", "B", "C", "D", "E", "F"
    ]),
    "daikinpark": dict(level=5, sections=[
        "Batters Eye Boxes", "Diamond Club", "Insperity Club", "Jim Beam Bar",
        "Standing Room Only", "Ultra Club Patio"
    ]),
    "globelifefield": dict(level=4, sections=[
        "First Base Lounge Table", "Home Plate Suite 1", "Home Plate Suite 10",
        "Home Plate Suite 11", "Home Plate Suite 12", "Home Plate Suite 13",
        "Home Plate Suite 14", "Home Plate Suite 2", "Home Plate Suite 3",
        "Home Plate Suite 4", "Home Plate Suite 5", "Home Plate Suite 6", "Home Plate Suite 7",
        "Home Plate Suite 8", "Home Plate Suite 9", "Sky Box 1", "Sky Box 2", "Sky Box 3",
        "Sky Box 4", "Standing Room Only", "Texas Terrace 1", "Texas Terrace 2",
        "Third Base Lounge Table"
    ]),
    "greatamericanballpark": dict(level=6, sections=[
        "Field 1", "Field 10", "Field 11", "Field 12", "Field 13", "Field 14", "Field 15",
        "Field 16", "Field 17", "Field 18", "Field 2", "Field 3", "Field 4", "Field 5",
        "Field 6", "Field 7", "Field 8", "Field 9", "Fioptics District", "Handlebar Rail",
        "Handlebar SRO", "PRESS CLUB", "Redlegs Landing", "Standing Room Only"
    ]),
    "kauffmanstadium": dict(level=5, sections=[
        "Brew & View", "Craft and Draft", "Craft and Draft Benches", "Crown 1", "Crown 2",
        "Crown 3", "Crown 4", "Crown 5", "Crown 6", "Diamond Box A", "Diamond Box B",
        "Diamond Box C", "Diamond Box D", "Diamond Box E", "Diamond Box F",
        "Diamond Club Tables", "Miller Lite Rail Seats", "QuickTrip Fountain Deck",
        "Rivals Tables", "Standing Room Only"
    ]),
    "loandepotpark": dict(level=4, sections=[
        "FL1", "FL10", "FL11", "FL14", "FL15", "FL16", "FL2", "FL3", "FL4", "FL5", "FL6",
        "FL7", "FL8", "FL9"
    ]),
    "nationalspark": dict(level=5, sections=[
        "A", "B", "C", "D", "Diamond Club Tables", "E", "SRO"
    ]),
    "petcopark": dict(level=4, sections=[
        "A", "Agave Club", "B", "C", "Coronado Club 206", "Coronado Club 208",
        "Coronado Club 210", "D", "E", "F", "G", "Gallagher Square", "Gallaghers Club A",
        "Gallaghers Club B", "H", "I", "J", "K", "L", "Rail Seats", "The Landing", "The Point"
    ]),
    "pncpark": dict(level=4, sections=[
        "Field Sections", "Standing Room Only", "VALR VIP Lounge", "World Series Suites"
    ]),
    "progressivefield": dict(level=6, sections=[
        "Carnegie Club 1", "Carnegie Club 2", "Carnegie Club 3", "Carnegie Club 4",
        "Dugout Lounge 1", "Dugout Lounge 2", "Dugout Lounge 3", "Dugout Lounge 4",
        "Dugout Lounge 5", "Dugout Lounge 6", "Standing Room Only", "The Corner Drink Rails",
        "Upper Outfield Terrace"
    ]),
    "ratefield": dict(level=6, sections=[
        "130S", "131S", "133S", "134S", "Guaranteed Rate Club", "Miller Lite Landing",
        "Miller Lite Landing SRO", "Suite 134"
    ]),
    "sutterhealthpark": dict(level=3, sections=[
        "A", "B", "Beer Garden", "C", "D", "Dugout Club B", "Dugout Club C", "Dugout Club D",
        "Home Run Hill", "Lawn", "Legacy Club", "Party Suite", "Press Box", "Senate 104",
        "Senate 105", "Senate 106", "Senate 107", "Senate 108", "Senate 109", "Senate 110",
        "Senate 111", "Suite 1-35"
    ]),
    "targetfield": dict(level=4, sections=[
        "A", "B", "Budweiser Roof Deck", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N",
        "P", "Q", "R", "S", "T", "U", "V"
    ]),
    "tmobilepark": dict(level=4, sections=[
        "All-Star Club", "Hit It Here Cafe", "Press Club 1", "Press Club 2", "Press Club 3",
        "Press Club 4", "Press Club 5", "Press Club 6", "Press Club 7", "Standing Room Only",
        "Suites"
    ]),
    "wrigleyfield": dict(level=6, sections=[
        "Bleachers", "Budweiser Patio", "Field A", "Field AA", "Field AB", "Field B",
        "Field C", "Field D", "Field E", "Field F", "Field G", "Field H", "Field J", "Field K",
        "Field L", "Field M", "Field N", "Field P", "Field Q", "Field R", "Field S", "Field T",
        "Field U", "Field V", "Field W", "Field X", "Field Y", "Field Z", "Standing Room Only",
        "eero Club"
    ]),
}
