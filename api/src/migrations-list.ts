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
  {
    // The media library. Postgres is the single source of truth for every image, sound and video:
    // the bytes, in 1 MiB chunks, under the IPFS CID of the whole file (see media.ts). Paths are the
    // names files are known by on the site; many paths may name one CID. The public copies live on
    // Bunny (the CDN for images and sounds, Stream for videos) and each row remembers where.
    id: "0005-media",
    sql: `
      CREATE TABLE media (
        cid            TEXT PRIMARY KEY,
        mime           TEXT NOT NULL,
        kind           TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document', 'other')),
        size           BIGINT NOT NULL,
        created        TIMESTAMPTZ NOT NULL DEFAULT now(),
        -- where the public copy went: a path in the Bunny storage zone, or a Bunny Stream video
        cdn_path       TEXT,
        stream_guid    TEXT,
        distributed_at TIMESTAMPTZ
      );
      CREATE INDEX ix_media_kind ON media (kind, created DESC);

      CREATE TABLE media_chunks (
        cid   TEXT NOT NULL REFERENCES media(cid) ON DELETE CASCADE,
        idx   INTEGER NOT NULL,
        bytes BYTEA NOT NULL,
        PRIMARY KEY (cid, idx)
      );

      CREATE TABLE media_paths (
        path    TEXT PRIMARY KEY,
        cid     TEXT NOT NULL REFERENCES media(cid),
        updated TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_media_paths_cid ON media_paths (cid);
    `,
  },
  {
    // Tags on the media library: where each file is used — "Day 18", "cover", "in the post", the folder,
    // "unused" — derived from the journal and the site's code at every upload, so the library can be
    // filtered by them. Wholly derived: replaced each time, never edited by hand.
    id: "0006-media-tags",
    sql: `
      CREATE TABLE media_tags (
        cid TEXT NOT NULL REFERENCES media(cid) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (cid, tag)
      );
      CREATE INDEX ix_media_tags_tag ON media_tags (tag);
    `,
  },
  {
    // Signing a terminal in with a passkey, and uploading through the API.
    // A terminal asks for a device code; the admin approves it on maia.city with their passkey; the
    // terminal receives a key that can do only what was asked (for now media:admin). Only the key's hash
    // is kept. Uploads arrive in parts, are staged, and become media once their CID is checked.
    id: "0007-device-keys-and-uploads",
    sql: `
      CREATE TABLE device_codes (
        device_code TEXT PRIMARY KEY,      -- the terminal's secret, polled with
        user_code   TEXT NOT NULL UNIQUE,  -- what the person sees and approves
        scope       TEXT NOT NULL,         -- the capabilities asked for, comma list
        label       TEXT NOT NULL,
        founder_id  TEXT REFERENCES founders(id) ON DELETE CASCADE,
        approved_at TIMESTAMPTZ,
        used_at     TIMESTAMPTZ,
        expires_at  TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE api_keys (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        founder_id TEXT NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
        hash       TEXT NOT NULL UNIQUE,   -- sha256 of the key; the key itself is shown once
        scope      TEXT NOT NULL,
        label      TEXT NOT NULL,
        created    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used  TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );

      CREATE TABLE uploads (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        founder_id TEXT NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
        path       TEXT NOT NULL,
        mime       TEXT NOT NULL,
        size       BIGINT NOT NULL,
        cid        TEXT NOT NULL,          -- what the uploader says it is; checked at the end
        created    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE upload_chunks (
        upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        idx       INTEGER NOT NULL,
        bytes     BYTEA NOT NULL,
        PRIMARY KEY (upload_id, idx)
      );
    `,
  },
  {
    // What a file is about, beyond its bytes: the words a voice take speaks, the voice and model that made it.
    // Free-form JSON, merged as it arrives; the studio shows it.
    id: "0008-media-meta",
    sql: `
      ALTER TABLE media   ADD COLUMN meta JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE uploads ADD COLUMN meta JSONB NOT NULL DEFAULT '{}';
    `,
  },
  {
    // The studio's timelines: a named edit — its clips (each a CID with where it sits, where it is trimmed
    // and how loud), its frame and its tags — kept with the library it is cut from.
    id: "0009-timelines",
    sql: `
      CREATE TABLE timelines (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT NOT NULL,
        aspect     TEXT NOT NULL DEFAULT '1:1',
        tags       TEXT[] NOT NULL DEFAULT '{}',
        clips      JSONB NOT NULL DEFAULT '[]',
        founder_id TEXT REFERENCES founders(id) ON DELETE SET NULL,
        created    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
];

