#!/bin/bash
# LOC Statistics Generator for AIDE RAP
#
# Usage:
#   ./tools/loc-stats.sh [--markdown]                    # Project-wide stats
#   ./tools/loc-stats.sh [--markdown] --system <name>    # System-specific stats
#
# Options:
#   --markdown       Output markdown format
#   --system <name>  Generate stats for specific system only

set -e

# Parse arguments
MARKDOWN_MODE=false
SYSTEM_NAME=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --markdown)
            MARKDOWN_MODE=true
            shift
            ;;
        --system)
            SYSTEM_NAME="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
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

    if [ ! -d "$path" ]; then
        echo 0
        return
    fi

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
SYSTEMS_ROOT="$PROJECT_ROOT/app/systems"

# ============================================================================
# SYSTEM-SPECIFIC STATS
# ============================================================================

if [ -n "$SYSTEM_NAME" ]; then
    SYSTEM_DIR="$SYSTEMS_ROOT/$SYSTEM_NAME"

    if [ ! -d "$SYSTEM_DIR" ]; then
        echo "Error: System '$SYSTEM_NAME' not found at $SYSTEM_DIR" >&2
        exit 1
    fi

    # Count system-specific docs
    docs_requirements=$(count_loc "$SYSTEM_DIR/docs" "*.md")
    docs_classes=$(count_loc "$SYSTEM_DIR/docs/classes" "*.md")
    docs_other=$((docs_requirements - docs_classes))
    help_loc=$(count_loc "$SYSTEM_DIR/help" "*.md")

    # Config files
    config_json=$(wc -l "$SYSTEM_DIR/config.json" 2>/dev/null | awk '{print $1}' || echo 0)
    config_yaml=$(wc -l "$SYSTEM_DIR/docs/DataModel.yaml" 2>/dev/null | awk '{print $1}' || echo 0)
    config_layout=$(wc -l "$SYSTEM_DIR/docs/DataModel-layout.json" 2>/dev/null | awk '{print $1}' || echo 0)
    config_total=$((config_json + config_yaml + config_layout))

    system_total=$((docs_requirements + help_loc + config_total))

    if [ "$MARKDOWN_MODE" = true ]; then
        cat << EOF
# ${SYSTEM_NAME^} System - Statistics

Lines of code for the **${SYSTEM_NAME}** system.

*Generated: $(date '+%Y-%m-%d %H:%M')*

## Documentation

