#!/bin/bash
#
# SeedManager Integration Tests
# Tests all SeedManager operations against the Book system.
#
# Usage:
#   ./app/tests/test-seed-manager.sh [port]
#
# Prerequisites:
#   - Book system server running on the specified port (default: 18349)
#   - Start with: ./run -s book -p 18349 --noauth
#

PORT=${1:-18349}
BASE="http://localhost:$PORT"
PASS=0
FAIL=0
TOTAL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# --- Helpers ---

assert() {
  local test_name="$1"
  local condition="$2"
  TOTAL=$((TOTAL + 1))

  if eval "$condition" 2>/dev/null; then
    echo -e "  ${GREEN}PASS${NC} #${TOTAL}: ${test_name}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} #${TOTAL}: ${test_name}"
    FAIL=$((FAIL + 1))
  fi
}

# curl wrapper: GET
get() {
  curl -s "$BASE$1"
}

# curl wrapper: POST with JSON body
post() {
  curl -s -X POST "$BASE$1" -H 'Content-Type: application/json' -d "$2"
}

# curl wrapper: DELETE
delete() {
  curl -s -X DELETE "$BASE$1"
}

# Extract JSON field using python
json_field() {
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print($2)"
}

# Check if server is reachable
echo ""
echo -e "${YELLOW}=== SeedManager Integration Tests ===${NC}"
echo "Target: $BASE"
echo ""

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/seed/status")
if [ "$HEALTH" != "200" ]; then
  echo -e "${RED}ERROR: Server not reachable at $BASE (HTTP $HEALTH)${NC}"
  echo "Start the book server first: ./run -s book -p $PORT --noauth"
  exit 1
fi

echo -e "${GREEN}Server reachable.${NC}"
echo ""

# ============================================================================
# Phase 1: Clean slate — reset everything first
# ============================================================================

echo -e "${YELLOW}--- Phase 0: Clear All ---${NC}"
post "/api/seed/clear-all" '{}' > /dev/null 2>&1
echo "  Clear-all done (clean slate for individual load tests)."
echo ""

# ============================================================================
# Test 1: Seed Status
# ============================================================================

echo -e "${YELLOW}--- Test 1: Seed Status ---${NC}"
STATUS=$(get "/api/seed/status")

# Should have 3 entities
ENTITY_COUNT=$(json_field "$STATUS" "len(d['entities'])")
assert "Status returns 3 entities" "[ '$ENTITY_COUNT' = '3' ]"

# Each entity should have seedFile info
HAS_PUBLISHER=$(json_field "$STATUS" "'Publisher' in [e['name'] for e in d['entities']]")
assert "Status includes Publisher" "[ '$HAS_PUBLISHER' = 'True' ]"

HAS_AUTHOR=$(json_field "$STATUS" "'Author' in [e['name'] for e in d['entities']]")
assert "Status includes Author" "[ '$HAS_AUTHOR' = 'True' ]"

HAS_BOOK=$(json_field "$STATUS" "'Book' in [e['name'] for e in d['entities']]")
assert "Status includes Book" "[ '$HAS_BOOK' = 'True' ]"
echo ""

# ============================================================================
# Test 2: Load Seed — Publisher (no FK dependencies)
# ============================================================================

echo -e "${YELLOW}--- Test 2: Load Seed (Publisher) ---${NC}"
LOAD_PUB=$(post "/api/seed/load/Publisher" '{"sourceDir":"seed"}')
LOADED_PUB=$(json_field "$LOAD_PUB" "d.get('loaded', 0)")
assert "Publisher loaded > 0" "[ '$LOADED_PUB' -gt 0 ]"
assert "Publisher loaded = 3" "[ '$LOADED_PUB' = '3' ]"

SUCCESS_PUB=$(json_field "$LOAD_PUB" "d.get('success', False)")
assert "Publisher load success" "[ '$SUCCESS_PUB' = 'True' ]"
echo ""

# ============================================================================
# Test 3: Load Seed — Author (no FK, but has TimeRange constraint)
# ============================================================================

echo -e "${YELLOW}--- Test 3: Load Seed (Author) ---${NC}"
LOAD_AUTH=$(post "/api/seed/load/Author" '{"sourceDir":"seed"}')
LOADED_AUTH=$(json_field "$LOAD_AUTH" "d.get('loaded', 0)")
assert "Author loaded > 0" "[ '$LOADED_AUTH' -gt 0 ]"
assert "Author loaded = 5" "[ '$LOADED_AUTH' = '5' ]"
echo ""

# ============================================================================
# Test 4: Load Seed — Book (FK to Author + Publisher)
# ============================================================================

