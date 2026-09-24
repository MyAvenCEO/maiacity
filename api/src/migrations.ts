// Migrations are an append-only list. Each entry runs once, inside a
// transaction, and its id is recorded — so a redeploy is a no-op and a new
// entry is the only way to change the shape of the data.
import { sql } from "./db";

type Migration = { id: string; sql: string };

const MIGRATIONS: Migration[] = [
  {
    id: "0001-founders",
    sql: `
      CREATE TABLE founders (
        id      TEXT PRIMARY KEY,
        -- the founder's place in the line. Day 01 counts in Fibonacci steps;
        -- this is the raw number underneath that.
        number  BIGINT GENERATED ALWAYS AS IDENTITY,
        name    TEXT NOT NULL,
        created TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- A passkey is the whole account. No password, no email, nothing to leak.
      CREATE TABLE passkeys (
        id         TEXT PRIMARY KEY,
        founder_id TEXT NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
        public_key TEXT NOT NULL,
        counter    BIGINT NOT NULL DEFAULT 0,
        transports TEXT,
        created    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_passkeys_founder ON passkeys(founder_id);

      -- Things the server generates for itself and must not forget across a
      -- restart — currently only the key that signs session cookies.
      CREATE TABLE secrets (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

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
