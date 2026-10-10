#!/usr/bin/env python3
"""Build American Family Field section-detail CSVs."""
import csv
import os
# Paths resolve from this file, not the working directory, so the build works from a
# checkout on any machine. Outputs land in the parent folder - the published ballpark
# directory - rather than beside the scripts.
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
def outpath(name): return os.path.join(OUT, name)

# ---------------------------------------------------------------- row data
# section: (rows_label, entrance_row, walkway, wheelchair_rows)
ROWS = {}

def put(sec, rows, ent, walk="", wc=""):
    ROWS[sec] = (rows, ent, walk, wc)

# ---- 100 Field Level
for s, r, e in [
    (101,"1-7","7"),(102,"1-14","14"),(103,"1-14","14"),(104,"1-14","14"),
    (106,"17-27","27"),(107,"7-27","27"),(108,"9-27","27"),(109,"1-27","27"),
    (110,"1-27","27"),(111,"1-27","27"),(112,"1-21","21"),(113,"4-21","21"),
    (114,"1-21","21"),(115,"1-21","21"),(116,"1-21","21"),(117,"1-27","27"),
    (118,"1-27","27"),(119,"1-21","21"),(120,"1-21","21"),(121,"1-21","21"),
    (122,"4-21","21"),(123,"4-21","21"),(124,"1-27","27"),(125,"1-27","27"),
    (126,"1-29","29"),(127,"1-30","30"),(128,"1-27","27"),(129,"3-27","27"),
    (130,"10-30","30"),(131,"20-26","26")]:
    put(s, r, e)

# ---- 200 Loge Level
for s, r, e in [
    (201,"1-14","14"),(202,"1-14","14"),(203,"1-14","14"),(204,"1-14","14"),
    (205,"1-16","16"),(206,"1-19","19"),(207,"1-21","21"),(208,"1-19","19"),
    (209,"1-19","19"),(210,"1-21","21"),(211,"1-19","19"),(212,"1-19","19"),
    (213,"1-21","21"),(214,"1-19","19"),(215,"1-21","21"),(216,"1-10","10"),
    (217,"1-10","10"),(218,"1-10","10"),(219,"1-10","10"),(220,"1-10","10"),
    (221,"1-10","10"),(222,"1-21","21"),(223,"1-19","19"),(224,"1-21","21"),
    (225,"1-19","19"),(226,"1-19","19"),(227,"1-19","19"),(228,"1-19","19"),
    (229,"1-21","21"),(230,"1-19","19"),(231,"1-21","21"),(232,"1-19","19"),
    (233,"1-19","19"),(234,"1-19","19"),(235,"1-19","19"),(236,"1-18","18"),
    (237,"UNKNOWN","UNKNOWN"),(238,"UNKNOWN","UNKNOWN")]:
    put(s, r, e)

# ---- 300 Club Level
for s in (302,303,304,305):
    put(s, "1-8 (unverified; one fan photo tagged row 13)", "UNKNOWN")
for s in range(306, 346):
    if s in (311,324,335): put(s,"1-8","8")
    elif s in (320,339):   put(s,"3-7","7")
    else:                  put(s,"1-7","7")

