/**
 * THE MEDIA LIBRARY — every image, sound and video, kept in Postgres and known by its CID.
 *
 * Postgres is the single source of truth: the bytes live here, in 1 MiB chunks, under the IPFS content
 * identifier of the whole file. The CID is computed exactly as `ipfs add --cid-version 1` computes it (UnixFS,
 * raw leaves, sha2-256), so the same file has the same name here, on any IPFS node, and in any object store it
 * moves to later. The same bytes are stored once, however many paths point at them.
 *
 * Distribution is not done from here: images and sounds are copied to the Bunny storage zone and served by its CDN,
 * videos to Bunny Stream. Each row remembers where its copy went.
 */
import { importByteStream, importBytes } from "ipfs-unixfs-importer";
import { db, type Queryable } from "./pg";

/** One row of bytes. Small enough to move comfortably, large enough that a video is a few hundred rows. */
export const CHUNK = 1024 * 1024;

export type MediaKind = "image" | "video" | "audio" | "document" | "other";

/** The CID of a file, as `ipfs add --cid-version 1` would give it. No IPFS node needed: the blocks are discarded. */
export async function cidOf(bytes: Uint8Array): Promise<string> {
  const discard = { put: async (cid: unknown) => cid } as never;
  return (await importBytes(bytes, discard)).cid.toString();
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  pdf: "application/pdf",
};
export const EXT: Record<string, string> = Object.fromEntries(Object.entries(MIME).map(([e, m]) => [m, e]));
EXT["image/jpeg"] = "jpg";

export const mimeOf = (path: string) => MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
export const kindOf = (mime: string): MediaKind =>
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : mime === "application/pdf" ? "document" : "other";

/**
 * Keep a file: store its bytes under their CID unless they are already here, and let `path` name it.
 * Returns the CID and whether the bytes were new.
 */
export async function putMedia(bytes: Uint8Array, path: string, mime = mimeOf(path)): Promise<{ cid: string; stored: boolean }> {
  const cid = await cidOf(bytes);
  const stored = await db.transaction(async (tx) => {
    const { rows } = await tx.query("SELECT 1 FROM media WHERE cid = $1", [cid]);
    if (!rows.length) {
      await tx.query("INSERT INTO media (cid, mime, kind, size) VALUES ($1, $2, $3, $4)", [cid, mime, kindOf(mime), bytes.length]);
      for (let i = 0, n = 0; i < bytes.length || n === 0; i += CHUNK, n++)
        await tx.query("INSERT INTO media_chunks (cid, idx, bytes) VALUES ($1, $2, $3)", [cid, n, bytes.subarray(i, i + CHUNK)]);
    }
    await nameIt(tx, path, cid);
    return !rows.length;
  });
  return { cid, stored };
}

/** Point a path at a CID. A path that named something else before now names this. */
export async function nameIt(q: Queryable, path: string, cid: string) {
  await q.query(
    `INSERT INTO media_paths (path, cid) VALUES ($1, $2)
     ON CONFLICT (path) DO UPDATE SET cid = EXCLUDED.cid, updated = now() WHERE media_paths.cid <> EXCLUDED.cid`,
    [path, cid],
  );
}

export type MediaRow = {
  cid: string;
  mime: string;
  kind: MediaKind;
  size: number;
  created: string;
  paths: string[];
  tags: string[];
  meta: Record<string, unknown>;
  cdn_path: string | null;
  stream_guid: string | null;
  distributed_at: string | null;
};

/** The library: newest first, every path that names each file, and where its public copy is. */
export async function listMedia(filter: { kind?: string; q?: string } = {}): Promise<MediaRow[]> {
  const { rows } = await db.query<MediaRow>(
    `SELECT m.cid, m.mime, m.kind, m.size, m.created, m.meta, m.cdn_path, m.stream_guid, m.distributed_at,
            coalesce(array_agg(DISTINCT p.path) FILTER (WHERE p.path IS NOT NULL), '{}') AS paths,
            coalesce((SELECT array_agg(t.tag ORDER BY t.tag) FROM media_tags t WHERE t.cid = m.cid), '{}') AS tags
       FROM media m LEFT JOIN media_paths p ON p.cid = m.cid
      WHERE ($1::text IS NULL OR m.kind = $1)
        AND ($2::text IS NULL OR m.cid = $2 OR EXISTS (SELECT 1 FROM media_paths q WHERE q.cid = m.cid AND q.path ILIKE '%' || $2 || '%'))
      GROUP BY m.cid ORDER BY m.created DESC, m.cid`,
    [filter.kind || null, filter.q?.trim() || null],
  );
  return rows.map((r) => ({ ...r, size: Number(r.size) }));
}

export async function mediaInfo(cid: string): Promise<{ mime: string; size: number } | null> {
  const { rows } = await db.query<{ mime: string; size: number }>("SELECT mime, size FROM media WHERE cid = $1", [cid]);
  return rows[0] ? { mime: rows[0].mime, size: Number(rows[0].size) } : null;
}

