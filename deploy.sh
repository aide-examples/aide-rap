#!/bin/bash
# Deploy aide-rap to a remote server
# 1. Pack project into ZIP (resolves symlinks)
# 2. Upload ZIP via sftp (interactive password prompt)
#
# Usage:
#   ./deploy.sh
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

# Step 2: Upload via sftp
echo "Uploading to $REMOTE_HOST:$REMOTE_DIR/ ..."
echo "  (Enter password when prompted)"
echo ""

sftp "$REMOTE_HOST" <<EOF
put "$ZIP_PATH" "$REMOTE_DIR/$ZIP_NAME"
quit
EOF

if [ $? -ne 0 ]; then
    echo "ERROR: sftp upload failed"
    exit 1
fi

echo ""
echo "Upload complete."
echo "Use the Re-Install button in the Admin panel to deploy."
