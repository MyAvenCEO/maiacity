// A stand-in for Day 19 · G on a local API, to test api/scripts/world-timeline.ts without production: a fake rendered
// shot for every shot of the list (a few bytes each, tagged as .live-timeline.ts tags them — some left untagged on
// purpose, to test matching by order), fake voice, music and sound clips, the thumbnail frame, and the timeline
// itself, timed by the list's cuts (run with LIBRARY=<fake library> — scripts/film/fixtures/fake-library.mjs).
//
//   MAIA_API=http://localhost:3102 LIBRARY=/tmp/fake-lib bun scripts/film/fixtures/fake-g-timeline.ts --local
import { call, say, upload } from "../../../api/scripts/media-client";

const film = (await import("../day-19-d.mjs")).default;
if (!film.cuts) throw new Error("set LIBRARY to a (fake) library so the list has its timing");
const fake = (n: number) => `bafkrei${"abcdefghijklmnopqrstuvwxyz234567"[n % 32]!.repeat(8)}${String(n).padStart(4, "a").replace(/\d/g, (d) => "abcdefghij"[Number(d)]!)}${"q".repeat(40)}`;
const clips: any[] = [];
for (const [i, s] of film.shots.entries()) {
  const nn = String(i + 1).padStart(2, "0");
  // shots 5 and 6 carry no shot tag: world-timeline.ts must place them by their order
  const tags = ["Day 19", "role:shot", "cut:G", ...(i === 4 || i === 5 ? [] : [`shot:${nn} ${s.name.replace(/-/g, " ")}`]), "sandbox 4"];
  const up = await upload(new TextEncoder().encode(`fake shot ${nn} ${s.name}`), { mime: "video/mp4", title: `Day 19 · ${nn} ${s.size} · ${s.name}`, tags, meta: { size: s.size, hour: s.hour } });
  const c = film.cuts[i];
  clips.push({ id: `v${nn}`, cid: up.cid, track: "V1", start: c.start, in: 0, dur: c.seconds, vol: 0 });
}
clips.push({ id: "thumbnail", cid: fake(900), track: "V1", start: 0, in: 0, dur: 0.1, vol: 0 });
film.voices.forEach((v: any, i: number) => clips.push({ id: `a${i}`, cid: v.cid, track: "A1", start: v.at, in: 0, dur: 6, vol: 1 }));
clips.push({ id: "music", cid: fake(901), track: "A2", start: 0, in: 0, dur: film.total, vol: 0.5, fin: 2, fout: 3 });
clips.push({ id: "bed", cid: fake(902), track: "A3", start: 0, in: 0, dur: 20, vol: 0.3 });
const all = await call<any[]>("/api/timelines");
const had = all.find((t) => t.project === "Day 19" && t.variant === "G");
const body = { name: "Full shots 2", project: "Day 19", variant: "G", aspect: "1:1", tags: ["Day 19", "film"], description: "fake G for testing", clips };
const g = had ? await call<any>(`/api/timelines/${had.id}`, { method: "PUT", body: JSON.stringify(body) }) : await call<any>("/api/timelines", { method: "POST", body: JSON.stringify(body) });
say(`fake Day 19 · G: ${g.clips.length} clips (${g.id})`);
