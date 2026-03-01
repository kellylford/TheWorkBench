#!/usr/bin/env bash
# build.sh — Build Parallels Manager.app and sign it with Developer ID
# Usage: ./build.sh [--skip-sign]
# Output: ./build/Parallels Manager.app
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Parallels Manager"
BUNDLE_ID="com.kellyford.parallels-manager"
SIGN_ID="Developer ID Application: Kelly Ford (P887QF74N8)"
BUILD_DIR="$SCRIPT_DIR/build"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
SKIP_SIGN=false

for arg in "$@"; do
  [[ "$arg" == "--skip-sign" ]] && SKIP_SIGN=true
done

echo "==> Building $APP_NAME"
cd "$SCRIPT_DIR"
swift build -c release 2>&1

BIN="$SCRIPT_DIR/.build/release/ParallelsManager"
if [[ ! -f "$BIN" ]]; then
  echo "ERROR: binary not found at $BIN" >&2
  exit 1
fi

echo "==> Assembling app bundle"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

cp "$BIN" "$APP_BUNDLE/Contents/MacOS/ParallelsManager"
cp "$SCRIPT_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"

# Copy install scripts into Resources so the app can launch them
cp "$SCRIPT_DIR/Sources/ParallelsManager/Resources/install-windows-full.sh" \
   "$APP_BUNDLE/Contents/Resources/"
cp "$SCRIPT_DIR/Sources/ParallelsManager/Resources/Install Windows (Full).command" \
   "$APP_BUNDLE/Contents/Resources/"
chmod +x "$APP_BUNDLE/Contents/Resources/install-windows-full.sh"
chmod +x "$APP_BUNDLE/Contents/Resources/Install Windows (Full).command"

# Strip quarantine from binary (not needed for self-built, but be safe)
xattr -cr "$APP_BUNDLE" 2>/dev/null || true

if $SKIP_SIGN; then
  echo "==> Skipping code signing (--skip-sign)"
else
  echo "==> Signing with: $SIGN_ID"
  codesign \
    --force \
    --deep \
    --options runtime \
    --sign "$SIGN_ID" \
    --identifier "$BUNDLE_ID" \
    --timestamp \
    "$APP_BUNDLE"
  echo "==> Verifying signature"
  codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
fi

echo ""
echo "Done: $APP_BUNDLE"
echo "      Binary: $(du -sh "$APP_BUNDLE/Contents/MacOS/ParallelsManager" | cut -f1)"
