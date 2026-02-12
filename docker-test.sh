#!/bin/bash
# Local Docker test: pack, unzip, build and run
# Simulates the exact deployment workflow on the customer's machine

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="/tmp/aide-docker-test"

echo "=== Step 1: Pack ==="
mkdir -p "$TEST_DIR"
"$SCRIPT_DIR/pack.sh" "$TEST_DIR/aide-rap.zip"

echo ""
echo "=== Step 2: Unzip ==="
rm -rf "$TEST_DIR/aide-rap"
cd "$TEST_DIR"
unzip -qo aide-rap.zip

echo ""
echo "=== Step 3: Docker build & run ==="
cd "$TEST_DIR/aide-rap"
docker compose up --build "$@"
