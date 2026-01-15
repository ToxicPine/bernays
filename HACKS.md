# Hacks & Deviations

This file documents customizations, temporary workarounds, and architectural
deviations from standard patterns. Other agents (deploy-orchestrator,
test-architect, plugin-scaffold) check this file first to understand the current
state.

## Infrastructure

### 2026-01-12: Fly.io deployment with test machine pattern

- **Files**: `Justfile`, `scripts/deploy-application.ts`
- **Reason**: Production machines run the app; a separate "test-machine" is spun
  up for interactive scripts (event-logs, inbox, configure-browsers) to avoid
  impacting production
- **Status**: Active

## Plugins

<!-- Platform-specific deviations, custom behaviors, non-standard integrations -->

## Scripts

### 2026-01-12: Scripts depend on infrastructure implementations

- **Files**: `scripts/view-inbox.ts`, `scripts/view-event-log.ts`,
  `scripts/manage-browser-configs.ts`
- **Reason**: Scripts import directly from `plugins/*/` and
  `backend/server/src/store/` for platform adapters and store implementations
- **Impact**: When adding platforms or changing DB backends, update
  corresponding scripts
- **Status**: Active

## Architecture

<!-- Deviations from CLAUDE.md patterns, non-standard event flows -->

## Known Issues

<!-- Temporary workarounds, tech debt, things that need fixing -->
