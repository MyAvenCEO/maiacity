// library/: the single source of truth for media, for now. Every file once, named by its content — <cid>.<ext> —
// and beside it <cid>.json: what is known about it (title, description, tags, meta, whether it is public). There
// are no paths and no folders: everything names a file by its CID (tags only sort). The databases (local,
// production) are seeded from here; the site and the servers only ever read the databases (and, in production, the CDN).
//
// New files come in with put(): the bytes are copied in (never linked), the description written, and — when the file
// replaces another (a re-rendered title card) — the one before is marked superseded.
import { existsSync } from "node:fs";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
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
