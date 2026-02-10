// tests/lib/mod.ts

export {
  type E2EConfig,
  E2EConfigSchema,
  type LinkedInTestConfig,
  LinkedInTestConfigSchema,
  loadConfig,
  loadLinkedInTestConfig,
  type LocalTestConfig,
  LocalTestConfigSchema,
  loadLocalTestConfig,
  validateBrowserbase,
  validateDatabase,
} from "./config.ts";

export { cleanupTestData, getEventCount } from "./database.ts";

export {
  type BridgeMessage,
  createSession,
  setupBridge,
  type TestSession,
  waitForExtension,
} from "./browser.ts";