/** The bytes from `start` to `end` (inclusive), read chunk by chunk — a video is never held whole in memory. */
export function readMedia(cid: string, start: number, end: number): ReadableStream<Uint8Array> {
  let idx = Math.floor(start / CHUNK);
  const last = Math.floor(end / CHUNK);
  return new ReadableStream({
    async pull(controller) {
      if (idx > last) return controller.close();
      const { rows } = await db.query<{ bytes: Uint8Array }>("SELECT bytes FROM media_chunks WHERE cid = $1 AND idx = $2", [cid, idx]);
      if (!rows[0]) return controller.error(new Error(`chunk ${idx} of ${cid} is missing`));
      const from = idx * CHUNK;
      const bytes = new Uint8Array(rows[0].bytes);
      controller.enqueue(bytes.subarray(Math.max(0, start - from), Math.min(bytes.length, end - from + 1)));
      idx++;
    },
  });
}

/** Every file whose public copy has not been made yet. */
export async function undistributed(): Promise<{ cid: string; mime: string; kind: MediaKind; size: number; path: string | null }[]> {
  const { rows } = await db.query<any>(
    `SELECT m.cid, m.mime, m.kind, m.size, (SELECT min(path) FROM media_paths p WHERE p.cid = m.cid) AS path
       FROM media m WHERE m.distributed_at IS NULL ORDER BY m.size`,
  );
  return rows.map((r) => ({ ...r, size: Number(r.size) }));
}

export async function markDistributed(cid: string, where: { cdn_path?: string; stream_guid?: string }) {
  await db.query("UPDATE media SET cdn_path = $2, stream_guid = $3, distributed_at = now() WHERE cid = $1", [
    cid,
    where.cdn_path ?? null,
    where.stream_guid ?? null,
  ]);
}

/** The whole file, for copying it out (distribution). */
export async function mediaBytes(cid: string): Promise<Uint8Array> {
  const { rows } = await db.query<{ bytes: Uint8Array }>("SELECT bytes FROM media_chunks WHERE cid = $1 ORDER BY idx", [cid]);
  const parts = rows.map((r) => new Uint8Array(r.bytes));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
}

/** path → where the site should load it from: the CDN copy of its CID, once there is one. */
export async function manifest(): Promise<Record<string, { cid: string; url: string | null }>> {
  const { rows } = await db.query<{ path: string; cid: string; cdn_path: string | null }>(
    "SELECT p.path, p.cid, m.cdn_path FROM media_paths p JOIN media m ON m.cid = p.cid ORDER BY p.path",
  );
  return Object.fromEntries(rows.map((r) => [r.path, { cid: r.cid, url: r.cdn_path ? `/${r.cdn_path}` : null }]));
}

/** Every path the library knows, and the CID it names. */
export async function allPaths(): Promise<{ path: string; cid: string }[]> {
  return (await db.query<{ path: string; cid: string }>("SELECT path, cid FROM media_paths ORDER BY path")).rows;
}

/** Replace every tag: they are derived (see scripts/media-tags.ts), so the new set is the whole truth. */
export async function retag(tags: Map<string, Set<string>>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM media_tags");
    for (const [cid, set] of tags)
      for (const tag of set) await tx.query("INSERT INTO media_tags (cid, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING", [cid, tag]);
  });
}

// ─────────────────────────────── uploads, through the API ───────────────────────────────

export class MediaError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Which of these CIDs does the library already hold? Those need no upload, only their path. */
export async function have(cids: string[]): Promise<string[]> {
  if (!cids.length) return [];
  const { rows } = await db.query<{ cid: string }>(
    "SELECT cid FROM media WHERE cid IN (SELECT jsonb_array_elements_text(($1::text)::jsonb))",
    [JSON.stringify(cids)],
  );
  return rows.map((r) => r.cid);
}

/** Name a path after bytes the library already holds (and add to what is known about them). */
export async function namePath(path: unknown, cid: unknown, meta?: unknown) {
  const p = String(path ?? ""), c = String(cid ?? "");
  if (!p.startsWith("/")) throw new MediaError("A path starts with /.");
  if (!(await have([c])).length) throw new MediaError("The library does not hold that CID.", 404);
  await nameIt(db, p, c);
  if (meta) await db.query("UPDATE media SET meta = meta || ($2::text)::jsonb WHERE cid = $1", [c, metaOf(meta)]);
}

const partsOf = (size: number) => Math.max(1, Math.ceil(size / CHUNK));

/**
 * Begin (or resume) an upload: the file's path, size and the CID the uploader computed. The parts already
 * received come back, so an interrupted upload carries on where it stopped.
 */
const metaOf = (v: unknown) => JSON.stringify(v && typeof v === "object" && !Array.isArray(v) ? v : {});