echo -e "${YELLOW}--- Test 4: Load Seed (Book) ---${NC}"
LOAD_BOOK=$(post "/api/seed/load/Book" '{"sourceDir":"seed"}')
LOADED_BOOK=$(json_field "$LOAD_BOOK" "d.get('loaded', 0)")
assert "Book loaded > 0" "[ '$LOADED_BOOK' -gt 0 ]"
assert "Book loaded = 8" "[ '$LOADED_BOOK' = '8' ]"

# Check FK errors
FK_ERRORS=$(json_field "$LOAD_BOOK" "len(d.get('fkErrors', []))")
assert "Book has 0 FK errors" "[ '$FK_ERRORS' = '0' ]"
echo ""

# ============================================================================
# Test 5: Entity Counts
# ============================================================================

echo -e "${YELLOW}--- Test 5: Entity Counts ---${NC}"
PUB_LIST=$(get "/api/entities/Publisher")
PUB_COUNT=$(json_field "$PUB_LIST" "d.get('totalCount', 0)")
assert "Publisher count = 3" "[ '$PUB_COUNT' = '3' ]"

AUTH_LIST=$(get "/api/entities/Author")
AUTH_COUNT=$(json_field "$AUTH_LIST" "d.get('totalCount', 0)")
assert "Author count = 5" "[ '$AUTH_COUNT' = '5' ]"

BOOK_LIST=$(get "/api/entities/Book")
BOOK_COUNT=$(json_field "$BOOK_LIST" "d.get('totalCount', 0)")
assert "Book count = 8" "[ '$BOOK_COUNT' = '8' ]"
echo ""

# ============================================================================
# Test 6: FK Label Lookup
# ============================================================================

echo -e "${YELLOW}--- Test 6: FK Label Lookup ---${NC}"
LOOKUP_PUB=$(get "/api/seed/debug-lookup/Publisher")
LOOKUP_KEYS=$(json_field "$LOOKUP_PUB" "d.get('rowCount', 0)")
assert "Publisher lookup has rows" "[ '$LOOKUP_KEYS' -gt 0 ]"

# Check that specific labels are in lookup
HAS_PENGUIN=$(json_field "$LOOKUP_PUB" "'Penguin Random House' in d.get('lookup', {})")
assert "Lookup contains 'Penguin Random House'" "[ '$HAS_PENGUIN' = 'True' ]"

HAS_KODANSHA=$(json_field "$LOOKUP_PUB" "'Kodansha' in d.get('lookup', {})")
assert "Lookup contains 'Kodansha'" "[ '$HAS_KODANSHA' = 'True' ]"
echo ""

# ============================================================================
# Test 7: Validate Import
# ============================================================================

echo -e "${YELLOW}--- Test 7: Validate Import ---${NC}"

# Valid record
VALID_REC='{"records":[{"title":"Test Book","isbn":"978-0-00-000000-0","publication_date":"2024-01-01","price":9.99,"page_count":100,"is_available":true,"genre":"FIC","binding":"PB","condition":1,"author":"Jane","publisher":"Kodansha"}]}'
VALIDATE=$(post "/api/seed/validate/Book" "$VALID_REC")
IS_VALID=$(json_field "$VALIDATE" "d.get('valid', False)")
assert "Valid record passes validation" "[ '$IS_VALID' = 'True' ]"

# Record with bad FK
BAD_FK='{"records":[{"title":"Bad FK","isbn":"978-0-00-000001-0","publication_date":"2024-01-01","price":9.99,"page_count":100,"is_available":true,"genre":"FIC","binding":"PB","condition":1,"author":"NONEXISTENT","publisher":"Kodansha"}]}'
VALIDATE_BAD=$(post "/api/seed/validate/Book" "$BAD_FK")
WARN_COUNT=$(json_field "$VALIDATE_BAD" "len(d.get('warnings', []))")
assert "Bad FK produces warnings" "[ '$WARN_COUNT' -gt 0 ]"
echo ""

# ============================================================================
# Test 8: Backup All
# ============================================================================

echo -e "${YELLOW}--- Test 8: Backup All ---${NC}"
BACKUP=$(post "/api/seed/backup" '{}')
BACKUP_SUCCESS=$(json_field "$BACKUP" "d.get('success', False)")
assert "Backup succeeds" "[ '$BACKUP_SUCCESS' = 'True' ]"

BACKUP_TOTAL=$(json_field "$BACKUP" "d.get('totalRecords', 0)")
assert "Backup has records" "[ '$BACKUP_TOTAL' -gt 0 ]"

# Check that null records are NOT in backup (totalRecords should match our seed counts)
BACKUP_PUB=$(json_field "$BACKUP" "d.get('entities', {}).get('Publisher', 0)")
assert "Publisher backup = 3 (no null record)" "[ '$BACKUP_PUB' = '3' ]"

