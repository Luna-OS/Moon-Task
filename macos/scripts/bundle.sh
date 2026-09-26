#!/bin/bash
# Builds MoonTask.app (universal: Apple silicon + Intel) and a disk image.
#
# usage: scripts/bundle.sh <version> [output dir]
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=${1:?version, e.g. 0.3.0}
OUT=${2:-dist}
APP="$OUT/MoonTask.app"

swift build -c release --arch arm64 --arch x86_64
BIN=$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/MoonTask

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/MoonTask"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
sed "s/__VERSION__/$VERSION/g" Resources/Info.plist > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# Ad-hoc signature: required to run on Apple silicon. Not notarized, so
# macOS asks once before the first start (see the README).
codesign --force --deep --sign - "$APP"
codesign --verify --verbose=2 "$APP"

# The disk image: the night-sky window with the app and a shortcut to
# Applications (laid out by dmgbuild, which needs no Finder scripting).
DMG="$OUT/MoonTask_${VERSION}_macos_universal.dmg"
rm -f "$DMG"
BG="$OUT/background.tiff"
tiffutil -cathidpicheck Resources/dmg/background.png Resources/dmg/background@2x.png -out "$BG"
if [ ! -x "$OUT/.venv/bin/dmgbuild" ]; then
  python3 -m venv "$OUT/.venv"
  "$OUT/.venv/bin/pip" install --quiet dmgbuild
fi
"$OUT/.venv/bin/dmgbuild" -s scripts/dmg-settings.py \
  -D app="$APP" -D background="$BG" "MoonTask" "$DMG"
echo "Built $APP and $DMG"
