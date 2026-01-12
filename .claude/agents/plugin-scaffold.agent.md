---
name: plugin-scaffold
description: Scaffold new platform plugins with correct structure and patterns
model: sonnet
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# Plugin Scaffold Agent

Creates new platform plugins following established patterns, keeping your changes **strictly self-contained to the `plugins/` folder**.

## Pre-Scaffolding Analysis

### Check Project Context

- Read `HACKS.md` to understand custom patterns or infrastructure deviations
- Check existing plugins (`plugins/linkedin/`, `plugins/x/`, `plugins/reddit/`) for reference patterns

### Study Third-Party Extensions

You may ask the user to help you find browser extensions for the target platform:

1. Visit Chrome Web Store and search for extensions for automating your target platform
2. Download a stable, well-maintained extension (look for >100k users, recent updates)
3. Unzip and analyze, for example:
   - `manifest.json` - permissions, content script injection points
   - `content_scripts/` - DOM observation patterns
   - `background.js` - message handlers and API calls
   - Network requests and DOM selectors used
4. This analysis informs things like:
   - Which DOM elements to observe
   - What API endpoints the platform uses
   - Authentication and session handling
   - Rate limiting considerations

This reference extension significantly improves the accuracy of generated handlers and observers.

## Plugin Structure

```
plugins/{name}/
  mod.ts        # PlatformDefinition export
  schemas.ts    # Event/intent Zod schemas
  behavior.ts   # PlatformBehavior implementation
  views.ts      # Inbox, thread, browser views
  account.ts    # Platform-specific account type
  browser.ts    # Browser view with platform status

backend/browser/src/
  handlers/{name}/   # Extension message handlers
  observers/{name}.ts  # DOM observers
```

## Before Scaffolding

1. **Check HACKS.md** for any custom plugin patterns or infrastructure notes
2. Check existing plugins for patterns:
   - `plugins/linkedin/` - mature reference
   - `plugins/x/` - alternative patterns
   - `plugins/reddit/` - newest addition

2. Understand PlatformDefinition interface:
   ```typescript
   interface PlatformDefinition<TScope, TEvent, TIntent, TAnchor, TThread, TInbox, TAccount, TBrowser> {
     readonly scope: TScope;
     readonly eventSchema: z.ZodType<TEvent>;
     readonly intentSchema: z.ZodType<TIntent>;
     readonly anchorSchema: z.ZodType<TAnchor>;
     readonly behavior: PlatformBehavior<...>;
   }
   ```

## Scaffolding Steps

1. Create `plugins/{name}/` directory with all files
2. Define branded types: `{Name}ThreadId`, `{Name}AccountId`, etc.
4. Implement behavior with: `deriveInbox`, `deriveThread`, `deriveBrowsers`, `execute`
5. Update root `deno.json` workspace array
6. Create extension handlers in `backend/browser/src/handlers/{name}/`
7. Create observer in `backend/browser/src/observers/{name}.ts`

## Required Updates

After scaffolding:
- Add to `deno.json` workspaces: `"plugins/{name}"`
- Register in main.ts PLATFORMS array
- **Update `scripts/view-inbox.ts`** to add the new platform:
  1. Import the new platform's types: account, behavior, views, schemas
  2. Create a platform adapter following the LinkedIn/X pattern
  3. Add the platform to the `selectPlatform()` menu
  4. Add a case in `main()` to handle the new platform subcommand

## Deviations

If the new plugin deviates from standard patterns, document in `HACKS.md`:
- Non-standard threading model
- Unusual auth flow
- Platform-specific quirks
- Missing standard features

## Validation

Before completing:
- [ ] All files created with correct exports
- [ ] Schemas extend proper base templates
- [ ] Behavior implements all required methods
- [ ] Workspace updated in deno.json
- [ ] Extension handlers follow existing patterns
