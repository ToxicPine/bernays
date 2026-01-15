// =============================================================================
// Platform Extensions — Barrel export for platform-specific integrations
// =============================================================================
//
// This module provides the extension points for adding new platforms.
// When adding a new platform (e.g., Reddit, Instagram), update:
//
// 1. stores.ts — Add the store factory for account loading
//    Used by: load-accounts.ts
//
// 2. providers.tsx — Add the TUI provider for inbox viewing
//    Used by: view-inbox.tsx
//
// =============================================================================

// Account store factories for load-accounts CLI
export {
  type AccountsTomlFile,
  AccountsTomlFileSchema,
  type AccountToml,
  // Schema and types
  AccountTomlSchema,
  BrowserBindingTomlSchema,
  fromAccount,
  fromLinkedInAccount,
  fromXAccount,
  getStore,
  isSupportedPlatform,
  // Legacy exports (for backwards compatibility)
  LinkedInTomlFileSchema,
  // Registry
  platformStores,
  type SupportedPlatform,
  supportedPlatforms,
  // Converters
  toAccount,
  toLinkedInAccount,
  toXAccount,
  XTomlFileSchema,
} from "./stores.ts";

// TUI providers for view-inbox
export {
  type AnyPlatformProvider,
  // Base types
  type BaseAccount,
  type BaseInbox,
  type BaseThread,
  type BaseThreadSummary,
  createProviderRegistry,
  getProvider,
  // Rendering helpers
  InboxHeaderStats,
  // Platform providers
  linkedInProvider,
  type PlatformKey,
  platformOptions,
  // Provider interface
  type PlatformProvider,
  // Registry
  platformProviders,
  type ProviderRegistry,
  ThreadHeaderStats,
  xProvider,
} from "./providers.tsx";
