#!/bin/bash
# Server-side reinstall script for AIDE RAP
# Called by the admin endpoint as a detached process.
# Stops PM2, overwrites installation from ZIP, restarts PM2.
#
# Expected layout:
#   /var/www/vhosts/followthescore.org/
#   ├── aide-rap-latest.zip
#   └── aide-rap/          ← this script lives here
#       └── reinstall.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
INSTALL_DIR="$SCRIPT_DIR"
ZIP_FILE="$PARENT_DIR/aide-rap-latest.zip"
PM2_NAME="aide-irma"
LOG="$INSTALL_DIR/reinstall.log"

# Redirect all output to log file
exec > "$LOG" 2>&1

echo "=== Reinstall started at $(date) ==="
echo "Install dir: $INSTALL_DIR"
echo "ZIP file:    $ZIP_FILE"
echo "PM2 name:    $PM2_NAME"
echo ""

# Verify ZIP exists
if [ ! -f "$ZIP_FILE" ]; then
    echo "ERROR: ZIP file not found: $ZIP_FILE"
    exit 1
fi

# Wait for HTTP response to be sent
sleep 2

# 1. Stop PM2 (clean SQLite shutdown via SIGINT)
echo "Stopping PM2 process '$PM2_NAME'..."
pm2 stop "$PM2_NAME"
sleep 1
echo "PM2 stopped."

# 2. Unzip with overwrite (replaces everything including database)
echo "Unzipping $ZIP_FILE..."
cd "$PARENT_DIR"
unzip -o "$ZIP_FILE"
echo "Unzip complete."

# 3. Reinstall dependencies (if package.json changed)
echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm ci --omit=dev 2>&1

# 4. aide-frame dependencies
echo "Installing aide-frame dependencies..."
cd "$INSTALL_DIR/aide-frame/js/aide_frame"
npm ci --omit=dev 2>&1

# 5. Restart PM2
echo "Starting PM2 process '$PM2_NAME'..."
cd "$INSTALL_DIR"
pm2 start "$PM2_NAME"

echo ""
echo "=== Reinstall completed at $(date) ==="
