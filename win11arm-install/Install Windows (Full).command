#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install Windows (Full).command
#
# Double-click this file in Finder to run the full Windows 11 ARM install.
# macOS will open it in Terminal automatically.
#
# What this installs:
#   Windows 11 Pro ARM64 with the complete set of Microsoft inbox apps
#   (Photos, Calculator, Paint, Notepad, Terminal, Media Player, and more).
#   128 GB virtual disk to accommodate the larger footprint.
#
# For a lean install without Microsoft inbox apps and a 64 GB disk, open
# "Install Windows (Minimal).command" instead.
# ─────────────────────────────────────────────────────────────────────────────

# Move to the folder containing this script so relative paths inside it work
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║    Windows 11 ARM – Full Install Launcher                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "This will run install-windows-full.sh (full edition)."
echo "See README.md for full details and customisation options."
echo ""

bash install-windows-full.sh

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "Done. Press Return to close this window."
read -r
