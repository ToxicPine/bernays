# =============================================================================
# Justfile — Task runner for the Social Automation Framework
# =============================================================================

app := env_var_or_default("APP_NAME", "linkedin-automation-worker")

# Show available commands
help:
    @printf '\033[1m%s\033[0m\n' "Social Automation Framework"
    @printf '\n'
    @printf '\033[1m%s\033[0m\n' "COMMANDS"
    @printf '  just %-18s %s\n' "help" "Show this help"
    @printf '  just %-18s %s\n' "deploy" "Build, sync extension, deploy to Fly.io"
    @printf '  just %-18s %s\n' "logs" "Tail application logs"
    @printf '  just %-18s %s\n' "status" "Show app status"
    @printf '  just %-18s %s\n' "events" "Query event log (CSV → csvlens)"
    @printf '\n'
    @printf '\033[1m%s\033[0m\n' "EXTENSION"
    @printf '  just %-18s %s\n' "ext-build" "Build browser extension"
    @printf '  just %-18s %s\n' "ext-sync" "Sync extension to Browserbase"
    @printf '\n'
    @printf '\033[1m%s\033[0m\n' "EXAMPLES"
    @printf '  just deploy\n'
    @printf '  just logs --since 5m\n'
    @printf '  just events --type linkedin --limit 50\n'
    @printf '  just ext-build && just ext-sync\n'
    @printf '\n'
    @printf '\033[2m%s\033[0m\n' "Run 'just <command> --help' for command-specific help."

# =============================================================================
# Deployment
# =============================================================================

# Build extension, sync to Browserbase, deploy to Fly.io
deploy: (_ext-sync "--silent")
    @APP_NAME={{app}} bernays-deploy

# =============================================================================
# Extension
# =============================================================================

# Build browser extension (TypeScript → JS + zip)
ext-build *args:
    @deno run -A packages/browser/scripts/build.ts --zip {{args}}

# Sync extension to Browserbase
ext-sync *args: (_ext-build "--silent")
    @deno run -A packages/browser/scripts/sync.ts {{args}}

# Internal: build with args (for silent mode in deploy)
_ext-build *args:
    @deno run -A packages/browser/scripts/build.ts --zip {{args}}

# Internal: sync with args (for silent mode in deploy)
_ext-sync *args: (_ext-build "--silent")
    @deno run -A packages/browser/scripts/sync.ts {{args}}

# =============================================================================
# Operations
# =============================================================================

# Tail application logs
logs *args:
    @fly logs -a {{app}} {{args}}

# Show app status
status:
    @fly status -a {{app}}

# Query the event log
events *args:
    @bash -lc 'set -euo pipefail; \
      set -- {{args}}; \
      [[ "${1-}" == "--" ]] && shift; \
      joined="$*"; \
      if printf "%s" "$joined" | grep -Eq "(^|[[:space:]])--help([[:space:]]|$)"; then \
        deno run -A scripts/events.ts "$@"; \
      elif printf "%s" "$joined" | grep -Eq "(^|[[:space:]])--format(=|[[:space:]]+)json([[:space:]]|$)"; then \
        deno run -A scripts/events.ts "$@"; \
      elif [[ -t 0 && -t 1 ]]; then \
        output="$(deno run -A scripts/events.ts --silent "$@")" && printf "%s\n" "$output" | csvlens; \
      else \
        deno run -A scripts/events.ts "$@"; \
      fi'
