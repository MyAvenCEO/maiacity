// The studio's timelines (every film and every cut of it), from the local database to production: each timeline is
// matched by project and variant (by name when it has no project), created or brought up to date, and every file its
// clips point at goes up first (from library/, with its description), so production can play and render it, and
// with them every rendered cut (role:render).
//
//   bun api/scripts/timelines.ts [--dry]
//
// Needs both keys: bun media login --local, and bun media login.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileOf } from "./library";
import { API, call, KEYS, mb, readJson, ROOT, say, upload } from "./media-client";

type Clip = { cid: string };
type Timeline = { id: string; name: string; project: string | null; variant: string | null; description: string | null; aspect: string; tags: string[]; clips: Clip[] };

if (process.argv.includes("--local")) throw new Error("this copies local → production; run it without --local");
const dry = process.argv.includes("--dry");
const LOCAL = "http://localhost:3100";
const localKey = (await readJson<Record<string, string>>(KEYS, {}))[LOCAL];
if (!localKey) throw new Error("Not signed in locally. Run: bun media login --local");
const res = await fetch(`${LOCAL}/api/timelines`, { headers: { authorization: `Bearer ${localKey}` } });
if (!res.ok) throw new Error(`${LOCAL}/api/timelines: ${res.status}`);
const mine = (await res.json()) as Timeline[];
const theirs = await call<Timeline[]>("/api/timelines");
const key = (t: Timeline) => (t.project ? `${t.project} · ${t.variant ?? ""}` : `name: ${t.name}`);

// the files first: a timeline on production is only as good as the files it can find there — and its rendered cuts
const renders: string[] = [];
for (const f of await readdir(join(ROOT, "library")))
  if (f.endsWith(".json") && (await readJson<{ tags?: string[] }>(join(ROOT, "library", f), {})).tags?.includes("role:render")) renders.push(f.slice(0, -5));
const cids = [...new Set([...mine.flatMap((t) => t.clips.map((c) => c.cid)), ...renders])];
const { have } = await call<{ have: string[] }>("/api/media/have", { method: "POST", body: JSON.stringify({ cids }) });
const missing = cids.filter((c) => !have.includes(c));
let size = 0;
for (const c of missing) size += (await stat(await fileOf(c))).size;
say(`${API}: ${mine.length} timelines here, ${theirs.length} there; their clips use ${cids.length} files, ${missing.length} to upload (${mb(size)})`);
if (dry) process.exit(0);

for (const [i, cid] of missing.entries()) {
  const file = await fileOf(cid);
  const about = await readJson<{ mime?: string; title?: string; description?: string; tags?: string[]; meta?: Record<string, unknown>; public?: boolean }>(file.replace(/\.[^.]+$/, ".json"), {});
  await upload(new Uint8Array(await readFile(file)), { cid, mime: about.mime ?? "application/octet-stream", title: about.title, description: about.description, tags: about.tags, meta: about.meta, public: about.public ?? false, progress: true });
  say(`${String(i + 1).padStart(4)}/${missing.length} ${cid}  ${about.title ?? ""}`);
}

let made = 0, updated = 0;
for (const t of mine) {
  const body = JSON.stringify({ name: t.name, project: t.project, variant: t.variant, description: t.description, aspect: t.aspect, tags: t.tags, clips: t.clips });
  const there = theirs.find((x) => key(x) === key(t));
  if (there) await call(`/api/timelines/${there.id}`, { method: "PUT", body }), updated++;
  else await call("/api/timelines", { method: "POST", body }), made++;
}
say(`timelines: ${made} created, ${updated} brought up to date`);
