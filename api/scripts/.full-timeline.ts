// Day 19 variant E: the storyboard's timing with the rendered shots — every shot on V1 at its cut, the thumbnail on
// the first frame, the takes on A1, the score on A2, the sounds on A3. Local only.
import { call, say } from "./media-client";
import { bareCid, bring } from "./library";
import { musicClips, soundClips } from "../../scripts/film/sound";
const film = (await import("../../scripts/film/day-19-d.mjs")).default;
const DIR = "studio/film/day-19-d";
// bun api/scripts/.full-timeline.ts --local [--variant G --name … --description …]
const arg = (k: string, d: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1]! : d);
const VARIANT = arg("variant", "E");
const id = () => Math.random().toString(36).slice(2, 10);
const clips: unknown[] = [];
for (const [i, s] of film.shots.entries()) {
  const tag = `${String(i + 1).padStart(2, "0")}-${s.name}`;
  const up = await bring(`${DIR}/${tag}.mp4`, {
    title: `Day 19 D · ${String(i + 1).padStart(2, "0")} ${s.size} · ${s.name}`, tags: ["Day 19", "role:shot", `shot:${String(i + 1).padStart(2, "0")} ${s.name.replace(/-/g, " ")}`, "sandbox 4"], meta: { size: s.size, hour: s.hour },
  });
  const c = film.cuts[i];
  clips.push({ id: id(), cid: up.cid, track: "V1", start: c.start, in: 0, dur: c.seconds, vol: 0 });
  process.stdout.write(`\r${i + 1}/${film.shots.length} shots in the library   `);
}
say("");
const cid = bareCid;
clips.push({ id: "thumbnail", cid: cid("bafybeid43rcs67pryfneg5e3mfcg7u6n6fvic6dkarrzdkojs4jhikjawu.jpg"), track: "V1", start: 0, in: 0, dur: 0.1, vol: 0 });
clips.push(...soundClips(film.name, film, cid));
for (const v of film.voices) clips.push({ id: id(), cid: cid(v.cid), track: "A1", start: Math.max(0, v.at), in: Math.max(0, -v.at), dur: v.words.at(-1).end - Math.max(0, -v.at) + 0.4, vol: 1 });
clips.push(...musicClips(film, cid));
const name = arg("name", "Full shots");
const description = arg("description", "40 rendered shots · own score · sound design · 2:49");
const existing = (await call<any[]>("/api/timelines")).find((t) => t.project === "Day 19" && t.variant === VARIANT);
const body = { name, description, project: "Day 19", variant: VARIANT, aspect: "1:1", tags: ["Day 19", "film"], clips };
if (existing) await call(`/api/timelines/${existing.id}`, { method: "PUT", body: JSON.stringify(body) });
else await call("/api/timelines", { method: "POST", body: JSON.stringify(body) });
say(`${existing ? "updated" : "created"} Day 19 · ${VARIANT}: ${clips.length} clips, ${film.total.toFixed(1)} s`);
