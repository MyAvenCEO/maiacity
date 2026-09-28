// Day 19 variant D as a storyboard timeline: one still per shot on V1 at its cut, every take on A1,
// the composed score on A2, the shot's sounds on A3. Local only.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { call, say } from "./media-client";
import { bareCid, bring } from "./library";
import { musicClips, soundClips } from "../../scripts/film/sound";
// @ts-expect-error — a plain .mjs module
import { exposureFor } from "../../scripts/film/grade.mjs";
const film = (await import("../../scripts/film/day-19-d.mjs")).default;
const DIR = "studio/film/day-19-d";
// which variant to build: bun api/scripts/.animatic.ts --local [--variant F --name … --description …]
const arg = (k: string, d: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1]! : d);
const VARIANT = arg("variant", "D");
const id = () => Math.random().toString(36).slice(2, 10);
const clips: unknown[] = [];
for (const [i, s] of film.shots.entries()) {
  const tag = `${String(i + 1).padStart(2, "0")}-${s.name}`;
  const c = film.cuts[i];
  // a long shot shows its start, middle and end (the flight off the forest floor, up to the view); else its middle
  const keys = c.seconds > 6 && ["a", "c"].every((k) => existsSync(`${DIR}/${tag}-${k}.jpg`)) ? ["a", "b", "c"] : ["b"];
  for (const [j, k] of keys.entries()) {
    const raw = `${DIR}/${tag}-${k}.jpg`;
    if (!existsSync(raw)) throw new Error(`missing still ${raw}`);
    const graded = `${DIR}/${tag}-${k}-story.jpg`;
    // the still as the film will look: scaled to the frame, its exposure set for its hour, graded like its shot
    const chain = (exposure: string) => `scale=1080:1080:flags=lanczos,${exposure ? `${exposure},` : ""}eq=contrast=1.05:saturation=1.06:gamma=0.98,${s.grade ? `${s.grade},` : ""}vignette=angle=PI/5`;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-vf", chain(exposureFor(s, [raw], chain)), "-q:v", "3", graded]);
    const up = await bring(graded, { title: `Day 19 ${VARIANT} · ${String(i + 1).padStart(2, "0")} ${s.size} · ${s.name}${keys.length > 1 ? ` (${k})` : ""}`, tags: ["Day 19", "role:storyboard", `cut:${VARIANT}`, `shot:${String(i + 1).padStart(2, "0")} ${s.name.replace(/-/g, " ")}`], meta: { size: s.size } });
    const part = c.seconds / keys.length;
    clips.push({ id: id(), cid: up.cid, track: "V1", start: c.start + j * part, in: 0, dur: part, vol: 0 });
  }
}
const cid = bareCid;
clips.push(...soundClips(film.name, film, cid));
for (const v of film.voices) clips.push({ id: id(), cid: cid(v.cid), track: "A1", start: Math.max(0, v.at), in: Math.max(0, -v.at), dur: v.words.at(-1).end - Math.max(0, -v.at) + 0.4, vol: 1 });
clips.push(...musicClips(film, cid));
const name = arg("name", "Storyboard");
const description = arg("description", "40 stills cut on the words · own score · sound design · 2:49");
const existing = (await call<{ id: string; project: string; variant: string }[]>("/api/timelines")).find((t) => t.project === "Day 19" && t.variant === VARIANT);
if (existing) await call(`/api/timelines/${existing.id}`, { method: "PUT", body: JSON.stringify({ name, description, clips, aspect: "1:1", tags: ["Day 19", "storyboard"] }) });
else await call("/api/timelines", { method: "POST", body: JSON.stringify({ name, description, project: "Day 19", variant: VARIANT, aspect: "1:1", tags: ["Day 19", "storyboard"], clips }) });
say(`${existing ? "updated" : "created"} Day 19 · ${VARIANT}: ${clips.length} clips, ${film.total.toFixed(1)} s`);
