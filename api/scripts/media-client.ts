// What the terminal's scripts share: where the repository is, and how they speak. They hold no key of the API: files
// live in avenDB (scripts/film/vault.mjs, as an agent device of avenMAIA, by its caps alone; Samuel 2026-10-19: every
// agent goes through avenDB vault caps). Shared by `bun media`, `bun voice` and the film scripts.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "../..");

export const say = (s: string) => console.log(s);
export const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}
