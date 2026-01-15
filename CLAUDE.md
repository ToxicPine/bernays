# bernays

## Document Purpose

This document provides **coding standards and conventions** for bernays. For
architectural decisions, type system design, and implementation patterns, see
`ARCHITECTURE.md`.

**This document covers**:

1. Coding style and conventions
2. Script conventions
3. Quick reference guides

---

## Coding Style & Conventions

### TypeScript Path Alias

Use the `$/` path alias for imports within the server package:

```typescript
// Good
import { Result } from "$/core/mod.ts";
import type { StorableEvent } from "$/store/mod.ts";
import { BrowserPool } from "$/connectivity/mod.ts";

// Bad - relative paths are harder to refactor
import { Result } from "../../core/result.ts";
```

The alias is configured in `deno.json` and resolves to `server/src/`.

### Functional Style

- Prefer pure functions, immutable data structures, composition
- Use discriminated unions and type guards over class hierarchies
- Prefer interfaces + functions or small modules over deep class inheritance
- No `any`; use `unknown` and narrow with type guards

### Result Type for Errors

Use `Result<T, E>` for operations that can fail predictably:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Good - explicit error handling
const result = await store.append(events);
if (!result.ok) {
  console.error("Append failed:", result.error);
  return;
}

// Avoid throwing for expected failures
```

### Effect-TS for Services

Services use Effect-TS for dependency injection and composition:

```typescript
import { Context, Effect, Layer } from "effect";

// Define service interface
interface MyService {
  readonly doThing: () => Effect.Effect<string, MyError>;
}

// Create service tag
class MyServiceTag
  extends Context.Tag("my/Service")<MyServiceTag, MyService>() {}

// Implement as layer
const MyServiceLive = Layer.succeed(MyServiceTag, {
  doThing: () => Effect.succeed("done"),
});
```

**Key patterns**:

- Services are interfaces, not classes
- `Context.Tag` creates the dependency injection token
- `Layer` provides implementations
- Use `Effect.gen(function* () { ... })` for sequential operations
- Use `yield*` to access services: `const svc = yield* MyServiceTag`

### Zod for Validation

Use Zod schemas at system boundaries (bridge messages, storage, external input).
Co-locate schemas with the types they validate:

```typescript
import { z } from "@zod/zod";

export const MyEventSchema = z.object({
  scope: z.literal("myplatform"),
  type: z.literal("MyEvent"),
  eventId: z.string().transform(EventId),
  timestamp: z.string(),
  // ... event-specific fields
});

export type MyEvent = z.infer<typeof MyEventSchema>;
```

**Schema inheritance**: Use `.extend()` to build schema hierarchies:

```typescript
const BaseSchema = z.object({ id: z.string() });
const ExtendedSchema = BaseSchema.extend({ extra: z.number() });
```

### Branded Types

Use branded types to prevent mixing up IDs and stringly-typed values. See
`ARCHITECTURE.md` for the full list and rationale.

```typescript
type Brand<T, B extends string> = T & { readonly __brand: B };

// Simple branded type
type ThreadId = Brand<string, "ThreadId">;
const ThreadId = (value: string): ThreadId => value as ThreadId;

// Scoped branded type (ParticipantId carries platform scope)
type ParticipantId<TScope extends string = string> = string & {
  readonly __brand: "ParticipantId";
  readonly __scope: TScope;
};
const ParticipantId = <TScope extends string>(
  scope: TScope,
  platformId: string,
): ParticipantId<TScope> => `${scope}:${platformId}` as ParticipantId<TScope>;
```

**Core branded types**:

| Type                    | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `Scope`                 | Platform identifier (extensible)               |
| `ParticipantId<TScope>` | Any user on a platform, scoped for type safety |
| `ThreadId`              | Conversation identifier                        |
| `EventId`               | Deduplication key                              |
| `CorrelationId`         | Tracing across events                          |
| `CanonicalId`           | Message identity                               |
| `BrowserConfigId`       | Browser session identifier                     |
| `ExtensionId`           | Browser extension identifier                   |
| `ExecuteErrorCode`      | Effect error codes (extensible)                |

Use Zod's `.transform()` to cast strings to branded types at validation
boundaries. For `ParticipantId`, use the `participantIdSchema(scope)` factory to
validate the prefix matches the expected scope.

### Naming Conventions

| Category | Pattern                     | Examples                                            |
| -------- | --------------------------- | --------------------------------------------------- |
| Events   | `{What}{Verb}` + context    | `AuthObserved`, `MessageSent`, `RateLimitObserved`  |
| Schemas  | `{TypeName}Schema`          | `LinkedInEventSchema`, `SendMessageSchema`          |
| Services | `{Domain}Service`           | `BrowserPoolService`, `JournalService`              |
| Tags     | `{Domain}` (no suffix)      | `BrowserPool`, `Journal`, `Platform`                |
| Views    | `{What}` or `{Scope}{What}` | `LinkedInBrowser`, `LinkedInInbox`                  |
| Actions  | verb phrase                 | `sendMessage`, `syncInbox`, `sendConnectionRequest` |

### Module Organization

Each module has a `mod.ts` barrel that exports the public API:

```typescript
// connectivity/mod.ts
export { BrowserPool, type BrowserPoolService } from "./pool.ts";
export type { BridgeError, BridgeEvent } from "./bridge.ts";
```

Import from barrels, not internal files:

```typescript
// Good
import { BrowserPool } from "$/connectivity/mod.ts";

