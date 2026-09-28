// A shorter cut of a film, as a new variant of the same project: stretches of the source timeline, joined end to end.
// Every track comes with them (picture, voice, music, sounds) — a clip that crosses a stretch's edge is trimmed to it,
// and music and sound fade briefly where two stretches meet. Voice lines are cut whole, so choose stretches around them.
//
//   bun api/scripts/cut.ts <cut.json> [--local]
//
// cut.json: { "project", "from": "G", "variant": "H", "name", "description", "aspect": "9:16",
//             "stretches": [[startSeconds, endSeconds], …] }   (times on the source timeline)
import { readFileSync } from "node:fs";
import { call, say } from "./media-client";

type Clip = { id: string; cid: string; track: string; start: number; in: number; dur: number; vol: number; fin?: number; fout?: number };
const file = process.argv.slice(2).find((a) => a.endsWith(".json"));
if (!file) throw new Error("usage: bun api/scripts/cut.ts <cut.json> [--local]");
const plan = JSON.parse(readFileSync(file, "utf8")) as { project: string; from: string; variant: string; name: string; description: string; aspect?: string; stretches: [number, number][] };

const timelines = await call<{ id: string; project: string | null; variant: string | null; aspect: string; tags: string[]; clips: Clip[] }[]>("/api/timelines");
const src = timelines.find((t) => t.project === plan.project && t.variant === plan.from);
if (!src) throw new Error(`no timeline ${plan.project} · ${plan.from}`);

const JOIN = 0.35; // the fade where two stretches of music or sound meet
const id = () => Math.random().toString(36).slice(2, 10);
const clips: Clip[] = [];
let at = 0;
for (const [k, [a, b]] of plan.stretches.entries()) {
  for (const c of src.clips) {
    const s = Math.max(a, c.start), e = Math.min(b, c.start + c.dur);
    if (e - s < 0.02) continue;
    const cutIn = s > c.start + 0.01, cutOut = e < c.start + c.dur - 0.01;
    const sound = c.track === "A2" || c.track === "A3";
    clips.push({
      ...c, id: c.id === "thumbnail" && k === 0 ? "thumbnail" : id(),
      start: +(at + s - a).toFixed(3), in: +(c.in + s - c.start).toFixed(3), dur: +(e - s).toFixed(3),
      ...(sound && cutIn ? { fin: JOIN } : {}), ...(sound && cutOut ? { fout: JOIN } : {}),
    });
  }
  at += b - a;
}
say(`${plan.stretches.length} stretches → ${at.toFixed(1)} s, ${clips.length} clips`);
if (at > 90 && plan.aspect === "9:16") say("longer than 90 s: Instagram Reels (via Zernio) will not take it");

const body = { name: plan.name, description: plan.description, project: plan.project, variant: plan.variant, aspect: plan.aspect ?? src.aspect, tags: src.tags, clips };
const existing = timelines.find((t) => t.project === plan.project && t.variant === plan.variant);
if (existing) await call(`/api/timelines/${existing.id}`, { method: "PUT", body: JSON.stringify(body) });
else await call("/api/timelines", { method: "POST", body: JSON.stringify(body) });
say(`${existing ? "updated" : "created"} ${plan.project} · ${plan.variant}: ${plan.name}`);
