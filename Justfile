# =============================================================================
# Backend Config
# =============================================================================
# HACKABLE: Change these for your deployment target
#
# Current backend: Fly.io
# =============================================================================

app := env_var_or_default("APP_NAME", "virtual-bernays")

# =============================================================================
# Help
# =============================================================================

help:
    @printf '\033[1m%s\033[0m\n' "Bernays"
    @printf '\n'
    @printf '\033[1m%s\033[0m\n' "DEPLOYMENT"
    @printf '  just %-20s %s\n' "deploy" "Deploy to Production"
    @printf '  just %-20s %s\n' "logs" "Tail Application Logs"
    @printf '  just %-20s %s\n' "status" "Show Application Status"
    @printf '\n'
    @printf '\033[1m%s\033[0m\n' "TESTING"
    @printf '  just %-20s %s\n' "test" "Run E2E Tests"
    @printf '  just %-20s %s\n' "ssh" "SSH into Production Instance"
    @printf '\n'
    @printf '\033[1m%s\033[0m\n' "EXTENSION"
    @printf '  just %-20s %s\n' "ext-build" "Build Browser Extension"
    @printf '  just %-20s %s\n' "ext-sync" "Sync Extension to Browserbase"
    @printf '\n'
    @printf '\033[1m%s\033[0m\n' "LOCAL"
    @printf '  just %-20s %s\n' "event-logs" "Query Event Log"
    @printf '  just %-20s %s\n' "configure-browsers" "Manage Browser Configs"

# =============================================================================
# Backend Operations
# =============================================================================
# HACKABLE: Replace these recipes for your deployment target
#
# Required recipes:
#   - deploy        Run deployment
#   - logs          Tail logs
#   - status        Show status
#
# Current backend: Fly.io
# =============================================================================

deploy: (ext-sync "--silent")
    @deno run -A scripts/deploy-application.ts

logs *args:
    @fly logs -a {{app}} {{args}}

status:
    @fly status -a {{app}}

# =============================================================================
# Backend Testing
# =============================================================================
# HACKABLE: Replace these recipes for your deployment target
#
# Note: Tests spawn a separate machine with access to private network.
# They do NOT run on the production instance.
#
# Current backend: Fly.io
# =============================================================================

dispatch-backend-test *args: sync
    @echo "Spawning test machine..."
    @fly machine run . -a {{app}} --rm --vm-memory 1024 -- deno task test:e2e:all {{args}}

dispatch-backend-test-db: sync
    @fly machine run . -a {{app}} --rm -- deno eval "const p = (await import('postgres')).default; const sql = p(Deno.env.get('DATABASE_URL')); await sql\`SELECT 1\`; console.log('DB OK'); await sql.end()"

read-backend-test-logs:
    @fly logs -a {{app}}

sync:
    @if [ ! -f .env ]; then echo "Error: .env File Not Found"; exit 1; fi
    @grep -v '^#' .env | grep -v '^$$' | while IFS='=' read -r key value; do \
        if [ -n "$$key" ]; then \
            echo "Setting $$key..."; \
            echo "$$value" | fly secrets set "$$key=-" -a {{app}}; \
        fi \
    done
    @echo "Secrets Synced Successfully"

test: dispatch-backend-test dispatch-backend-test-db
    read-backend-test-logs

ssh *args: sync
    @fly ssh console -a {{app}} {{args}}

event-logs *args:
    fly ssh console -a {{app}} -C 'deno run -A scripts/view-event-log.ts {{args}}'

configure-browsers *args:
    fly ssh console -a {{app}} -C 'deno run -A scripts/manage-browser-configs.ts {{args}}'

# =============================================================================
# Extensions
# =============================================================================

# Build Browser Extension
ext-build *args:
    @deno run -A scripts/build-extension.ts --zip {{args}}

# Sync Extension to Browserbase
ext-sync *args: (ext-build "--silent")
    @deno run -A scripts/sync-extension.ts {{args}}

