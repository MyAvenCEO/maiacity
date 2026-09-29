// library/: the single source of truth for media, for now. Every file once, named by its content — <cid>.<ext> —
// and beside it <cid>.json: what is known about it (title, description, tags, meta, whether it is public). There
// are no paths and no folders: everything names a file by its CID (tags only sort). The databases (local,
// production) are seeded from here; the site and the servers only ever read the databases (and, in production, the CDN).
//
// New files come in with put(): the bytes are copied in (never linked), the description written, and — when the file
// replaces another (a re-rendered title card) — the one before is marked superseded.
import { existsSync } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cidOf, EXT, kindOf, mimeOf } from "../src/media";
import { ROOT, upload } from "./media-client";

export const DIR = join(ROOT, "library");

export type Doc = {
  cid: string;
  /** its file in library/: <cid>.<ext> */
  file: string;
  mime: string;
  kind: string;
  size: number;
  title: string;
  description: string;
  /** how it is sorted (never how it is found — that is its CID): "Day 19", "role:thumbnail", "shape:16x9", … */
  tags: string[];
  meta: Record<string, unknown>;
  /** public: the site or a platform shows it (it gets a copy on the CDN); a working file is not */
  public: boolean;
  /** when it came into the library */
  added: string;
};

const docPath = (cid: string) => join(DIR, `${cid}.json`);

/** Every file the library holds. */
export async function all(): Promise<Doc[]> {
  const names = (await readdir(DIR)).filter((f) => /^baf[a-z2-7]+\.json$/.test(f));
  return Promise.all(names.map(async (f) => JSON.parse(await readFile(join(DIR, f), "utf8")) as Doc));
}

export async function get(cid: string): Promise<Doc | null> {
  return existsSync(docPath(cid)) ? (JSON.parse(await readFile(docPath(cid), "utf8")) as Doc) : null;
}

/** The file on disk for a CID. */
export async function fileOf(cid: string): Promise<string> {
  const doc = await get(cid);
  if (!doc) throw new Error(`the library does not hold ${cid}`);
  return join(DIR, doc.file);
}

export async function save(doc: Doc) {
  doc.tags = [...new Set(doc.tags)].sort();
  await writeFile(docPath(doc.cid), JSON.stringify(doc, null, 1) + "\n");
}

export type About = {
  title?: string;
  description?: string;
  tags?: string[];
  meta?: Record<string, unknown>;
  public?: boolean;
  /** its type, when a file name does not tell it */
  mime?: string;
  /** the files it replaces, by CID: they stay in the library, marked superseded */
  replaces?: string[];
};

/** Bring a file into the library (a path on disk, or bytes): copied in, described. Returns its description. */
export async function put(from: string | Uint8Array, about: About): Promise<Doc> {
  const bytes = typeof from === "string" ? new Uint8Array(await readFile(from)) : from;
  const cid = await cidOf(bytes);
  const mime = about.mime ?? (typeof from === "string" ? mimeOf(from) : "application/octet-stream");
  const file = `${cid}.${EXT[mime] ?? "bin"}`;
  const target = join(DIR, file);
  await mkdir(DIR, { recursive: true });
  if (!existsSync(target)) {
    if (typeof from === "string") await copyFile(from, target);
    else await writeFile(target, bytes);
  }
  const before = await get(cid);
  const doc: Doc = {
    cid, file, mime, kind: kindOf(mime), size: bytes.length,
    title: about.title ?? before?.title ?? cid.slice(0, 12),
    description: about.description ?? before?.description ?? "",
    tags: [...new Set([...(before?.tags ?? []).filter((t) => t !== "superseded"), ...(about.tags ?? [])])],
    meta: { ...(before?.meta ?? {}), ...(about.meta ?? {}) },
    public: about.public ?? before?.public ?? false,
    added: before?.added ?? new Date().toISOString(),
  };
  for (const old of about.replaces ?? []) {
    const other = old !== cid ? await get(old) : null;
    if (other && !other.tags.includes("superseded")) await save({ ...other, tags: [...other.tags, "superseded"] });
  }
  await save(doc);
  return doc;
}

/** A reference to a file — its CID, alone or with its extension ("bafy….mp3") — as the bare CID. */
export const bareCid = (ref: string) => ref.replace(/\.[a-z0-9]+$/, "");

/** Into library/ and straight on into the database (the one this terminal talks to: --local or production). */
export async function bring(from: string | Uint8Array, about: About): Promise<Doc> {
  const d = await put(from, about);
  const bytes = new Uint8Array(await readFile(join(DIR, d.file)));
  await upload(bytes, { cid: d.cid, mime: d.mime, title: d.title, description: d.description, tags: d.tags, meta: d.meta, public: d.public });
  return d;
}

// ─────────────────────────────── EXR sequences: one tar per clip ───────────────────────────────

/** A 512-byte POSIX ustar header, deterministic: no owner, no time, mode 0644. */
function tarHeader(name: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  const put = (at: number, text: string) => h.set(new TextEncoder().encode(text), at);
  const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";
  put(0, name);
  put(100, "0000644\0");
  put(108, "0000000\0");
  put(116, "0000000\0");
  put(124, octal(size, 12));
  put(136, octal(0, 12));
  put(148, "        ");
  put(156, "0");
  put(257, "ustar\0");
  put(263, "00");
  const sum = h.reduce((n, b) => n + b, 0);
  put(148, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

/**
 * Pack an EXR sequence (a folder of frames, in name order) into one tar: the frames renamed 000000.exr, 000001.exr, …,
 * with no dates or owners, so the same frames always give the same bytes and the same CID. Written to `out`.
 * Returns the number of frames.
 */
export async function packSequence(dir: string, out: string): Promise<{ frames: number; first: string }> {
  const names = (await readdir(dir)).filter((f) => /\.exr$/i.test(f)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!names.length) throw new Error(`${dir} holds no .exr frames`);
  const fh = await open(out, "w");
  try {
    for (const [i, f] of names.entries()) {
      const bytes = new Uint8Array(await readFile(join(dir, f)));
      await fh.write(tarHeader(`${String(i).padStart(6, "0")}.exr`, bytes.length));
      await fh.write(bytes);
      const pad = (512 - (bytes.length % 512)) % 512;
      if (pad) await fh.write(new Uint8Array(pad));
    }
    await fh.write(new Uint8Array(1024));
  } finally {
    await fh.close();
  }
  if ((await stat(out)).size < 1536) throw new Error("the tar came out empty");
  return { frames: names.length, first: join(dir, names[0]!) };
}