# ---- 400 Terrace Level  (rows 4,6,7 generally do not exist; walkway splits the section)
T = {
 404:("1-4, 8-24","4","between row 4 and row 8",""),
 405:("1-7, 8-24","5","between row 7 and row 8",""),
 406:("1-3, 5, 8-24","5","between row 5 and row 8","between rows 3 and 5"),
 407:("1-7, 8-24","5","between row 7 and row 8",""),
 408:("1-3, 5, 8-24","5","between row 5 and row 8","between rows 3 and 5"),
 409:("1-7, 8-24","5","between row 7 and row 8",""),
 410:("1-3, 5, 8-24","5","between row 5 and row 8","between rows 3 and 5"),
 411:("1-7, 8-23","5","between row 7 and row 8",""),
 412:("1-3, 5, 8-23","5","between row 5 and row 8","between rows 3 and 5"),
 413:("1-7, 8-20","5","between row 7 and row 8",""),
 414:("1-3, 5, 8-19","5","between row 5 and row 8","between rows 3 and 5"),
 415:("1-7, 8-20","5","between row 7 and row 8",""),
 416:("1-3, 5, 8-19","5","between row 5 and row 8","between rows 3 and 5"),
 417:("1-7, 8-20","5","between row 7 and row 8",""),
 418:("1-3, 5, 8-22","5","between row 5 and row 8","between rows 3 and 5"),
 419:("1-7, 8-25","5","between row 7 and row 8",""),
 420:("1-3, 5, 8-25","5","between row 5 and row 8","between rows 3 and 5"),
 421:("1-7, 8-20, 21-25","5","between row 7 and row 8",""),
 422:("1-3, 5, 8-20, 21-25","5","between row 5 and row 8","between rows 3 and 5"),
 423:("1-7, 8-20, 21-25","5","between row 7 and row 8",""),
 424:("1-3, 5, 8-25","5","between row 5 and row 8","between rows 3 and 5"),
 425:("1-7, 8-25","5","between row 7 and row 8",""),
 426:("1-3, 5, 8-22","5","between row 5 and row 8","between rows 3 and 5"),
 427:("1-7, 8-20","5","between row 7 and row 8",""),
 428:("1-3, 5, 8-19","5","between row 5 and row 8","between rows 3 and 5"),
 429:("1-7, 8-20","5","between row 7 and row 8",""),
 430:("1-3, 5, 8-19","5","between row 5 and row 8","between rows 3 and 5"),
 431:("1-7, 8-20","5","between row 7 and row 8",""),
 432:("1-3, 5, 8-21","5","between row 5 and row 8","between rows 3 and 5"),
 433:("1-7, 8-22","5","between row 7 and row 8",""),
 434:("1-3, 5, 8-23","5","between row 5 and row 8","between rows 3 and 5"),
 435:("1-7, 8-24","5","between row 7 and row 8",""),
 436:("1-3, 5, 8-24","5","between row 5 and row 8","between rows 3 and 5"),
 437:("1-7, 8-24","5","between row 7 and row 8",""),
 438:("1-3, 5, 8-24","5","between row 5 and row 8","between rows 3 and 5"),
 439:("1-7, 8-24","5","between row 7 and row 8",""),
 440:("1-3, 5, 8-16","5","between row 5 and row 8","between rows 3 and 5"),
 441:("1-16","5","",""),
 442:("1-3, 4, 8-15","4","between row 4 and row 8","between rows 3 and 4"),
}
for s,(r,e,w,wc) in T.items():
    put(s,r,e,w,wc)

# ---------------------------------------------------------------- geography
# (zone, location_in_stadium, side)
def rng(a,b): return list(range(a,b+1))

ZONE = {}
LOC  = {}
SIDE = {}

def band(secs, zone, side, locfn):
    for s in secs:
        ZONE[s]=zone; SIDE[s]=side; LOC[s]=locfn(s)

# --- Field Level 100s
band([101,102,103,104],"Field Bleachers","right field",
     lambda s:{101:"Right field, beyond the right-field wall in fair territory, the section deepest toward right-center; sits directly above the visiting team bullpen",
               102:"Right field, beyond the right-field wall in fair territory; sits directly above the visiting team bullpen",
               103:"Right field, beyond the right-field wall in fair territory",
               104:"Right field, beyond the right-field wall in fair territory, nearest the right-field foul pole"}[s])
band(rng(106,109),"Field Outfield Box","right field / first-base line",
     lambda s:"Lowest tier in right-field foul territory between the right-field foul pole and first base; "
              + ("nearest the foul pole" if s==106 else "nearest first base" if s==109 else "between the foul pole and first base")
              + ". Front rows sit against the outfield wall")
band(rng(110,116),"Field Infield Box","first-base side",
     lambda s:"Lowest tier along the infield on the first-base side"
              + (", directly in front of the Brewers (home) dugout" if s in (112,113,114) else
                 ", at first base" if s==110 else
                 ", just to the first-base side of home plate" if s==116 else ""))
band(rng(117,120),"Field Infield Box","behind home plate",
     lambda s:"Lowest tier directly behind home plate"
              + (" (the protective net behind home plate ends in this section)" if s==119 else ""))
band(rng(121,125),"Field Infield Box","third-base side",
     lambda s:"Lowest tier along the infield on the third-base side"
              + (", directly in front of the visiting team dugout" if s in (121,122,123) else
                 ", approaching third base" if s in (124,125) else ""))
