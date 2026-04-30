#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/excalidraw/excalidraw.git"
CLONE_DIR=$(mktemp -d)
VENDOR_DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor"

cleanup() { rm -rf "$CLONE_DIR"; }
trap cleanup EXIT

echo "Cloning excalidraw into $CLONE_DIR..."
git clone --depth 1 "$REPO_URL" "$CLONE_DIR"

echo "Installing dependencies..."
(cd "$CLONE_DIR" && yarn install --frozen-lockfile)

echo "Building packages..."
(cd "$CLONE_DIR" && yarn build:packages)

echo "Packing tarballs..."
mkdir -p "$VENDOR_DIR"
for pkg in common math element excalidraw; do
  tgz=$(cd "$CLONE_DIR/packages/$pkg" && npm pack --pack-destination "$VENDOR_DIR" 2>/dev/null | tail -1)
  echo "  $tgz"
done

echo "Installing from vendor/..."
(cd "$VENDOR_DIR/.." && npm install \
  ./vendor/excalidraw-common-*.tgz \
  ./vendor/excalidraw-math-*.tgz \
  ./vendor/excalidraw-element-*.tgz \
  ./vendor/excalidraw-excalidraw-*.tgz)

echo "Done. @excalidraw packages installed from source."
