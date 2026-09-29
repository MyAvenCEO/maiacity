/**
 * THE MEDIA LIBRARY — every image, sound and video, kept in Postgres and known by its CID.
 *
 * The bytes live here, in 1 MiB chunks, under the IPFS content identifier of the whole file. The CID is computed
 * exactly as `ipfs add --cid-version 1` computes it (UnixFS, raw leaves, sha2-256), so the same file has the same
 * name here, on any IPFS node, and in the repo's library/ folder, which seeds this database. The same bytes are
 * stored once. There are no paths: a file is its CID, and what is known about it — a title, a description, tags
 * (how it is found and sorted), its meta, and whether it is public.
 *
 * Distribution is not done from here: public images and sounds are copied to the Bunny storage zone and served by
 * its CDN, public videos to Bunny Stream. Each row remembers where its copy went.
 */
import { importByteStream, importBytes } from "ipfs-unixfs-importer";
import { db, type Queryable } from "./pg";
import { hasProxyJob, queueProxy } from "./renders";

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
  exr: "image/x-exr", tar: "application/x-tar",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  pdf: "application/pdf",
};
export const EXT: Record<string, string> = Object.fromEntries(Object.entries(MIME).map(([e, m]) => [m, e]));
EXT["image/jpeg"] = "jpg";

export const mimeOf = (path: string) => MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
export const kindOf = (mime: string): MediaKind =>
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : mime === "application/pdf" ? "document" : "other";

/** What is known about a file, besides its bytes. */
export type Description = { title?: string; description?: string; tags?: string[]; meta?: Record<string, unknown>; public?: boolean };

/** Keep a file: store its bytes under their CID unless they are already here, and describe it. */
export async function putMedia(bytes: Uint8Array, mime: string, about: Description = {}): Promise<{ cid: string; stored: boolean }> {
  const cid = await cidOf(bytes);
  const stored = await db.transaction(async (tx) => {
    const { rows } = await tx.query("SELECT 1 FROM media WHERE cid = $1", [cid]);
    if (!rows.length) {
      await tx.query("INSERT INTO media (cid, mime, kind, size) VALUES ($1, $2, $3, $4)", [cid, mime, kindOf(mime), bytes.length]);
      for (let i = 0, n = 0; i < bytes.length || n === 0; i += CHUNK, n++)
        await tx.query("INSERT INTO media_chunks (cid, idx, bytes) VALUES ($1, $2, $3)", [cid, n, bytes.subarray(i, i + CHUNK)]);
    }
    await describeIn(tx, cid, about);
    return !rows.length;
  });
  return { cid, stored };
}

/** Set what is known about a file: each field given replaces the one before (tags as a whole set). */
async function describeIn(q: Queryable, cid: string, about: Description) {
  if (about.title !== undefined) await q.query("UPDATE media SET title = $2 WHERE cid = $1", [cid, String(about.title).slice(0, 300)]);
  if (about.description !== undefined) await q.query("UPDATE media SET description = $2 WHERE cid = $1", [cid, String(about.description).slice(0, 5000)]);
  if (about.meta !== undefined) await q.query("UPDATE media SET meta = ($2::text)::jsonb WHERE cid = $1", [cid, metaOf(about.meta)]);
  if (about.public !== undefined) await q.query("UPDATE media SET public = $2 WHERE cid = $1", [cid, Boolean(about.public)]);
  if (about.tags !== undefined) {
    await q.query("DELETE FROM media_tags WHERE cid = $1", [cid]);
    for (const tag of new Set(about.tags.map((t) => String(t).trim()).filter(Boolean)))
      await q.query("INSERT INTO media_tags (cid, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING", [cid, tag]);
  }
}

/** Describe a file the library holds (the seed step sends what library/<cid>.json says). */
export async function describe(cid: unknown, about: unknown): Promise<void> {
  const c = String(cid ?? "");
  if (!(await have([c])).length) throw new MediaError("The library does not hold that CID.", 404);
  const { rows: before } = await db.query<{ mime: string; meta: Record<string, any> }>("SELECT mime, meta FROM media WHERE cid = $1", [c]);
  const a = aboutOf(about);
  await db.transaction((tx) => describeIn(tx, c, a));
  await proxyOnDescribe(c, before[0]!.mime, before[0]!.meta ?? {}, a);
}

