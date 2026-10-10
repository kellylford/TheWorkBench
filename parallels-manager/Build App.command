#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build App.command
#
# Double-click this file in Finder to build Parallels Manager.app.
# macOS will open it in Terminal automatically.
#
# Output: parallels-manager/build/Parallels Manager.app
#
# The app is signed with your Developer ID certificate.
# To build without signing (for local testing), run build.sh --skip-sign
# from the terminal instead.
# ─────────────────────────────────────────────────────────────────────────────

# Move to the folder containing this script so build.sh resolves relative paths
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║    Parallels Manager — Build App                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

bash build.sh

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "Done. Press Return to close this window."
read -r
