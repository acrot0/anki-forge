#!/usr/bin/env bash
# anki-forge installer for Linux/macOS.
# Downloads the latest self-contained release binary into ~/.local/bin.
set -euo pipefail

DEST="$HOME/.local/bin"
BASE="https://github.com/acrot0/anki-forge/releases"
VERSION="${1:-latest}"

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) ASSET="anki-forge-linux-x64" ;;
  Darwin/arm64) ASSET="anki-forge-macos-x64" ;;
  Darwin/x86_64) ASSET="anki-forge-macos-x64" ;;
  *) echo "unsupported platform $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac

if [ "$VERSION" = "latest" ]; then
  URL="$BASE/latest/download/$ASSET"
else
  URL="$BASE/download/$VERSION/$ASSET"
fi

mkdir -p "$DEST"
echo "Downloading $URL ..."
curl -fL "$URL" -o "$DEST/anki-forge"
chmod +x "$DEST/anki-forge"
echo "Installed to $DEST/anki-forge"

case ":$PATH:" in
  *":$DEST:"*) echo "Run: anki-forge" ;;
  *) echo "Add ~/.local/bin to PATH, then run: anki-forge" ;;
esac
