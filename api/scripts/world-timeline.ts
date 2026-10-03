// Day 19 with the world on the timeline: every rendered shot of variant G ("Full shots 2") becomes a world shot —
// its camera, light and world as data (game/film/shot.js, /api/shots) — and a new variant W ("World") has a world
// clip in each shot's place, at the same start and length, with every sound clip and every other picture clip (the
// title card, the thumbnail frame) copied as it is. Nothing is rendered: the studio plays the world live, the worker
// renders plates at the end.
//
//   bun api/scripts/world-timeline.ts [--local] [--from G] [--variant W] [--name World] [--list scripts/film/day-19-d.mjs]
//
// Each V1 shot clip is matched to its shot in the list by its file's tag in the vault, `shot:NN name` (NN = the
// shot's number), or, for a clip without one, by its order on V1. The shot's length and its place on the film's clock
// come from the clip, so the voice's word timings are not needed. Run again, it updates: a shot whose spec changed gets
// a new version, and W's clips are replaced.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { API, call, say } from "./media-client";
import { fromLegacy } from "../../game/film/shot.js";
import { list } from "../../scripts/film/vault.mjs";
import { nameOfDay } from "../../src/lib/stories/names.js";

const arg = (k: string, d: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1]! : d);
const FROM = arg("from", "G"), VARIANT = arg("variant", "W"), NAME = arg("name", "World"), PROJECT = arg("project", nameOfDay(19));
const LIST = resolve(arg("list", "scripts/film/day-19-d.mjs"));
const film = (await import(pathToFileURL(LIST).href)).default as { name: string; shots: any[] };

type Clip = { id: string; track: string; start: number; in: number; dur: number; vol: number; kind?: string; hash?: string; shot?: string; shotVersion?: number; [k: string]: unknown };
type Timeline = { id: string; name: string; project: string | null; variant: string | null; aspect: string; tags: string[]; description: string | null; clips: Clip[] };
type Shot = { id: string; name: string; project: string | null; version: number; spec: unknown };

const timelines = await call<Timeline[]>("/api/timelines");
const from = timelines.find((t) => t.project === PROJECT && t.variant === FROM);
if (!from) throw new Error(`No timeline ${PROJECT} · ${FROM} on ${API}.`);
say(`${PROJECT} · ${FROM} (${from.name}): ${from.clips.length} clips`);

// which file is which shot: its `shot:NN name` tag in the vault
const numberOf = new Map<string, number>();
for (const m of await list())
  for (const tag of m.tags ?? []) {
    const n = /^shot:(\d+)\b/.exec(tag);
    if (n) numberOf.set(m.hash, Number(n[1]));
  }

const v1 = from.clips.filter((c) => c.track === "V1" && (c.kind ?? "media") === "media" && c.id !== "thumbnail").sort((a, b) => a.start - b.start);
// by tag first; the clips with no tag take the shots left over, in order
const byShot = new Map<number, Clip>();
for (const c of v1) {
  const n = numberOf.get(c.hash ?? "");
  if (n && n >= 1 && n <= film.shots.length && !byShot.has(n - 1)) byShot.set(n - 1, c);
}
const untagged = v1.filter((c) => ![...byShot.values()].includes(c));
const left = film.shots.map((_, i) => i).filter((i) => !byShot.has(i));
untagged.slice(0, left.length).forEach((c, k) => byShot.set(left[k]!, c));
if (!byShot.size) throw new Error(`No shot clips on ${FROM}'s V1.`);
say(`${byShot.size} of ${film.shots.length} shots found on V1 (${[...byShot.keys()].filter((i) => numberOf.has(byShot.get(i)!.hash ?? "")).length} by their tag)`);

// the shots, as records: one per shot of the list, named as the vault names them
const existing = await call<Shot[]>(`/api/shots?project=${encodeURIComponent(PROJECT)}`);
const worldClip = new Map<Clip, Clip>();
for (const [i, clip] of [...byShot.entries()].sort((a, b) => a[0] - b[0])) {
  const s = film.shots[i];
  const nn = String(i + 1).padStart(2, "0");
  const name = `${film.name} · ${nn} ${s.name.replace(/-/g, " ")}`;
  // the shot runs from its first frame to the end of the clip as cut; its world clock starts where the clip does
  const spec = fromLegacy(s, { seconds: clip.in + clip.dur, clock: clip.start - clip.in });
  const had = existing.find((x) => x.name === name);
  const shot = had
    ? await call<Shot>(`/api/shots/${had.id}`, { method: "PUT", body: JSON.stringify({ spec }) })
    : await call<Shot>("/api/shots", { method: "POST", body: JSON.stringify({ name, project: PROJECT, spec }) });
  say(`  ${nn} ${s.name}: shot ${shot.id.slice(0, 8)} v${shot.version}${had ? (had.version === shot.version ? " (unchanged)" : " (new version)") : " (new)"}`);
  worldClip.set(clip, { id: clip.id, kind: "world", shot: shot.id, shotVersion: shot.version, track: "V1", start: clip.start, in: clip.in, dur: clip.dur, vol: 0,
    ...(clip.fin !== undefined ? { fin: clip.fin } : {}), ...(clip.fout !== undefined ? { fout: clip.fout } : {}) });
}

// W: every clip as it was, the shots' clips swapped for their world clips
const clips = from.clips.map((c) => worldClip.get(c) ?? c);
const body = {
  name: NAME,
  project: PROJECT,
  variant: VARIANT,
  aspect: from.aspect,
  tags: [...new Set([...from.tags, "world"])],
  description: `${FROM} with the world on the timeline: ${worldClip.size} world shots (data, rendered at the end) · every sound as in ${FROM}`,
  clips,
};
const had = timelines.find((t) => t.project === PROJECT && t.variant === VARIANT);
const w = had
  ? await call<Timeline>(`/api/timelines/${had.id}`, { method: "PUT", body: JSON.stringify(body) })
  : await call<Timeline>("/api/timelines", { method: "POST", body: JSON.stringify(body) });
say(`${had ? "updated" : "created"} ${PROJECT} · ${VARIANT} · ${NAME} (${w.id}): ${w.clips.filter((c) => c.kind === "world").length} world clips, ${w.clips.filter((c) => c.kind !== "world").length} others`);
