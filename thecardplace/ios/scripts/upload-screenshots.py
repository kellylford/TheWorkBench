#!/usr/bin/env python3
"""Put the screenshots from scripts/take-screenshots.sh on the App Store listing.

Each device's screenshot set is replaced as a whole, in file-name order, so
the store shows exactly what is in build/screenshots/<device>/. Without
--apply this only says what it would do.

  scripts/upload-screenshots.py            # show what would happen
  scripts/upload-screenshots.py --apply
"""
import argparse, glob, hashlib, json, os, sys
from urllib import request

sys.path.insert(0, os.path.expanduser("~/.thecardplace-keys"))
os.environ.setdefault("ASC_CONFIG", "~/.thecardplace-keys/asc.json")
import asc  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "..", "build", "screenshots")
STORE = os.path.join(HERE, "..", "store")

# The folder take-screenshots.sh writes -> App Store Connect's display type.
# APP_IPHONE_67 is the 6.9" slot; APP_IPAD_PRO_3GEN_129 the 13" one.
DISPLAY = {"iphone": "APP_IPHONE_67", "ipad": "APP_IPAD_PRO_3GEN_129"}


def ok(st):
    return 200 <= st < 300


def call(method, path, body=None, query=None):
    st, j = asc.api(method, path, body=body, query=query)
    if not ok(st):
        raise SystemExit(f"{method} {path} failed ({st}): {json.dumps(j)[:600]}")
    return j.get("data") if j else None


def upload(set_id, path):
    data = open(path, "rb").read()
    shot = call("POST", "/v1/appScreenshots", {"data": {
        "type": "appScreenshots",
        "attributes": {"fileName": os.path.basename(path), "fileSize": len(data)},
        "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})
    for op in shot["attributes"]["uploadOperations"]:
        chunk = data[op["offset"]:op["offset"] + op["length"]]
        req = request.Request(op["url"], data=chunk, method=op["method"])
        for h in op.get("requestHeaders", []):
            req.add_header(h["name"], h["value"])
        with request.urlopen(req, timeout=120) as r:
            r.read()
    call("PATCH", f"/v1/appScreenshots/{shot['id']}", {"data": {
        "type": "appScreenshots", "id": shot["id"],
        "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
    return shot["id"]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true")
    p.add_argument("--locale", default="en-US")
    a = p.parse_args()

    cfg = json.load(open(os.path.join(STORE, "app-store.json")))
    app_id = asc.find_app()
    version = asc.find_appstore_version(app_id, cfg["version"])
    loc = next(x for x in call("GET", f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations")
               if x["attributes"]["locale"] == a.locale)
    sets = {s["attributes"]["screenshotDisplayType"]: s["id"]
            for s in call("GET", f"/v1/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")}

    for device, display in DISPLAY.items():
        files = sorted(glob.glob(os.path.join(SHOTS, device, "*.png")))
        if not files:
            raise SystemExit(f"no screenshots in build/screenshots/{device}; run scripts/take-screenshots.sh")
        set_id = sets.get(display)
        old = call("GET", f"/v1/appScreenshotSets/{set_id}/appScreenshots") if set_id else []
        print(f"{device} ({display}): replace {len(old)} with {len(files)}: "
              + ", ".join(os.path.basename(f) for f in files))
        if not a.apply:
            continue
        if not set_id:
            set_id = call("POST", "/v1/appScreenshotSets", {"data": {
                "type": "appScreenshotSets", "attributes": {"screenshotDisplayType": display},
                "relationships": {"appStoreVersionLocalization": {
                    "data": {"type": "appStoreVersionLocalizations", "id": loc["id"]}}}}})["id"]
        for s in old:
            call("DELETE", f"/v1/appScreenshots/{s['id']}")
        ids = [upload(set_id, f) for f in files]
        call("PATCH", f"/v1/appScreenshotSets/{set_id}/relationships/appScreenshots",
             {"data": [{"type": "appScreenshots", "id": i} for i in ids]})
        print(f"  uploaded {len(ids)}")
    print("Done." if a.apply else "Nothing was changed. Run again with --apply to upload.")


if __name__ == "__main__":
    main()
