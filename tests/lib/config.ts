// tests/lib/config.ts
// E2E test configuration

import { z } from "@zod/zod";

export const E2EConfigSchema = z.object({
  browserbaseApiKey: z.string().min(1),
  browserbaseProjectId: z.string().min(1),
  browserbaseContextId: z.string().min(1),
  databaseUrl: z.string().min(1),
  flyAppName: z.string().default("virtual-bernays"),
  testTimeout: z.number().default(120_000),
  browserTimeout: z.number().default(60_000),
});

export const LinkedInTestConfigSchema = z.object({
  linkedinTestEmail: z.email(),
  linkedinTestPassword: z.string().min(1),
  linkedinTestThreadId: z.string().min(1),
});

export type LinkedInTestConfig = z.infer<typeof LinkedInTestConfigSchema>;

export const LocalTestConfigSchema = z.object({
  headless: z.boolean().default(false),
  userDataDir: z.string().optional(),
});

export type LocalTestConfig = z.infer<typeof LocalTestConfigSchema>;

export type E2EConfig = z.infer<typeof E2EConfigSchema>;

const loadEnvFile = async (path: string): Promise<void> => {
  try {
    const content = await Deno.readTextFile(path);
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && !Deno.env.get(key)) {
        Deno.env.set(key, value);
      }
    }
  } catch {
    // .env doesn't exist
  }
};

// Map config fields to their env var names
const ENV_VAR_NAMES: Record<string, string> = {
  browserbaseApiKey: "BROWSERBASE_API_KEY",
  browserbaseProjectId: "BROWSERBASE_PROJECT_ID",
  browserbaseContextId: "BROWSERBASE_CONTEXT_ID",
  databaseUrl: "DATABASE_URL",
  flyAppName: "FLY_APP_NAME",
  testTimeout: "E2E_TEST_TIMEOUT",
  browserTimeout: "E2E_BROWSER_TIMEOUT",
  linkedinTestEmail: "LINKEDIN_TEST_EMAIL",
  linkedinTestPassword: "LINKEDIN_TEST_PASSWORD",
  linkedinTestThreadId: "LINKEDIN_TEST_THREAD_ID",
  headless: "HEADLESS",
  userDataDir: "USER_DATA_DIR",
};

const loadEnvAndParse = async () => {
  const projectRoot = new URL("../..", import.meta.url).pathname;
  await loadEnvFile(`${projectRoot}/.env`);
  await loadEnvFile(`${projectRoot}/.env.test`);

  return E2EConfigSchema.safeParse({
    browserbaseApiKey: Deno.env.get("BROWSERBASE_API_KEY") ?? "",
    browserbaseProjectId: Deno.env.get("BROWSERBASE_PROJECT_ID") ?? "",
    browserbaseContextId: Deno.env.get("BROWSERBASE_CONTEXT_ID") ?? "",
    databaseUrl: Deno.env.get("DATABASE_URL") ?? "",
    flyAppName: Deno.env.get("FLY_APP_NAME") ?? "virtual-bernays",
    testTimeout: parseInt(Deno.env.get("E2E_TEST_TIMEOUT") ?? "120000", 10),
    browserTimeout: parseInt(
      Deno.env.get("E2E_BROWSER_TIMEOUT") ?? "60000",
      10,
    ),
  });
};

/**
 * Load config, throwing if required values are missing.
 */
export const loadConfig = async (): Promise<E2EConfig> => {
  const result = await loadEnvAndParse();
  if (result.success) {
    return result.data;
  }

  // Check which required env vars are missing
  const requiredVars = [
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "BROWSERBASE_CONTEXT_ID",
    "DATABASE_URL",
  ];

  const missing = requiredVars.filter((v) => !Deno.env.get(v));

  if (missing.length > 0) {
    throw new Error(
      `E2E config missing required environment variables:\n` +
        missing.map((v) => `  - ${v}`).join("\n") +
        `\n\nSet these in your environment or in .env/.env.test files.`,
    );
  }

  // If all required vars are set but validation still failed, show Zod errors
  const errors = result.error.issues
    .map((i) => {
      const field = i.path[0] as string;
      const envVar = ENV_VAR_NAMES[field] ?? field;
      return `  - ${envVar}: ${i.message}`;
    })
    .join("\n");

  throw new Error(`E2E config validation failed:\n${errors}`);
};

/**
 * Load LinkedIn test config, throwing if required values are missing.
 */
export const loadLinkedInTestConfig = async (): Promise<LinkedInTestConfig> => {
  const projectRoot = new URL("../..", import.meta.url).pathname;
  await loadEnvFile(`${projectRoot}/.env`);
  await loadEnvFile(`${projectRoot}/.env.test`);

  const result = LinkedInTestConfigSchema.safeParse({
    linkedinTestEmail: Deno.env.get("LINKEDIN_TEST_EMAIL") ?? "",
    linkedinTestPassword: Deno.env.get("LINKEDIN_TEST_PASSWORD") ?? "",
    linkedinTestThreadId: Deno.env.get("LINKEDIN_TEST_THREAD_ID") ?? "",
  });

  if (result.success) {
    return result.data;
  }

  const errors = result.error.issues
    .map((i) => {
      const field = i.path[0] as string;
      const envVar = ENV_VAR_NAMES[field] ?? field;
      return `  - ${envVar}: ${i.message}`;
    })
    .join("\n");

  throw new Error(`LinkedIn Test Config Validation Error:\n${errors}`);
};

/**
 * Load local test config, throwing if required values are missing.
 */
export const loadLocalTestConfig = async (): Promise<LocalTestConfig> => {
  const projectRoot = new URL("../..", import.meta.url).pathname;
  await loadEnvFile(`${projectRoot}/.env`);
  await loadEnvFile(`${projectRoot}/.env.test`);

  const result = LocalTestConfigSchema.safeParse({
    headless: Deno.env.get("HEADLESS") === "true",
    userDataDir: Deno.env.get("USER_DATA_DIR") || undefined,
  });

  if (result.success) {
    return result.data;
  }

  const errors = result.error.issues
    .map((i) => {
      const field = i.path[0] as string;
      const envVar = ENV_VAR_NAMES[field] ?? field;
      return `  - ${envVar}: ${i.message}`;
    })
    .join("\n");

  throw new Error(`Local Test Config Validation Error:\n${errors}`);
};

export const validateDatabase = async (url: string): Promise<void> => {
  const postgres = await import("postgres").then((m) => m.default);
  const sql = postgres(url, { max: 1 });
  try {
    await sql`SELECT 1`;
  } finally {
    await sql.end({ timeout: 5 });
  }
};

export const validateBrowserbase = async (
  apiKey: string,
  projectId: string,
): Promise<void> => {
  const res = await fetch(
    `https://www.browserbase.com/v1/projects/${projectId}`,
    { headers: { "X-BB-API-Key": apiKey } },
  );
  if (!res.ok) {
    throw new Error(`Browserbase API error: ${res.status}`);
  }
};
