// The terminal's side of the media library API: where it is, the key this terminal was given, and uploads.
// Shared by `bun media` and `bun voice`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { cidOf, mimeOf } from "../src/media";

export const ROOT = join(import.meta.dir, "../..");
export const local = process.argv.includes("--local");
export const API = local ? "http://localhost:3100" : "https://api.maia.city";
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

/** Upload one file under a path, in resumable parts; the server checks the CID. Known bytes are only named. */
export async function upload(bytes: Uint8Array, path: string, opts: { cid?: string; mime?: string; meta?: Record<string, unknown>; progress?: boolean } = {}) {
  const cid = opts.cid ?? (await cidOf(bytes));
  const mime = opts.mime ?? mimeOf(path);
  const { have } = await call<{ have: string[] }>("/api/media/have", { method: "POST", body: JSON.stringify({ cids: [cid] }) });
  if (have.length) {
    await call("/api/media/paths", { method: "POST", body: JSON.stringify({ path, cid, meta: opts.meta }) });
    return { cid, stored: false };
  }
  const start = await call<{ id: string; chunk: number; parts: number; received: number[] }>("/api/media/uploads", {
    method: "POST",
    body: JSON.stringify({ path, size: bytes.length, cid, mime, meta: opts.meta }),
  });
  const todo = [...Array(start.parts).keys()].filter((i) => !start.received.includes(i));
  let next = 0, sent = start.received.length;
  const worker = async () => {
    while (next < todo.length) {
      const i = todo[next++]!;
      await call(`/api/media/uploads/${start.id}/${i}`, { method: "PUT", body: new Blob([bytes.subarray(i * start.chunk, (i + 1) * start.chunk) as BlobPart]), headers: { "content-type": "application/octet-stream" } });
      sent++;
      if (opts.progress && start.parts > 8) process.stdout.write(`\r  ${path}  ${Math.round((sent / start.parts) * 100)}%   `);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (opts.progress && start.parts > 8) process.stdout.write("\n");
  return call<{ cid: string; stored: boolean }>(`/api/media/uploads/${start.id}/finish`, { method: "POST" });
}
