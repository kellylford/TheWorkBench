#!/usr/bin/env python3
"""Wire an uploaded build of The Card Place into TestFlight.

Everything App Store Connect needs that is not the binary: the tester-facing
description and feedback address, the Beta App Review contact, the beta groups,
this build's What-to-Test notes, and the external review submission.

Every step is idempotent — it reads what is there before it writes — so this
can be re-run on a half-finished release without making a second of anything.

  ASC_CONFIG=~/.thecardplace-keys/asc.json \
  python3 scripts/wire-testflight.py --version 1.0 --build 1 --notes-file notes.txt
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.expanduser("~/.thecardplace-keys"))
os.environ.setdefault("ASC_CONFIG", "~/.thecardplace-keys/asc.json")
import asc  # noqa: E402

# What a tester sees in TestFlight before they install, and where their
# feedback goes. Contact details are the same ones this developer's other
# apps use for Beta App Review.
DESCRIPTION = (
    "Five card games - hearts, euchre, spades, cribbage and sheephead - against "
    "computer opponents, played entirely on your device with no network. Built to "
    "be fully playable with VoiceOver: every card is a button that says what it is "
    "and where it sits, a card you may not play says why, and everything that "
    "happens is spoken and written down."
)
FEEDBACK_EMAIL = "kelly@kellford.com"
CONTACT = {"contactFirstName": "kelly", "contactLastName": "ford",
           "contactPhone": "425-381-9165", "contactEmail": "kelly@kellford.com"}


def ok(st):
    return 200 <= st < 300


def ensure_localization(app_id, locale="en-US"):
    st, j = asc.api("GET", f"/v1/apps/{app_id}/betaAppLocalizations", query={"limit": 20})
    for loc in j.get("data", []):
        if loc["attributes"].get("locale") == locale:
            st, _ = asc.api("PATCH", f"/v1/betaAppLocalizations/{loc['id']}", body={"data": {
                "type": "betaAppLocalizations", "id": loc["id"],
                "attributes": {"description": DESCRIPTION, "feedbackEmail": FEEDBACK_EMAIL}}})
            print(f"  localization {locale}: updated ({st})")
            return
    st, j = asc.api("POST", "/v1/betaAppLocalizations", body={"data": {
        "type": "betaAppLocalizations",
        "attributes": {"locale": locale, "description": DESCRIPTION, "feedbackEmail": FEEDBACK_EMAIL},
        "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})
    print(f"  localization {locale}: created ({st})")
    if not ok(st):
        raise SystemExit(json.dumps(j)[:400])


def ensure_review_detail(app_id):
    st, j = asc.api("GET", f"/v1/apps/{app_id}/betaAppReviewDetail")
    if ok(st) and j.get("data"):
        rid = j["data"]["id"]
        st, j = asc.api("PATCH", f"/v1/betaAppReviewDetails/{rid}", body={"data": {
            "type": "betaAppReviewDetails", "id": rid,
            "attributes": {**CONTACT, "demoAccountRequired": False}}})
        print(f"  beta app review contact: updated ({st})")
        return
    st, j = asc.api("POST", "/v1/betaAppReviewDetails", body={"data": {
        "type": "betaAppReviewDetails",
        "attributes": {**CONTACT, "demoAccountRequired": False},
        "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})
    print(f"  beta app review contact: created ({st})")
    if not ok(st):
        raise SystemExit(json.dumps(j)[:400])


def ensure_group(app_id, name, internal):
    st, j = asc.api("GET", f"/v1/apps/{app_id}/betaGroups", query={"limit": 50})
    for g in j.get("data", []):
        if g["attributes"].get("name") == name:
            return g["id"], bool(g["attributes"].get("isInternalGroup"))
    attrs = {"name": name, "isInternalGroup": internal}
    if not internal:
        # A public link is what lets somebody be invited without handing over
        # their email address first.
        attrs["publicLinkEnabled"] = True
    st, j = asc.api("POST", "/v1/betaGroups", body={"data": {
        "type": "betaGroups", "attributes": attrs,
        "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})
    if not ok(st):
        raise SystemExit(f"could not create group {name} ({st}): {json.dumps(j)[:400]}")
    print(f"  group {name!r}: created")
    return j["data"]["id"], internal


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--version", required=True)
    p.add_argument("--build", required=True)
    p.add_argument("--notes-file")
    p.add_argument("--locale", default="en-US")
    p.add_argument("--groups", default="Internal test,External")
    p.add_argument("--submit-external", action="store_true", default=True)
    p.add_argument("--no-submit-external", dest="submit_external", action="store_false")
    p.add_argument("--timeout", type=int, default=1800)
    p.add_argument("--interval", type=int, default=30)
    a = p.parse_args()

    app_id = asc.find_app()
    print(f"App: {app_id} ({asc.BUNDLE})")

    print("Test information")
    ensure_localization(app_id, a.locale)
    ensure_review_detail(app_id)

    print("Beta groups")
    wanted = [g.strip() for g in a.groups.split(",") if g.strip()]
    resolved = [(n, *ensure_group(app_id, n, internal=(n.lower().startswith("internal"))))
                for n in wanted]

    print(f"Waiting for build {a.version} ({a.build}) to finish processing")
    build_id = asc.poll_build(app_id, a.version, a.build, timeout=a.timeout, interval=a.interval)
    print(f"  build is VALID: {build_id}")

    if a.notes_file:
        notes = open(os.path.expanduser(a.notes_file)).read().strip()
        if not notes:
            raise SystemExit("notes file is empty")
        asc.set_whats_new(build_id, notes, locale=a.locale)

    external_targeted = False
    for name, gid, internal in resolved:
        asc.assign_group(build_id, gid, name)
        if not internal:
            external_targeted = True

    if external_targeted and a.submit_external:
        asc.submit_external_review(build_id)
    print("TestFlight wiring complete.")


if __name__ == "__main__":
    main()