// ─────────────────────────────── proxies: every picture gets its colour read and an HD log proxy ───────────────────────────────

/** The worker's own files need no proxy: proxies, preview LUTs, and finished films. */
const NO_PROXY = ["role:proxy", "role:lut", "role:render"];

/** Does a file get a proxy job? Videos, images and EXR sequences (a tar with meta.sequence) — never the worker's own. */
export function wantsProxy(mime: string, tags: string[] = [], meta: Record<string, unknown> = {}): boolean {
  if (tags.some((t) => NO_PROXY.includes(t)) || meta.proxyOf) return false;
  const kind = kindOf(mime);
  return kind === "video" || kind === "image" || (mime === "application/x-tar" && Boolean(meta.sequence));
}

async function tagsOf(cid: string): Promise<string[]> {
  return (await db.query<{ tag: string }>("SELECT tag FROM media_tags WHERE cid = $1", [cid])).rows.map((r) => r.tag);
}

/**
 * After a description: a file whose colour is not known yet, and that never had a proxy job, gets one (the library
 * catching up with files from before proxies); a file whose colour was set by hand (meta.color.override changed)
 * gets a new one, made in its new colour.
 */
async function proxyOnDescribe(cid: string, mime: string, old: Record<string, any>, about: Description) {
  const meta = (about.meta ?? old) as Record<string, any>;
  const tags = about.tags ?? (await tagsOf(cid));
  if (!wantsProxy(mime, tags, meta)) return;
  const changed = (old.color?.override ?? null) !== (meta.color?.override ?? null);
  if (changed || (!meta.color && !(await hasProxyJob(cid)))) await queueProxy(cid);
}

/** A description from a request body: only the fields it has, of the right kinds. */
const aboutOf = (v: unknown): Description => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    ...(typeof o.title === "string" ? { title: o.title } : {}),
    ...(typeof o.description === "string" ? { description: o.description } : {}),
    ...(Array.isArray(o.tags) ? { tags: o.tags.map(String) } : {}),
    ...(o.meta && typeof o.meta === "object" && !Array.isArray(o.meta) ? { meta: o.meta as Record<string, unknown> } : {}),
    ...(typeof o.public === "boolean" ? { public: o.public } : {}),
  };
};

export type MediaRow = {
  cid: string;
  mime: string;
  kind: MediaKind;
  size: number;
  created: string;
  title: string;
  description: string;
  tags: string[];
  meta: Record<string, unknown>;
  public: boolean;
  cdn_path: string | null;
  stream_guid: string | null;
  distributed_at: string | null;
};

/** The library, newest first: what is known about each file, and where its public copy is. */
export async function listMedia(filter: { kind?: string; q?: string } = {}): Promise<MediaRow[]> {
  const { rows } = await db.query<MediaRow>(
    `SELECT m.cid, m.mime, m.kind, m.size, m.created, m.title, m.description, m.meta, m.public, m.cdn_path, m.stream_guid, m.distributed_at,
            coalesce((SELECT array_agg(t.tag ORDER BY t.tag) FROM media_tags t WHERE t.cid = m.cid), '{}') AS tags
       FROM media m
      WHERE ($1::text IS NULL OR m.kind = $1)
        AND ($2::text IS NULL OR m.cid = $2 OR m.title ILIKE '%' || $2 || '%' OR m.description ILIKE '%' || $2 || '%'
             OR EXISTS (SELECT 1 FROM media_tags q WHERE q.cid = m.cid AND q.tag ILIKE '%' || $2 || '%'))
      ORDER BY m.created DESC, m.cid`,
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

/** Every public file whose copy on the CDN has not been made yet (a private one never gets one). */
export async function undistributed(): Promise<{ cid: string; mime: string; kind: MediaKind; size: number; title: string }[]> {
  const { rows } = await db.query<any>("SELECT cid, mime, kind, size, title FROM media WHERE public AND distributed_at IS NULL ORDER BY size");
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

/** What the site knows of a file: where to load it (its CDN copy, once there is one), and how it is described. */
export type ManifestEntry = { url: string | null; mime: string; title: string; description: string; tags: string[]; stream?: string };

/** Every public file, by CID — the site finds its pictures and sounds by CID or by tag in this. */
export async function manifest(): Promise<Record<string, ManifestEntry>> {
  const { rows } = await db.query<{ cid: string; mime: string; title: string; description: string; cdn_path: string | null; stream_guid: string | null; tags: string[] }>(
    `SELECT m.cid, m.mime, m.title, m.description, m.cdn_path, m.stream_guid,
            coalesce((SELECT array_agg(t.tag ORDER BY t.tag) FROM media_tags t WHERE t.cid = m.cid), '{}') AS tags
       FROM media m WHERE m.public ORDER BY m.cid`,
  );
  return Object.fromEntries(rows.map((r) => [r.cid, {
    url: r.cdn_path ? `/${r.cdn_path}` : null, mime: r.mime, title: r.title, description: r.description, tags: r.tags,
    ...(r.stream_guid ? { stream: r.stream_guid } : {}),
  }]));
}

/** Tags for many files at once: each file's set replaced by the one given. */
export async function retag(tags: Map<string, Set<string>>): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [cid, set] of tags) await describeIn(tx, cid, { tags: [...set] });
  });
}