band(rng(126,131),"Field Outfield Box","third-base line / left field",
     lambda s:"Lowest tier in left-field foul territory between third base and the left-field foul pole; "
              + ("nearest third base" if s==126 else
                 "in the left-field corner at the foul pole; a very small section" if s==131 else
                 "between third base and the foul pole"))

# --- Loge Level 200s
band(rng(201,205),"Loge Bleachers","right field",
     lambda s:"Second tier, right field, behind the right-field wall; "
              + ("deepest toward right-center" if s==201 else
                 "nearest the right-field foul pole" if s==205 else "in the right-field bleacher bank")
              + ". Bench seating with backrests, near the visiting bullpen")
band(rng(206,209),"Loge Outfield Box","right field / first-base line",
     lambda s:"Second tier down the right-field line between the outfield corner and first base")
band(rng(210,215),"Loge Infield Box","first-base side",
     lambda s:"Second tier along the infield on the first-base side")
band(rng(216,221),"Loge Infield Box","behind home plate",
     lambda s:"Second tier directly behind home plate"
              + (" (alcohol-free family section)" if s==217 else
                 " (in front of the press box)" if s==218 else
                 " (a wheelchair lift serves this section)" if s==221 else ""))
band(rng(222,227),"Loge Infield Box","third-base side",
     lambda s:"Second tier along the infield on the third-base side")
band(rng(228,232),"Loge Outfield Box","third-base line / left field",
     lambda s:"Second tier down the left-field line between third base and the outfield corner")
band(rng(233,238),"Loge Bleachers","left field",
     lambda s:"Second tier, left field, behind the left-field wall, near the Brewers (home) bullpen. Bench seating with backrests")

# --- Club Level 300s
band(rng(302,305),"The Party Deck & Miller High Life Loft","right field",
     lambda s:"Third tier beyond the right-field wall; all-inclusive group hospitality area with table and rail seating, not standard bowl seating")
band(rng(306,313),"PNC Club Level - Club Outfield Box","right field / first-base line",
     lambda s:"Club Level above the lower bowl, out toward the right-field corner. No in-seat wait service in this sub-zone")
band(rng(314,327),"PNC Club Level - Club Infield Box","first-base side",
     lambda s:"Club Level above the lower bowl, overlooking the first-base line"
              + ("; between the dugouts" if s>=324 else ""))
band(rng(328,331),"PNC Club Level - Club Infield Box","behind home plate",
     lambda s:"Club Level above the lower bowl, directly behind home plate")
band(rng(332,343),"PNC Club Level - Club Infield Box","third-base side",
     lambda s:"Club Level above the lower bowl, "
              + ("between the dugouts on the third-base side of home plate" if s<=335 else "overlooking the third-base line"))
band([344,345],"PNC Club Level - Club Outfield Box","left field",
     lambda s:"Club Level above the lower bowl, out toward the left-field corner. No in-seat wait service in this sub-zone")

# --- Terrace Level 400s
band(rng(404,410),"Terrace Box","right field / first-base line",
     lambda s:"Upper deck, first-base side toward the right-field corner; the lowest-numbered terrace sections")
band(rng(411,419),"Terrace Box","first-base side",
     lambda s:"Upper deck along the first-base side"
              + (" (alcohol-free family section)" if s==417 else
                 " (Guest Relations kiosk is behind this section)" if s==419 else ""))
band(rng(420,423),"Terrace Box","behind home plate",
     lambda s:"Upper deck directly behind home plate"
              + ("; the Bob Uecker 'Last Row' statue sits behind the last row here, and the cheap obstructed 'Uecker seats' are in this area" if s==422 else ""))
band(rng(424,437),"Terrace Box","third-base side",
     lambda s:"Upper deck along the third-base side")
band(rng(438,440),"Terrace Level Outfield","left field",
     lambda s:"Upper deck near the left-field corner"
              + ("; sits directly behind the left-field foul pole" if s in (439,440) else ""))
band([441,442],"Bernie's Terrace","left field",
     lambda s:"Upper deck in deep left field next to Bernie Brewer's chalet and home-run slide; among the farthest seats from home plate in the ballpark")

