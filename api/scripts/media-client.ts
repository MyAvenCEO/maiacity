// The terminal's side of the media library API: where it is, the key this terminal was given, and uploads.
// Shared by `bun media` and `bun voice`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { cidOf } from "../src/media";

export const ROOT = join(import.meta.dir, "../..");
export const local = process.argv.includes("--local");
// MAIA_API: another API (a second local one on its own port, for a parallel checkout)
export const API = process.env.MAIA_API ?? (local ? "http://localhost:3100" : "https://api.maia.city");
export const SITE = local ? "http://localhost:5173" : "https://maia.city";
export const CONFIG = join(homedir(), ".config", "maiacity");
export const KEYS = join(CONFIG, "media-keys.json");

export const say = (s: string) => console.log(s);
export const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function saveKey(key: string | null) {
  await mkdir(CONFIG, { recursive: true });
  const keys = await readJson<Record<string, string>>(KEYS, {});
  if (key) keys[API] = key;
  else delete keys[API];
  await writeFile(KEYS, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

export async function keyFor(): Promise<string> {
  const k = (await readJson<Record<string, string>>(KEYS, {}))[API];
  if (!k) throw new Error(`Not signed in to ${API}. Run: bun media login${local ? " --local" : ""}`);
  return k;
}

export async function call<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
  const key = init.key ?? (await keyFor());
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${body?.error ?? res.status}`);
  return body as T;
}

/** What is known about a file, as the library/ folder has it (library/<cid>.json). */
export type Described = { title?: string; description?: string; tags?: string[]; meta?: Record<string, unknown>; public?: boolean };

/** Upload one file, in resumable parts, with its description; the server checks the CID. Known bytes are only described. */
export async function upload(bytes: Uint8Array, opts: Described & { cid?: string; mime: string; progress?: boolean; label?: string }) {
  const cid = opts.cid ?? (await cidOf(bytes));
  const about: Described = { title: opts.title, description: opts.description, tags: opts.tags, meta: opts.meta, public: opts.public };
  const { have } = await call<{ have: string[] }>("/api/media/have", { method: "POST", body: JSON.stringify({ cids: [cid] }) });
  if (have.length) {
    await call("/api/media/describe", { method: "POST", body: JSON.stringify({ cid, ...about }) });
    return { cid, stored: false };
  }
  const start = await call<{ id: string; chunk: number; parts: number; received: number[] }>("/api/media/uploads", {
    method: "POST",
    body: JSON.stringify({ cid, size: bytes.length, mime: opts.mime, ...about }),
  });
  const todo = [...Array(start.parts).keys()].filter((i) => !start.received.includes(i));
  let next = 0, sent = start.received.length;
  const worker = async () => {
    while (next < todo.length) {
      const i = todo[next++]!;
      // a part that fails (a 502 from the proxy, a dropped connection) is sent again, not the whole file
      for (let attempt = 1; ; attempt++) {
        try {
          await call(`/api/media/uploads/${start.id}/${i}`, { method: "PUT", body: new Blob([bytes.subarray(i * start.chunk, (i + 1) * start.chunk) as BlobPart]), headers: { "content-type": "application/octet-stream" } });
          break;
        } catch (e) {
          if (attempt >= 5) throw e;
          await Bun.sleep(2000 * attempt);
        }
      }
      sent++;
      if (opts.progress && start.parts > 8) process.stdout.write(`\r  ${opts.label ?? opts.title ?? cid}  ${Math.round((sent / start.parts) * 100)}%   `);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (opts.progress && start.parts > 8) process.stdout.write("\n");
  return call<{ cid: string; stored: boolean }>(`/api/media/uploads/${start.id}/finish`, { method: "POST" });
}
