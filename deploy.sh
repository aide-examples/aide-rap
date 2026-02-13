#!/bin/bash
# Deploy aide-rap to a remote server
# 1. Pack project into ZIP (resolves symlinks)
# 2. Upload ZIP via scp/sftp
#
# Usage:
#   ./deploy.sh                        # interactive password prompt
#   ./deploy.sh -p mypassword          # password via argument
#   DEPLOY_PASS=mypassword ./deploy.sh # password via env var
#
# After upload, use the Re-Install button in the Admin panel to deploy.
# PM2 must be set up once manually on the server:
#   pm2 start app/rap.js --name aide-irma -- -s irma --base-path /irma
#   pm2 save

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ZIP_NAME="aide-rap-latest.zip"
ZIP_PATH="/tmp/$ZIP_NAME"
REMOTE_HOST="root@followthescore.org"
REMOTE_DIR="/var/www/vhosts/followthescore.org"

# Parse args
while [ $# -gt 0 ]; do
    case "$1" in
        -p|--password) DEPLOY_PASS="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; echo "Usage: ./deploy.sh [-p password]"; exit 1 ;;
    esac
done

echo "=== AIDE RAP Deploy ==="
echo ""

# Step 1: Pack
echo "Packing..."
"$SCRIPT_DIR/pack.sh" "$ZIP_PATH"
if [ $? -ne 0 ]; then
    echo "ERROR: pack.sh failed"
    exit 1
fi
echo ""

# Step 2: Upload
echo "Uploading to $REMOTE_HOST:$REMOTE_DIR/ ..."

if [ -n "$DEPLOY_PASS" ]; then
    # Non-interactive: use sshpass + scp
    if ! command -v sshpass &>/dev/null; then
        echo "ERROR: sshpass not installed (needed for non-interactive upload)"
        echo "  Install: sudo apt-get install sshpass"
        exit 1
    fi
    sshpass -p "$DEPLOY_PASS" scp -o StrictHostKeyChecking=accept-new \
        "$ZIP_PATH" "$REMOTE_HOST:$REMOTE_DIR/$ZIP_NAME"
else
    # Interactive: sftp with password prompt
    echo "  (Enter password when prompted)"
    echo ""
    sftp "$REMOTE_HOST" <<EOF
put "$ZIP_PATH" "$REMOTE_DIR/$ZIP_NAME"
quit
EOF
fi

if [ $? -ne 0 ]; then
    echo "ERROR: Upload failed"
    exit 1
fi

echo ""
echo "Upload complete."
echo "Use the Re-Install button in the Admin panel to deploy."