# ---------------------------------------------------------------- notes
NOTES = {
101:"First five rows uncovered; rear rows shaded by the overhang above. Bench seating with backrests, no armrests. Center-field scoreboard hard to see.",
102:"First five rows uncovered; rear rows shaded by the overhang. Bench seating with backrests. Behind or beside the stage for most concerts.",
103:"First five rows uncovered; rear rows shaded. Bench seating with numbered bench spaces. TVs mounted overhead for replays.",
104:"First five rows uncovered; rear rows shaded. A fan report notes a pole obstruction at row 11. Popular for left-handed home runs.",
106:"Right-field sections generally get better shade for day games. Front rows sit against the outfield wall.",
107:"Better shade than the left-field side for day games. One fan review reports the section is not behind netting.",
108:"Angled view toward home plate. An affordable lower-level option.",
109:"Lower rows get sun early in day games, shade later.",
110:"Most rows have about 22 seats. Consistent shade even with the roof open.",
111:"Consistent shade even with the roof open.",
112:"Netting or screening in front of sections 112-123, height varies. Row 4 is the first row behind the Brewers dugout.",
113:"Behind the Brewers dugout. Row 4 is the first row behind the dugout. Netting in front.",
114:"Behind the Brewers dugout. Row 4 is the first row behind the dugout. Netting in front.",
115:"Netting in front. Consistent shade even with the roof open.",
116:"Netting in front. Reviewers report it very sunny early in day games, shaded by roughly 2pm in July.",
117:"Netting in front. Consistent shade.",
118:"Netting in front. Sunny early, shaded later. Gives glimpses into the dugout.",
119:"The net behind home plate ENDS in this section - half the section is behind net, half is not. View into the home dugout.",
120:"Netting in front. Consistent shade.",
121:"Behind the visitors dugout. Row 4 is the first row behind the dugout. Netting in front.",
122:"Behind the visitors dugout. Row 4 is the first row behind the dugout. Reviewers report strong sun.",
123:"Behind the visitors dugout. Netting in front.",
124:"Often among the cheapest seats within the Infield Box zone.",
125:"Often among the cheapest seats within the Infield Box zone.",
126:"Left-field side gets more sun during day games. Front rows against the field wall. Behind netting per fan reports.",
127:"More sun than the right-field side. Front rows sit against the outfield wall.",
128:"More sun than the right-field side. Angled view toward the infield.",
129:"More sun than the right-field side. Front rows sit against the outfield wall.",
130:"More sun than the right-field side. Front rows sit against the outfield wall.",
131:"Very small section - row 20 has only 4 seats. Comfortable angle toward the infield.",
201:"Bench seating with backrest, extra leg room. Partial scoreboard view; one review reports seeing only half the scoreboard.",
202:"Bench seating. Several seats have an obstructed scoreboard view, especially deeper rows.",
203:"Scoreboard visible at an angle. Bench seating with backrest.",
204:"Parts of the outfield are out of view due to angle and height. Scoreboard at an angle.",
205:"Bench seating. One fan notes seat 1 is closest to the wall rather than the aisle here. Complaints about food-stand exhaust.",
206:"Right-field side sections often hold shade longer. Good foul-ball territory.",
207:"Rows 17-21 recommended for convenience.",
208:"Row 9 reported at 20 seats. Solid foul-ball area.",
209:"Right-field side holds shade better than left field.",
210:"A reviewer reports being in shade after about one inning.",
211:"Row 3 reported at 23 seats. A reviewer reports the overhang blocking part of the view.",
212:"Rows 17 and higher in sections 212-215 get good shade during day games.",
213:"Row 5 reported at 22 seats.",
214:"A reviewer reports balls down the right-field line are hard to see land.",
215:"Rows 17 and higher get good shade during day games.",
216:"Rows 1-5 are sold as premium Loge Diamond Box.",
217:"Alcohol-free family section; no alcohol permitted. Directly in front of the press box.",
218:"Dead-centre behind home plate on this level.",
219:"Short section - only 10 rows deep.",
220:"Short section - only 10 rows deep.",
221:"A wheelchair lift serves this section. Guest Relations kiosk is behind section 221.",
222:"Rows 1-5 are premium Loge Diamond Box. One review reports the overhang cutting off the centre video board.",
223:"An accessible row is reported at row 19.",
224:"",
225:"",
226:"An accessible row is reported at row 19.",
227:"Rows 14 and up are shaded by the club-level overhang. Rows 1-5 are Loge Diamond Box. An 'ADA' row is reported here.",
228:"Left-field side gets significantly more sun with the roof open. Strong foul-ball area. Seat-numbering direction NOT stated by the source for this section.",
229:"Left-field side receives more sun with the roof open.",
230:"Left-field side receives more sun.",
231:"Left-field side receives more sun. Rows 17-21 recommended for convenience.",
232:"Left-field side receives more sun. Rows 17-21 recommended for convenience.",
233:"A large yellow pole at the front of the section blocks the left-field corner. Home plate is distant; scoreboard at an angle.",
234:"Bench seating with backrest. Scoreboard at an angle. Behind or beside the stage for most concerts.",
235:"You lose more of left field the higher you sit, so the left fielder can be blocked from upper rows.",
236:"Reserved bleacher benches with backrests and printed numbers. Behind or beside the stage for most concerts.",
237:"Listed in some venue indexes as a left-field Loge section but not present on the RateYourSeats section index - treat as unverified.",
238:"Listed in some venue indexes as a left-field Loge section near the Brewers bullpen but not present on the RateYourSeats section index - treat as unverified. Reported by some sources as a third alcohol-free family section.",
302:"All-inclusive group area: buffet, drink package, two complimentary beers per adult. Typically sold to groups of 25-260. Table seating.",
303:"All-inclusive group area. Some rows marked wheelchair accessible.",
304:"All-inclusive group area with rail-style seating and flat-screen TVs.",
305:"All-inclusive group area. Accessible rows and aisle seats noted. Individual tickets occasionally released.",
311:"Unlike other club sections this one has 8 rows with the entrance at row 8.",
320:"Row labels start at 3, not 1.",
324:"Listed as rows 1-8 though the same page also says seven rows per section - treat the 8th row as uncertain.",
327:"A fan review reports screens and metal bars obstructing the batter when leaning back; harder for shorter children.",
329:"A fan review reports row 1 has a poor angle and an LED sign blocking sightlines.",
335:"Listed as rows 1-8 though the same page also says seven rows per section - treat the 8th row as uncertain.",
338:"Full afternoon sun in this location.",
339:"Row labels start at 3, not 1.",
404:"A fan reports being unable to see the right-field corner. Entrance and walkway are at row 4 here, unlike the rest of the level.",
407:"An October 2025 fan review reports a significantly restricted view of right field caused by new office construction.",
408:"An October 2025 fan review reports most of the section now has a significantly restricted view of right field due to new office construction.",
417:"Alcohol-free family section; alcohol and profanity prohibited.",
419:"A Guest Relations kiosk sits behind this section.",
422:"Roof supports just above row 8 create viewing obstructions. The Bob Uecker 'Last Row' statue is behind the last row.",
433:"Rows 1-7 recommended for convenience.",
435:"Rows 2-7 rated best for view plus concourse access.",
436:"Rows 2-7 recommended.",
438:"Sections 438-442 in left field get direct sun during day games - avoid if you want shade.",
439:"Sits directly behind the left-field foul pole; some seats have partially obstructed views.",
440:"Sits directly behind the left-field foul pole; some seats have partially obstructed views. Behind or beside the stage for most concerts.",
441:"Distant view from deep left field. Sun exposure during day games. Family-friendly with frequent mascot interaction. Behind or beside the stage for most concerts.",
442:"Distant view from deep left field, with obstructed views of the scoreboard and right/centre field. Entrance and walkway at row 4 here, unlike the rest of the level.",
}