BACKUP_BOOK=$(json_field "$BACKUP" "d.get('entities', {}).get('Book', 0)")
assert "Book backup = 8 (no null record)" "[ '$BACKUP_BOOK' = '8' ]"
echo ""

# ============================================================================
# Test 9: Clear Entity (Book)
# ============================================================================

echo -e "${YELLOW}--- Test 9: Clear Entity (Book) ---${NC}"
CLEAR_BOOK=$(post "/api/seed/clear/Book" '{}')
DELETED=$(json_field "$CLEAR_BOOK" "d.get('deleted', 0)")
assert "Clear Book deleted = 8" "[ '$DELETED' = '8' ]"

# Verify count is 0 now
BOOK_AFTER=$(get "/api/entities/Book")
BOOK_AFTER_COUNT=$(json_field "$BOOK_AFTER" "d.get('totalCount', 0)")
assert "Book count after clear = 0" "[ '$BOOK_AFTER_COUNT' = '0' ]"
echo ""

# ============================================================================
# Test 10: Restore from Backup
# ============================================================================

echo -e "${YELLOW}--- Test 10: Restore from Backup (Book) ---${NC}"
RESTORE_BOOK=$(post "/api/seed/restore/Book" '{}')
RESTORE_SUCCESS=$(json_field "$RESTORE_BOOK" "d.get('success', False)")
assert "Restore Book succeeds" "[ '$RESTORE_SUCCESS' = 'True' ]"

RESTORED_COUNT=$(json_field "$RESTORE_BOOK" "d.get('loaded', 0)")
assert "Restored count = 8" "[ '$RESTORED_COUNT' = '8' ]"

# Verify count is back
BOOK_RESTORED=$(get "/api/entities/Book")
BOOK_RESTORED_COUNT=$(json_field "$BOOK_RESTORED" "d.get('totalCount', 0)")
assert "Book count after restore = 8" "[ '$BOOK_RESTORED_COUNT' = '8' ]"
echo ""

# ============================================================================
# Test 11: Seed Content
# ============================================================================

echo -e "${YELLOW}--- Test 11: Seed Content ---${NC}"
CONTENT=$(get "/api/seed/content/Publisher?sourceDir=seed")
CONTENT_RECORDS=$(json_field "$CONTENT" "len(d.get('records', []))")
assert "Seed content returns 3 records" "[ '$CONTENT_RECORDS' = '3' ]"

CONTENT_DB=$(json_field "$CONTENT" "d.get('dbRowCount', 0)")
assert "Seed content includes dbRowCount" "[ '$CONTENT_DB' -gt 0 ]"
echo ""

# ============================================================================
# Test 12: Upload Entity
# ============================================================================

echo -e "${YELLOW}--- Test 12: Upload Entity ---${NC}"
UPLOAD_DATA='[{"name":"Test Publisher","founded_year":2020,"headquarters":"Berlin"}]'
UPLOAD=$(post "/api/seed/upload/Publisher" "$UPLOAD_DATA")
UPLOAD_SUCCESS=$(json_field "$UPLOAD" "d.get('success', False)")
assert "Upload succeeds" "[ '$UPLOAD_SUCCESS' = 'True' ]"

# Verify uploaded file via content endpoint
UPLOADED_CONTENT=$(get "/api/seed/content/Publisher?sourceDir=seed")
UPLOADED_COUNT=$(json_field "$UPLOADED_CONTENT" "len(d.get('records', []))")
assert "Uploaded content has 1 record" "[ '$UPLOADED_COUNT' = '1' ]"

# Restore original seed file (upload back the 3 publishers)
RESTORE_SEED='[{"name":"Penguin Random House","founded_year":1935,"website":"https://www.penguinrandomhouse.com","headquarters":"10019 New York"},{"name":"Editorial Sudamericana","founded_year":1939,"website":"https://www.megustaleer.com.ar","headquarters":"C1023 Buenos Aires"},{"name":"Kodansha","founded_year":1909,"website":"https://www.kodansha.co.jp","headquarters":"112-8001 Tokyo"}]'
post "/api/seed/upload/Publisher" "$RESTORE_SEED" > /dev/null
echo ""

# ============================================================================
# Test 13: Load All
# ============================================================================

echo -e "${YELLOW}--- Test 13: Load All ---${NC}"
# First clear all to test load-all from scratch
post "/api/seed/clear-all" '{}' > /dev/null

LOADALL=$(post "/api/seed/load-all" '{}')
LOADALL_SUCCESS=$(json_field "$LOADALL" "d.get('success', False)")
assert "Load-all succeeds" "[ '$LOADALL_SUCCESS' = 'True' ]"

# Verify all entities loaded
PUB_AFTER_ALL=$(get "/api/entities/Publisher")
PUB_AFTER_COUNT=$(json_field "$PUB_AFTER_ALL" "d.get('totalCount', 0)")
assert "Publisher loaded via load-all" "[ '$PUB_AFTER_COUNT' -gt 0 ]"

