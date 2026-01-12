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
    @printf '\033[1m%s\033[0m\n' "DEBUG"
    @printf '  just %-20s %s\n' "ssh" "SSH into Production"
    @printf '  just %-20s %s\n' "test-ssh" "SSH into Test Machine"
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
# Secrets & SSH
# =============================================================================

sync:
    @if [ ! -f .env ]; then echo "Error: .env File Not Found"; exit 1; fi
    @grep -v '^#' .env | grep -v '^$$' | while IFS='=' read -r key value; do \
        if [ -n "$$key" ]; then \
            echo "Setting $$key..."; \
            echo "$$value" | fly secrets set "$$key=-" -a {{app}}; \
        fi \
    done
    @echo "Secrets Synced Successfully"

ssh *args:
    @fly ssh console -a {{app}} {{args}}

event-logs *args: _start-test-machine
    #!/usr/bin/env sh
    id=$(just _test-machine-id)
    fly ssh console -a {{app}} --machine $id -C 'deno run -A scripts/view-event-log.ts {{args}}'
    just _stop-test-machine

configure-browsers *args: _start-test-machine
    #!/usr/bin/env sh
    id=$(just _test-machine-id)
    fly ssh console -a {{app}} --machine $id -C 'deno run -A scripts/manage-browser-configs.ts {{args}}'
    just _stop-test-machine

# =============================================================================
# Test Machine Setup
# =============================================================================

_test-machine-id:
    @fly machine list -a {{app}} --json 2>/dev/null | jq -r '.[] | select(.name=="test-machine") | .id' || true

_ensure-test-machine:
    #!/usr/bin/env sh
    id=$(just _test-machine-id)
    if [ -z "$id" ]; then
        fly machine create . -a {{app}} --name test-machine --vm-memory 1024 --region iad --autostop=stop --autostart=false
    fi

_prod-machine-image:
    @fly machine list -a {{app}} --json 2>/dev/null | jq -r '[.[] | select(.name != "test-machine")][0].image_ref | .repository + ":" + .tag' || true

_start-test-machine: _ensure-test-machine
    #!/usr/bin/env sh
    id=$(just _test-machine-id)
    image=$(just _prod-machine-image)
    if [ -n "$image" ] && [ "$image" != "null:null" ]; then
        printf '\033[2mUpdating Machine to %s...\033[0m\n' "$image"
        fly machine update $id -a {{app}} --image "$image" -y 2>/dev/null || true
    fi
    fly machine start $id -a {{app}} 2>/dev/null || true
    for i in 1 2 3 4 5 6; do
        state=$(fly machine list -a {{app}} --json 2>/dev/null | jq -r ".[] | select(.id==\"$id\") | .state")
        [ "$state" = "started" ] && break
        sleep 2
    done

_stop-test-machine:
    #!/usr/bin/env sh
    id=$(just _test-machine-id)
    if [ -n "$id" ]; then fly machine stop $id -a {{app}} 2>/dev/null || true; fi

test-ssh *args: _start-test-machine
    #!/usr/bin/env sh
    id=$(just _test-machine-id)
    fly ssh console -a {{app}} --machine $id {{args}}
    just _stop-test-machine

test-machine-destroy:
    #!/usr/bin/env sh
    id=$(just _test-machine-id)
    if [ -n "$id" ]; then
        fly machine destroy $id -a {{app}} --force && echo "Test machine destroyed."
    else
        echo "Error: No Test Machine Defined."
    fi

# =============================================================================
# Extensions
# =============================================================================

# Build Browser Extension
ext-build *args:
    @deno run -A scripts/build-extension.ts --zip {{args}}

# Sync Extension to Browserbase
ext-sync *args: (ext-build "--silent")
    @deno run -A scripts/sync-extension.ts {{args}}

