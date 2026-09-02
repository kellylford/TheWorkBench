#!/usr/bin/env python3
"""Build the stadium-layout overview CSV (the 'general layout' view)."""
import csv
import os
# Paths resolve from this file, not the working directory, so the build works from a
# checkout on any machine. Outputs land in the parent folder - the published ballpark
# directory - rather than beside the scripts.
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
def outpath(name): return os.path.join(OUT, name)

rows = [
 # level, level_name, zone, sections, where_it_is, typical_rows, entry, notes
 ("100","Field Level","Field Bleachers","101-104",
  "Right field, beyond the right-field wall in fair territory. 101 is deepest toward right-center, 104 nearest the right-field foul pole. Sits above the visiting team bullpen.",
  "1-7 (101), 1-14 (102-104)","Top of section",
  "Bench seating with backrests, no armrests. First five rows uncovered; rear rows under the overhang."),
 ("100","Field Level","Field Outfield Box","106-109 and 126-131",
  "Lowest tier in foul territory. 106-109 run from the right-field foul pole to first base; 126-131 run from third base to the left-field foul pole. No section 105.",
  "roughly 1-30 depending on section","Top of section",
  "Front rows sit against the field wall. Left-field side (126-131) gets notably more sun."),
 ("100","Field Level","Field Infield Box / Diamond Box","110-125",
  "Lowest tier around the infield. 110-116 first-base side, 117-120 directly behind home plate, 121-125 third-base side. Brewers dugout fronts 112-114; visitors dugout fronts 121-123.",
  "1-21 in the dugout sections, 1-27 in the wider ones","Top of section",
  "Netting or screening in front of 112-123; the backstop net ends inside section 119. Row 4 is the first row behind each dugout."),
 ("200","Loge Level","Loge Bleachers","201-205 (right field), 233-238 (left field)",
  "Second tier behind each outfield wall. 201-205 in right field near the visiting bullpen; 233-238 in left field near the Brewers bullpen.",
  "1-14 to 1-19","Top of section",
  "Bench seating with backrests. Center-field scoreboard is seen at an angle from all of them. Sections 237-238 are unverified."),
 ("200","Loge Level","Loge Outfield Box","206-209 (right-field line), 228-232 (left-field line)",
  "Second tier down each foul line between the infield and the outfield corner.",
  "1-19 or 1-21","Top of section",
  "Good foul-ball territory. Left-field side gets more sun with the roof open."),
 ("200","Loge Level","Loge Infield Box / Loge Diamond Box","210-227",
  "Second tier around the infield. 210-215 first-base side, 216-221 directly behind home plate, 222-227 third-base side.",
  "1-10 in the home-plate sections (216-221), 1-19 or 1-21 elsewhere","Top of section",
  "Rows 1-5 of the infield sections are sold as premium Loge Diamond Box. 217 is an alcohol-free family section. A wheelchair lift serves section 221."),
 ("300","Club Level (PNC Club Level)","The Party Deck & Miller High Life Loft","302-305",
  "Third tier beyond the right-field wall.",
  "reported as 1-8, unverified","Not published",
  "All-inclusive group hospitality with table and rail seating, not standard bowl seating. Typically sold to groups of 25-260."),
 ("300","Club Level (PNC Club Level)","Club Outfield Box","306-313 and 344-345",
  "Above the lower bowl, out toward the right-field corner (306-313) and the left-field corner (344-345). No section 301.",
  "1-7 (311 has 1-8)","Row 7 (row 8 in 311)",
  "SKYY Lounge access included. No in-seat wait service in this sub-zone."),
 ("300","Club Level (PNC Club Level)","Club Infield Box","314-343",
  "Above the lower bowl around the infield. 314-327 first-base side, 328-331 directly behind home plate, 332-343 third-base side.",
  "1-7 (320 and 339 start at row 3; 324 and 335 listed as 1-8)","Row 7 (row 8 in 324 and 335)",
  "Only seven rows deep, so every seat is close to the concourse. SKYY Lounge access plus in-seat wait service."),
 ("400","Terrace Level","Terrace Box","404-437",
  "Upper deck. 404-410 toward the right-field corner, 411-419 first-base side, 420-423 directly behind home plate, 424-437 third-base side. No sections 401-403.",
  "1-3 or 1-7, then 8 up to 19-25 (rows 4, 6 and 7 usually do not exist)","Row 5 (row 4 in section 404)",
  "A walkway crosses each section between row 5 and row 8 (or row 7 and 8). Roof supports just above row 8 create obstructions. 417 is an alcohol-free family section. The Uecker statue and the $1 obstructed 'Uecker seats' are at section 422."),
 ("400","Terrace Level","Terrace Level Outfield","438-440",
  "Upper deck near the left-field corner. 439 and 440 sit directly behind the left-field foul pole.",
  "1-3 or 1-7, then 8 up to 16-24","Row 5",
  "The cheapest tickets in the ballpark. Full sun during day games. Partially obstructed views behind the foul pole."),
 ("400","Terrace Level","Bernie's Terrace","441-442",
  "Upper deck in deep left field beside Bernie Brewer's chalet and home-run slide.",
  "1-16 (441), 1-3, 4, 8-15 (442)","Row 5 (row 4 in section 442)",
  "Among the farthest seats from home plate in the park. Obstructed views of the scoreboard and right/center field from 442."),
 ("Field","Special areas","Named group and all-inclusive areas","Not bowl-numbered",
  "J. Leinenkugel's Barrel Yard (left-field corner, own table numbering 100-115 / 200-215 / 600-611); Aurora Health Care Bullpen (behind the right-field wall at field level); Associated Bank Power Alley (above the Brewers bullpen, left-center); Toyota Territory (above the right-center wall); Miller Lite Landing (Loge level, left-center); Johnsonville Party Deck (right field, third tier); Miller High Life Loft (above the right-field Loge bleachers).",
  "n/a","n/a",
  "These use their own table/seat numbering, separate from the bowl. A ticket reading 'table 604' is the Barrel Yard, not a bowl section."),
]

hdr = ["level","level_name","zone","sections","where_it_is","typical_rows","entry_row","notes"]
with open(outpath("american_family_field_layout.csv"),"w",newline="",encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(hdr); w.writerows(rows)
print("layout rows:", len(rows))