// ─────────────────────────────── uploads, through the API ───────────────────────────────

export class MediaError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Which of these CIDs does the library already hold? Those need no upload, only their description. */
export async function have(cids: string[]): Promise<string[]> {
  if (!cids.length) return [];
  const { rows } = await db.query<{ cid: string }>(
    "SELECT cid FROM media WHERE cid IN (SELECT jsonb_array_elements_text(($1::text)::jsonb))",
    [JSON.stringify(cids)],
  );
  return rows.map((r) => r.cid);
}

const partsOf = (size: number) => Math.max(1, Math.ceil(size / CHUNK));

/**
 * Begin (or resume) an upload: the file's CID (as the uploader computed it), size, type and description. The parts
 * already received come back, so an interrupted upload carries on where it stopped.
 */
const metaOf = (v: unknown) => JSON.stringify(v && typeof v === "object" && !Array.isArray(v) ? v : {});

export async function startUpload(founderId: string, body: Record<string, unknown>) {
  const cid = String(body.cid ?? ""), size = Number(body.size), mime = String(body.mime ?? "");
  if (!/^baf[a-z2-7]{20,}$/.test(cid)) throw new MediaError("Give the file's CID (CIDv1).");
  if (!Number.isSafeInteger(size) || size < 0) throw new MediaError("Give the file's size in bytes.");
  if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(mime)) throw new MediaError("Give the file's type (image/jpeg, video/mp4, …).");
  const { rows: old } = await db.query<{ id: string }>(
    "SELECT id FROM uploads WHERE founder_id = $1 AND cid = $2 AND size = $3 ORDER BY created DESC LIMIT 1",
    [founderId, cid, size],
  );
  const info = JSON.stringify(aboutOf(body));
  const id =
    old[0]?.id ??
    (await db.query<{ id: string }>("INSERT INTO uploads (founder_id, mime, size, cid, info) VALUES ($1, $2, $3, $4, ($5::text)::jsonb) RETURNING id", [founderId, mime, size, cid, info])).rows[0]!.id;
  if (old[0]) await db.query("UPDATE uploads SET info = ($2::text)::jsonb WHERE id = $1", [id, info]);
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
 * become media (or, when the library holds them already, are simply let go of). Either way it is described.
 */
export async function finishUpload(founderId: string, id: string): Promise<{ cid: string; stored: boolean }> {
  const { rows } = await db.query<{ mime: string; size: number; cid: string; info: unknown }>(
    "SELECT mime, size, cid, info FROM uploads WHERE id = $1 AND founder_id = $2",
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
    await describeIn(tx, cid, aboutOf(up.info));
    await tx.query("DELETE FROM uploads WHERE id = $1", [id]);
    return !known.length;
  });
  // a new picture: the worker reads its colour and makes its HD log proxy
  const about = aboutOf(up.info);
  if (stored && wantsProxy(up.mime, about.tags ?? [], about.meta ?? {})) await queueProxy(cid, founderId);
  return { cid, stored };
}

/** What the site needs to know, and anyone may: every public file with its copy on the CDN, by CID. */
export async function publicManifest(): Promise<Record<string, ManifestEntry>> {
  return Object.fromEntries(Object.entries(await manifest()).filter(([, v]) => v.url || v.stream));
}