CLUB_DEFAULT = ("All Club Level tickets include SKYY Lounge access: climate-controlled seating, upscale food and "
                "beverage, bars. Club Infield Box sections also get in-seat wait service; Club Outfield Box sections do not.")
TERRACE_DEFAULT = ("Roof supports just above row 8 can create viewing obstructions. Row 1 seats may require leaning "
                   "forward past the safety railing. First-base-side sections generally hold shade better with the roof open.")

# ---------------------------------------------------------------- helpers
LEVELS = {1:"100 Field Level",2:"200 Loge Level",3:"300 Club Level (PNC Club Level)",4:"400 Terrace Level"}
HOME_ARC = {1:(117,120), 2:(216,221), 3:(328,331), 4:(420,423)}

def offset(sec):
    lvl = sec//100
    lo,hi = HOME_ARC[lvl]
    if sec < lo:  return lo-sec, "toward first base / right field"
    if sec > hi:  return sec-hi, "toward third base / left field"
    return 0, "behind home plate"

def seat_rule(sec):
    n, direction = offset(sec)
    lvl = sec//100
    same = [x for x in ROWS if x//100 == lvl]
    lower = [x for x in same if x < sec]
    higher = [x for x in same if x > sec]
    lo_nb = max(lower) if lower else None
    hi_nb = min(higher) if higher else None
    seat1 = f"the edge facing section {hi_nb}" if hi_nb else "the far edge of the section (no higher-numbered section beyond it)"
    lastseat = f"the edge facing section {lo_nb}" if lo_nb else "the far edge of the section (no lower-numbered section beyond it)"
    base = (f"Seat 1 is on {seat1}; seat numbers count UP toward {lastseat}. "
            f"Facing the field, seat 1 is on your left.")
    if direction == "toward first base / right field":
        extra = (" Because this section is on the first-base/right-field half of the park, seat 1 is the end of the "
                 "row CLOSEST to home plate and HIGHER seat numbers are FARTHER from home plate.")
    elif direction == "toward third base / left field":
        extra = (" Because this section is on the third-base/left-field half of the park, the rule flips: seat 1 is the "
                 "end of the row FARTHEST from home plate and HIGHER seat numbers are CLOSER to home plate.")
    else:
        extra = (" This section is behind home plate, so seat 1 is on its third-base side and the highest seat number "
                 "is on its first-base side.")
    return base + extra

def aisle_text(sec):
    rows, ent, walk, wc = ROWS[sec]
    parts = ["Stairway aisles run along both side edges of the section; rows are not split by a mid-row aisle, so "
             "seat numbers run continuously from one side aisle to the other."]
    if ent and ent != "UNKNOWN":
        parts.append(f"Entry portal / cross-aisle at row {ent}.")
    else:
        parts.append("Entry portal row not published.")
    if walk:
        parts.append(f"Walkway crosses the section {walk}.")
    if wc:
        parts.append(f"Wheelchair seating platform {wc}.")
    return " ".join(parts)

def notes_for(sec):
    n = NOTES.get(sec, "")
    lvl = sec//100
    if lvl == 3 and 306 <= sec <= 345:
        n = (n + " " if n else "") + CLUB_DEFAULT
    if lvl == 4:
        n = (n + " " if n else "") + TERRACE_DEFAULT
    return n.strip()

def confidence(sec):
    if sec in (237,238):                 return "LOW - section not on the primary source index"
    if 302 <= sec <= 305:                return "LOW - row data from a secondary source and internally inconsistent"
    if sec in (324,335):                 return "MEDIUM - source contradicts itself on row count"
    return "HIGH - rows, entrance row and seat direction stated by RateYourSeats section page"

# ---------------------------------------------------------------- write
sections = sorted(ROWS.keys())
hdr = ["section","level","zone","location_in_stadium","side_of_ballpark",
       "sections_from_home_plate","direction_from_home_plate",
       "rows_in_section","entrance_row","aisle_and_walkway_locations",
       "seat_numbering","seats_per_row","notes","confidence"]

SEATS_PER_ROW = {110:"about 22 in most rows",131:"row 20 has only 4 seats",
                 208:"row 9 has 20 seats",211:"row 3 has 23 seats",213:"row 5 has 22 seats",
                 214:"one row reported at 18 seats"}

with open(outpath("american_family_field_sections.csv"),"w",newline="",encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(hdr)
    for s in sections:
        rows, ent, walk, wc = ROWS[s]
        n, direction = offset(s)
        w.writerow([
            s, LEVELS[s//100], ZONE.get(s,"UNKNOWN"), LOC.get(s,"UNKNOWN"), SIDE.get(s,"UNKNOWN"),
            n, direction, rows, ent, aisle_text(s), seat_rule(s),
            SEATS_PER_ROW.get(s,"not published (typical rows run roughly 18-23 seats)"),
            notes_for(s), confidence(s)])

print("sections written:", len(sections))
