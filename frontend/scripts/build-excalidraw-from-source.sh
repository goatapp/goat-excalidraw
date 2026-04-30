#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/excalidraw/excalidraw.git"
EXCALIDRAW_COMMIT="278cd357724b17e1119b6c76416520c42958d0e3"
CLONE_DIR=$(mktemp -d)
VENDOR_DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor"

cleanup() { rm -rf "$CLONE_DIR"; }
trap cleanup EXIT

# Skip if vendor tarballs already exist for this commit
STAMP_FILE="$VENDOR_DIR/.commit"
if [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE")" = "$EXCALIDRAW_COMMIT" ]; then
  echo "Vendor tarballs already match commit $EXCALIDRAW_COMMIT, skipping build."
  exit 0
fi

echo "Cloning excalidraw at $EXCALIDRAW_COMMIT..."
git clone --depth 1 "$REPO_URL" "$CLONE_DIR"
(cd "$CLONE_DIR" && git fetch --depth 1 origin "$EXCALIDRAW_COMMIT" && git checkout "$EXCALIDRAW_COMMIT")

echo "Installing dependencies..."
(cd "$CLONE_DIR" && yarn install --frozen-lockfile)

echo "Building packages..."
(cd "$CLONE_DIR" && yarn build:packages)

echo "Packing tarballs..."
rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"
for pkg in common math element excalidraw; do
  tgz=$(cd "$CLONE_DIR/packages/$pkg" && npm pack --pack-destination "$VENDOR_DIR" 2>/dev/null | tail -1)
  echo "  $tgz"
done
echo "$EXCALIDRAW_COMMIT" > "$STAMP_FILE"

if [ "${1:-}" = "--pack-only" ]; then
  echo "Done. Tarballs available in vendor/."
  exit 0
fi

echo "Installing from vendor/..."
(cd "$VENDOR_DIR/.." && npm install \
  ./vendor/excalidraw-common-*.tgz \
  ./vendor/excalidraw-math-*.tgz \
  ./vendor/excalidraw-element-*.tgz \
  ./vendor/excalidraw-excalidraw-*.tgz)

echo "Done. @excalidraw packages installed from source."