// Bad
import { BrowserPool } from "$/connectivity/pool.ts";
```

---

## Script Conventions

Scripts in `scripts/` are first-class citizens with consistent patterns. Two
types exist: CLI scripts (`.ts`) for automation and TUI scripts (`.tsx`) for
interactive terminal UIs.

### File Structure

Every script follows this layout:

```typescript
#!/usr/bin/env -S deno run -A
// =============================================================================
// my-script.ts — Short Description of Script (Title Case)
// =============================================================================
//
// Usage:
//   deno run -A scripts/my-script.ts [options]
//
// Options:
//   --option       Description of Option (Title Case)
//   --help, -h     Show This Help
//
// Examples:
//   deno run -A scripts/my-script.ts --option value
//
// =============================================================================

import { parseArgs } from "@std/cli";
import { createLogger, die } from "./lib/cli/mod.ts";

// =============================================================================
// Types
// =============================================================================

interface MyConfig {
  readonly silent: boolean;
  readonly optionValue: string;
}

// =============================================================================
// Main
// =============================================================================

export async function myScript(config: MyConfig): Promise<void> {
  const log = createLogger(config.silent);
  // ...
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["option"],
    boolean: ["silent", "help"],
    alias: { s: "silent", h: "help" },
  });

  if (args.help) {
    console.log(`Usage: ...`);
    Deno.exit(0);
  }

  if (!args.option) die("--option Is Required");

  await myScript({ silent: args.silent ?? false, optionValue: args.option });
}
```

**Key elements**:

- Shebang with `deno run -A` (or specific permissions)
- Header: `filename.ts — Short Description` (em-dash `—`, not hyphen)
- Separator: `//` + 77 `=` characters (80 chars total)
- Section names in Title Case: `Types`, `Config`, `Main`, `CLI`
- Config interface with `readonly` properties
- Exported main function (testable without CLI)
- `import.meta.main` guard for CLI entry

### Capitalization Conventions

All user-facing messages use **Title Case**:

| Context                    | Case       | Examples                                    |
| -------------------------- | ---------- | ------------------------------------------- |
| Section separators         | Title Case | `// Types`, `// Main`, `// Browserbase API` |
| Header description         | Title Case | `sync.ts — Sync Extension to Browserbase`   |
| `log.section()`            | Title Case | `"Finding Latest Extension Zip"`            |
| `log.info()` / `log.dim()` | Title Case | `"Uploading New Extension..."`              |
| `log.ok()` / `log.warn()`  | Title Case | `"Build Complete"`, `"Missing Config"`      |
| `die()` / `statusOk()`     | Title Case | `"Database Not Ready"`                      |
| Help text sections         | ALL CAPS   | `USAGE`, `OPTIONS`, `COMMANDS`, `EXAMPLES`  |
| Help text descriptions     | Title Case | `"Old Extension ID to Replace (required)"`  |

**Help text format**:

```typescript
const help = `
my-script — Short Description

USAGE
  bernays my-script [OPTIONS]

OPTIONS
  --from <id>     Old ID to Replace (required)
  --to <id>       New ID to Use (required)
  --silent, -s    Suppress Non-Error Output
  --dry-run       Show What Would Be Done
  --help, -h      Show This Help

EXAMPLES
  bernays my-script --from abc --to xyz
`.trim();
```

### CLI Argument Handling

Always use `@std/cli`'s `parseArgs`:

```typescript
import { parseArgs } from "@std/cli";

const args = parseArgs(Deno.args, {
  string: ["db-url", "from", "to"], // Named args with values
  boolean: ["silent", "dry-run", "help"], // Boolean flags
  alias: { s: "silent", h: "help" }, // Short aliases
});
```

**Validation pattern**:

```typescript
if (args.help) {
  console.log(buildHelp());
  Deno.exit(0);
}

if (!args.from) die("--from <id> is required");
if (!args.to) die("--to <id> is required");
```

### Shared Utilities

Scripts use shared utilities from `scripts/lib/`:

| Module                    | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `cli/log.ts`              | `createLogger()`, `die()`, `statusOk/Warn/Err()`, `Spinner` |
| `cli/env.ts`              | `loadDotenv()`, `writeDotenv()`, `requireEnv()`, `getEnv()` |
| `cli/shell.ts`            | `runCommand()`, `runWithSpinner()`, `commandExists()`       |
| `tui/ink.tsx`             | React/Ink components for TUI scripts                        |
| `tui/hooks.tsx`           | `useListNavigation()`, `usePagination()`                    |
| `tui/keybindings.tsx`     | `createBindings()`, `useKeyHandler()`                       |
| `platforms/stores.ts`     | Platform account store registry                             |
| `platforms/providers.tsx` | Platform TUI provider registry                              |