export async function startUpload(founderId: string, body: { path?: unknown; size?: unknown; cid?: unknown; mime?: unknown; meta?: unknown }) {
  const path = String(body.path ?? ""), cid = String(body.cid ?? ""), size = Number(body.size);
  if (!path.startsWith("/")) throw new MediaError("A path starts with /.");
  if (!/^baf[a-z2-7]{20,}$/.test(cid)) throw new MediaError("Give the file's CID (CIDv1).");
  if (!Number.isSafeInteger(size) || size < 0) throw new MediaError("Give the file's size in bytes.");
  const mime = typeof body.mime === "string" && body.mime ? body.mime : mimeOf(path);
  const { rows: old } = await db.query<{ id: string }>(
    "SELECT id FROM uploads WHERE founder_id = $1 AND path = $2 AND cid = $3 AND size = $4 ORDER BY created DESC LIMIT 1",
    [founderId, path, cid, size],
  );
  const id =
    old[0]?.id ??
    (await db.query<{ id: string }>("INSERT INTO uploads (founder_id, path, mime, size, cid, meta) VALUES ($1, $2, $3, $4, $5, ($6::text)::jsonb) RETURNING id", [founderId, path, mime, size, cid, metaOf(body.meta)])).rows[0]!.id;
  const { rows } = await db.query<{ idx: number }>("SELECT idx FROM upload_chunks WHERE upload_id = $1 ORDER BY idx", [id]);
  return { id, chunk: CHUNK, parts: partsOf(size), received: rows.map((r) => r.idx) };
}

/** One part: exactly CHUNK bytes, the last one the rest. */
export async function putPart(founderId: string, id: string, idx: number, bytes: Uint8Array) {
  const { rows } = await db.query<{ size: number }>("SELECT size FROM uploads WHERE id = $1 AND founder_id = $2", [id, founderId]);
  if (!rows[0]) throw new MediaError("No such upload.", 404);
  const size = Number(rows[0].size), parts = partsOf(size);
  if (!Number.isInteger(idx) || idx < 0 || idx >= parts) throw new MediaError("That part is not in this file.");
  const want = idx < parts - 1 ? CHUNK : size - (parts - 1) * CHUNK;
  if (bytes.length !== want) throw new MediaError(`Part ${idx} should be ${want} bytes, not ${bytes.length}.`);
  await db.query(
    "INSERT INTO upload_chunks (upload_id, idx, bytes) VALUES ($1, $2, $3) ON CONFLICT (upload_id, idx) DO UPDATE SET bytes = EXCLUDED.bytes",
    [id, idx, bytes],
  );
}

/**
 * Every part is in: compute the CID from the staged bytes. Only if it is the CID the uploader promised do the bytes
 * become media (or, when the library holds them already, are simply let go of). Either way the path now names it.
 */
export async function finishUpload(founderId: string, id: string): Promise<{ cid: string; stored: boolean }> {
  const { rows } = await db.query<{ path: string; mime: string; size: number; cid: string; meta: unknown }>(
    "SELECT path, mime, size, cid, meta FROM uploads WHERE id = $1 AND founder_id = $2",
    [id, founderId],
  );
  const up = rows[0];
  if (!up) throw new MediaError("No such upload.", 404);
  const size = Number(up.size), parts = partsOf(size);
  const { rows: count } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM upload_chunks WHERE upload_id = $1", [id]);
  if (Number(count[0]!.n) !== parts) throw new MediaError(`${parts - Number(count[0]!.n)} parts are still missing.`, 409);
  async function* staged() {
    for (let i = 0; i < parts; i++) {
      const { rows } = await db.query<{ bytes: Uint8Array }>("SELECT bytes FROM upload_chunks WHERE upload_id = $1 AND idx = $2", [id, i]);
      yield new Uint8Array(rows[0]!.bytes);
    }
  }
  const discard = { put: async (c: unknown) => c } as never;
  const cid = (await importByteStream(staged(), discard)).cid.toString();
  if (cid !== up.cid) {
    await db.query("DELETE FROM uploads WHERE id = $1", [id]);
    throw new MediaError(`The bytes arrived as ${cid}, not ${up.cid}: the upload was dropped. Try again.`, 422);
  }
  const stored = await db.transaction(async (tx) => {
    const { rows: known } = await tx.query("SELECT 1 FROM media WHERE cid = $1", [cid]);
    if (!known.length) {
      await tx.query("INSERT INTO media (cid, mime, kind, size) VALUES ($1, $2, $3, $4)", [cid, up.mime, kindOf(up.mime), size]);
      await tx.query("INSERT INTO media_chunks (cid, idx, bytes) SELECT $1, idx, bytes FROM upload_chunks WHERE upload_id = $2", [cid, id]);
    }
    await tx.query("UPDATE media SET meta = meta || ($2::text)::jsonb WHERE cid = $1", [cid, metaOf(up.meta)]);
    await tx.query("DELETE FROM uploads WHERE id = $1", [id]);
    await nameIt(tx, up.path, cid);
    return !known.length;
  });
  return { cid, stored };
}

/** What the site needs to know, and anyone may: every path with a public copy, and where it is. */
export async function publicManifest(): Promise<Record<string, { cid: string; url: string }>> {
  const all = await manifest();
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v.url).map(([k, v]) => [k, { cid: v.cid, url: v.url! }]));
}
