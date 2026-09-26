// Narration for the journal films, through fal: design a voice once, then speak lines with it.
//
//   bun voice design "<what the voice sounds like>" --name narrator
//   bun voice say "<the line>" [--voice narrator] [--name slug] [--speed 0.92] [--pitch -1] [--local]
//   bun voice say "<the line>" --eleven George [--stability 0.4]      ElevenLabs v3, with each word's timing
//
// A voice is designed with MiniMax Voice Design and kept by name in studio/voices.json. A line is spoken with
// MiniMax Speech 2.8 HD, saved to studio/<slug>.mp3, and put into the media library as /studio/voice/<slug>.mp3 —
// with its words, voice and settings — where /admin/studio plays it back. Needs FAL_API_KEY in .env.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { call, readJson, ROOT, say, upload } from "./media-client";

const FAL = "https://fal.run";
const SPEECH = "fal-ai/minimax/speech-2.8-hd";
const ELEVEN = "fal-ai/elevenlabs/tts/eleven-v3";
const DESIGN = "fal-ai/minimax/voice-design";
const STUDIO = join(ROOT, "studio");
const VOICES = join(STUDIO, "voices.json");

type Voice = { id: string; prompt: string; model: string; created: string };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

async function fal<T>(model: string, input: unknown): Promise<T> {
  const key = process.env.FAL_API_KEY ?? process.env.FAL_KEY;
  if (!key) throw new Error("FAL_API_KEY is not set in .env");
  const res = await fetch(`${FAL}/${model}`, {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${model}: ${res.status} ${JSON.stringify(body?.detail ?? body).slice(0, 300)}`);
  return body as T;
}

const download = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

async function design() {
  const [, prompt] = positional;
  const name = flag("name") ?? "narrator";
  if (!prompt) throw new Error('usage: bun voice design "<what the voice sounds like>" --name narrator');
  const preview = flag("preview") ?? "Beneath the glass, a forest has begun to feed the people who planted it.";
  const r = await fal<{ custom_voice_id: string; audio: { url: string } }>(DESIGN, { prompt, preview_text: preview });
  await mkdir(STUDIO, { recursive: true });
  const voices = await readJson<Record<string, Voice>>(VOICES, {});
  voices[name] = { id: r.custom_voice_id, prompt, model: DESIGN, created: new Date().toISOString() };
  await writeFile(VOICES, JSON.stringify(voices, null, 2) + "\n");
  await writeFile(join(STUDIO, `${name}-preview.mp3`), await download(r.audio.url));
  say(`voice "${name}" → ${r.custom_voice_id} (studio/voices.json); preview in studio/${name}-preview.mp3`);
}

type Word = { word: string; start: number; end: number };

/**
 * ElevenLabs' timings come per character, in chunks: { characters[], character_start_times_seconds[],
 * character_end_times_seconds[] }. Joined and split at spaces they become words; audio tags like [warmly] are
 * directions, not words, and drop out.
 */
function wordsOf(raw: unknown): Word[] {
  const chars: { c: string; s: number; e: number }[] = [];
  for (const chunk of Array.isArray(raw) ? raw : []) {
    const c = (chunk as any).characters ?? [], st = (chunk as any).character_start_times_seconds ?? [], en = (chunk as any).character_end_times_seconds ?? [];
    for (let i = 0; i < c.length; i++) chars.push({ c: String(c[i]), s: Number(st[i]), e: Number(en[i]) });
  }
  const words: Word[] = [];
  let cur: Word | null = null, tag = false;
  for (const { c, s, e } of chars) {
    if (c === "[") tag = true;
    if (tag) {
      if (c === "]") tag = false;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) words.push(cur), (cur = null);
      continue;
    }
    if (!cur) cur = { word: c, start: s, end: e };
    else (cur.word += c), (cur.end = e);
  }
  if (cur) words.push(cur);
  return words;
}

async function speak() {
  const [, text] = positional;
  if (!text) throw new Error('usage: bun voice say "<the line>" [--voice narrator | --eleven George]');
  const eleven = flag("eleven");
  let bytes: Uint8Array, duration_ms: number, meta: Record<string, unknown>;
  if (eleven) {
    const stability = Number(flag("stability") ?? 0.5);
    const r = await fal<{ audio: { url: string }; timestamps?: unknown }>(ELEVEN, { text, voice: eleven, stability, timestamps: true, language_code: "en" });
    bytes = await download(r.audio.url);
    const words = wordsOf(r.timestamps);
    duration_ms = Math.round((words.at(-1)?.end ?? 0) * 1000 + 250);
    meta = { text: text.replace(/\[[^\]]*\]\s*/g, ""), direction: text, voice: eleven, model: ELEVEN, stability, words, duration_ms };
    if (!words.length) console.log(`(no word timings came back: ${JSON.stringify(r.timestamps).slice(0, 200)})`);
  } else {
    const voiceName = flag("voice") ?? "narrator";
    const voices = await readJson<Record<string, Voice>>(VOICES, {});
    const voiceId = voices[voiceName]?.id ?? voiceName; // a designed voice by name, or one of MiniMax's own ids
    const speed = Number(flag("speed") ?? 0.92);
    const pitch = Number(flag("pitch") ?? 0);
    const r = await fal<{ audio: { url: string }; duration_ms: number }>(SPEECH, {
      prompt: text,
      voice_setting: { voice_id: voiceId, speed, pitch, vol: 1, english_normalization: true },
      audio_setting: { format: "mp3", sample_rate: 44100, bitrate: 256000, channel: 1 },
      language_boost: "English",
      output_format: "url",
    });
    bytes = await download(r.audio.url);
    duration_ms = r.duration_ms;
    meta = { text, voice: voiceName, voiceId, model: SPEECH, speed, pitch, duration_ms };
  }
  const slug = flag("name") ?? `${new Date().toISOString().slice(0, 10)}-${slugify(text)}`;
  await mkdir(STUDIO, { recursive: true });
  await writeFile(join(STUDIO, `${slug}.mp3`), bytes);
  meta.made = new Date().toISOString();
  // the words beside the take, so `bun media add studio/<slug>.mp3 …` elsewhere carries them too
  await writeFile(join(STUDIO, `${slug}.json`), JSON.stringify(meta, null, 2) + "\n");
  const path = `/studio/voice/${slug}.mp3`;
  const up = await upload(bytes, path, { meta });
  await call("/api/media/distribute", { method: "POST" }).catch(() => {});
  say(`${(duration_ms / 1000).toFixed(1)} s · studio/${slug}.mp3 · in the library as ${path} (${up.cid})`);
}

const run = { design, say: speak }[positional[0] as "design"];
if (!run) {
  say('usage: bun voice design "<description>" --name narrator | bun voice say "<line>" [--voice narrator] [--local]');
  process.exit(1);
}
try {
  await run();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
