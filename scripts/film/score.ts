// Compose a film's score and make its sound effects, with ElevenLabs through fal, into the vault.
//
//   bun scripts/film/score.ts scripts/film/day-19-d.mjs [--only music|cues] [--take b]
//   bun scripts/film/score.ts scripts/film/day-19-d.mjs --sfx <name>
//
// The score follows the film's arc: every section of `music.chunks` (see the shot list) ends where the list says,
// in the style it asks for — so the swell lands on the sunrise and the drop on the tired land. Instrumental, one
// piece. The sound effects are the film's own (dawn chorus, cold wind, …), each made from its line in SFX below.
// Everything goes into the vault (described) and the shot list names it by hash: a new score or cue takes the old
// one's place there (the old one is kept, superseded); a new sound effect's hash is printed, for the shot list.
// Needs FAL_API_KEY, and the Mac app running (its vault).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { say } from "../../api/scripts/media-client";
import { add, bare } from "./vault.mjs";
import { ideaTag, nameOfDay } from "../../src/lib/stories/names.js";

const args = process.argv.slice(2);
const listFile = resolve(args.find((a) => a.endsWith(".mjs"))!);
const film = (await import(pathToFileURL(listFile).href)).default;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const take = args.includes("--take") ? args[args.indexOf("--take") + 1] : "a";
const sfx = args.includes("--sfx") ? args[args.indexOf("--sfx") + 1] : null;
// the story the score belongs to, as its files' tag ("idea:233 settlers, how it starts") — never a day
const day = ideaTag(nameOfDay(film.day ?? 19));

/** Into the vault; when it replaces a file, the shot list names the new one in its place. */
async function bring(bytes: Uint8Array, about: { title: string; description?: string; tags: string[]; meta: Record<string, unknown> }, replaces?: string) {
  const old = replaces ? bare(replaces) : undefined;
  const { hash } = await add(bytes, { ...about, name: `${about.title.replace(/[^\w.-]+/g, "-")}.mp3`, ...(old ? { replaces: [old] } : {}) });
  if (old && old !== hash) writeFileSync(listFile, readFileSync(listFile, "utf8").replaceAll(old, hash));
  return hash;
}

const SFX: Record<string, { text: string; seconds: number; loop?: boolean }> = {
  "dawn-chorus": { text: "Dawn chorus in a lush forest at sunrise: many songbirds, distant and near, gentle and airy, no wind, no people", seconds: 22, loop: true },
  "cold-wind": { text: "Cold, lonely wind blowing over empty flat land, hollow and bleak, no birds, no traffic", seconds: 20, loop: true },
  commons: { text: "Inside a vast sunlit glass dome garden: songbirds under the glass, a small fountain trickling, very distant soft murmur of people and a child laughing far away, warm and peaceful, no music, no machines", seconds: 22, loop: true },
  goats: { text: "A few soft goat bleats in a quiet sunny meadow, a small goat bell tinkling as they graze, birds far away, gentle", seconds: 10 },
  "water-drop": { text: "A single clear water droplet falling from a leaf into a small puddle, close up, quiet early morning, soft natural reverb", seconds: 2.5 },
  "riser-sunrise": { text: "Soft breath-like cinematic riser, airy shimmer and gentle wind swelling up over four seconds to a bright crest, warm, no drums, no impact", seconds: 5 },
  "drop-hit": { text: "Reverse cymbal swell sucking in for two seconds, then one deep cinematic low boom with a long dark tail fading into silence", seconds: 6 },
  "whoosh-orbit": { text: "Slow soft cinematic air whoosh passing wide overhead, gentle, airy, no impact", seconds: 3 },
  "riser-final": { text: "Long airy cinematic riser with shimmering strings texture and soft wind, slowly swelling over seven seconds, emotional, ends on a bright crest", seconds: 8 },
  "truck-pass": { text: "A heavy lorry passing by on a distant highway, a long doppler whoosh and diesel rumble in an empty windy landscape, lonely", seconds: 5 },
  "traffic-drone": { text: "Oppressive low drone of a distant motorway: an endless roar of traffic, diesel engines and tyres, a low industrial hum underneath, unsettling and heavy, no music", seconds: 22, loop: true },
  "air-horn": { text: "A long distant lorry air horn blast echoing across flat empty land, harsh and lonely, wind around it", seconds: 4 },
  "morning-birds": { text: "Close, bright morning birdsong right outside an open window: a blackbird and a few small songbirds, warm and intimate, gentle air", seconds: 6 },
  "sub-hit": { text: "Soft deep cinematic sub bass hit with a long warm reverb tail, gentle and emotional, not aggressive", seconds: 5 },
  crickets: { text: "Warm summer night in a forest garden: crickets and distant frogs, very calm, soft", seconds: 22, loop: true },
};

