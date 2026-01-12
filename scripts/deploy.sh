#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# =============================================================================
# deploy.sh — Fly.io deploy script for the Social Automation Framework
# =============================================================================
#
# Usage:
#   ./scripts/deploy.sh
#   bernays deploy          (if aliased)
#
# What it does:
#   1. Verifies prerequisites (repo root, flyctl, git)
#   2. Ensures you're logged into Fly.io
#   3. Creates the app if it doesn't exist
#   4. Sets up managed Postgres (waits for ready)
#   5. Configures secrets (prompts for missing values)
#   6. Skips deploy if no changes since last deploy
#   7. Runs `fly deploy`
#
# Environment variables:
#
#   App config:
#     APP_NAME                    App name (default: from fly.toml)
#     REGION                      Deploy region (default: from fly.toml or "iad")
#     ORG                         Fly.io organization slug
#
#   Database:
#     USE_FLY_POSTGRES=1          Create/attach managed Postgres on Fly
#     POSTGRES_NAME               Cluster name (default: linkedin-automation-db)
#     DATABASE_URL                External database URL (if not using Fly Postgres)
#     DB_READY_TIMEOUT            Seconds to wait for DB ready (default: 300)
#
#   Secrets:
#     BROWSERBASE_API_KEY         Browserbase API key
#     BROWSERBASE_CONTEXT_ID      Browserbase context ID
#     BROWSERBASE_EXTENSION_ID    Browserbase extension ID
#     RUN_SOCKPUPPET              Enable sockpuppet (default: 1)
#     ACCOUNT_ID                  Account identifier
#
#   Flags:
#     FORCE_DEPLOY=1              Deploy even if no changes detected
#     ALLOW_DIRTY_DEPLOY=1        Deploy with uncommitted changes
#     SKIP_POSTGRES=1             Skip database setup
#     SKIP_SECRETS=1              Skip secret configuration
#
# Notes:
#   - Stores deploy fingerprint in .deploy/fly-<app>.fingerprint
#   - Loads .env at startup (won't override existing env vars)
#   - Writes DATABASE_URL to .env when database is ready
#   - Safe to ctrl-c during DB provisioning - will resume on next run
#
# =============================================================================

# =============================================================================
# Output Helpers
# =============================================================================

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# =============================================================================
# Utilities
# =============================================================================

have() { command -v "$1" >/dev/null 2>&1; }

confirm() {
  local prompt="${1:-Continue?} [y/N] " ans=""
  read -r -p "$prompt" ans || true
  [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]
}

toml_get() {
  local key="$1" file="$2"
  awk -F= -v k="$key" '
    $1 ~ ("^[[:space:]]*" k "[[:space:]]*$") {
      v=$2; gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      gsub(/^"/, "", v); gsub(/"$/, "", v)
      print v; exit
    }
  ' "$file"
}

# =============================================================================
# .env Handling
# =============================================================================

