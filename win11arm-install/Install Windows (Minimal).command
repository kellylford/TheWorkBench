#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install Windows (Minimal).command
#
# Double-click this file in Finder to run the minimal Windows 11 ARM install.
# macOS will open it in Terminal automatically.
#
# What this installs:
#   Windows 11 Pro ARM64, stripped of most Microsoft inbox apps (lean footprint).
#   64 GB virtual disk.
#
# For a full install with all Microsoft inbox apps and a 128 GB disk, open
# "Install Windows (Full).command" instead.
# ─────────────────────────────────────────────────────────────────────────────

# Move to the folder containing this script so relative paths inside it work
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║    Windows 11 ARM – Minimal Install Launcher             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "This will run install-windows-minimal.sh (minimal edition)."
echo "See README.md for full details and customisation options."
echo ""

bash install-windows-minimal.sh

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "Done. Press Return to close this window."
read -r
