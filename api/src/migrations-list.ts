// The schema's history, as data. Kept apart from the runner so the tests can
// build the same database in PGlite without a live Postgres.
export type Migration = { id: string; sql: string };

export const MIGRATIONS: Migration[] = [
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
  {
    // avenCITY Sandbox 2: every founder is a citizen of the game — they mint their own
    // hearts and invest them. The ledger's own tables are created by the ledger.
    id: "0002-avencity",
    sql: `
      ALTER TABLE founders ADD COLUMN role          TEXT NOT NULL DEFAULT 'citizen';
      ALTER TABLE founders ADD COLUMN last_claim_at TIMESTAMPTZ NOT NULL DEFAULT now();
      -- when the founding stake of 500 hearts was paid out: once, on the first mint
      ALTER TABLE founders ADD COLUMN stake_at      TIMESTAMPTZ;

      -- The first founder runs the city: they grant the role that launches coops.
      UPDATE founders SET role = 'admin' WHERE number = (SELECT min(number) FROM founders);

      CREATE TABLE coops (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug       TEXT NOT NULL UNIQUE,
        name       TEXT NOT NULL,
        founder_id TEXT NOT NULL REFERENCES founders(id),
        pitch      TEXT NOT NULL,
        tile       INTEGER NOT NULL UNIQUE,
        -- spendable hearts invested so far; the milestone is a function of this
        raised     NUMERIC(78, 0) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE investments (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        coop_id    UUID NOT NULL REFERENCES coops(id),
        founder_id TEXT NOT NULL REFERENCES founders(id),
        hearts     NUMERIC(78, 0) NOT NULL,
        minds      NUMERIC(78, 0) NOT NULL,
        milestone  INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_investments_coop ON investments (coop_id, founder_id);
    `,
  },
];

