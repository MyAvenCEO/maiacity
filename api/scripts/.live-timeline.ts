// Day 19 variant G, filled in as it renders: it starts as the storyboard (F's stills, voice, score and sound), and
// every shot that shoot.mjs finishes (a new studio/film/day-19-d/NN-name.mp4, newer than --since) goes into the
// library and takes its stills' place on V1 at once. Local only. Stops when every shot is in.
//
//   bun api/scripts/.live-timeline.ts --local --since <unix seconds> [--from F --variant G]
import { statSync, existsSync } from "node:fs";
import { call, say } from "./media-client";
import { bring } from "./library";
const film = (await import("../../scripts/film/day-19-d.mjs")).default;
const DIR = "studio/film/day-19-d";
const arg = (k: string, d: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1]! : d);
const SINCE = Number(arg("since", "0")) * 1000, FROM = arg("from", "F"), VARIANT = arg("variant", "G");
const NAME = "Full shots 2";
const DESCRIPTION = "42 rendered shots · drone flight, sunrise time-lapse, the highway set · gliding moves, whip pans · exposed for the hour · 2:49";

type Clip = { id: string; cid: string; track: string; start: number; in: number; dur: number; vol: number };
const find = async (v: string) => (await call<any[]>("/api/timelines")).find((t) => t.project === "Day 19" && t.variant === v);
let g = await find(VARIANT);
if (!g) {
  const f = await find(FROM);
  g = await call("/api/timelines", { method: "POST", body: JSON.stringify({ name: NAME, description: DESCRIPTION, project: "Day 19", variant: VARIANT, aspect: "1:1", tags: ["Day 19", "film"], clips: f.clips }) });
  say(`created Day 19 · ${VARIANT} from ${FROM}'s storyboard`);
}
const placed = new Set<number>();
const id = () => Math.random().toString(36).slice(2, 10);
for (;;) {
  for (const [i, s] of film.shots.entries()) {
    if (placed.has(i)) continue;
    const tag = `${String(i + 1).padStart(2, "0")}-${s.name}`, file = `${DIR}/${tag}.mp4`;
    if (!existsSync(file) || statSync(file).mtimeMs < SINCE) continue;
    // only a finished file: its size has held for three seconds (a shot uploaded mid-write played black)
    let size = -1;
    while (statSync(file).size !== size) (size = statSync(file).size), await Bun.sleep(3000);
    const up = await bring(file, {
      title: `Day 19 · ${String(i + 1).padStart(2, "0")} ${s.size} · ${s.name}`, tags: ["Day 19", "role:shot", `cut:${VARIANT}`, `shot:${String(i + 1).padStart(2, "0")} ${s.name.replace(/-/g, " ")}`, "sandbox 4"], meta: { size: s.size, hour: s.hour },
    });
    const c = film.cuts[i];
    const now = await find(VARIANT);
    // out go the stills (and the thumbnail frame stays): anything on V1 within this shot's span
    const clips: Clip[] = now.clips.filter((x: Clip) => !(x.track === "V1" && x.id !== "thumbnail" && x.start >= c.start - 0.01 && x.start < c.end - 0.01));
    clips.push({ id: id(), cid: up.cid, track: "V1", start: c.start, in: 0, dur: c.seconds, vol: 0 });
    await call(`/api/timelines/${now.id}`, { method: "PUT", body: JSON.stringify({ clips, name: NAME, description: DESCRIPTION }) });
    placed.add(i);
    say(`${placed.size}/${film.shots.length} · ${tag} is in ${VARIANT}`);
  }
  if (placed.size === film.shots.length) break;
  await Bun.sleep(10000);
}
say(`Day 19 · ${VARIANT}: every shot is in`);
