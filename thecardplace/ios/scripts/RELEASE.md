# The Card Place for iOS — TestFlight release

One command builds, uploads and wires a build into TestFlight.

```bash
cd thecardplace/ios
scripts/release-testflight.sh --notes scripts/RELEASE_NOTES.txt
```

That archives (Release, automatic signing), exports a signed App Store IPA,
validates and uploads it with `altool`, waits for App Store Connect to finish
processing, then sets the What-to-Test notes, makes sure the test information
and beta groups exist, assigns the build to them, and submits external Beta
App Review.

Useful flags: `--no-external-review` (internal testers only), `--upload-only`
(stop after the upload), and `--wire-only --version 1.0 --build 2` (a build
already uploaded, for instance from Xcode).

## Credentials

They live outside the repository in `~/.thecardplace-keys/` and are never
committed:

- `asc.json` — key id, issuer id, the `.p8` path, and this app's bundle id
- `asc.py` — the App Store Connect REST client, which signs its own ES256 JWT

The private key itself is shared with this developer's other apps and lives in
`~/.appstoreconnect/private_keys/AuthKey_<id>.p8`, which is where `altool`
looks for it. The Issuer ID is only shown in App Store Connect under Users and
Access, then Integrations.

## Cutting a release

1. Bump `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `project.yml`,
   run `xcodegen generate`, and commit. **A build number App Store Connect has
   already seen is rejected**, so it has to go up every time.
2. Rewrite `scripts/RELEASE_NOTES.txt` with what testers should look at.
3. Run the command above.

## The one thing that is not automated

App Store Connect has no API for creating an app record, so the very first
release of a new app needs the website: Apps, then the add button, then
platform iOS, the name, English (U.S.), the bundle id
`net.theideaplace.TheCardPlace`, and any unused SKU. Everything after that,
including the test information and the beta groups, this script does.

## Test information

`wire-testflight.py` holds the tester-facing description, the feedback address
and the Beta App Review contact, and rewrites them on every release, so they
are in version control rather than typed into a web form once and forgotten.
Change them there.
