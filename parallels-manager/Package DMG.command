#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Package DMG.command
#
# Double-click this file in Finder to build and package Parallels Manager
# into a distributable DMG.
# macOS will open it in Terminal automatically.
#
# Output: parallels-manager/build/Parallels Manager 1.0.dmg
#
# The app and DMG are signed with your Developer ID certificate.
# To skip signing, run package-dmg.sh --skip-sign from the terminal instead.
# ─────────────────────────────────────────────────────────────────────────────

# Move to the folder containing this script so package-dmg.sh resolves correctly
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║    Parallels Manager — Package DMG                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

bash package-dmg.sh

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "Done. Press Return to close this window."
read -r