load_dotenv() {
  [[ -f ".env" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    # Strip surrounding quotes (single or double)
    value="${value#\"}" ; value="${value%\"}"
    value="${value#\'}" ; value="${value%\'}"
    if [[ -n "$key" && -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < .env
}

write_dotenv() {
  local key="$1" val="$2"
  [[ -n "$val" ]] || return 0

  touch .env || die "Cannot create .env file"

  if grep -q "^${key}=" .env 2>/dev/null; then
    local tmp
    tmp="$(mktemp)" || die "Cannot create temp file"
    grep -v "^${key}=" .env > "$tmp" || true
    mv "$tmp" .env || die "Cannot update .env file"
  fi

  printf '%s=%s\n' "$key" "$val" >> .env || die "Cannot write to .env file"
  dim "  wrote $key to .env"
}

# =============================================================================
# Spinner
# =============================================================================

is_tty() { [[ -t 1 ]]; }
SPINNER_PID=""

spinner_start() {
  local label="${1:-working}"
  is_tty || return 0
  spinner_stop 2>/dev/null || true

  (
    local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0
    while :; do
      printf '\r\033[36m%s\033[0m %s\033[K' "${frames:i%10:1}" "$label"
      ((i++)) || true
      sleep 0.1
    done
  ) &
  SPINNER_PID="$!"
  disown "$SPINNER_PID" 2>/dev/null || true
}

spinner_stop() {
  is_tty || return 0
  if [[ -n "${SPINNER_PID:-}" ]] && kill -0 "$SPINNER_PID" 2>/dev/null; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
  fi
  SPINNER_PID=""
  printf '\r\033[K'
}

# Run command with spinner, show output only on failure
run_quiet() {
  local label="$1"; shift
  local out rc=0

  spinner_start "$label"
  out="$("$@" 2>&1)" || rc=$?
  spinner_stop

  if [[ "$rc" -eq 0 ]]; then
    ok "$label"
  else
    printf '%s\n' "$out" >&2
    err "$label"
  fi
  return "$rc"
}

trap 'spinner_stop 2>/dev/null || true' EXIT INT TERM

# =============================================================================
# Prerequisites
# =============================================================================

require_repo_root() {
  [[ -f fly.toml ]]   || die "fly.toml not found — run from repo root"
  [[ -f Dockerfile ]] || die "Dockerfile not found — run from repo root"
  [[ -f deno.json ]]  || die "deno.json not found — run from repo root"
}

require_flyctl() {
  have fly || die "flyctl not found — install from https://fly.io/docs/flyctl/"
}

require_git() {
  have git || die "git not found"
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not in a git repo"
}

require_jq() {
  have jq || die "jq not found — required for database setup"
}

# =============================================================================
# Secrets Management
# =============================================================================

# Accumulator for batched secrets
declare -a SECRETS_BATCH=()

secrets_add() {
  local key="$1" val="${2:-}"
  [[ -n "$val" ]] || return 0
  SECRETS_BATCH+=("$key=$val")
}

secrets_flush() {
  local app="$1"
  (( ${#SECRETS_BATCH[@]} > 0 )) || return 0

  run_quiet "Configuring ${#SECRETS_BATCH[@]} agent settings" \
    fly secrets set "${SECRETS_BATCH[@]}" -a "$app" \
    || die "Failed to configure agent settings"

  SECRETS_BATCH=()
}

read_secret() {
  local prompt="$1"
  local input="" char=""

  printf '%s' "$prompt"

  while IFS= read -r -s -n1 char; do
    if [[ -z "$char" ]]; then
      break
    elif [[ "$char" == $'\x7f' || "$char" == $'\x08' ]]; then
      if [[ -n "$input" ]]; then
        input="${input%?}"
        printf '\b \b'
      fi
    else
      input+="$char"
      printf '*'
    fi
  done

  echo
  printf '%s' "$input"
}

prompt_secret() {
  local key="$1" current="${2:-}"

  if [[ -n "$current" ]]; then
    secrets_add "$key" "$current"
    return 0
  fi

  local input=""
  input="$(read_secret "  $key (leave blank to skip): ")"
  [[ -n "$input" ]] && secrets_add "$key" "$input"
}

# =============================================================================
# Deploy Gating
# =============================================================================

git_fingerprint() {
  local head dirty

  head="$(git rev-parse HEAD 2>/dev/null)" || die "Cannot get git HEAD — is this a git repository?"
  dirty="$(git status --porcelain=v1 --untracked-files=all 2>/dev/null)" || dirty=""

  if [[ -n "$dirty" ]]; then
    printf '%s+dirty:%s' "$head" "$(printf '%s' "$dirty" | sha256sum | cut -d' ' -f1)"
  else
    printf '%s' "$head"
  fi
}

fingerprint_file() {
  mkdir -p .deploy || die "Cannot create .deploy directory"
  printf '.deploy/fly-%s.fingerprint' "$1"
}

check_should_deploy() {
  local app="$1"
  local fp_file fp last

  fp_file="$(fingerprint_file "$app")"
  fp="$(git_fingerprint)"
  last="$([[ -f "$fp_file" ]] && cat "$fp_file" || true)"

  if [[ "${FORCE_DEPLOY:-0}" == "1" ]]; then
    warn "FORCE_DEPLOY=1 — deploying anyway"
    return 0
  fi

  if [[ "$fp" == "$last" ]]; then
    ok "No changes since last deploy"
    dim "  Set FORCE_DEPLOY=1 to deploy anyway"
    exit 0
  fi

  if [[ "$fp" == *"+dirty:"* && "${ALLOW_DIRTY_DEPLOY:-0}" != "1" ]]; then
    warn "Uncommitted changes detected"
    die "Commit changes first, or set ALLOW_DIRTY_DEPLOY=1"
  fi
}

record_deploy() {
  local app="$1"
  printf '%s\n' "$(git_fingerprint)" > "$(fingerprint_file "$app")"
}

# =============================================================================
# Platform Backend Interface
# =============================================================================
# This section defines the interface that platform backends must implement.
# To add a new backend (e.g., Railway, Render), implement these functions.
# =============================================================================

# Platform: Authentication
# Ensures the user is authenticated with the platform
platform_ensure_auth() {
  if fly auth whoami >/dev/null 2>&1; then
    ok "Logged in to Fly.io"
    return 0
  fi

  warn "Not logged in to Fly.io"
  confirm "Open browser to log in?" || die "Aborted"
  fly auth login
  fly auth whoami >/dev/null 2>&1 || die "Login failed"
  ok "Logged in to Fly.io"
}

# Platform: App Management
# Check if app exists
platform_app_exists() {
  local app="$1"
  fly status -a "$app" >/dev/null 2>&1
}

# Create app if it doesn't exist
platform_ensure_app() {
  local app="$1" region="$2" org="${3:-}"

  if platform_app_exists "$app"; then
    ok "App exists: $app"
    return 0
  fi

  bold "Creating app: $app"
  if [[ -n "$org" ]]; then
    run_quiet "Creating app" fly apps create "$app" --org "$org" \
      || die "Failed to create app '$app'"
  else
    run_quiet "Creating app" fly apps create "$app" \
      || die "Failed to create app '$app'"
  fi
}

# Platform: Database Management
# Get organization slug for database operations
platform_get_org_slug() {
  if [[ -n "${ORG:-}" ]]; then
    printf '%s' "$ORG"
    return 0
  fi

  local out
  out="$(fly orgs list 2>/dev/null)" || return 1
  printf '%s' "$out" | awk '$3 ~ /PERSONAL|ORGANIZATION/ { print $2; exit }'
}

# Get database cluster ID by name
platform_db_get_cluster_id() {
  local name="$1"
  local org_slug json result

  org_slug="$(platform_get_org_slug)" || return 1
  [[ -n "$org_slug" ]] || return 1

  json="$(fly mpg list -o "$org_slug" --json 2>/dev/null)" || return 1
  [[ "$json" == \[* ]] || return 1

  result="$(printf '%s' "$json" | jq -re --arg n "$name" '
    .[] | select((.name // "") | ascii_downcase == ($n | ascii_downcase)) | .id
  ' 2>/dev/null | head -n1)" || true

  printf '%s' "$result"
}

# Get database cluster status
platform_db_get_status() {
  local cluster_id="$1"
  fly mpg status "$cluster_id" --json 2>/dev/null
}

# Extract credential status from status JSON
platform_db_credential_status() {
  local json="$1"
  printf '%s' "$json" | jq -r '.credentials.status // "unknown"'
}

# Extract connection URL from status JSON
platform_db_get_url() {
  local json="$1"
  printf '%s' "$json" | jq -r '.credentials.pgbouncer_uri // empty'
}

# Create database cluster
platform_db_create() {
  local name="$1" region="$2"
  local org_slug

  org_slug="$(platform_get_org_slug)" || die "Cannot fetch organization list from Fly.io"
  [[ -n "$org_slug" ]] || die "Cannot determine organization — set ORG=<slug>"

  local plan="${DB_PLAN:-development}"
  local size="${DB_VOLUME_GB:-10}"

  run_quiet "Creating database" \
    fly mpg create -n "$name" -o "$org_slug" -r "$region" --plan "$plan" --volume-size "$size" \
    || die "Failed to create database cluster"
}

# Attach database to app
platform_db_attach() {
  local app="$1" cluster_id="$2"

  if run_quiet "Attaching database to agent" fly mpg attach "$cluster_id" -a "$app" --variable-name DATABASE_URL; then
    return 0
  else
    dim "  (may already be attached)"
    return 0
  fi
}

# Wait for database to be ready
platform_db_wait_ready() {
  local cluster_id="$1"
  local timeout="${2:-300}"
  local interval=5
  local elapsed=0
  local status json

  while (( elapsed < timeout )); do
    json="$(platform_db_get_status "$cluster_id" 2>/dev/null || true)"
    if [[ -n "$json" ]]; then
      status="$(platform_db_credential_status "$json")"
      [[ "$status" == "ready" ]] && return 0
    else
      status="unknown"
    fi

    spinner_start "Waiting for database to be ready (${elapsed}s elapsed, status: $status)"
    sleep "$interval"
    spinner_stop
    (( elapsed += interval ))
  done

  return 1
}

# Get DATABASE_URL, waiting for ready if needed
platform_db_get_database_url() {
  local cluster_id="$1"
  local timeout="${2:-300}"
  local json status url

  # Check current status
  json="$(platform_db_get_status "$cluster_id" 2>/dev/null)" || json=""
  if [[ -z "$json" ]]; then
    die "Could not fetch database status — check your network connection"
  fi

  status="$(platform_db_credential_status "$json")" || status="unknown"

  if [[ "$status" != "ready" ]]; then
    bold "Database is setting-up..."
    dim "  This typically takes 1-3 minutes. Safe to ctrl-c and re-run later."
    echo

    if ! platform_db_wait_ready "$cluster_id" "$timeout"; then
      warn "Timed out waiting for database (${timeout}s)"
      dim "  Re-run this script once the database is ready, or fetch URL manually:"
      dim "  https://fly.io/dashboard/$(platform_get_org_slug)/managed_postgres/$cluster_id"
      return 1
    fi

    # Re-fetch status after ready
    json="$(platform_db_get_status "$cluster_id" 2>/dev/null)" || json=""
    if [[ -z "$json" ]]; then
      die "Could not fetch database status after waiting"
    fi
  fi

  ok "Database is ready"

  url="$(platform_db_get_url "$json")" || url=""
  if [[ -z "$url" ]]; then
    die "Could not extract DATABASE_URL from backend."
  fi

  printf '%s' "$url"
}

# Platform: Deployment
# Execute the actual deployment
platform_deploy() {
  local app="$1"
  run_quiet "fly deploy" fly deploy -a "$app" \
    || die "Deploy failed — check the output above for details"
}

# =============================================================================
# High-Level Orchestration
# =============================================================================

setup_database() {
  local app="$1" name="$2" region="$3"
  local timeout="${DB_READY_TIMEOUT:-300}"
  local cluster_id url

  require_jq

  bold "Setting up database: $name"

  # Step 1: Ensure cluster exists
  cluster_id="$(platform_db_get_cluster_id "$name")"
  if [[ -n "$cluster_id" ]]; then
    ok "Database cluster exists: $name"
  else
    platform_db_create "$name" "$region"
    cluster_id="$(platform_db_get_cluster_id "$name")"
    [[ -n "$cluster_id" ]] || die "Failed to create database cluster"
  fi

  # Step 2: Attach to app
  platform_db_attach "$app" "$cluster_id"

  # Step 3: Wait for ready and get URL
  url="$(platform_db_get_database_url "$cluster_id" "$timeout")" || return 1

  # Step 4: Write to .env for local use
  write_dotenv DATABASE_URL "$url"

  echo
}

configure_secrets() {
  local app="$1"

  bold "Configuring agent..."
  secrets_add RUN_SOCKPUPPET "${RUN_SOCKPUPPET:-1}"
  secrets_add ACCOUNT_ID "${ACCOUNT_ID:-}"
  prompt_secret BROWSERBASE_API_KEY "${BROWSERBASE_API_KEY:-}"
  prompt_secret BROWSERBASE_CONTEXT_ID "${BROWSERBASE_CONTEXT_ID:-}"
  prompt_secret BROWSERBASE_PROJECT_ID "${BROWSERBASE_PROJECT_ID:-}"
  prompt_secret BROWSERBASE_EXTENSION_ID "${BROWSERBASE_EXTENSION_ID:-}"
  secrets_flush "$app"
  echo
}

# =============================================================================
# Main
# =============================================================================

main() {
  load_dotenv

  require_repo_root
  require_flyctl
  require_git

  local app region org
  app="${APP_NAME:-$(toml_get app fly.toml)}"
  region="${REGION:-$(toml_get primary_region fly.toml)}"
  region="${region:-iad}"
  org="${ORG:-}"

  [[ -n "$app" ]] || die "Cannot determine app name — set APP_NAME or check fly.toml"

  echo
  bold "═══════════════════════════════════════════════════════════"
  bold "  DEPLOY: $app"
  bold "═══════════════════════════════════════════════════════════"
  echo

  # -- Prerequisites ----------------------------------------------------------
  platform_ensure_auth
  platform_ensure_app "$app" "$region" "$org"
  check_should_deploy "$app"

  # -- Database ---------------------------------------------------------------
  if [[ "${SKIP_POSTGRES:-0}" != "1" ]]; then
    if [[ "${USE_FLY_POSTGRES:-0}" == "1" ]]; then
      local pg_name="${POSTGRES_NAME:-linkedin-automation-db}"
      setup_database "$app" "$pg_name" "$region"
    elif [[ -n "${DATABASE_URL:-}" ]]; then
      secrets_add DATABASE_URL "$DATABASE_URL"
      secrets_flush "$app"
      write_dotenv DATABASE_URL "$DATABASE_URL"
    fi
  else
    dim "Skipping database setup (SKIP_POSTGRES=1)"
  fi

  # -- Secrets ----------------------------------------------------------------
  if [[ "${SKIP_SECRETS:-0}" != "1" ]]; then
    configure_secrets "$app"
  else
    dim "Skipping secrets (SKIP_SECRETS=1)"
  fi

  # -- Deploy -----------------------------------------------------------------
  bold "Deploying..."
  platform_deploy "$app"

  record_deploy "$app"

  echo
  ok "Deploy complete!"
  dim "  View logs:   bernays logs"
  dim "  App status:  bernays status"
}

main "$@"
