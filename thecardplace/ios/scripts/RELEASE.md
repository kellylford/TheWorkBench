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

## App Store release

TestFlight and the App Store share the build; what the App Store adds is the
listing. The listing is in the repository, like the test information:

- `store/en-US/*.txt` — description, keywords, subtitle, promotional text,
  and the notes for App Review. Each file is the field, as it will appear.
- `store/app-store.json` — everything else: the version, copyright, release
  type (manual, so approval does not publish the app), categories, URLs,
  content rights, the App Review contact, the age rating answers, the
  Accessibility Nutrition Labels, and the price.
- `TheCardPlace/PrivacyInfo.xcprivacy` — the privacy manifest in the build:
  no tracking, no data collected, and `UserDefaults` for the settings.

### Steps

1. Put the build on TestFlight as above, and let it be tested.
2. Take the screenshots, on a 6.9" iPhone and a 13" iPad simulator (the script
   creates them if they are missing). This plays a hand of every game, so it
   takes a few minutes per device:

   ```bash
   scripts/take-screenshots.sh
   ```

   They land in `build/screenshots/iphone/` and `build/screenshots/ipad/`,
   numbered in store order, and are not committed. Look at them before they go up.
3. See what the listing would change, then write it and choose the build:

   ```bash
   scripts/wire-appstore.py
   scripts/wire-appstore.py --apply --build 5
   scripts/upload-screenshots.py --apply
   ```

   Price and availability are left alone unless `--set-price` is given, which
   makes the app free in every territory, including ones Apple adds later.
   That only has to happen once.
   **Build with a released Xcode.** TestFlight takes builds from a beta Xcode;
   App Store submission refuses them ("The build's Xcode build is not supported
   yet"). Version 1.0 went in as build 6 from the Xcode 27.1 RC after build 5,
   from the 27.1 beta, was refused.
4. By hand in App Store Connect, because the API cannot do it:
   - **App Privacy**
     (`https://appstoreconnect.apple.com/apps/6807994140/distribution/privacy`):
     Get Started, then "No, we do not collect data from this app", then Save,
     **then Publish** — saving alone is not enough, and submission is refused
     until the answers are published. That's true because the app has no
     network access at all. If it ever gains any, this answer and the manifest
     change too.
   - Look over the version page, then **Add for Review** and **Submit**.
5. When it is approved, release it from the version page (the release type is
   manual).
6. Once it is on the store, publish the Accessibility Nutrition Labels. Apple
   keeps them as drafts until the app is live:

   ```bash
   scripts/wire-appstore.py --apply --publish-accessibility
   ```

The privacy policy is `thecardplace/privacy.html` on the Card Place site; the
listing's privacy URL points at it, so it has to be live before submission.
