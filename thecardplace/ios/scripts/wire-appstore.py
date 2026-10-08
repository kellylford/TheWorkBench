#!/usr/bin/env python3
"""Fill in The Card Place's App Store listing from the files in store/.

The listing is kept in the repository the way the TestFlight test information
is: the prose in store/en-US/*.txt, everything else in store/app-store.json.
This reads what App Store Connect has, prints every field that differs, and
with --apply writes them. Without --apply it changes nothing.

  scripts/wire-appstore.py                    # show what would change
  scripts/wire-appstore.py --apply            # write the listing
  scripts/wire-appstore.py --apply --build 4  # and choose the build for 1.0
  scripts/wire-appstore.py --apply --set-price  # and make it free everywhere

Price and availability are only touched with --set-price, because they decide
who can get the app the moment it is approved. Nothing here submits for
review; that is done by hand, in App Store Connect.

What the API cannot do, and has to be done on the website: the App Privacy
answers, screenshots' review (they are uploaded by upload-screenshots.py), and
Submit for Review.
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.expanduser("~/.thecardplace-keys"))
os.environ.setdefault("ASC_CONFIG", "~/.thecardplace-keys/asc.json")
import asc  # noqa: E402

STORE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "store")
APPLY = False


def ok(st):
    return 200 <= st < 300


def text(locale, name):
    with open(os.path.join(STORE, locale, name + ".txt")) as f:
        return f.read().strip()


def get(path, **query):
    st, j = asc.api("GET", path, query=query or None)
    if not ok(st):
        raise SystemExit(f"GET {path} failed ({st}): {json.dumps(j)[:400]}")
    return j.get("data")


def write(method, path, body, what):
    """Send one change, or only say it would be sent."""
    if not APPLY:
        print(f"    would {method} {path}")
        return None
    st, j = asc.api(method, path, body=body)
    print(f"    {method} {path}: {st}")
    if not ok(st):
        raise SystemExit(f"{what} failed: {json.dumps(j)[:600]}")
    return j.get("data")


def changes(have, want):
    """The fields of want that differ from have, each printed as it is found."""
    out = {}
    for k, v in want.items():
        if have.get(k) != v:
            old = have.get(k)
            shown = (lambda x: x if not isinstance(x, str) or len(x) < 70 else x[:67] + "...")
            print(f"    {k}: {shown(old)!r} -> {shown(v)!r}")
            out[k] = v
    return out


def patch(kind, rid, have, want, what):
    diff = changes(have, want)
    if not diff:
        print("    already as wanted")
        return
    write("PATCH", f"/v1/{kind}/{rid}",
          {"data": {"type": kind, "id": rid, "attributes": diff}}, what)


def wire_version_text(version_id, cfg, locale):
    print(f"Version text ({locale})")
    want = {
        "description": text(locale, "description"),
        "keywords": text(locale, "keywords"),
        "promotionalText": text(locale, "promotional_text"),
        "supportUrl": cfg["urls"]["support"],
        "marketingUrl": cfg["urls"]["marketing"],
    }
    for k, limit in (("description", 4000), ("keywords", 100), ("promotionalText", 170)):
        if len(want[k]) > limit:
            raise SystemExit(f"{k} is {len(want[k])} characters; the limit is {limit}")
    for loc in get(f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations"):
        if loc["attributes"]["locale"] == locale:
            return patch("appStoreVersionLocalizations", loc["id"], loc["attributes"], want,
                         "version localization")
    raise SystemExit(f"version has no {locale} localization")


def wire_app_info(app_id, cfg, locale):
    info = get(f"/v1/apps/{app_id}/appInfos")[0]
    print(f"App information ({locale})")
    want = {"subtitle": text(locale, "subtitle"), "privacyPolicyUrl": cfg["urls"]["privacy_policy"]}
    if len(want["subtitle"]) > 30:
        raise SystemExit(f"subtitle is {len(want['subtitle'])} characters; the limit is 30")
    for loc in get(f"/v1/appInfos/{info['id']}/appInfoLocalizations"):
        if loc["attributes"]["locale"] == locale:
            patch("appInfoLocalizations", loc["id"], loc["attributes"], want, "app info localization")

    print("Categories")
    rels = {}
    for rel, key in (("primaryCategory", "primary_category"), ("secondaryCategory", "secondary_category")):
        cur = get(f"/v1/appInfos/{info['id']}/{rel}")
        have = cur["id"] if cur else None
        if have != cfg[key]:
            print(f"    {rel}: {have!r} -> {cfg[key]!r}")
            rels[rel] = {"data": {"type": "appCategories", "id": cfg[key]}}
    if rels:
        write("PATCH", f"/v1/appInfos/{info['id']}",
              {"data": {"type": "appInfos", "id": info["id"], "relationships": rels}}, "categories")
    else:
        print("    already as wanted")

    print("Age rating")
    decl = get(f"/v1/appInfos/{info['id']}/ageRatingDeclaration")
    want = {k: v for k, v in cfg["age_rating"].items() if not k.startswith("_")}
    patch("ageRatingDeclarations", decl["id"], decl["attributes"], want, "age rating")


def wire_app(app_id, cfg):
    print("Content rights")
    app = get(f"/v1/apps/{app_id}")
    patch("apps", app_id, app["attributes"], {"contentRightsDeclaration": cfg["content_rights"]},
          "content rights")


def wire_version(version, cfg, build):
    print(f"Version {cfg['version']}")
    patch("appStoreVersions", version["id"], version["attributes"],
          {"copyright": cfg["copyright"], "releaseType": cfg["release_type"]}, "version")
    if build:
        app_id = asc.find_app()
        found = asc.find_build(app_id, cfg["version"], str(build))
        if not found:
            raise SystemExit(f"build {build} of {cfg['version']} not found")
        build_id = found["id"]
        cur = get(f"/v1/appStoreVersions/{version['id']}/build")
        if cur and cur["id"] == build_id:
            print(f"    build {build} already chosen")
        else:
            print(f"    build: {cur['attributes']['version'] if cur else None!r} -> {str(build)!r}")
            write("PATCH", f"/v1/appStoreVersions/{version['id']}/relationships/build",
                  {"data": {"type": "builds", "id": build_id}}, "build")


def wire_review(version_id, cfg, locale):
    print("App Review contact and notes")
    want = {**cfg["review_contact"], "notes": text(locale, "review_notes")}
    cur = get(f"/v1/appStoreVersions/{version_id}/appStoreReviewDetail")
    if cur:
        return patch("appStoreReviewDetails", cur["id"], cur["attributes"], want, "review detail")
    changes({}, want)
    write("POST", "/v1/appStoreReviewDetails", {"data": {
        "type": "appStoreReviewDetails", "attributes": want,
        "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}}}}},
        "review detail")


def wire_accessibility(app_id, cfg):
    print("Accessibility Nutrition Labels")
    a = cfg["accessibility"]
    flags = {k: v for k, v in a.items() if k.startswith("supports")}
    have = {d["attributes"]["deviceFamily"]: d for d in get(f"/v1/apps/{app_id}/accessibilityDeclarations")}
    for family in a["device_families"]:
        print(f"  {family}")
        if family in have:
            patch("accessibilityDeclarations", have[family]["id"], have[family]["attributes"], flags,
                  f"accessibility {family}")
        else:
            changes({}, flags)
            write("POST", "/v1/accessibilityDeclarations", {"data": {
                "type": "accessibilityDeclarations",
                "attributes": {"deviceFamily": family, **flags},
                "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}},
                f"accessibility {family}")


def wire_price(app_id, cfg):
    """Free, in every territory, including ones Apple adds later."""
    p = cfg["price"]
    if not (p["free"] and p["all_territories"]):
        raise SystemExit("only free in every territory is scripted; set anything else on the website")
    print("Price: free")
    points = get(f"/v1/apps/{app_id}/appPricePoints",
                 **{"filter[territory]": p["base_territory"], "limit": 200})
    free = next((x for x in points if float(x["attributes"]["customerPrice"]) == 0), None)
    if not free:
        raise SystemExit("no free price point found")
    write("POST", "/v1/appPriceSchedules", {
        "data": {"type": "appPriceSchedules", "relationships": {
            "app": {"data": {"type": "apps", "id": app_id}},
            "baseTerritory": {"data": {"type": "territories", "id": p["base_territory"]}},
            "manualPrices": {"data": [{"type": "appPrices", "id": "${free}"}]}}},
        "included": [{"type": "appPrices", "id": "${free}", "attributes": {"startDate": None},
                      "relationships": {"appPricePoint": {"data": {"type": "appPricePoints",
                                                                   "id": free["id"]}}}}]},
        "price")

    print("Availability: every territory")
    territories = get("/v1/territories", limit=200)
    print(f"    {len(territories)} territories, and new ones as Apple adds them")
    inline = [{"type": "territoryAvailabilities", "id": f"${{{t['id']}}}",
               "attributes": {"available": True},
               "relationships": {"territory": {"data": {"type": "territories", "id": t["id"]}}}}
              for t in territories]
    write("POST", "/v2/appAvailabilities", {
        "data": {"type": "appAvailabilities", "attributes": {"availableInNewTerritories": True},
                 "relationships": {
                     "app": {"data": {"type": "apps", "id": app_id}},
                     "territoryAvailabilities": {"data": [{"type": x["type"], "id": x["id"]} for x in inline]}}},
        "included": inline}, "availability")


def main():
    global APPLY
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="write the changes; without it, only show them")
    p.add_argument("--build", type=int, help="choose this build number for the version")
    p.add_argument("--set-price", action="store_true", help="also set price and availability")
    p.add_argument("--locale", default="en-US")
    a = p.parse_args()
    APPLY = a.apply

    with open(os.path.join(STORE, "app-store.json")) as f:
        cfg = json.load(f)
    app_id = asc.find_app()
    print(f"App: {app_id} ({asc.BUNDLE}){'' if APPLY else ' - showing changes only'}")
    found = asc.find_appstore_version(app_id, cfg["version"])
    if not found:
        raise SystemExit(f"no App Store version {cfg['version']}")
    version = get(f"/v1/appStoreVersions/{found['id']}")

    wire_version_text(version["id"], cfg, a.locale)
    wire_app_info(app_id, cfg, a.locale)
    wire_app(app_id, cfg)
    wire_version(version, cfg, a.build)
    wire_review(version["id"], cfg, a.locale)
    wire_accessibility(app_id, cfg)
    if a.set_price:
        wire_price(app_id, cfg)
    else:
        print("Price and availability: not touched (--set-price)")
    print("Done." if APPLY else "Nothing was changed. Run again with --apply to write this.")


if __name__ == "__main__":
    main()
