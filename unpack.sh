#!/bin/bash
# Unpack aide-rap archive and install dependencies

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARCHIVE="${1:-}"

if [ -z "$ARCHIVE" ]; then
    # Find most recent aide-rap zip in current directory
    ARCHIVE=$(ls -t aide-rap-*.zip 2>/dev/null | head -1)
fi

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
    echo "Usage: $0 <archive.zip>"
    echo "   or: Place aide-rap-*.zip in current directory"
    exit 1
fi

echo "Unpacking $ARCHIVE..."
unzip -q "$ARCHIVE"

echo "Installing dependencies..."
cd aide-rap/app && npm install --silent

echo "Done. To start:"
echo "  cd aide-rap"
echo "  ./run -s <system>"
