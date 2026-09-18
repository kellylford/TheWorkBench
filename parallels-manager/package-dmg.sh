#!/usr/bin/env bash
# package-dmg.sh — Build and package Parallels Manager into a distributable DMG
# Usage: ./package-dmg.sh [--skip-sign]
# Output: ./build/Parallels Manager.dmg
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Parallels Manager"
VERSION="1.0"
DMG_NAME="${APP_NAME} ${VERSION}"
BUILD_DIR="$SCRIPT_DIR/build"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
STAGING="$BUILD_DIR/dmg-staging"
DMG_OUT="$BUILD_DIR/${DMG_NAME}.dmg"
DMG_TMP="$BUILD_DIR/${DMG_NAME}-tmp.dmg"

# ── Step 1: build ────────────────────────────────────────────────────────────
echo "==> Building app…"
"$SCRIPT_DIR/build.sh" "$@"

# ── Step 2: create staging folder ───────────────────────────────────────────
echo "==> Staging DMG contents"
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -R "$APP_BUNDLE" "$STAGING/$APP_NAME.app"
ln -s /Applications "$STAGING/Applications"

# ── Step 3: create writable DMG from staging folder ─────────────────────────
echo "==> Creating DMG"
rm -f "$DMG_TMP" "$DMG_OUT"

hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING" \
  -ov \
  -fs HFS+ \
  -format UDRW \
  "$DMG_TMP"

# ── Step 4: set basic window appearance via AppleScript ─────────────────────
echo "==> Setting DMG window layout"
DEV=$(hdiutil attach -readwrite -noverify -noautoopen "$DMG_TMP" | \
      grep -E '^/dev/' | awk 'NR==1{print $1}')
MNT="/Volumes/$APP_NAME"

# Short wait for mount
sleep 1

osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$APP_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {200, 120, 760, 440}
    set theViewOptions to icon view options of container window
    set arrangement of theViewOptions to not arranged
    set icon size of theViewOptions to 100
    set position of item "$APP_NAME.app" of container window to {150, 170}
    set position of item "Applications" of container window to {400, 170}
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT

# Sync and unmount
sync
hdiutil detach "$DEV" -quiet 2>/dev/null || true
sleep 1

# ── Step 5: convert to compressed read-only DMG ──────────────────────────────
echo "==> Converting to compressed DMG"
hdiutil convert "$DMG_TMP" -format UDZO -imagekey zlib-level=9 -o "$DMG_OUT"
rm -f "$DMG_TMP"
rm -rf "$STAGING"

echo ""
echo "Done: $DMG_OUT"
echo "      Size: $(du -sh "$DMG_OUT" | cut -f1)"
