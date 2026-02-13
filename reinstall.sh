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

# Ensure PM2 and node are in PATH (nvm, global installs)
export PATH="$HOME/.nvm/versions/node/$(ls -1 $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$PATH"
export PATH="/usr/local/bin:/usr/bin:$PATH"

# Redirect all output to log file
exec > "$LOG" 2>&1

echo "=== Reinstall started at $(date) ==="
echo "Install dir: $INSTALL_DIR"
echo "ZIP file:    $ZIP_FILE"
echo "PM2 name:    $PM2_NAME"
echo "PATH:        $PATH"
echo "pm2 location: $(which pm2 2>/dev/null || echo 'NOT FOUND')"
echo ""

# Verify ZIP exists
if [ ! -f "$ZIP_FILE" ]; then
    echo "ERROR: ZIP file not found: $ZIP_FILE"
    exit 1
fi

# Verify pm2 is available
if ! command -v pm2 &> /dev/null; then
    echo "ERROR: pm2 not found in PATH"
    echo "Tried PATH: $PATH"
    exit 1
fi

# Wait for HTTP response to be sent
sleep 2

# 1. Stop PM2 (clean SQLite shutdown)
echo "Stopping PM2 process '$PM2_NAME'..."
pm2 stop "$PM2_NAME" 2>&1
STOP_EXIT=$?
echo "pm2 stop exit code: $STOP_EXIT"

# 2. Wait and verify process is actually dead
echo "Waiting for process to stop..."
for i in $(seq 1 10); do
    # Check if pm2 process is still running
    STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
procs = json.load(sys.stdin)
for p in procs:
    if p.get('name') == '$PM2_NAME':
        print(p.get('pm2_env', {}).get('status', 'unknown'))
        sys.exit(0)
print('not_found')
" 2>/dev/null || echo "unknown")

    if [ "$STATUS" = "stopped" ] || [ "$STATUS" = "not_found" ]; then
        echo "Process confirmed stopped (status: $STATUS) after ${i}s"
        break
    fi
    echo "  Still running (status: $STATUS), waiting... ($i/10)"
    sleep 1
done

# 3. Final safety check: is the port still in use?
PORT=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
procs = json.load(sys.stdin)
for p in procs:
    if p.get('name') == '$PM2_NAME':
        args = p.get('pm2_env', {}).get('args', [])
        print('18354')  # default port
        sys.exit(0)
print('18354')
" 2>/dev/null || echo "18354")

if lsof -i ":$PORT" -t > /dev/null 2>&1; then
    echo "WARNING: Port $PORT still in use — force killing..."
    pm2 kill 2>/dev/null
    sleep 2
    if lsof -i ":$PORT" -t > /dev/null 2>&1; then
        echo "ERROR: Could not free port $PORT — aborting to prevent DB corruption"
        exit 1
    fi
fi

echo "Port $PORT is free. Safe to proceed."
echo ""

# 4. Unzip with overwrite (replaces everything including database)
echo "Unzipping $ZIP_FILE..."
cd "$PARENT_DIR"
unzip -o "$ZIP_FILE"
echo "Unzip complete."

# 5. Reinstall dependencies (if package.json changed)
echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm ci --omit=dev 2>&1

# 6. aide-frame dependencies
echo "Installing aide-frame dependencies..."
cd "$INSTALL_DIR/aide-frame/js/aide_frame"
npm ci --omit=dev 2>&1

# 7. Restart PM2
echo "Starting PM2 process '$PM2_NAME'..."
cd "$INSTALL_DIR"
pm2 start "$PM2_NAME" 2>&1 || {
    echo "pm2 start by name failed, trying full command..."
    pm2 start app/rap.js --name "$PM2_NAME" -- -s irma 2>&1
}

echo ""
echo "=== Reinstall completed at $(date) ==="
