// The render worker: exports the timelines the studio asks for.
//
//   bun film worker [--local]
//
// It waits for a render job (the studio's Render button), takes the timeline exactly as it is edited — every clip
// where it sits, trimmed and levelled as set — and renders it: pictures in their frame (1:1, 16:9, 9:16 or 4:5), each
// shot cut hard into the next, the voice, music and sound clips mixed at
// their volumes, and captions from the voice clips' own word timings. The film goes into the media library
// (library/, described, and the database) and the job is marked done with its CID. Runs wherever ffmpeg and Chrome
// are; the files come from library/ — the single source of truth — by their CIDs.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { API, call, keyFor, say, upload } from "../../api/scripts/media-client";
import { put } from "../../api/scripts/library";

type Clip = { id: string; cid: string; track: string; start: number; in: number; dur: number; vol: number; fin?: number; fout?: number };
type Timeline = { id: string; name: string; project: string | null; variant: string | null; aspect: string; clips: Clip[] };
type Media = { cid: string; mime: string; kind: string; size: number; created: string; title: string; tags: string[]; meta: Record<string, any> };
type Job = { id: string; timeline_id: string };

const FPS = 30, XF = 0; // hard cuts: no dissolves, and so never a dip to black between shots
// the hook: the title over the first seconds of the moving film, in the social copies (cut away hard)
const HOOK = 2.5;
const FRAME: Record<string, [number, number]> = { "1:1": [1080, 1080], "16:9": [1920, 1080], "9:16": [1080, 1920], "4:5": [1080, 1350] };
// What each shape is delivered as (Zernio posts it; its platform pages set the limits, docs.zernio.com/platforms):
//   16:9 — the default. A 4K master (3840×2160, HEVC 10-bit) for YouTube, which recommends 4K and takes H.265; and a
//          1080 H.264 copy made from it (≤ 20 Mbps, AAC 192k) for X (H.264 only, ≤ 25 Mbps, ≤ 1920×1200) and
//          LinkedIn (H.264, 16:9 or 1:1) — and for the studio's preview, as every browser plays H.264.
//   9:16 — 1080×1920 H.264, 30 fps (≤ 12 Mbps, so a 3-minute film stays under Instagram's 300 MB) for TikTok,
//          Instagram Reels and YouTube Shorts, which all ask for exactly that. No 4K: none of them shows it.
//   1:1, 4:5 — 1080 H.264, for the Instagram and LinkedIn feeds.
const masterOf = (aspect: string) => (aspect === "16:9" ? 2 : 1);
const COLOR = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav" };
const LIB = resolve("library");
const report = (id: string, body: object) => call(`/api/renders/${id}`, { method: "PUT", body: JSON.stringify(body) }).catch(() => {});

/** The file for a CID: library/<cid>.<ext> — or, when only the database holds it, a copy fetched into a cache. */
async function fileOf(m: Media): Promise<string> {
  const name = `${m.cid}.${EXT[m.mime] ?? "bin"}`;
  if (existsSync(join(LIB, name))) return join(LIB, name);
  const cache = join(homedir(), ".cache", "maiacity", "media");
  if (existsSync(join(cache, name))) return join(cache, name);
  mkdirSync(cache, { recursive: true });
  const res = await fetch(`${API}/api/media/${m.cid}`, { headers: { authorization: `Bearer ${await keyFor()}` } });
  if (!res.ok) throw new Error(`could not fetch ${m.title || m.cid}: ${res.status}`);
  writeFileSync(join(cache, name), new Uint8Array(await res.arrayBuffer()));
  say(`  ${m.title || m.cid} is not in library/ — fetched from the database`);
  return join(cache, name);
}

