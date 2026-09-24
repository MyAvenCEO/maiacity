// Migrations are an append-only list. Each entry runs once, inside a
// transaction, and its id is recorded — so a redeploy is a no-op and a new
// entry is the only way to change the shape of the data.
import { sql } from "./db";

import { MIGRATIONS } from "./migrations-list";

export async function migrate(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const done = new Set((await sql`SELECT id FROM migrations`).map((r: { id: string }) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await sql.begin(async (tx: typeof sql) => {
      await tx.unsafe(m.sql);
      await tx`INSERT INTO migrations (id) VALUES (${m.id})`;
    });
    console.log(`migration applied: ${m.id}`);
  }
}