| Category | LOC |
|----------|----:|
| Entity Classes (classes/*.md) | $(format_num $docs_classes) |
| Other Docs (requirements/*.md) | $(format_num $docs_other) |
| Help | $(format_num $help_loc) |
| **Subtotal** | **$(format_num $((docs_requirements + help_loc)))** |

## Configuration

| Category | LOC |
|----------|----:|
| config.json | $(format_num $config_json) |
| DataModel.yaml | $(format_num $config_yaml) |
| DataModel-layout.json | $(format_num $config_layout) |
| **Subtotal** | **$(format_num $config_total)** |

## Total

| Category | LOC |
|----------|----:|
| **System Total** | **$(format_num $system_total)** |
EOF
    else
        echo ""
        echo -e "${BOLD}${SYSTEM_NAME^} System - LOC Statistics${RESET}"
        echo -e "${GRAY}Generated: $(date '+%Y-%m-%d %H:%M')${RESET}"
        echo ""
        echo "Entity Classes:  $(format_num $docs_classes)"
        echo "Other Docs:      $(format_num $docs_other)"
        echo "Help:            $(format_num $help_loc)"
        echo "Config:          $(format_num $config_total)"
        echo "─────────────────────"
        echo -e "${BOLD}Total:           $(format_num $system_total)${RESET}"
        echo ""
    fi

    exit 0
fi

# ============================================================================
# PROJECT-WIDE STATS
# ============================================================================

# AIDE-RAP Platform
server_loc=$(count_loc "$PROJECT_ROOT/app/server" "*.js")
shared_loc=$(count_loc "$PROJECT_ROOT/app/shared" "*.js")

frontend_js=$(count_loc "$PROJECT_ROOT/app/static/rap" "*.js")
frontend_css=$(count_loc "$PROJECT_ROOT/app/static/rap" "*.css")
frontend_html=$(count_loc "$PROJECT_ROOT/app/static/rap" "*.html")
frontend_total=$((frontend_js + frontend_css + frontend_html))

tools_js=$(count_loc "$PROJECT_ROOT/tools" "*.js")
tools_sh=$(count_loc "$PROJECT_ROOT/tools" "*.sh")
tools_total=$((tools_js + tools_sh))

config_pkg=$(wc -l "$PROJECT_ROOT/package.json" 2>/dev/null | awk '{print $1}' || echo 0)
config_sample=$(wc -l "$PROJECT_ROOT/app/config_sample.json" 2>/dev/null | awk '{print $1}' || echo 0)

platform_own=$((server_loc + shared_loc + frontend_total + tools_total + config_pkg + config_sample))

# External dependencies
if [ -d "$PROJECT_ROOT/node_modules" ]; then
    node_modules_loc=$(find "$PROJECT_ROOT/node_modules" -name "*.js" -type f 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
else
    node_modules_loc=0
fi

# AIDE-FRAME
frame_own=0
frame_node_modules=0
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
    fi
fi

# Systems - collect stats for each
declare -A system_docs
declare -A system_help
declare -A system_config
declare -A system_total
systems_total_docs=0
systems_total_help=0
systems_total_config=0
systems_total=0

if [ -d "$SYSTEMS_ROOT" ]; then
    for system_dir in "$SYSTEMS_ROOT"/*/; do
        if [ -d "$system_dir" ]; then
            sname=$(basename "$system_dir")

            sdocs=$(count_loc "$system_dir/docs" "*.md")
            shelp=$(count_loc "$system_dir/help" "*.md")
            sconfig_json=$(wc -l "$system_dir/config.json" 2>/dev/null | awk '{print $1}' || echo 0)
            sconfig_yaml=$(wc -l "$system_dir/docs/DataModel.yaml" 2>/dev/null | awk '{print $1}' || echo 0)
            sconfig_layout=$(wc -l "$system_dir/docs/DataModel-layout.json" 2>/dev/null | awk '{print $1}' || echo 0)
            sconfig=$((sconfig_json + sconfig_yaml + sconfig_layout))
            stotal=$((sdocs + shelp + sconfig))

            system_docs[$sname]=$sdocs
            system_help[$sname]=$shelp
            system_config[$sname]=$sconfig
            system_total[$sname]=$stotal

            systems_total_docs=$((systems_total_docs + sdocs))
            systems_total_help=$((systems_total_help + shelp))
            systems_total_config=$((systems_total_config + sconfig))
            systems_total=$((systems_total + stotal))
        fi
    done
fi

# Grand totals
total_own=$((platform_own + frame_own + systems_total))
total_deps=$((node_modules_loc + frame_node_modules))

# ============================================================================
# Output
# ============================================================================

if [ "$MARKDOWN_MODE" = true ]; then
    cat << EOF
# Codebase Statistics

Lines of code statistics for the AIDE RAP project.

*Generated: $(date '+%Y-%m-%d %H:%M')*

## External Dependencies

| Package | LOC |
|---------|----:|
| node_modules (RAP) | $(format_num ${node_modules_loc:-0}) |
| node_modules (FRAME) | $(format_num ${frame_node_modules:-0}) |
| **Total Dependencies** | **$(format_num $total_deps)** |

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
| Documentation | $(format_num $frame_docs_total) |
| **Subtotal** | **$(format_num $frame_own)** |

EOF
    fi

    cat << EOF
## AIDE-RAP Platform

| Category | LOC |
|----------|----:|
| Server (app/server) | $(format_num $server_loc) |
| Shared (app/shared) | $(format_num $shared_loc) |
| Frontend (app/static) | $(format_num $frontend_total) |
| Tools | $(format_num $tools_total) |
| Config (package.json etc.) | $(format_num $((config_pkg + config_sample))) |
| **Subtotal** | **$(format_num $platform_own)** |

## Systems

| System | Docs | Help | Config | Total |
|--------|-----:|-----:|-------:|------:|
EOF

    for sname in $(echo "${!system_total[@]}" | tr ' ' '\n' | sort); do
        echo "| $sname | $(format_num ${system_docs[$sname]}) | $(format_num ${system_help[$sname]}) | $(format_num ${system_config[$sname]}) | $(format_num ${system_total[$sname]}) |"
    done

    cat << EOF
| **Subtotal** | **$(format_num $systems_total_docs)** | **$(format_num $systems_total_help)** | **$(format_num $systems_total_config)** | **$(format_num $systems_total)** |

## Summary

| Component | Own Code |
|-----------|----------|
| AIDE-FRAME | $(format_num $frame_own) |
| AIDE-RAP Platform | $(format_num $platform_own) |
| Systems (all) | $(format_num $systems_total) |
| **Total Own Code** | **$(format_num $total_own)** |

*Note: node_modules contains third-party dependencies and is excluded from own code counts.*
EOF

else
    # Terminal output
    echo ""
    echo -e "${BOLD}LOC Statistics${RESET}"
    echo -e "${GRAY}Generated: $(date '+%Y-%m-%d %H:%M')${RESET}"
    echo ""

    echo -e "${BOLD}AIDE-FRAME${RESET}"
    echo "  Own Code:     $(format_num $frame_own)"
    echo ""

    echo -e "${BOLD}AIDE-RAP Platform${RESET}"
    echo "  Server:       $(format_num $server_loc)"
    echo "  Shared:       $(format_num $shared_loc)"
    echo "  Frontend:     $(format_num $frontend_total)"
    echo "  Tools:        $(format_num $tools_total)"
    echo "  ─────────────────"
    echo "  Subtotal:     $(format_num $platform_own)"
    echo ""

    echo -e "${BOLD}Systems${RESET}"
    for sname in $(echo "${!system_total[@]}" | tr ' ' '\n' | sort); do
        echo "  $sname:        $(format_num ${system_total[$sname]})"
    done
    echo "  ─────────────────"
    echo "  Subtotal:     $(format_num $systems_total)"
    echo ""

    echo -e "${BOLD}Summary${RESET}"
    echo "  Own Code:     $(format_num $total_own)"
    echo "  Dependencies: $(format_num $total_deps)"
    echo ""
fi
