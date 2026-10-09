// The schema's history, as data. Kept apart from the runner so the tests can
// build the same database in PGlite without a live Postgres.
import { CID_MAP } from "./cid-map";
import { defaultCards } from "../../game/economy/params.js";

export type Migration = { id: string; sql: string };

// the CID → hash map as SQL rows (both sides are checked to be base32 and hex: nothing to quote)
const CID_ROWS = CID_MAP.filter(([c, h]) => /^baf[a-z2-7]{56}$/.test(c) && /^[0-9a-f]{64}$/.test(h)).map(([c, h]) => `('${c}', '${h}')`).join(",\n        ");

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
  {
    // The publishing calendar: everything we put out — films, reels, posts, threads, articles — from the
    // first idea to the day it goes live, on which channels, with the library files it carries (by CID).
    id: "0010-content-calendar",
    sql: `
      CREATE TABLE content_items (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title        TEXT NOT NULL,
        kind         TEXT NOT NULL,
        channels     TEXT[] NOT NULL DEFAULT '{}',
        status       TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'draft', 'ready', 'scheduled', 'published')),
        scheduled_at TIMESTAMPTZ,
        body         TEXT NOT NULL DEFAULT '',
        cids         TEXT[] NOT NULL DEFAULT '{}',
        link         TEXT,
        tags         TEXT[] NOT NULL DEFAULT '{}',
        founder_id   TEXT REFERENCES founders(id) ON DELETE SET NULL,
        created      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_content_when ON content_items (scheduled_at);
    `,
  },
  {
    // Timelines grouped as variants of one project: "Day 19" with its variants A, B, C… — a new cut is a variant
    // of the same film, not a new film.
    id: "0011-timeline-variants",
    sql: `
      ALTER TABLE timelines ADD COLUMN project TEXT;
      ALTER TABLE timelines ADD COLUMN variant TEXT;
      CREATE INDEX ix_timelines_project ON timelines (project, variant);
    `,
  },
  {
    // Render jobs: the studio asks for a timeline to be exported; a render worker (bun film worker, wherever
    // ffmpeg and Chrome are) takes the job, renders the timeline and puts the film into the library.
    id: "0012-render-jobs",
    sql: `
      CREATE TABLE render_jobs (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        timeline_id UUID NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
        status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'rendering', 'done', 'failed')),
        progress    REAL NOT NULL DEFAULT 0,
        note        TEXT,
        output_cid  TEXT,
        founder_id  TEXT REFERENCES founders(id) ON DELETE SET NULL,
        created     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_render_jobs_open ON render_jobs (status, created);
    `,
  },
  {
    // A line on what a timeline variant is — "40 stills cut on the words, own score" — shown under its title.
    id: "0013-timeline-description",
    sql: `ALTER TABLE timelines ADD COLUMN description TEXT;`,
  },
  {
    // A render's files on the calendar: every format a film is delivered in, each with the channels it is for
    // (YouTube: the 4K master; X, LinkedIn: 1080 H.264; TikTok, Reels, Shorts: 9:16) — ready for the upload step
    // (Zernio) to post. One calendar item per timeline, updated by each new render.
    id: "0014-content-deliveries",
    sql: `
      ALTER TABLE content_items ADD COLUMN deliveries JSONB NOT NULL DEFAULT '[]';
      ALTER TABLE content_items ADD COLUMN timeline_id UUID REFERENCES timelines(id) ON DELETE SET NULL;
      CREATE UNIQUE INDEX ix_content_timeline ON content_items (timeline_id) WHERE timeline_id IS NOT NULL;
    `,
  },
  {
    // The posts a film goes out as, one per platform: its title, text and hashtags, which of the film's files and
    // which thumbnail it carries — written ready for the upload step (Zernio), shown in the calendar as previews.
    id: "0015-content-posts",
    sql: `ALTER TABLE content_items ADD COLUMN posts JSONB NOT NULL DEFAULT '[]';`,
  },
  {
    // One board for everything we put out: a content snippet moves idea → draft → review → scheduled → delivered.
    // The ideas notebook's open ideas become its first column (the swipe file). A film is one snippet, whatever
    // its cuts: every timeline of a project (the full film, the Reel) delivers onto the same item. Four channels
    // for now: YouTube, LinkedIn, Instagram, X.
    id: "0016-content-flow",
    sql: `
      ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_status_check;
      UPDATE content_items SET status = CASE status WHEN 'ready' THEN 'review' WHEN 'published' THEN 'delivered' ELSE status END;
      ALTER TABLE content_items ADD CONSTRAINT content_items_status_check CHECK (status IN ('idea', 'draft', 'review', 'scheduled', 'delivered'));
      UPDATE content_items SET channels = ARRAY(SELECT c FROM unnest(channels) c WHERE c IN ('youtube', 'linkedin', 'instagram', 'x'));
      ALTER TABLE content_items ADD COLUMN project TEXT;
      UPDATE content_items i SET project = t.project FROM timelines t WHERE i.timeline_id = t.id AND t.project IS NOT NULL;
      UPDATE content_items SET project = NULL
        WHERE project IS NOT NULL AND id NOT IN (SELECT DISTINCT ON (project) id FROM content_items WHERE project IS NOT NULL ORDER BY project, created);
      DROP INDEX IF EXISTS ix_content_timeline;
      CREATE UNIQUE INDEX ix_content_project ON content_items (project) WHERE project IS NOT NULL;
      INSERT INTO content_items (title, kind, status, body, founder_id, created)
        SELECT left(split_part(body, E'\n', 1), 200), 'post', 'idea', body, author_id, created_at FROM ideas WHERE NOT done;
      UPDATE ideas SET done = true WHERE NOT done;
    `,
  },
  {
    // A day's base article: the single source everything that day derives from (the film's script, the posts, the
    // X thread, the Reel). The article lives in the repo (blog/day-NN-…/post.md); the item keeps its text and path.
    id: "0017-content-source",
    sql: `ALTER TABLE content_items ADD COLUMN source TEXT;`,
  },
  {
    // Draft is the base article alone; moving on to "derivatives" locks it, and everything is derived from it then.
    // "review" was the same stage under another name.
    id: "0018-content-derivatives-stage",
    sql: `
      ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_status_check;
      UPDATE content_items SET status = 'derivatives' WHERE status = 'review';
      ALTER TABLE content_items ADD CONSTRAINT content_items_status_check CHECK (status IN ('idea', 'draft', 'derivatives', 'scheduled', 'delivered'));
    `,
  },
  {
    // The last stage of a card is "published" — the blog post is out, and its derivatives with it.
    id: "0019-content-published",
    sql: `
      ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_status_check;
      UPDATE content_items SET status = 'published' WHERE status = 'delivered';
      ALTER TABLE content_items ADD CONSTRAINT content_items_status_check CHECK (status IN ('idea', 'draft', 'derivatives', 'scheduled', 'published'));
    `,
  },
  {
    // Before the article: the hook — the day's title, set into its title cards (every thumbnail, every shape).
    // The article is written from it.
    id: "0020-content-hook",
    sql: `
      ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_status_check;
      ALTER TABLE content_items ADD CONSTRAINT content_items_status_check CHECK (status IN ('idea', 'hook', 'draft', 'derivatives', 'scheduled', 'published'));
      ALTER TABLE content_items ADD COLUMN hook TEXT;
    `,
  },
  {
    // The library is flat: a file is its CID, and what is known about it — a title, a description, tags, whether it
    // is public (made into a copy on the CDN). Names (paths) are gone; a file is found by its CID or its tags.
    id: "0021-media-without-paths",
    sql: `
      ALTER TABLE media ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
      ALTER TABLE media ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
      ALTER TABLE media ADD COLUMN IF NOT EXISTS public BOOLEAN NOT NULL DEFAULT false;
      UPDATE media m SET title = coalesce(nullif(m.meta->>'title', ''),
        (SELECT regexp_replace(regexp_replace(min(p.path), '^.*/', ''), '[.][^.]+$', '') FROM media_paths p WHERE p.cid = m.cid), '');
      UPDATE media SET public = true WHERE distributed_at IS NOT NULL;
      ALTER TABLE uploads ALTER COLUMN path DROP NOT NULL;
      ALTER TABLE uploads ADD COLUMN IF NOT EXISTS info JSONB NOT NULL DEFAULT '{}'::jsonb;
      DROP TABLE media_paths;
    `,
  },
  {
    // The communities outlive the sandboxes. A city or a settlement is founded and joined in the apps, with no
    // place on any map; each world a sandbox draws may then give it one — a card of Sandbox 2's planet for a city,
    // a cell of its city's island for a settlement. The places they already had become their Sandbox 2 placements.
    id: "0022-placements",
    sql: `
      CREATE TABLE placements (
        coop_id    UUID NOT NULL REFERENCES coops(id),
        -- the world that draws it: 'sandbox-2' …
        world      TEXT NOT NULL,
        -- where in that world: a card for a city, "q,r" on its city's island for a settlement
        spot       TEXT NOT NULL,
        -- the city whose island a settlement stands on; null for a city
        within     UUID REFERENCES coops(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (coop_id, world)
      );
      CREATE UNIQUE INDEX ux_placement_spot ON placements (world, COALESCE(within::text, ''), spot);

      INSERT INTO placements (coop_id, world, spot, within)
        SELECT id, 'sandbox-2', CASE WHEN kind = 'city' THEN tile::text ELSE cell END, city_id FROM coops;

      DROP INDEX IF EXISTS ux_city_tile;
      DROP INDEX IF EXISTS ux_cell;
      ALTER TABLE coops DROP COLUMN tile;
      ALTER TABLE coops DROP COLUMN cell;
      ALTER TABLE coops ADD CONSTRAINT coops_city_check CHECK ((kind = 'city') = (city_id IS NULL));
    `,
  },
  {
    // The economy changed underneath the game — 62,500 starting hearts, 25,000 for a home, 1.3 million MINDs a coop —
    // so the game starts over, as it did with 0003. Every note, mint, investment, city, settlement, invite and
    // placement goes; every account stays, and everyone's first mint pays the new starting hearts. The ledger
    // recreates its own tables at boot.
    id: "0023-economy-reset",
    sql: `
      DROP TABLE IF EXISTS ledger_tx_states, ledger_transactions, ledger_blocks, ledger_states, ledger_keys CASCADE;
      UPDATE founders SET city_id = NULL, settlement_id = NULL, last_claim_at = now(), stake_at = NULL;
      DELETE FROM invites;
      DELETE FROM placements;
      DELETE FROM investments;
      DELETE FROM coops;
    `,
  },
  {
    // The render worker does more than render timelines: it makes each new file's HD log proxy (and reads its colour)
    // and bakes the studio's preview LUTs. A job says which kind it is and what it is for — a timeline (render) or a
    // file (proxy) — and keeps its report (QC, loudness, the transforms used, by config hash).
    id: "0024-film-jobs",
    sql: `
      ALTER TABLE render_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'render' CHECK (kind IN ('render', 'proxy', 'lut'));
      ALTER TABLE render_jobs ADD COLUMN media_cid TEXT;
      ALTER TABLE render_jobs ADD COLUMN report JSONB;
      ALTER TABLE render_jobs ALTER COLUMN timeline_id DROP NOT NULL;
      ALTER TABLE render_jobs ADD CONSTRAINT render_jobs_target
        CHECK ((kind <> 'render' OR timeline_id IS NOT NULL) AND (kind <> 'proxy' OR media_cid IS NOT NULL));
      CREATE INDEX ix_render_jobs_media ON render_jobs (media_cid, created) WHERE media_cid IS NOT NULL;
    `,
  },
  {
    // World shots as data (game/film/shot.js): a shot of Sandbox 4 is a record — world, camera, light, exposure,
    // cues, shutter, framing — rendered only when it is needed. Every save of a changed spec is a new version and the
    // old ones are kept, so a clip cut with version 3 renders version 3 however the shot is edited later.
    id: "0025-shots",
    sql: `
      CREATE TABLE shots (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT NOT NULL,
        project    TEXT,
        version    INT NOT NULL DEFAULT 1,
        spec       JSONB NOT NULL,
        founder_id TEXT REFERENCES founders(id) ON DELETE SET NULL,
        created    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_shots_project ON shots (project, name);
      CREATE TABLE shot_versions (
        shot_id    UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
        version    INT NOT NULL,
        spec       JSONB NOT NULL,
        founder_id TEXT REFERENCES founders(id) ON DELETE SET NULL,
        created    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (shot_id, version)
      );
    `,
  },
  {
    // A timeline's working steps (Edit → locked → Grade → Render), its version (one more at every unlock), its colour
    // pipeline (the working space and the output transform) and the whole film's grade. Clips gain world clips and
    // their own grade and framing inside the clips JSON (api/src/timelines.ts); every existing timeline stays valid.
    id: "0026-timeline-stages",
    sql: `
      ALTER TABLE timelines ADD COLUMN stage TEXT NOT NULL DEFAULT 'edit' CHECK (stage IN ('edit', 'locked', 'graded', 'rendered'));
      ALTER TABLE timelines ADD COLUMN version INT NOT NULL DEFAULT 1;
      ALTER TABLE timelines ADD COLUMN color JSONB NOT NULL DEFAULT '{"working": "acescct", "output": "odt-rec709"}';
      ALTER TABLE timelines ADD COLUMN grade JSONB;
    `,
  },
  {
    // Two more kinds of work for the render worker, now that shots are data: the HD proxy of a world shot (a proxy
    // job for a shot version instead of a file, so the studio can play a world clip while the live world is still
    // loading) and a hero frame — one frame of a timeline rendered at full precision through the whole chain, for
    // grading against. A frame job keeps what it is of (the time, the shape) in `params`.
    id: "0027-shot-and-frame-jobs",
    sql: `
      ALTER TABLE render_jobs DROP CONSTRAINT IF EXISTS render_jobs_target;
      ALTER TABLE render_jobs DROP CONSTRAINT IF EXISTS render_jobs_kind_check;
      ALTER TABLE render_jobs ADD CONSTRAINT render_jobs_kind_check CHECK (kind IN ('render', 'proxy', 'lut', 'frame'));
      ALTER TABLE render_jobs ADD COLUMN shot_id UUID REFERENCES shots(id) ON DELETE CASCADE;
      ALTER TABLE render_jobs ADD COLUMN shot_version INT;
      ALTER TABLE render_jobs ADD COLUMN params JSONB;
      ALTER TABLE render_jobs ADD CONSTRAINT render_jobs_target CHECK (
        (kind NOT IN ('render', 'frame') OR timeline_id IS NOT NULL) AND
        (kind <> 'proxy' OR media_cid IS NOT NULL OR (shot_id IS NOT NULL AND shot_version IS NOT NULL)));
      CREATE INDEX ix_render_jobs_shot ON render_jobs (shot_id, shot_version) WHERE shot_id IS NOT NULL;
    `,
  },
  {
    // The media vault (vault/, .claude/skills/iroh): every file known by its BLAKE3 hash, its catalog an iroh-docs
    // replica on every device. These tables only MIRROR the catalog for the website and the admin (the server peer
    // writes them), keep the devices the admin paired with the passkey, and hold what a new device needs to join.
    id: "0028-media-vault",
    sql: `
      CREATE TABLE vault_files (
        hash     TEXT PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
        size     BIGINT NOT NULL,
        mime     TEXT NOT NULL,
        kind     TEXT NOT NULL,
        title    TEXT NOT NULL DEFAULT '',
        tags     TEXT[] NOT NULL DEFAULT '{}',
        public   BOOLEAN NOT NULL DEFAULT false,
        meta     JSONB NOT NULL DEFAULT '{}',
        stored   BOOLEAN NOT NULL DEFAULT false,
        added    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_vault_files_tags ON vault_files USING GIN (tags);
      CREATE TABLE vault_devices (
        endpoint_id TEXT PRIMARY KEY CHECK (endpoint_id ~ '^[0-9a-f]{64}$'),
        founder_id  TEXT NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
        label       TEXT NOT NULL DEFAULT '',
        created     TIMESTAMPTZ NOT NULL DEFAULT now(),
        seen        TIMESTAMPTZ,
        revoked_at  TIMESTAMPTZ
      );
      CREATE TABLE vault_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    // Off IPFS CIDs: every file is known by its BLAKE3 hash (64 hex), as the vault knows it. Every CID the timelines,
    // shots, content board and render jobs name becomes its hash (by the map in cid-map.ts), every "cid" key becomes
    // "hash" — or "file" where the object already has a "hash" of its own (a shot's world.build, a preview LUT) — and
    // the columns follow: content_items.cids → hashes, render_jobs.media_cid → media_hash, output_cid → output_hash.
    // A file's proxy is the Mac app's work now (meta.proxy on the original): media proxy jobs still waiting are closed.
    // The old library tables (media, media_chunks, media_tags, uploads) are left as they are, to be dropped once the
    // vault is checked against them. A timeline or shot naming a CID the map does not know stops the migration.
    id: "0029-hashes-not-cids",
    sql: `
      CREATE TEMP TABLE cid_map (cid TEXT PRIMARY KEY, hash TEXT NOT NULL);
      INSERT INTO cid_map (cid, hash) VALUES
        ${CID_ROWS};

      -- every CID in a text, replaced by its hash (a CID is always 59 characters: none is the start of another)
      CREATE FUNCTION pg_temp.hashed(t TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
      DECLARE r RECORD;
      BEGIN
        IF t IS NULL THEN RETURN NULL; END IF;
        FOR r IN SELECT DISTINCT m.cid, m.hash FROM regexp_matches(t, 'baf[a-z2-7]{56}', 'g') x JOIN pg_temp.cid_map m ON m.cid = x[1] LOOP
          t := replace(t, r.cid, r.hash);
        END LOOP;
        RETURN t;
      END $$;

      -- every "cid" key, at any depth, renamed: "hash", or "file" beside a "hash" the object already has
      CREATE FUNCTION pg_temp.rekeyed(j JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
      DECLARE k TEXT; v JSONB; o JSONB := '{}';
      BEGIN
        IF jsonb_typeof(j) = 'object' THEN
          FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
            o := o || jsonb_build_object(CASE WHEN k <> 'cid' THEN k WHEN j ? 'hash' THEN 'file' ELSE 'hash' END, pg_temp.rekeyed(v));
          END LOOP;
          RETURN o;
        ELSIF jsonb_typeof(j) = 'array' THEN
          RETURN coalesce((SELECT jsonb_agg(pg_temp.rekeyed(e) ORDER BY i) FROM jsonb_array_elements(j) WITH ORDINALITY a(e, i)), '[]');
        END IF;
        RETURN j;
      END $$;

      CREATE FUNCTION pg_temp.rehashed(j JSONB) RETURNS JSONB LANGUAGE sql AS $$
        SELECT pg_temp.hashed(pg_temp.rekeyed(j)::text)::jsonb
      $$;

      UPDATE timelines SET clips = pg_temp.rehashed(clips) WHERE clips::text ~ 'baf|"cid"';
      UPDATE shots SET spec = pg_temp.rehashed(spec) WHERE spec::text ~ 'baf|"cid"';
      UPDATE shot_versions SET spec = pg_temp.rehashed(spec) WHERE spec::text ~ 'baf|"cid"';

      ALTER TABLE content_items RENAME COLUMN cids TO hashes;
      UPDATE content_items SET
          hashes = ARRAY(SELECT pg_temp.hashed(h) FROM unnest(hashes) WITH ORDINALITY u(h, i) ORDER BY i),
          body = pg_temp.hashed(body), link = pg_temp.hashed(link),
          deliveries = pg_temp.rehashed(deliveries), posts = pg_temp.rehashed(posts)
        WHERE array_to_string(hashes, ' ') ~ 'baf' OR body ~ 'baf' OR link ~ 'baf' OR deliveries::text ~ 'baf|"cid"' OR posts::text ~ 'baf|"cid"';

      -- (the target check and the index follow a renamed column on their own)
      ALTER TABLE render_jobs RENAME COLUMN media_cid TO media_hash;
      ALTER TABLE render_jobs RENAME COLUMN output_cid TO output_hash;
      UPDATE render_jobs SET
          media_hash = pg_temp.hashed(media_hash), output_hash = pg_temp.hashed(output_hash),
          report = pg_temp.rehashed(report), params = pg_temp.rehashed(params)
        WHERE media_hash ~ 'baf' OR output_hash ~ 'baf' OR report::text ~ 'baf|"cid"' OR params::text ~ 'baf|"cid"';
      UPDATE render_jobs SET status = 'failed', note = 'A file''s proxy is made by the Mac app now.', updated = now()
        WHERE kind = 'proxy' AND media_hash IS NOT NULL AND status IN ('queued', 'rendering');

      DO $$
      DECLARE left_over TEXT;
      BEGIN
        SELECT string_agg(DISTINCT x[1], ', ') INTO left_over FROM (
          SELECT clips::text AS t FROM timelines UNION ALL SELECT spec::text FROM shots UNION ALL SELECT spec::text FROM shot_versions
        ) s, regexp_matches(s.t, '(baf[a-z2-7]{56})', 'g') x;
        IF left_over IS NOT NULL THEN
          RAISE EXCEPTION 'These CIDs are in a timeline or a shot but not in the map, so they have no hash: %', left_over;
        END IF;
      END $$;

      DROP FUNCTION pg_temp.rehashed(JSONB);
      DROP FUNCTION pg_temp.rekeyed(JSONB);
      DROP FUNCTION pg_temp.hashed(TEXT);
      DROP TABLE pg_temp.cid_map;
    `,
  },
  {
    // Media bytes out of Postgres, the last step (26b): the old library — files as rows of chunks, named by IPFS CID —
    // is gone. Every file is in the vault (the iroh-docs catalog, this Mac's store, Object Storage), each re-hashed to
    // its BLAKE3 name; nothing has read these tables since release 11 (0029). Backups before every deploy keep them.
    id: "0030-old-media-tables-dropped",
    sql: `
      DROP TABLE IF EXISTS upload_chunks;
      DROP TABLE IF EXISTS uploads;
      DROP TABLE IF EXISTS media_tags;
      DROP TABLE IF EXISTS media_paths;
      DROP TABLE IF EXISTS media_chunks;
      DROP TABLE IF EXISTS media;
    `,
  },
  {
    // The stories board: a story moves idea → hook → journey → writing → movie → derivatives → scheduled → published.
    // "draft" is now "writing" (the long-form master article everything derives from); the journey (the arc beat by
    // beat, each with the feeling it leaves) and the movie (the film, made in the studio) are new steps. A story keeps
    // its brainstorm pad (an idea's text, which used to be its body), the description that goes under its hook, its
    // journey, and the vault story its files are filed in — the Mac app makes that bucket once the story has a hook.
    id: "0031-stories",
    sql: `
      ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_status_check;
      UPDATE content_items SET status = 'writing' WHERE status = 'draft';
      ALTER TABLE content_items ADD CONSTRAINT content_items_status_check
        CHECK (status IN ('idea', 'hook', 'journey', 'writing', 'movie', 'derivatives', 'scheduled', 'published'));
      ALTER TABLE content_items ADD COLUMN idea TEXT NOT NULL DEFAULT '';
      ALTER TABLE content_items ADD COLUMN description TEXT NOT NULL DEFAULT '';
      ALTER TABLE content_items ADD COLUMN journey JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE content_items ADD COLUMN story TEXT;
      -- an idea's text (the old ideas notebook's) is its pad; a day's item that only sits at "idea" keeps its body
      UPDATE content_items SET idea = body, body = '' WHERE status = 'idea' AND source IS NULL AND project IS NULL;
    `,
  },
  {
    // Stories, not days. The old world sorted everything by its day ("Day 19"); the new one by stories (the media
    // vault's buckets, named by their titles) and, before a story, ideas. Every old day is one name now — the story it
    // became (Test, The 1 million decision, Thinking outside the box, 233 settlers, how it starts) or the idea it is —
    // in the items', the timelines' and the shots' project alike (src/lib/stories/names.js holds the same list). The
    // days that did not become stories are ideas again, their drafts kept for the Writing step; no title starts with
    // its day any more. A story's name is one item's (ix_content_project): an old day whose name another item already
    // has, or that two items shared, keeps no project, as in 0016.
    id: "0032-stories-not-days",
    sql: `
      CREATE TEMP TABLE day_names (day INT PRIMARY KEY, name TEXT NOT NULL, story BOOLEAN NOT NULL DEFAULT false);
      INSERT INTO day_names (day, name) VALUES (0, 'Test'), (1, 'The 1 million decision'), (2, 'Thinking outside the box'), (4, 'Act before you think'), (5, 'The first settlement'), (6, 'The food forest'), (7, 'Weight of unused potential'), (8, 'avenMAIA, the mayor'), (9, 'Hearts and minds'), (10, 'Hearts every two minutes'), (11, 'The Earth in cards'), (12, 'First believer pays least'), (13, 'Invited into a home'), (14, 'One tent to 233'), (15, 'Inside the domes'), (16, 'The solar factory dome'), (17, 'Thirteen domes, one world'), (18, 'Homes and forest sounds'), (19, '233 settlers, how it starts');
      UPDATE day_names SET story = true WHERE day IN (0, 1, 2, 19);
      CREATE TEMP TABLE day_items AS SELECT c.id, c.created, n.name, n.story
        FROM content_items c JOIN day_names n ON c.project ~* '^\\s*day[\\s-]*[0-9]+\\s*$' AND substring(c.project from '[0-9]+')::int = n.day;
      UPDATE content_items c SET status = CASE WHEN d.story THEN c.status ELSE 'idea' END,
        project = CASE WHEN NOT EXISTS (SELECT 1 FROM content_items o WHERE o.project = d.name)
          AND d.id = (SELECT d2.id FROM day_items d2 WHERE d2.name = d.name ORDER BY d2.created, d2.id LIMIT 1) THEN d.name END
        FROM day_items d WHERE c.id = d.id;
      DROP TABLE day_items;
      UPDATE timelines t SET project = n.name
        FROM day_names n WHERE t.project ~* '^\\s*day[\\s-]*[0-9]+\\s*$' AND substring(t.project from '[0-9]+')::int = n.day;
      UPDATE shots s SET project = n.name
        FROM day_names n WHERE s.project ~* '^\\s*day[\\s-]*[0-9]+\\s*$' AND substring(s.project from '[0-9]+')::int = n.day;
      UPDATE content_items SET title = regexp_replace(title, '^\\s*day\\s*[0-9]+\\s*[·:—–-]\\s*', '', 'i')
        WHERE title ~* '^\\s*day\\s*[0-9]+\\s*[·:—–-]\\s*\\S';
      DROP TABLE day_names;
    `,
  },
  {
    // The economy sandbox (Sandbox 7, the avens trading) keeps everything here (api/src/economy.js): its configs —
    // every policy and world value, resource and recipe, as config cards (game/economy/params.js), versioned — changed
    // only by MIPs (MaiaCity improvement proposals: a title, a description, the cards as they would be) the admin
    // accepts; and every game run, day by day: its stats row, its trades and its avens' Liquid decisions. The first
    // config, "valley", holds the catalogue's defaults.
    id: "0033-economy",
    sql: `
      CREATE TABLE econ_configs (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version     INT NOT NULL DEFAULT 1,
        cards       JSONB NOT NULL DEFAULT '[]'::jsonb,
        deleted     TIMESTAMPTZ,
        created     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE mips (
        number       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title        TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        config_id    TEXT NOT NULL,
        action       TEXT NOT NULL DEFAULT 'edit' CHECK (action IN ('edit', 'create', 'delete')),
        name         TEXT,
        about        TEXT,
        from_id      TEXT,
        cards        JSONB NOT NULL DEFAULT '[]'::jsonb,
        remove       JSONB NOT NULL DEFAULT '[]'::jsonb,
        base         JSONB NOT NULL DEFAULT '{}'::jsonb,
        base_version INT,
        status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'withdrawn')),
        author       TEXT REFERENCES founders(id) ON DELETE SET NULL,
        via          TEXT NOT NULL DEFAULT 'page' CHECK (via IN ('page', 'mcp')),
        created      TIMESTAMPTZ NOT NULL DEFAULT now(),
        decided      TIMESTAMPTZ,
        decided_by   TEXT REFERENCES founders(id) ON DELETE SET NULL,
        note         TEXT NOT NULL DEFAULT '',
        result       JSONB
      );
      CREATE INDEX ix_mips_status ON mips (status, number DESC);
      CREATE TABLE econ_config_versions (
        config_id TEXT NOT NULL REFERENCES econ_configs(id) ON DELETE CASCADE,
        version   INT NOT NULL,
        body      JSONB NOT NULL,
        mip       INT REFERENCES mips(number) ON DELETE SET NULL,
        at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (config_id, version)
      );
      CREATE TABLE econ_runs (
        id             TEXT PRIMARY KEY,
        config_id      TEXT REFERENCES econ_configs(id) ON DELETE SET NULL,
        config_version INT,
        config         JSONB NOT NULL,
        seed           BIGINT,
        brain          TEXT NOT NULL DEFAULT '',
        player         TEXT REFERENCES founders(id) ON DELETE SET NULL,
        started        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated        TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended          TIMESTAMPTZ,
        days           INT NOT NULL DEFAULT 0,
        alive          INT,
        summary        JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX ix_econ_runs_started ON econ_runs (started DESC);
      CREATE TABLE econ_run_days (
        run_id    TEXT NOT NULL REFERENCES econ_runs(id) ON DELETE CASCADE,
        day       INT NOT NULL,
        stats     JSONB NOT NULL,
        trades    JSONB NOT NULL DEFAULT '[]'::jsonb,
        decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
        PRIMARY KEY (run_id, day)
      );
      INSERT INTO econ_configs (id, name, description, cards)
        VALUES ('valley', 'The valley', 'Ten avens, five goods, HEARTS: the sandbox as first played.', '${JSON.stringify(defaultCards()).replace(/'/g, "''")}'::jsonb);
      INSERT INTO econ_config_versions (config_id, version, body)
        SELECT id, 1, jsonb_build_object('name', name, 'description', description, 'cards', cards)
          FROM econ_configs WHERE id = 'valley';
    `,
  },
];
