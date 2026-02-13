#!/bin/bash
# Manual reinstall script for AIDE RAP (recovery use only)
#
# Use this ONLY via SSH when the Admin UI is not available.
# The normal deployment path is: deploy.sh → Admin UI "Re-Install" button.
#
# This script: unzip → npm ci → kill process → PM2 auto-restarts.
#
# Usage: reinstall.sh [port]
#   port = the application port (default: 18354)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
INSTALL_DIR="$SCRIPT_DIR"
ZIP_FILE="$PARENT_DIR/aide-rap-latest.zip"
PORT="${1:-18354}"
LOG="$INSTALL_DIR/reinstall.log"

# Ensure node/npm are in PATH (nvm, global installs)
export PATH="$HOME/.nvm/versions/node/$(ls -1 $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$PATH"
export PATH="/usr/local/bin:/usr/bin:$PATH"

# Redirect all output to log file AND terminal
exec > >(tee "$LOG") 2>&1

echo "=== Manual reinstall started at $(date) ==="
echo "Port: $PORT"
echo ""

# Verify ZIP exists
if [ ! -f "$ZIP_FILE" ]; then
    echo "ERROR: ZIP file not found: $ZIP_FILE"
    exit 1
fi

# 1. UNZIP
echo "=== Unzipping ==="
cd "$PARENT_DIR"
unzip -o "$ZIP_FILE" 2>&1
if [ $? -ne 0 ]; then
    echo "ERROR: unzip failed"
    exit 1
fi
echo ""

# 2. INSTALL
echo "=== Installing dependencies ==="
cd "$INSTALL_DIR"
npm ci --omit=dev 2>&1

if [ -f "$INSTALL_DIR/aide-frame/js/aide_frame/package.json" ]; then
    echo "Installing aide-frame dependencies..."
    cd "$INSTALL_DIR/aide-frame/js/aide_frame"
    npm ci --omit=dev 2>&1
fi
echo ""

# 3. KILL — PM2 auto-restarts with original arguments
echo "=== Restarting ==="
PIDS=$(lsof -t -i ":$PORT" 2>/dev/null)
if [ -n "$PIDS" ]; then
    echo "Killing process on port $PORT (PIDs: $PIDS)..."
    kill $PIDS 2>/dev/null
    sleep 2
    # Force kill if still alive
    PIDS=$(lsof -t -i ":$PORT" 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "Force killing (PIDs: $PIDS)..."
        kill -9 $PIDS 2>/dev/null
    fi
else
    echo "No process on port $PORT — PM2 should restart automatically"
fi

# Wait for PM2 to restart
echo "Waiting for application to come back up..."
for i in $(seq 1 20); do
    sleep 1
    PIDS=$(lsof -t -i ":$PORT" 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "Application is listening on port $PORT after ${i}s"
        echo ""
        echo "=== Reinstall completed successfully at $(date) ==="
        exit 0
    fi
    echo "  Waiting... ($i/20)"
done

echo "WARNING: Application did not come back up on port $PORT within 20s"
echo "Check: pm2 logs"
echo ""
echo "=== Reinstall completed WITH WARNINGS at $(date) ==="
exit 1
