#!/bin/bash
# Server-side reinstall script for AIDE RAP
# Called by the admin endpoint as a detached process.
# Stops the application (port-based kill), overwrites from ZIP, restarts via PM2.
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
PORT=18354
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
echo "Port:        $PORT"
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

# ============================================================
# 1. STOP — kill everything on our port (don't rely on PM2 names)
# ============================================================
echo "=== Stopping application ==="

# Try PM2 stop with all known names (best effort, may fail silently)
echo "Attempting PM2 stop all..."
pm2 stop all 2>&1
echo "pm2 stop all exit code: $?"

# Wait for port to become free (up to 15 seconds)
echo "Waiting for port $PORT to become free..."
for i in $(seq 1 15); do
    PIDS=$(lsof -t -i ":$PORT" 2>/dev/null || fuser "$PORT/tcp" 2>/dev/null | tr -s ' ')
    if [ -z "$PIDS" ]; then
        echo "Port $PORT is free after ${i}s"
        break
    fi
    echo "  Port $PORT still in use (PIDs: $PIDS), waiting... ($i/15)"

    # After 10 seconds, force kill whatever is on the port
    if [ "$i" -eq 10 ]; then
        echo "  Force killing PIDs on port $PORT..."
        lsof -t -i ":$PORT" 2>/dev/null | xargs kill -9 2>/dev/null
        fuser -k "$PORT/tcp" 2>/dev/null
    fi
    sleep 1
done

# Final safety check — ABORT if port is still in use
PIDS=$(lsof -t -i ":$PORT" 2>/dev/null)
if [ -n "$PIDS" ]; then
    echo "ERROR: Port $PORT still in use by PIDs: $PIDS"
    echo "ABORTING to prevent database corruption!"
    echo "Manual fix: kill $PIDS, then run this script again."
    exit 1
fi

echo "Port $PORT confirmed free. Safe to proceed."
echo ""

# ============================================================
# 2. UNZIP — overwrite everything (code + database)
# ============================================================
echo "=== Unzipping ==="
cd "$PARENT_DIR"
unzip -o "$ZIP_FILE" 2>&1
UNZIP_EXIT=$?
echo "unzip exit code: $UNZIP_EXIT"
if [ "$UNZIP_EXIT" -ne 0 ]; then
    echo "ERROR: unzip failed — trying to restart with old version"
fi
echo ""

# ============================================================
# 3. INSTALL — reinstall dependencies
# ============================================================
echo "=== Installing dependencies ==="
cd "$INSTALL_DIR"
npm ci --omit=dev 2>&1

echo "Installing aide-frame dependencies..."
cd "$INSTALL_DIR/aide-frame/js/aide_frame"
npm ci --omit=dev 2>&1
echo ""

# ============================================================
# 4. START — clean PM2 start (delete all old entries first)
# ============================================================
echo "=== Starting application ==="
cd "$INSTALL_DIR"

# Remove ALL known PM2 entries to avoid stale configs
pm2 delete "$PM2_NAME" 2>/dev/null
pm2 delete "aide-rap-irma" 2>/dev/null

echo "Starting: pm2 start app/rap.js --name $PM2_NAME -- -s irma"
pm2 start app/rap.js --name "$PM2_NAME" -- -s irma 2>&1
echo "pm2 start exit code: $?"

# Verify process is actually running (wait up to 10s for port to open)
echo "Verifying startup..."
for i in $(seq 1 10); do
    sleep 1
    PIDS=$(lsof -t -i ":$PORT" 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "Application is listening on port $PORT after ${i}s (PIDs: $PIDS)"
        echo "Saving PM2 state..."
        pm2 save 2>&1
        echo ""
        echo "=== Reinstall completed successfully at $(date) ==="
        exit 0
    fi
    echo "  Not yet listening on port $PORT... ($i/10)"
done

echo "WARNING: Application did not start listening on port $PORT within 10s"
echo "Check: pm2 logs $PM2_NAME"
echo ""
echo "=== Reinstall completed WITH ERRORS at $(date) ==="
exit 1
