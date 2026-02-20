#!/usr/bin/env bash
set -euo pipefail

DEB="release/otree-bots_0.1.0_amd64.deb"
PKG="otree-bots"

cd "$(dirname "$0")"

if ! [ -f "$DEB" ]; then
  echo "Building package first..."
  make package-linux
fi

echo "── Removing old $PKG ──"
sudo dpkg -r "$PKG" 2>/dev/null || true

echo "── Installing $DEB ──"
sudo dpkg -i "$DEB"

echo "✔ Done. Run with: otree-bots"
