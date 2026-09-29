// The terminal's side of the API: where it is, and the key this terminal was given. Files are not the API's: they
// live in the vault (scripts/film/vault.mjs, the Mac app's local server). Shared by `bun media`, `bun voice`, the
// render worker and the scripts.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "../..");
export const local = process.argv.includes("--local");
// MAIACITY_API (or MAIA_API) points a terminal, the render worker or a script at another API — a test server, a
// second local one on its own port for a parallel checkout
export const API = process.env.MAIACITY_API ?? process.env.MAIA_API ?? (local ? "http://localhost:3100" : "https://api.maia.city");
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
  // MAIACITY_KEY: a key given outright (a test run, a worker started with its own key)
  const k = process.env.MAIACITY_KEY ?? (await readJson<Record<string, string>>(KEYS, {}))[API];
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
