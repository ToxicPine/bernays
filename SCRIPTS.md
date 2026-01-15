# Scripts

Operational tooling for deployment, extension management, and debugging.

## Justfile Dependency Chain

```
deploy
├── sync-extension.ts (syncs extension, updates .env)
│   └── build-extension.ts (compiles extension)
├── deploy-application.ts (deploys to Fly.io)
└── transition-extension.ts (if extension ID changed)

ext-sync
└── ext-build (dependency)

inbox / event-logs / configure-browsers
└── _start-test-machine
    └── _ensure-test-machine
```

The `inbox`, `event-logs` and `configure-browsers` commands rely on a database,
which is only available within the deployed context, so we access these commands
through `ssh` on an idle test machine.

The `deploy` recipe orchestrates the full workflow: build extension → sync to
Browserbase → deploy app → transition browser configs if extension changed.

## Folder Structure

```
scripts/
├── build-extension.ts      # Compile extension, generate manifest, create zip
├── sync-extension.ts       # Upload extension to Browserbase
├── transition-extension.ts # Update browser configs, delete old extension
├── deploy-application.ts   # Full deployment orchestration
├── load-accounts.ts        # CLI: Import/export accounts from TOML
├── view-inbox.tsx          # TUI: View platform inbox
├── view-event-log.tsx      # TUI: Query event log
├── manage-browser-configs.tsx  # TUI: CRUD for browser configs
└── lib/
    ├── log.ts              # Logging, colors, spinner
    ├── env.ts              # .env file I/O
    ├── shell.ts            # Command execution
    ├── tui.ts              # Terminal I/O (secrets, confirm)
    ├── filters.ts          # Predicates for event filtering
    ├── account-schemas.ts  # Zod schemas for TOML account validation
    ├── ink.tsx             # Ink components and hooks
    ├── hooks.tsx           # List navigation, pagination
    ├── keybindings.tsx     # Declarative keybinding system
    └── providers.tsx       # Platform provider pattern
```

**Two tiers:**

- CLI scripts (`.ts`) use `lib/log`, `lib/env`, `lib/shell`, `lib/tui`
- TUI scripts (`.tsx`) additionally use `lib/ink`, `lib/hooks`,
  `lib/keybindings`, `lib/providers`

## Account Management

The `load-accounts.ts` script manages account bindings via TOML files:

```bash
# Validate TOML structure
just accounts validate linkedin accounts/linkedin.toml

# Import accounts to database
just accounts import linkedin accounts/linkedin.toml

# Export accounts from database
just accounts export linkedin > accounts/linkedin-backup.toml
```

**TOML Structure:**

```toml
# accounts/linkedin.toml
[[accounts]]
id = "alice-linkedin-member-id"

  [[accounts.browserBindings]]
  configId = "browser_alice"

  [accounts.browserBindings.metadata]
  deviceType = "desktop"
```

Accounts contain only `id` (persistent platform identifier) and
`browserBindings` (which browsers are logged in). All dynamic platform state
(display names, follower counts, rate limits, etc.) is derived from events, not
stored in account definitions.

Example files in `accounts/` directory.

## Key Architecture Points

**Provider Pattern in TUI**: `lib/providers.tsx` defines `PlatformProvider`
interface for platform-specific views. Add a new platform by implementing
`getInbox()`, `getConversation()`, and registering in `PROVIDERS`.

**Keybinding System**: `lib/keybindings.tsx` provides declarative keybindings
via `createBindings()`. All TUI scripts use the same navigation patterns
(↑/↓/j/k for nav, Enter to select, q to quit).

**Deploy Provider Pattern**: `deploy-application.ts` uses `ExecutionProvider`
and `DatabaseProvider` interfaces. Current implementations: Fly.io execution,
Fly Managed Postgres.

**Extension Transition**: `transition-extension.ts` uses the
`transitionExtension` utility from `backend/server/src/store/`. This utility
composes `ConfigStore` and `ExtensionStore` services, making it
implementation-agnostic. When the script runs:

1. `ConfigStore.replaceExtensionId()` updates browser configs (Postgres uses
   `array_replace`, in-memory uses list+upsert)
2. `ExtensionStore.remove()` deletes the old extension (Browserbase uses HTTP
   DELETE, local would delete from filesystem)

## Switching Providers

When switching store implementations (database, browser backend), keep these
scripts in mind:

| Script                       | Service Dependencies               | Impact of Change                                                                   |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `transition-extension.ts`    | `ConfigStore`, `ExtensionStore`    | Must implement `replaceExtensionId()` on ConfigStore, `remove()` on ExtensionStore |
| `manage-browser-configs.tsx` | `ConfigStore`                      | CRUD operations must work with new implementation                                  |
| `view-inbox.tsx`             | `EventStore`, platform projections | Event queries must support `byScope` filtering                                     |
| `view-event-log.tsx`         | `EventStore`                       | All query types (since, byScope, byCorrelation) must work                          |

The scripts use service interfaces, not direct database access. As long as new
implementations satisfy the interfaces, scripts work unchanged. However, verify:

- **Postgres-specific SQL** (like `array_replace`) has equivalent in new
  implementation
- **API-specific calls** (like Browserbase DELETE) are implemented for the new
  backend
- **Effect error types** match expectations (some methods use `Effect.orDie` for
  simplicity)

### Different Database (e.g., Neon, Supabase)

1. Provide `DATABASE_URL` in `.env` pointing to your database
2. Skip managed DB: `SKIP_DATABASE=1 just deploy`

The app uses standard Postgres via `postgres` npm package. Any
Postgres-compatible database works.

When switching to non-Postgres (e.g., SQLite, DynamoDB), you'll need to
implement:

- `createSqliteConfigStore()` or equivalent with `replaceExtensionId()` method
- `createSqliteEventStore()` with all query types

### Different Execution Platform (e.g., Railway, Render)

1. Implement `ExecutionProvider` interface in `deploy-application.ts`:
   - `prepare()`, `ensureAuth()`, `instanceExists()`, `ensureInstance()`,
     `setSecrets()`, `deploy()`
2. Wire provider selection in `main()` based on env vars
3. Update Justfile backend recipes (`logs`, `status`, `ssh`)

### Different Browser Backend (e.g., Local Playwright)

The browser backend bundles `BrowserPool` + `ExtensionStore` together. When
switching from Browserbase to local Playwright:

1. Implement `makeLocalBackend()` returning `BrowserBackend`:
   - `pool`: Local browser lifecycle via Playwright
   - `extensions`: Filesystem-based extension store
2. Ensure `ExtensionStoreService.remove()` cleans up appropriately (delete file,
   no-op, etc.)
3. Update `scripts/sync-extension.ts` to handle local extension installation
4. Update `scripts/transition-extension.ts` layer composition (or script detects
   backend from env)

The `transitionExtension` utility works with any backend—it just calls
`ConfigStore.replaceExtensionId()` and `ExtensionStore.remove()`.

### Adding a Platform Plugin

TUI scripts automatically pick up new platforms if:

1. Platform is registered in `lib/providers.tsx` `PROVIDERS` map
2. Platform implements the store interfaces (`EventStore`, `ConfigStore`)

For inbox views, implement `PlatformProvider` with platform-specific
message/thread rendering.

## Environment Variables

| Variable                   | Used By                  | Purpose             |
| -------------------------- | ------------------------ | ------------------- |
| `DATABASE_URL`             | All DB scripts           | Postgres connection |
| `BROWSERBASE_API_KEY`      | sync, transition         | Browserbase auth    |
| `BROWSERBASE_EXTENSION_ID` | sync, transition, deploy | Current extension   |
| `APP_NAME`                 | Justfile, deploy         | Fly.io app name     |