BOOK_AFTER_ALL=$(get "/api/entities/Book")
BOOK_AFTER_COUNT=$(json_field "$BOOK_AFTER_ALL" "d.get('totalCount', 0)")
assert "Book loaded via load-all" "[ '$BOOK_AFTER_COUNT' -gt 0 ]"
echo ""

# ============================================================================
# Test 14: Reset All
# ============================================================================

echo -e "${YELLOW}--- Test 14: Reset All ---${NC}"
RESETALL=$(post "/api/seed/reset-all" '{}')
RESET_SUCCESS=$(json_field "$RESETALL" "d.get('success', False)")
assert "Reset-all succeeds" "[ '$RESET_SUCCESS' = 'True' ]"

# Verify data is back after reset
PUB_AFTER_RESET=$(get "/api/entities/Publisher")
PUB_RESET_COUNT=$(json_field "$PUB_AFTER_RESET" "d.get('totalCount', 0)")
assert "Publisher present after reset" "[ '$PUB_RESET_COUNT' = '3' ]"
echo ""

# ============================================================================
# Test 15: Integration Options
# ============================================================================

echo -e "${YELLOW}--- Test 15: Integration Options ---${NC}"
OPTIONS=$(get "/api/integrate/Book/options")

# Options should not include the null record
OPTIONS_COUNT=$(json_field "$OPTIONS" "len(d)")
assert "Book options count = 8 (no null record)" "[ '$OPTIONS_COUNT' = '8' ]"

# Check that options have label field
FIRST_LABEL=$(json_field "$OPTIONS" "d[0].get('label', '') if d else ''")
assert "Options have label field" "[ -n '$FIRST_LABEL' ]"
echo ""

# ============================================================================
# Test 16: Integration Lookup
# ============================================================================

echo -e "${YELLOW}--- Test 16: Integration Lookup ---${NC}"

# Lookup by direct field
LOOKUP_DIRECT=$(get "/api/integrate/Book/lookup?field=title&value=Americanah")
LOOKUP_COUNT=$(json_field "$LOOKUP_DIRECT" "d.get('totalCount', 0)")
assert "Lookup by title finds 1 record" "[ '$LOOKUP_COUNT' = '1' ]"

# Lookup by FK field (author → Author LABEL)
LOOKUP_FK=$(get "/api/integrate/Book/lookup?field=author&value=Jane")
LOOKUP_FK_COUNT=$(json_field "$LOOKUP_FK" "d.get('totalCount', 0)")
assert "Lookup by author FK finds 2 records (Jane's books)" "[ '$LOOKUP_FK_COUNT' = '2' ]"
echo ""

# ============================================================================
# Test 17: id=1 Protection
# ============================================================================

echo -e "${YELLOW}--- Test 17: id=1 Protection ---${NC}"
DEL_RESULT=$(delete "/api/entities/Publisher/1")
DEL_STATUS=$(echo "$DEL_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error', {}).get('code', 'none') if isinstance(d.get('error'), dict) else 'none')" 2>/dev/null)
assert "DELETE id=1 returns error" "[ '$DEL_STATUS' != 'none' ]"
echo ""

# ============================================================================
# Test 18: Merge Mode
# ============================================================================

echo -e "${YELLOW}--- Test 18: Merge Mode ---${NC}"

# Get current book count and a specific book title
BEFORE_MERGE=$(get "/api/entities/Book")
BEFORE_COUNT=$(json_field "$BEFORE_MERGE" "d.get('totalCount', 0)")

# Load same seed in merge mode — should update existing, not duplicate
MERGE_RESULT=$(post "/api/seed/load/Book" '{"sourceDir":"seed","mode":"merge"}')
MERGE_SUCCESS=$(json_field "$MERGE_RESULT" "d.get('success', False)")
assert "Merge mode succeeds" "[ '$MERGE_SUCCESS' = 'True' ]"

MERGE_UPDATED=$(json_field "$MERGE_RESULT" "d.get('updated', 0)")
assert "Merge mode updated > 0" "[ '$MERGE_UPDATED' -gt 0 ]"

# Count should be same (no duplicates)
AFTER_MERGE=$(get "/api/entities/Book")
AFTER_COUNT=$(json_field "$AFTER_MERGE" "d.get('totalCount', 0)")
assert "Count unchanged after merge ($BEFORE_COUNT)" "[ '$AFTER_COUNT' = '$BEFORE_COUNT' ]"
echo ""

# ============================================================================
# Summary
# ============================================================================

echo -e "${YELLOW}========================================${NC}"
echo -e "  Tests: $TOTAL  |  ${GREEN}Pass: $PASS${NC}  |  ${RED}Fail: $FAIL${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
else
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
