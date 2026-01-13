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

The `inbox`, `event-logs` and `configure-browsers` commands rely on a database, which is only available within the deployed context, so we access these commands through `ssh` on an idle test machine.

The `deploy` recipe orchestrates the full workflow: build extension → sync to Browserbase → deploy app → transition browser configs if extension changed.

## Folder Structure

```
scripts/
├── build-extension.ts      # Compile extension, generate manifest, create zip
├── sync-extension.ts       # Upload extension to Browserbase
├── transition-extension.ts # Update browser configs, delete old extension
├── deploy-application.ts   # Full deployment orchestration
├── view-inbox.tsx          # TUI: View platform inbox
├── view-event-log.tsx      # TUI: Query event log
├── manage-browser-configs.tsx  # TUI: CRUD for browser configs
└── lib/
    ├── log.ts              # Logging, colors, spinner
    ├── env.ts              # .env file I/O
    ├── shell.ts            # Command execution
    ├── tui.ts              # Terminal I/O (secrets, confirm)
    ├── filters.ts          # Predicates for event filtering
    ├── ink.tsx             # Ink components and hooks
    ├── hooks.tsx           # List navigation, pagination
    ├── keybindings.tsx     # Declarative keybinding system
    └── providers.tsx       # Platform provider pattern
```

**Two tiers:**
- CLI scripts (`.ts`) use `lib/log`, `lib/env`, `lib/shell`, `lib/tui`
- TUI scripts (`.tsx`) additionally use `lib/ink`, `lib/hooks`, `lib/keybindings`, `lib/providers`

## Key Architecture Points

**Provider Pattern in TUI**: `lib/providers.tsx` defines `PlatformProvider` interface for platform-specific views. Add a new platform by implementing `getInbox()`, `getConversation()`, and registering in `PROVIDERS`.

**Keybinding System**: `lib/keybindings.tsx` provides declarative keybindings via `createBindings()`. All TUI scripts use the same navigation patterns (↑/↓/j/k for nav, Enter to select, q to quit).

**Deploy Provider Pattern**: `deploy-application.ts` uses `ExecutionProvider` and `DatabaseProvider` interfaces. Current implementations: Fly.io execution, Fly Managed Postgres.

## Switching Providers

### Different Database (e.g., Neon, Supabase)

1. Provide `DATABASE_URL` in `.env` pointing to your database
2. Skip managed DB: `SKIP_DATABASE=1 just deploy`

The app uses standard Postgres via `postgres` npm package. Any Postgres-compatible database works.

### Different Execution Platform (e.g., Railway, Render)

1. Implement `ExecutionProvider` interface in `deploy-application.ts`:
   - `prepare()`, `ensureAuth()`, `instanceExists()`, `ensureInstance()`, `setSecrets()`, `deploy()`
2. Wire provider selection in `main()` based on env vars
3. Update Justfile backend recipes (`logs`, `status`, `ssh`)

### Adding a Platform Plugin

TUI scripts automatically pick up new platforms if:

1. Platform is registered in `lib/providers.tsx` `PROVIDERS` map
2. Platform implements the store interfaces (`EventStore`, `ConfigStore`)

For inbox views, implement `PlatformProvider` with platform-specific message/thread rendering.

## Environment Variables

| Variable | Used By | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | All DB scripts | Postgres connection |
| `BROWSERBASE_API_KEY` | sync, transition | Browserbase auth |
| `BROWSERBASE_EXTENSION_ID` | sync, transition, deploy | Current extension |
| `APP_NAME` | Justfile, deploy | Fly.io app name |
