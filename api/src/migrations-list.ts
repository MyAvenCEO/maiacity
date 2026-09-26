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
  {
    // Sandbox 2, reshaped: a card of the planet holds a CITY; the city opens
    // as an island of cells, and settlements (dome clusters) stand on them. The game starts over — every note, coop and investment goes —
    // but every account stays, and everyone's first mint pays the (now 30,000
    // heart) stake again. The ledger recreates its own tables at boot.
    id: "0003-cities",
    sql: `
      DROP TABLE IF EXISTS ledger_tx_states, ledger_transactions, ledger_blocks, ledger_states, ledger_keys CASCADE;
      DROP TABLE IF EXISTS invites;
      DROP TABLE IF EXISTS investments;
      ALTER TABLE founders DROP COLUMN IF EXISTS city_id;
      ALTER TABLE founders DROP COLUMN IF EXISTS settlement_id;
      DROP TABLE IF EXISTS coops;
      UPDATE founders SET last_claim_at = now(), stake_at = NULL;

      -- One table for all three: a city IS a coop, on its own card of the
      -- planet; a settlement is a coop on a cell of its city's island; later
      -- coops (a solar works …) stand on cells too.
      CREATE TABLE coops (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug       TEXT NOT NULL UNIQUE,
        kind       TEXT NOT NULL CHECK (kind IN ('city', 'settlement', 'coop')),
        city_id    UUID REFERENCES coops(id),
        name       TEXT NOT NULL,
        founder_id TEXT NOT NULL REFERENCES founders(id),
        pitch      TEXT NOT NULL,
        tile       INTEGER NOT NULL,
        -- the sub-hex on the city's island, "q,r"
        cell       TEXT,
        raised     NUMERIC(78, 0) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK ((kind = 'city' AND city_id IS NULL AND cell IS NULL) OR (kind <> 'city' AND city_id IS NOT NULL AND cell IS NOT NULL))
      );
      CREATE UNIQUE INDEX ux_city_tile ON coops (tile) WHERE kind = 'city';
      CREATE UNIQUE INDEX ux_cell ON coops (city_id, cell) WHERE kind <> 'city';

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

      -- A player is a citizen of one city and a settler of one settlement, for good.
      ALTER TABLE founders ADD COLUMN city_id UUID REFERENCES coops(id);
      ALTER TABLE founders ADD COLUMN settlement_id UUID REFERENCES coops(id);

      -- A settlement grows by invitation: a settler makes a link, one person uses it.
      CREATE TABLE invites (
        token         TEXT PRIMARY KEY,
        settlement_id UUID NOT NULL REFERENCES coops(id),
        created_by    TEXT NOT NULL REFERENCES founders(id),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at    TIMESTAMPTZ NOT NULL,
        used_by       TEXT REFERENCES founders(id),
        used_at       TIMESTAMPTZ
      );
    `,
  },
  {
    // Roles become rows: a role is a name and the capabilities it holds, edited by the admin
    // instead of fixed in a file. The rows themselves are seeded at boot from caps.ts (ROLE_CAPS),
    // so the list of what exists lives in one place. And the admin gets a notebook for ideas.
    id: "0004-roles-and-ideas",
    sql: `
      CREATE TABLE roles (
        name         TEXT PRIMARY KEY,
        -- a comma list of capability ids from caps.ts; only what is named here is held
        capabilities TEXT NOT NULL DEFAULT '',
        created      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE ideas (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id  TEXT REFERENCES founders(id) ON DELETE SET NULL,
        body       TEXT NOT NULL,
        done       BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_ideas_open ON ideas (done, created_at DESC);
    `,
  },
];

