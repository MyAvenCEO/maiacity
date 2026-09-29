// The studio's timelines (every film and every cut of it), from the local database to production: each timeline is
// matched by project and variant (by name when it has no project), created or brought up to date. Their files are not
// sent: they travel in the vault (this Mac's app to the server peer). Every file a clip names is checked against
// production's vault mirror first, and one production does not hold yet is named — its timeline still goes up.
//
//   bun api/scripts/timelines.ts [--dry]
//
// Needs both keys: bun media login --local, and bun media login.
import { API, call, KEYS, mb, readJson, say } from "./media-client";

type Clip = { hash?: string; kind?: string };
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

// the files: a timeline on production is only as good as the files its vault holds
const mirror = new Map((await call<{ hash: string; size: number; stored: boolean; title: string }[]>("/api/vault/files")).map((f) => [f.hash, f]));
const hashes = [...new Set(mine.flatMap((t) => t.clips.flatMap((c) => (c.hash ? [c.hash] : []))))];
const missing = hashes.filter((h) => !mirror.get(h)?.stored);
say(`${API}: ${mine.length} timelines here, ${theirs.length} there; their clips use ${hashes.length} files, ${missing.length} not in production's vault yet`);
for (const h of missing) say(`  ${h}  ${mirror.has(h) ? `${mirror.get(h)!.title} (${mb(mirror.get(h)!.size)}) — described, its bytes still on the way` : "unknown there — open the Mac app so it syncs"}`);
if (dry) process.exit(0);

let made = 0, updated = 0;
for (const t of mine) {
  const body = JSON.stringify({ name: t.name, project: t.project, variant: t.variant, description: t.description, aspect: t.aspect, tags: t.tags, clips: t.clips });
  const there = theirs.find((x) => key(x) === key(t));
  if (there) await call(`/api/timelines/${there.id}`, { method: "PUT", body }), updated++;
  else await call("/api/timelines", { method: "POST", body }), made++;
}
say(`timelines: ${made} created, ${updated} brought up to date`);