const probe = (file: string) =>
  new Promise<number>((ok) => {
    const p = spawn("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => ok(Number(out) || 0));
  });

/** Captions: the voice clips' words, in short phrases broken at the punctuation, on the timeline's clock. */
function phrasesOf(t: Timeline, media: Map<string, Media>) {
  const out: { text: string; start: number; end: number }[] = [];
  for (const c of t.clips.filter((c) => c.track === "A1")) {
    const words = (media.get(c.cid)?.meta?.words ?? []) as { word: string; start: number; end: number }[];
    let cur: typeof words = [];
    const flush = () => cur.length && out.push({ text: cur.map((w) => w.word).join(" "), start: c.start + cur[0]!.start - c.in, end: c.start + cur.at(-1)!.end - c.in });
    for (const w of words.filter((w) => w.start >= c.in && w.start < c.in + c.dur)) {
      cur.push(w);
      const text = cur.map((x) => x.word).join(" ");
      if ((/[.,;:!?…]$/.test(w.word) && (cur.length >= 3 || /[.;:!?…]$/.test(w.word))) || text.length > 34) flush(), (cur = []);
    }
    flush();
  }
  return out;
}

async function captionImages(phrases: { text: string }[], [W, H]: [number, number], dir: string) {
  const font = pathToFileURL(resolve("node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2")).href;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  const files: string[] = [];
  for (const [i, p] of phrases.entries()) {
    await page.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: F; src: url(${font}) format('woff2'); font-weight: 100 900; }
      html, body { margin: 0; width: ${W}px; height: ${H}px; background: transparent; }
      p { position: absolute; left: 9%; right: 9%; bottom: ${H > W ? 22 : 8.5}%; margin: 0; text-align: center;
          font: 460 ${Math.round(H > W ? W / 30 : Math.min(W, H) / 24)}px/1.3 F, Georgia, serif; color: #fff;
          text-shadow: 0 2px 18px rgba(0,0,0,.65), 0 0 3px rgba(0,0,0,.45); }
    </style></head><body><p>${p.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const f = join(dir, `${String(i).padStart(3, "0")}.png`);
    await page.screenshot({ path: f, omitBackground: true });
    files.push(f);
  }
  await browser.close();
  return files;
}

/** Every format a film goes out in, by the shape it is cut for (Zernio's platform pages set the limits). */
type Output = { file: string; name: string; channels: string[]; format: string; aspect: string; width: number; height: number; codec: string; note?: string };

async function render(job: Job) {
  const t = (await call<Timeline[]>("/api/timelines")).find((x) => x.id === job.timeline_id);
  if (!t) throw new Error("the timeline is gone");
  const media = new Map((await call<{ media: Media[] }>("/api/media")).media.map((m) => [m.cid, m]));
  const clips = t.clips.filter((c) => media.has(c.cid)).sort((a, b) => a.start - b.start);
  const total = clips.reduce((n, c) => Math.max(n, c.start + c.dur), 0);
  if (!total) throw new Error("the timeline is empty");
  await report(job.id, { note: "fetching files", progress: 0.02 });
  const files = new Map<string, string>();
  for (const c of clips) if (!files.has(c.cid)) files.set(c.cid, await fileOf(media.get(c.cid)!));
  // A title card's marker on the picture track is not a picture: it marks where the hook goes, and names the day's
  // cards by CID (its meta: cards and hooks, one per shape — written by thumbnail.mjs): the title card delivered with
  // the film, and the hook layer laid over the first seconds of the social copies (the same title, transparent). The
  // film itself runs from its first frame: a still card there would stop it, and the Short's and X's cover is a frame.
  type Marker = { cards?: Record<string, string>; hooks?: Record<string, string> };
  const card = clips.find((c) => c.track === "V1" && (media.get(c.cid)?.meta as Marker | undefined)?.cards);
  const named = card ? (media.get(card.cid)!.meta as Marker) : {};
  const thumbnails = new Map<string, Media>(); // by shape: the title card delivered with its film
  const hooks = new Map<string, string>(); // by shape: the hook layer's file
  for (const aspect of Object.keys(FRAME)) {
    const shape = aspect.replace(":", "x"), thumb = media.get(named.cards?.[shape] ?? ""), hook = media.get(named.hooks?.[shape] ?? "");
    if (thumb) thumbnails.set(aspect, thumb);
    if (hook) hooks.set(aspect, await fileOf(hook));
  }

  const work = resolve("studio/film/.render", job.id);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const phrases = phrasesOf(t, media);
  const base = `${(t.project ?? "film").toLowerCase().replace(/\s+/g, "-")}${t.variant ? `-${t.variant.toLowerCase()}` : ""}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;

  // every shape it is delivered in: 16:9 (the default: YouTube, X, LinkedIn), 9:16 (TikTok, Reels, Shorts), 1:1 (the
  // Instagram feed: a film longer than a Reel goes there), and the timeline's own frame too (4:5). A shape the edit
  // was not framed for is cut from the middle of each shot.
  const shapes = [...new Set(["16:9", "9:16", "1:1", t.aspect in FRAME ? t.aspect : "16:9"])];
  const outputs: Output[] = [];
  for (const [k, aspect] of shapes.entries()) {
    const span = 0.88 / shapes.length, from = 0.04 + k * span;
    outputs.push(...(await shape(aspect, from, from + span)));
  }

  async function shape(aspect: string, p0: number, p1: number): Promise<Output[]> {
  const [W1, H1] = FRAME[aspect]!;
  const MASTER = masterOf(aspect);
  const [W, H] = [W1 * MASTER, H1 * MASTER];
  await report(job.id, { note: "setting the captions", progress: p0 });
  const caps = await captionImages(phrases, [W, H], work);
  const hook = hooks.get(aspect) ?? null, hook0 = hook && card ? card.start : null;

    const args: string[] = ["-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"];
    const f: string[] = [];
    let n = 0;
    // pictures: one stream, the clips joined end to end (a hard cut is a join, not a layer — laying 43 clips over
    // each other made every 4K frame composite all of them). Where clips overlap, the later one is on top (the
    // thumbnail over the first frame); a gap is black. Each piece is cut to its exact frame count on the film's
    // clock, so the cuts stay on their words however many pieces there are.
    const pictures = clips.filter((c) => c.track === "V1" && c !== card);
    const edges = [...new Set([0, total, ...pictures.flatMap((c) => [c.start, c.start + c.dur])].map((t) => Math.round(Math.min(total, Math.max(0, t)) * FPS)))].sort((a, b) => a - b);
    const pieces: { clip: Clip | null; a: number; b: number }[] = [];
    for (let k = 0; k + 1 < edges.length; k++) {
      const a = edges[k]!, b = edges[k + 1]!, mid = (a + b) / 2 / FPS;
      const top = pictures.filter((c) => c.start <= mid && mid < c.start + c.dur).at(-1) ?? null;
      const prev = pieces.at(-1);
      if (prev && prev.clip === top && prev.b === a) prev.b = b;
      else pieces.push({ clip: top, a, b });
    }
    const joins: string[] = [];
    for (const [i, p] of pieces.entries()) {
      const frames = p.b - p.a;
      if (!p.clip) {
        f.push(`color=c=black:s=${W}x${H}:r=${FPS},trim=end_frame=${frames},setpts=N/${FPS}/TB,format=yuv420p[q${i}]`);
        joins.push(`[q${i}]`);
        continue;
      }
      const c = p.clip;
      const m = media.get(c.cid)!, file = files.get(c.cid)!;
      const from = c.in + (p.a / FPS - c.start);
      if (m.kind === "image") args.push("-loop", "1", "-framerate", String(FPS), "-t", (frames / FPS + 0.5).toFixed(3), "-i", file);
      else args.push("-ss", Math.max(0, from).toFixed(3), "-t", (frames / FPS + 0.5).toFixed(3), "-i", file);
      // exactly `frames` long: a clip that runs short holds its last frame
      f.push(`[${n}:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},fps=${FPS},tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frames},setpts=N/${FPS}/TB,format=yuv420p[q${i}]`);
      joins.push(`[q${i}]`);
      n++;
    }
    f.push(`${joins.join("")}concat=n=${joins.length}:v=1:a=0[joined]`);
    let last = "joined";
    // a film with a hook opens on its moving picture (the title over it); one without fades up from black
    f.push(`[${last}]${hook0 === null ? "fade=t=in:st=0:d=1.2," : ""}fade=t=out:st=${Math.max(0, total - 2.5).toFixed(3)}:d=2.5[pic]`);
    last = "pic";
    // captions over it, each fading in and out on its phrase
    for (const [i, p] of phrases.entries()) {
      // each caption only for its own phrase (looping every one over the whole film ran ffmpeg out of resources)
      const a = Math.max(0, p.start - 0.08), b = Math.min(total, p.end + 0.3), d = Math.max(0.3, b - a);
      args.push("-loop", "1", "-t", d.toFixed(3), "-framerate", String(FPS), "-i", caps[i]!);
      f.push(`[${n}:v]format=yuva420p,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${(d - 0.25).toFixed(3)}:d=0.25:alpha=1,setpts=PTS-STARTPTS+${a.toFixed(3)}/TB[c${i}]`);
      f.push(`[${last}][c${i}]overlay=0:0:eof_action=pass:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[o${i}]`);
      last = `o${i}`;
      n++;
    }
    // the hook over the first seconds — in a copy rendered straight (a 4K master stays clean: YouTube takes its title
    // card as a thumbnail; its 1080 copy gets the hook below)
    if (hook && MASTER === 1) {
      args.push("-loop", "1", "-framerate", String(FPS), "-t", HOOK.toFixed(3), "-i", hook);
      f.push(`[${n}:v]scale=${W}:${H},format=yuva420p,setpts=PTS-STARTPTS+${hook0!.toFixed(3)}/TB[hk]`);
      f.push(`[${last}][hk]overlay=0:0:eof_action=pass:enable='between(t,${hook0!.toFixed(3)},${(hook0! + HOOK).toFixed(3)})'[hko]`);
      last = "hko";
      n++;
    }
    f.push(`[${last}]format=yuv420p[vout]`);
    // sound: every audio clip from where it is trimmed, at its volume, with its own fades (or a short one at both
    // ends); voice, music and sounds mixed apart, so the music can step back while the voice speaks
    const tracks: Record<"voice" | "music" | "fx", string[]> = { voice: [], music: [], fx: [] };
    let k = 0;
    for (const c of clips.filter((c) => c.track.startsWith("A"))) {
      args.push("-ss", c.in.toFixed(3), "-t", c.dur.toFixed(3), "-i", files.get(c.cid)!);
      const ms = Math.round(c.start * 1000), auto = Math.min(c.track === "A1" ? 0.05 : 0.8, c.dur / 3);
      const fin = Math.max(0.005, Math.min(c.fin ?? auto, c.dur / 2)), fout = Math.max(0.005, Math.min(c.fout ?? auto, c.dur / 2));
      f.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${c.vol.toFixed(3)},afade=t=in:d=${fin.toFixed(3)},afade=t=out:st=${(c.dur - fout).toFixed(3)}:d=${fout.toFixed(3)},adelay=${ms}|${ms}[s${k}]`);
      tracks[c.track === "A1" ? "voice" : c.track === "A2" ? "music" : "fx"].push(`[s${k++}]`);
      n++;
    }
    const mix = (labels: string[], out: string) =>
      f.push(labels.length === 1 ? `${labels[0]}anull[${out}]` : `${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest[${out}]`);
    const parts: string[] = [];
    if (tracks.voice.length) mix(tracks.voice, "voice");
    if (tracks.music.length) mix(tracks.music, "music");
    if (tracks.fx.length) mix(tracks.fx, "fx"), parts.push("[fx]");
    if (tracks.voice.length && tracks.music.length) {
      // the voice keys the music down about 6 dB while it speaks, and lets it back up in the pauses
      f.push(`[voice]asplit=2[vo][vkey]`, `[vkey]apad=whole_dur=${total.toFixed(3)}[vk]`,
        `[music][vk]sidechaincompress=threshold=0.02:ratio=4:knee=4:attack=120:release=900:makeup=1[ducked]`);
      parts.push("[vo]", "[ducked]");
    } else {
      if (tracks.voice.length) parts.push("[voice]");
      if (tracks.music.length) parts.push("[music]");
    }
    f.push(parts.length
      ? `${parts.join("")}amix=inputs=${parts.length}:normalize=0:duration=longest,alimiter=limit=0.95,atrim=0:${total.toFixed(3)}[aout]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(3)}[aout]`);

  const tag = `${base}-${aspect.replace(":", "x")}`;
  const masterName = `${tag}-4k-hevc.mp4`, name = `${tag}.mp4`;
  const master = join(work, masterName), out = join(work, name);
  const H264 = ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-maxrate", H1 > W1 ? "12M" : "20M", "-bufsize", "40M", "-pix_fmt", "yuv420p", ...COLOR];
  args.push("-filter_complex", f.join(";"), "-map", "[vout]", "-map", "[aout]",
    ...(MASTER > 1
      // the Mac's own HEVC encoder (VideoToolbox): ~10× faster than x265, 10-bit, at YouTube's 4K upload bitrate
      // (35–68 Mbps recommended) — the platforms re-encode it anyway, so the encoder's efficiency buys nothing
      ? ["-c:v", "hevc_videotoolbox", "-profile:v", "main10", "-pix_fmt", "p010le", "-b:v", "50M", "-maxrate", "68M", "-bufsize", "100M", "-allow_sw", "1", "-tag:v", "hvc1", ...COLOR]
      : H264),
    "-r", String(FPS), "-c:a", "aac", "-b:a", MASTER > 1 ? "384k" : "192k", "-movflags", "+faststart", MASTER > 1 ? master : out);

  const pr = (x: number) => p0 + (p1 - p0) * x;
  await report(job.id, { note: "rendering", progress: pr(0.05) });
  await new Promise<void>((ok, bad) => {
    const p = spawn("ffmpeg", args);
    let err = "", lastReport = 0;
    p.stdout.on("data", (d) => {
      const us = /out_time_us=(\d+)/.exec(String(d))?.[1];
      if (us && Date.now() - lastReport > 3000) {
        lastReport = Date.now();
        void report(job.id, { progress: pr(0.05 + (MASTER > 1 ? 0.8 : 0.95) * Math.min(1, Number(us) / 1e6 / total)), note: "rendering" });
      }
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? ok() : (writeFileSync(join(work, "ffmpeg-error.txt"), `${args.join(" ")}\n\n${err}`), bad(new Error(err.slice(-400) || `ffmpeg exited ${code}`)))));
  });

  // the 1080 copy, from the master
  if (MASTER > 1) {
    await report(job.id, { note: "rendering", progress: pr(0.88) });
    await new Promise<void>((ok, bad) => {
      const scaled = `[0:v]scale=${W1}:${H1}:flags=lanczos,format=yuv420p`;
      const graph = hook
        ? ["-loop", "1", "-framerate", String(FPS), "-t", HOOK.toFixed(3), "-i", hook, "-filter_complex",
          `${scaled}[v];[1:v]scale=${W1}:${H1},format=yuva420p,setpts=PTS-STARTPTS+${hook0!.toFixed(3)}/TB[hk];[v][hk]overlay=0:0:eof_action=pass:enable='between(t,${hook0!.toFixed(3)},${(hook0! + HOOK).toFixed(3)})',format=yuv420p[o]`,
          "-map", "[o]", "-map", "0:a"]
        : ["-vf", scaled.slice("[0:v]".length)];
      const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", master, ...graph,
        ...H264, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => (code === 0 ? ok() : bad(new Error(err.slice(-400) || `ffmpeg exited ${code}`))));
    });
  }
  const long = total > 90 ? "Instagram Reels take at most 90 s (via Zernio): post it as a feed video, or cut it down" : undefined;
  const hooked = hook ? ` · the hook over its first ${HOOK} s` : "";
  if (aspect === "16:9")
    return [
      { file: master, name: masterName, channels: ["youtube"], format: `4K master · HEVC 10-bit · ${W}×${H}`, aspect, width: W, height: H, codec: "hevc" },
      { file: out, name, channels: ["x", "linkedin"], format: `H.264 · ${W1}×${H1}${hooked}`, aspect, width: W1, height: H1, codec: "h264" },
    ];
  if (aspect === "9:16")
    return [{ file: out, name, channels: total <= 180 ? ["instagram", "youtube"] : ["instagram"], format: `H.264 · ${W1}×${H1} · 30 fps · Reel${total <= 180 ? " and Short" : ""}${hooked}`, aspect, width: W1, height: H1, codec: "h264", ...(long ? { note: long } : {}) }];
  return [{ file: out, name, channels: ["instagram"], format: `H.264 · ${W1}×${H1} · feed${hooked}`, aspect, width: W1, height: H1, codec: "h264" }];
  }

  // into the library, and onto the calendar (the job's report carries them): ready for the upload step
  await report(job.id, { note: "into the library", progress: 0.94 });
  // each file into library/ first (copied, described), then the database — tagged by what it is, never named
  const title = `${t.project ?? ""} ${t.variant ?? ""} · ${t.name}`.trim();
  const deliveries = [];
  for (const o of outputs) {
    const d = await put(o.file, {
      title: `${title} · ${o.aspect} ${o.codec}`,
      description: `${o.format} · for ${o.channels.join(", ")}`,
      tags: [t.project ?? "film", "role:render", ...(t.variant ? [`cut:${t.variant}`] : []), `aspect:${o.aspect}`, `codec:${o.codec}`],
      meta: { timeline: t.id, duration_s: Number(total.toFixed(2)), format: o.format },
    });
    const bytes = new Uint8Array(await Bun.file(o.file).arrayBuffer());
    await upload(bytes, { cid: d.cid, mime: d.mime, title: d.title, description: d.description, tags: d.tags, meta: d.meta, public: d.public });
    deliveries.push({ channels: o.channels, cid: d.cid, format: o.format, aspect: o.aspect, width: o.width, height: o.height, codec: o.codec, bytes: bytes.length, seconds: Number(total.toFixed(2)), ...(o.note ? { note: o.note } : {}) });
  }
  // the thumbnails, one per shape, for the same channels as its film
  for (const [aspect, m] of thumbnails) {
    const [w, h] = FRAME[aspect]!;
    for (const d of deliveries.filter((d) => d.aspect === aspect && d.codec === "h264"))
      deliveries.push({ channels: d.channels, cid: m.cid, format: `thumbnail · ${w}×${h}`, aspect, width: w, height: h, codec: "jpeg", bytes: m.size, seconds: 0, kind: "thumbnail" } as any);
  }
  rmSync(work, { recursive: true, force: true });
  // the film the studio plays: the 1080 H.264 cut of the timeline's own frame (browsers play it everywhere)
  const own = deliveries.find((d) => d.aspect === t.aspect && d.codec === "h264") ?? deliveries.find((d) => d.codec === "h264")!;
  return { cid: own.cid, deliveries };
}

say(`render worker on ${API} — waiting for jobs (the studio's Render button)`);
for (;;) {
  // the API away for a moment (restarted, rebuilt) is waited out, not a crash
  const res = await fetch(`${API}/api/renders/claim`, { method: "POST", headers: { authorization: `Bearer ${await keyFor()}` } }).catch(() => null);
  if (!res) {
    await Bun.sleep(5000);
    continue;
  }
  if (res.status === 204) {
    await Bun.sleep(3000);
    continue;
  }
  if (!res.ok) {
    say(`claim failed: ${res.status}`);
    await Bun.sleep(10000);
    continue;
  }
  const job = (await res.json()) as Job;
  say(`job ${job.id}: rendering timeline ${job.timeline_id}`);
  try {
    const { cid, deliveries } = await render(job);
    await report(job.id, { status: "done", progress: 1, note: `in the library and on the calendar: ${deliveries.length} files`, output_cid: cid, deliveries });
    say(`job ${job.id}: done → ${cid}`);
  } catch (e) {
    await report(job.id, { status: "failed", note: (e as Error).message.slice(0, 280) });
    say(`job ${job.id}: failed — ${(e as Error).message}`);
  }
}
