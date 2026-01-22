#!/bin/bash
# LOC Statistics Generator for AIDE-IRMA and AIDE-FRAME
#
# Usage: ./tools/loc-stats.sh [--markdown]
#
# Options:
#   --markdown    Output markdown format (for app/docs/statistics.md)

set -e

# Parse arguments
MARKDOWN_MODE=false
for arg in "$@"; do
    if [ "$arg" = "--markdown" ]; then
        MARKDOWN_MODE=true
    fi
done

# Colors for terminal output (disabled in markdown mode)
if [ "$MARKDOWN_MODE" = true ]; then
    BOLD=''
    RESET=''
    GRAY=''
else
    BOLD='\033[1m'
    RESET='\033[0m'
    GRAY='\033[90m'
fi

# Count lines in files matching pattern with optional exclusions
count_loc() {
    local path="$1"
    local pattern="$2"
    shift 2
    local excludes=("$@")

    local find_cmd="find \"$path\" -name \"$pattern\" -type f"
    for excl in "${excludes[@]}"; do
        find_cmd+=" ! -path \"*/$excl/*\""
    done

    local result
    result=$(eval "$find_cmd" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    echo "${result:-0}"
}

# Format number with thousand separator
format_num() {
    printf "%'d" "$1" 2>/dev/null || echo "$1"
}

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
FRAME_ROOT="$PROJECT_ROOT/aide-frame"

# ============================================================================
# Collect all statistics first
# ============================================================================

# AIDE-IRMA
docs_loc=$(count_loc "$PROJECT_ROOT/app/docs" "*.md")
help_loc=$(count_loc "$PROJECT_ROOT/app/help" "*.md" 2>/dev/null || echo 0)
docs_total=$((docs_loc + help_loc))

server_loc=$(count_loc "$PROJECT_ROOT/app/server" "*.js")
shared_loc=$(count_loc "$PROJECT_ROOT/app/shared" "*.js")

frontend_js=$(count_loc "$PROJECT_ROOT/app/static/irma" "*.js")
frontend_css=$(count_loc "$PROJECT_ROOT/app/static/irma" "*.css")
frontend_html=$(count_loc "$PROJECT_ROOT/app/static/irma" "*.html")
frontend_total=$((frontend_js + frontend_css + frontend_html))

tools_js=$(count_loc "$PROJECT_ROOT/tools" "*.js")
tools_sh=$(count_loc "$PROJECT_ROOT/tools" "*.sh")
tools_total=$((tools_js + tools_sh))

config_yaml=$(wc -l "$PROJECT_ROOT/app/docs/requirements/DataModel.yaml" 2>/dev/null | awk '{print $1}' || echo 0)
config_layout=$(wc -l "$PROJECT_ROOT/app/docs/requirements/DataModel-layout.json" 2>/dev/null | awk '{print $1}' || echo 0)
config_app=$(wc -l "$PROJECT_ROOT/app/config.json" 2>/dev/null | awk '{print $1}' || echo 0)
config_sample=$(wc -l "$PROJECT_ROOT/app/config_sample.json" 2>/dev/null | awk '{print $1}' || echo 0)
config_pkg=$(wc -l "$PROJECT_ROOT/package.json" 2>/dev/null | awk '{print $1}' || echo 0)
config_total=$((config_yaml + config_layout + config_app + config_sample + config_pkg))

irma_own=$((docs_total + server_loc + shared_loc + frontend_total + tools_total + config_total))

if [ -d "$PROJECT_ROOT/node_modules" ]; then
    irma_node_modules=$(find "$PROJECT_ROOT/node_modules" -name "*.js" -type f 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
else
    irma_node_modules=0
fi
irma_total=$((irma_own + ${irma_node_modules:-0}))

# AIDE-FRAME
if [ -d "$FRAME_ROOT" ]; then
    python_loc=$(count_loc "$FRAME_ROOT/python" "*.py" "node_modules")
    js_server=$(count_loc "$FRAME_ROOT/js/aide_frame" "*.js" "node_modules")
    js_browser=$(count_loc "$FRAME_ROOT/static/js" "*.js")
    js_sw=$(wc -l "$FRAME_ROOT/static/service-worker.js" 2>/dev/null | awk '{print $1}' || echo 0)
    js_browser_total=$((js_browser + js_sw))
    css_loc=$(count_loc "$FRAME_ROOT/static/css" "*.css" "vendor")
    html_loc=$(count_loc "$FRAME_ROOT/static/templates" "*.html")
    frame_docs=$(count_loc "$FRAME_ROOT/docs" "*.md")
    frame_readme=$(wc -l "$FRAME_ROOT/README.md" 2>/dev/null | awk '{print $1}' || echo 0)
    frame_docs_total=$((frame_docs + frame_readme))
    frame_own=$((python_loc + js_server + js_browser_total + css_loc + html_loc + frame_docs_total))

    if [ -d "$FRAME_ROOT/js/aide_frame/node_modules" ]; then
        frame_node_modules=$(find "$FRAME_ROOT/js/aide_frame/node_modules" -name "*.js" -type f 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    else
        frame_node_modules=0
    fi
    frame_total=$((frame_own + ${frame_node_modules:-0}))
fi

# ============================================================================
# Output
# ============================================================================

if [ "$MARKDOWN_MODE" = true ]; then
    # Markdown output
    cat << EOF
# Codebase Statistics

Lines of code statistics for the AIDE-IRMA project and the AIDE Framework.

*Generated: $(date '+%Y-%m-%d %H:%M')*

## AIDE-IRMA

| Category | LOC |
|----------|----:|
| Documentation (MD) | $(format_num $docs_total) |
| Server (JS) | $(format_num $server_loc) |
| Shared (JS) | $(format_num $shared_loc) |
| Frontend (JS/CSS/HTML) | $(format_num $frontend_total) |
| Tools (JS/Shell) | $(format_num $tools_total) |
| Config (JSON/YAML) | $(format_num $config_total) |
| **Own Code Subtotal** | **$(format_num $irma_own)** |
| External (node_modules) | $(format_num ${irma_node_modules:-0}) |
| **Total** | **$(format_num $irma_total)** |

EOF

    if [ -d "$FRAME_ROOT" ]; then
        cat << EOF
## AIDE-FRAME

| Category | LOC |
|----------|----:|
| Python | $(format_num $python_loc) |
| JS Server | $(format_num $js_server) |
| JS Browser | $(format_num $js_browser_total) |
| CSS | $(format_num $css_loc) |
| HTML Templates | $(format_num $html_loc) |
| Documentation (MD) | $(format_num $frame_docs_total) |
| **Own Code Subtotal** | **$(format_num $frame_own)** |
| External (node_modules) | $(format_num ${frame_node_modules:-0}) |
| **Total** | **$(format_num $frame_total)** |

EOF
    fi

    cat << EOF
## Summary

| Project | Own Code | Dependencies | Total |
|---------|----------|--------------|-------|
| AIDE-IRMA | $(format_num $irma_own) | $(format_num ${irma_node_modules:-0}) | $(format_num $irma_total) |
EOF
    if [ -d "$FRAME_ROOT" ]; then
        echo "| AIDE-FRAME | $(format_num $frame_own) | $(format_num ${frame_node_modules:-0}) | $(format_num $frame_total) |"
        echo "| **Combined Own Code** | **$(format_num $((irma_own + frame_own)))** | | |"
    fi
    echo ""
    echo "*Note: node_modules contains third-party dependencies and is excluded from own code counts.*"

else
    # Terminal output with box drawing
    print_row() {
        printf "│ %-25s │ %8s │\n" "$1" "$(format_num $2)"
    }

    print_separator() {
        echo "├───────────────────────────┼──────────┤"
    }

    print_header() {
        echo "┌───────────────────────────┬──────────┐"
        printf "│ %-25s │ %8s │\n" "$1" "LOC"
        echo "├───────────────────────────┼──────────┤"
    }

    print_footer() {
        echo "├───────────────────────────┼──────────┤"
        printf "│ ${BOLD}%-25s${RESET} │ ${BOLD}%8s${RESET} │\n" "$1" "$(format_num $2)"
        echo "└───────────────────────────┴──────────┘"
    }

    echo ""
    echo -e "${BOLD}LOC Statistics${RESET}"
    echo -e "${GRAY}Generated: $(date '+%Y-%m-%d %H:%M')${RESET}"
    echo ""

    echo -e "${BOLD}AIDE-IRMA${RESET}"
    print_header "Category"
    print_row "Documentation (MD)" "$docs_total"
    print_row "Server (JS)" "$server_loc"
    print_row "Shared (JS)" "$shared_loc"
    print_row "Frontend (JS/CSS/HTML)" "$frontend_total"
    print_row "Tools (JS/Shell)" "$tools_total"
    print_row "Config (JSON/YAML)" "$config_total"
    print_separator
    print_row "Own Code Subtotal" "$irma_own"
    print_row "External (node_modules)" "${irma_node_modules:-0}"
    print_footer "Total AIDE-IRMA" "$irma_total"
    echo ""

    if [ -d "$FRAME_ROOT" ]; then
        echo -e "${BOLD}AIDE-FRAME${RESET}"
        print_header "Category"
        print_row "Python" "$python_loc"
        print_row "JS Server" "$js_server"
        print_row "JS Browser" "$js_browser_total"
        print_row "CSS" "$css_loc"
        print_row "HTML Templates" "$html_loc"
        print_row "Documentation (MD)" "$frame_docs_total"
        print_separator
        print_row "Own Code Subtotal" "$frame_own"
        print_row "External (node_modules)" "${frame_node_modules:-0}"
        print_footer "Total AIDE-FRAME" "$frame_total"
        echo ""
        echo -e "${GRAY}Note: node_modules contains third-party dependencies${RESET}"
    else
        echo -e "${GRAY}AIDE-FRAME not found at $FRAME_ROOT${RESET}"
    fi
    echo ""
fi
