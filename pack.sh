#!/bin/bash
# Pack aide-rap and aide-frame into a single zip file (excluding .git)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_FILE="${1:-aide-rap-$(date +%Y%m%d).zip}"

# If relative path, make it relative to current working directory
if [[ "$OUTPUT_FILE" != /* ]]; then
    OUTPUT_FILE="$(pwd)/$OUTPUT_FILE"
fi

cd "$SCRIPT_DIR/.."

echo "Packing aide-rap ..."
echo "Output: $OUTPUT_FILE"

zip -r "$OUTPUT_FILE" \
    aide-rap \
    -x "*.git*" \
    -x "*node_modules*" \
    -x "*.log" \
    -x "*/logs/*" \
    -x "*.sqlite" \
    -x "*.sqlite-shm" \
    -x "*.sqlite-wal" \
    -x "*/backup/*"

echo "Done: $(du -h "$OUTPUT_FILE" | cut -f1)"
