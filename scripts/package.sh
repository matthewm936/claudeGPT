#!/bin/bash
# Package YourPsyche into a distributable zip
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_NAME="YourPsyche"
TEMP_DIR=$(mktemp -d)
DEST="$TEMP_DIR/$PACKAGE_NAME"
OUTPUT="$HOME/Desktop/$PACKAGE_NAME.zip"

echo "Packaging YourPsyche..."

# Copy repo structure
mkdir -p "$DEST"

# Core files
cp "$REPO_DIR/CLAUDE.md" "$DEST/"
cp "$REPO_DIR/YourPsyche.command" "$DEST/"
cp "$REPO_DIR/.gitignore" "$DEST/"

# Web app (exclude node_modules, logs, and stray user files)
rsync -a \
  --exclude='node_modules' \
  --exclude='server.log' \
  --exclude='*.txt' \
  --exclude='test-*.mjs' \
  --exclude='debug-*.mjs' \
  "$REPO_DIR/web/" "$DEST/web/"

# Search tooling
rsync -a "$REPO_DIR/search/" "$DEST/search/"

# Claude settings
mkdir -p "$DEST/.claude"
cp "$REPO_DIR/.claude/settings.json" "$DEST/.claude/" 2>/dev/null || true
cp "$REPO_DIR/.claude/CLAUDE.md" "$DEST/.claude/" 2>/dev/null || true

# Empty profiles dir (user data stays local)
mkdir -p "$DEST/profiles"

# Ensure launcher is executable
chmod +x "$DEST/YourPsyche.command"
chmod +x "$DEST/search/kb-search" 2>/dev/null || true

# Remove any stale zip
rm -f "$OUTPUT"

# Create zip
(cd "$TEMP_DIR" && zip -rq "$OUTPUT" "$PACKAGE_NAME")

# Cleanup
rm -rf "$TEMP_DIR"

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
echo "Done! $OUTPUT ($SIZE)"
echo "Send this zip to anyone — they double-click YourPsyche.command to get started."
