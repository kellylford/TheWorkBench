#!/usr/bin/env bash
# Take the App Store screenshots of The Card Place, on the two display sizes
# App Store Connect requires for an app that runs on iPhone and iPad.
#
#   cd thecardplace/ios
#   scripts/take-screenshots.sh            # both devices
#   scripts/take-screenshots.sh iphone     # one of them
#   REUSE=1 scripts/take-screenshots.sh    # pick again from the last run's results
#
# The pictures come from the UI tests, which already attach a screenshot at
# a good moment in each game. This runs those tests on each device, exports
# the attachments from the result bundle, and copies the chosen ones, in
# store order, to build/screenshots/<device>/. Upload them with
# scripts/upload-screenshots.py.
#
# The deals are random, so each run's pictures differ a little.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=build/screenshots

# name | device type | display type in App Store Connect | width x height
DEVICES=(
  "iphone|com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max|APP_IPHONE_67|1320x2868"
  "ipad|com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB|APP_IPAD_PRO_3GEN_129|2064x2752"
)

# Attachment names -> store file name, in the order the store shows them.
# The first attachment the run has wins: the tests play random deals, and a
# moment like "euchre-play" does not come if the player sits out the hand.
SHOTS=(
  "hearts-trick,hearts-passing|01-hearts"
  "euchre-play,euchre-bidding|02-euchre"
  "spades-trick,spades-bidding|03-spades"
  "cribbage-play,cribbage-cut|04-cribbage"
  "sheephead-trick,sheephead-dealt|05-sheephead"
  "hub|06-hub"
)

TESTS=(
  -only-testing:TheCardPlaceUITests/HeartsUITests/testPlaysAHandByLabels
  -only-testing:TheCardPlaceUITests/EuchreUITests
  -only-testing:TheCardPlaceUITests/SpadesUITests
  -only-testing:TheCardPlaceUITests/CribbageUITests
  -only-testing:TheCardPlaceUITests/SheepheadUITests
  -only-testing:TheCardPlaceUITests/ScreenshotUITests
)

runtime=$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
rs = [r for r in json.load(sys.stdin)["runtimes"] if r["platform"] == "iOS" and r["isAvailable"]]
print(sorted(rs, key=lambda r: [int(n) for n in r["version"].split(".")])[-1]["identifier"])')

for entry in "${DEVICES[@]}"; do
  IFS='|' read -r name devtype display size <<<"$entry"
  [[ $# -gt 0 && " $* " != *" $name "* ]] && continue
  sim="The Card Place screenshots ($name)"
  udid=$(xcrun simctl list devices -j | python3 -c "
import json, sys
for rt, ds in json.load(sys.stdin)['devices'].items():
    for d in ds:
        if d['name'] == '''$sim''' and d['isAvailable']: print(d['udid']); sys.exit()")
  if [[ -z "$udid" ]]; then
    udid=$(xcrun simctl create "$sim" "$devtype" "$runtime")
    echo "Created simulator $sim"
  fi
  xcrun simctl boot "$udid" 2>/dev/null || true
  # Put the real status bar back however this run ends.
  trap "xcrun simctl status_bar '$udid' clear 2>/dev/null || true" EXIT
  xcrun simctl bootstatus "$udid" -b >/dev/null
  # The status bar Apple's own screenshots show: 9:41, full signal, full battery.
  xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
  xcrun simctl ui "$udid" appearance light

  result="build/screenshots-$name.xcresult"
  rm -rf "build/attachments-$name"
  if [[ -z "${REUSE:-}" || ! -d "$result" ]]; then
    rm -rf "$result"
    echo "Running the UI tests on $sim (this plays a hand of every game)"
    xcodebuild -project TheCardPlace.xcodeproj -scheme TheCardPlace \
      -destination "id=$udid" -resultBundlePath "$result" "${TESTS[@]}" test -quiet \
      || { echo "The UI tests failed on $name; see $result"; exit 1; }
  fi

  xcrun xcresulttool export attachments --path "$result" --output-path "build/attachments-$name" >/dev/null
  mkdir -p "$OUT/$name"
  rm -f "$OUT/$name"/*.png
  for shot in "${SHOTS[@]}"; do
    IFS='|' read -r attachment file <<<"$shot"
    src=$(python3 - "build/attachments-$name" "$attachment" <<'EOF'
import json, os, sys
d, wants = sys.argv[1], sys.argv[2].split(",")
tests = json.load(open(os.path.join(d, "manifest.json")))
for want in wants:
    for test in tests:
        for a in test["attachments"]:
            if a["suggestedHumanReadableName"].startswith(want + "_"):
                print(os.path.join(d, a["exportedFileName"])); sys.exit()
EOF
)
    if [[ -z "$src" ]]; then echo "No $attachment screenshot on $name"; exit 1; fi
    dest="$OUT/$name/$file.png"
    cp "$src" "$dest"
    got="$(sips -g pixelWidth "$dest" | awk '/pixelWidth/{print $2}')x$(sips -g pixelHeight "$dest" | awk '/pixelHeight/{print $2}')"
    if [[ "$got" != "$size" ]]; then
      echo "$dest is $got; App Store Connect wants $size for $display"; exit 1
    fi
    echo "  $dest ($got)"
  done
  xcrun simctl status_bar "$udid" clear
done
echo "Screenshots are in $OUT/."