async function fal<T>(model: string, input: unknown): Promise<T> {
  const key = process.env.FAL_API_KEY ?? process.env.FAL_KEY;
  if (!key) throw new Error("FAL_API_KEY is not set in .env");
  const res = await fetch(`https://fal.run/${model}`, { method: "POST", headers: { authorization: `Key ${key}`, "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${model}: ${res.status} ${JSON.stringify(body?.detail ?? body).slice(0, 400)}`);
  return body as T;
}
const download = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

if (!sfx && (!only || only === "music")) {
  // the arc as a composition plan: each section's length from the film's clock, its styles from the shot list
  let from = 0;
  const chunks = film.music.chunks.map((c: { until: number; styles: string[] }, i: number) => {
    const ms = Math.round((c.until - from) * 1000);
    from = c.until;
    return { duration_ms: Math.max(3000, Math.min(120000, ms)), positive_styles: [...c.styles, "instrumental", "film score"], negative_styles: ["vocals", "lyrics", "singing", "drum machine", "EDM"], text: `[Section ${i + 1}]`, context_adherence: "medium" };
  });
  say(`composing ${chunks.length} sections, ${(from).toFixed(1)} s…`);
  const r = await fal<{ audio: { url: string } }>("elevenlabs/music/v2.5", { composition_plan: { chunks }, output_format: "mp3_48000_192" });
  const bytes = await download(r.audio.url);
  const hash = await bring(bytes, { title: `${film.name} · score ${take.toUpperCase()}`, tags: [day, "role:score"], meta: { model: "elevenlabs/music/v2.5", sections: chunks.map((c: any) => c.positive_styles[0]) } },
    take === "a" ? film.music.hash : undefined);
  say(`score ${take} → ${hash}${take === "a" ? " (in the shot list)" : ""}`);
}

// the cues: short pieces that take the score's place for a stretch, or lie on top of it (music.cues)
if (!sfx && (!only || only === "cues")) {
  for (const cue of film.music.cues ?? []) {
    const chunks = cue.chunks.map((c: { seconds: number; styles: string[] }, i: number) => ({
      duration_ms: Math.round(Math.max(3, Math.min(120, c.seconds)) * 1000), positive_styles: [...c.styles, "instrumental", "film score"],
      negative_styles: ["vocals", "lyrics", "singing", "drum machine", "EDM"], text: `[Section ${i + 1}]`, context_adherence: "medium",
    }));
    say(`composing the ${cue.name} cue, ${(chunks.reduce((n: number, c: any) => n + c.duration_ms, 0) / 1000).toFixed(1)} s…`);
    const r = await fal<{ audio: { url: string } }>("elevenlabs/music/v2.5", { composition_plan: { chunks }, output_format: "mp3_48000_192" });
    const bytes = await download(r.audio.url);
    const hash = await bring(bytes, { title: `${film.name} · ${cue.name} cue`, tags: [day, "role:cue", `cue:${cue.name}`], meta: { model: "elevenlabs/music/v2.5", sections: chunks.map((c: any) => c.positive_styles[0]) } }, cue.hash);
    say(`${cue.name} cue → ${hash} (in the shot list)`);
  }
}

// a sound effect, made from its recipe; its hash goes into the shot list by hand (on a shot, a bed or a hit)
if (sfx) {
  const spec = SFX[sfx];
  if (!spec) throw new Error(`no recipe for ${sfx} — add it to SFX`);
  const r = await fal<{ audio: { url: string } }>("fal-ai/elevenlabs/sound-effects/v2", { text: spec.text, duration_seconds: spec.seconds, loop: !!spec.loop, prompt_influence: 0.5 });
  const hash = await bring(await download(r.audio.url), { title: sfx.replace(/-/g, " "), description: spec.text, tags: [day, "role:sfx", `sound:${sfx}`], meta: { model: "elevenlabs/sound-effects/v2" } });
  say(`sfx ${sfx} → ${hash}`);
}