Import from barrel files:

```typescript
import { createLogger, die, loadDotenv, runCommand } from "./lib/cli/mod.ts";
import { createBindings, useListNavigation } from "./lib/tui/mod.ts";
import { getStoreFactory } from "./lib/platforms/mod.ts";
```

### Logging Conventions

All messages use **Title Case**:

```typescript
const log = createLogger(config.silent);

log.section("Building Extension"); // Magenta ==> header
log.info("Processing Files..."); // Cyan [INFO]
log.ok("Build Complete"); // Green [OK]
log.warn("Missing Optional Config"); // Yellow [WARN]
log.error("Build Failed"); // Red [ERR] to stderr
log.dim("  Extra Detail Here"); // Dimmed text

// Final status (deploy-style output)
statusOk("Extension Deployed"); // Green ✓
statusWarn("Partial Success"); // Yellow ⚠
statusErr("Deployment Failed"); // Red ✗
die("Database URL Required"); // Red ✗ + exit(1)
```

### Error Handling

Use `die()` for fatal errors—it logs (Title Case) and exits with code 1:

```typescript
import { die } from "./lib/cli/mod.ts";

// Required argument missing (Title Case)
if (!args.configId) die("--config-id Is Required");

// File not found (Title Case)
try {
  content = await Deno.readTextFile(filepath);
} catch (err) {
  if (err instanceof Deno.errors.NotFound) {
    die(`File Not Found: ${filepath}`);
  }
  throw err;
}

// Zod validation failure
const result = MySchema.safeParse(data);
if (!result.success) {
  log.error("Validation Failed:");
  for (const issue of result.error.issues) {
    log.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  Deno.exit(1);
}
```

### Dry-Run Support

Scripts that modify state should support `--dry-run`:

```typescript
if (config.dryRun) {
  log.warn("DRY RUN - No changes will be made");
  log.info(`Would update ${count} records`);
  return;
}
```

### Script Naming

| Category      | Pattern               | Examples                                       |
| ------------- | --------------------- | ---------------------------------------------- |
| Script files  | `kebab-case.ts`       | `build-extension.ts`, `load-accounts.ts`       |
| TUI scripts   | `kebab-case.tsx`      | `view-inbox.tsx`, `manage-browser-configs.tsx` |
| Config types  | `PascalCase + Config` | `BuildConfig`, `SyncConfig`                    |
| Main function | verb or noun          | `build()`, `sync()`, `transition()`            |

---

## Quick Reference

### Creating a New Platform Plugin

1. Create `plugins/{platform}/` directory
2. Define schemas in `schemas.ts` (events extending templates)
3. Implement derivation in `behavior.ts` (`deriveInbox`, `deriveThread`,
   `deriveBrowsers`, `deriveContact`)
4. Implement actions in `actions.ts` (curried `PlatformMethod` functions)
5. Define contact type in `contact.ts` (extends `BaseContact`)
6. Create account store in `account.ts` (uses `BaseAccount`)
7. Export platform definition in `mod.ts`
8. Register in `main.ts` PLATFORMS array

### Adding a New Event Type

1. Create or extend template in `events/templates/`
2. Extend in platform's `schemas.ts` with scope and type literals
3. Add to platform's discriminated union schema
4. Update behavior derivation functions as needed

### Adding a New Platform Action

1. Define result type for the action
2. Define error type (using branded `ExecuteErrorCode`)
3. Add to platform's actions interface as
   `PlatformMethod<TArgs, TResult, TError>`
4. Implement in `actions.ts` following curried pattern:
   `(options?) => (...args) => Effect`
5. Wire into `makeActions` in platform definition

### Creating a New Script

1. Create file in `scripts/` with kebab-case name (`.ts` for CLI, `.tsx` for
   TUI)
2. Add shebang and header comment block with usage, options, examples
3. Define `Config` interface with `readonly` properties
4. Import from `./lib/cli/mod.ts` or `./lib/tui/mod.ts`
5. Export main function that accepts config (for testability)
6. Add `import.meta.main` guard with `parseArgs()` handling
7. Use `createLogger()` for output, `die()` for fatal errors
8. Support `--help` and `--silent` flags; add `--dry-run` if modifying state

---

## Agents

Specialized agents in `.claude/agents/` handle cross-cutting concerns:

| Agent                 | Use When                                        |
| --------------------- | ----------------------------------------------- |
| `plugin-scaffold`     | Creating new platform plugins                   |
| `deploy-orchestrator` | Changing deployment backends, updating Justfile |
| `hack-tracker`        | Documenting deviations in HACKS.md              |
| `test-architect`      | Writing tests for store, backend, projections   |
| `codebase-auditor`    | Checking layer boundaries, import discipline    |
| `campaign-planner`    | Planning sockpuppet campaigns                   |
| `proxy-setup`         | Configuring Tailscale proxy infrastructure      |

When changing infrastructure (DB, browser backend), check `deploy-orchestrator`
and `hack-tracker` agents for script dependencies that may need updates.
