// tests/lib/database.ts
// Database setup for E2E tests

export const cleanupTestData = async (url: string): Promise<void> => {
  const postgres = await import("postgres").then((m) => m.default);
  const sql = postgres(url, { max: 1 });
  try {
    await sql`DELETE FROM events WHERE scope LIKE 'e2e-%' OR scope = 'test'`;
    await sql`DELETE FROM browser_configs WHERE id LIKE 'e2e-%'`;
    await sql`DELETE FROM linkedin_accounts WHERE id LIKE 'e2e-%'`;
  } finally {
    await sql.end({ timeout: 5 });
  }
};

export const getEventCount = async (url: string): Promise<number> => {
  const postgres = await import("postgres").then((m) => m.default);
  const sql = postgres(url, { max: 1 });
  try {
    const [{ count }] = await sql`SELECT COUNT(*)::int as count FROM events`;
    return count;
  } finally {
    await sql.end({ timeout: 5 });
  }
};
