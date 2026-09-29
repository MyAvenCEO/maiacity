// The render worker: exports the timelines the studio asks for, and makes the library's proxies and preview LUTs.
//
//   bun film worker [--local]        (MAIACITY_API=… MAIACITY_KEY=… point it at another API)
//
// It waits for a job on the render queue (render_jobs, migration 0024), of three kinds:
//
//   render — the timeline exactly as it is edited, every clip where it sits, trimmed and levelled as set: pictures in
//            their frame (16:9, 9:16, 1:1, 4:5), each shot cut hard into the next, the voice, music and sound clips
//            mixed at their volumes, captions from the voice clips' own word timings. Colour-managed: every picture
//            clip is read in float with its own matrix and range, taken into ACEScct by its input transform, cut in
//            float, graded (its own CDL, then the film's look), taken out by the ACES 2.0 output transform to Rec.709,
//            and only then do the graphics (captions, the hook) go on top. A display-referred clip with no grade under
//            a neutral look bypasses both transforms and renders bit for bit as it was. Conform: originals only — a
//            proxy on the timeline is swapped for its original. World clips (kind 'world') are rendered as ACEScct
//            plates, one per delivery shape. Every delivery is QC'd (tags, bit depth, frames, length, limits, loudness)
//            before it goes into the media library; the report names every transform by the hash of its config.
//   proxy  — a new file's colour read (ffprobe, EXR header → meta.color) and its HD log proxy made (proxy.mjs).
//   lut    — the studio viewer's preview LUTs baked from the transform configs into the library (also at start-up).
//
// Runs wherever ffmpeg (with zimg), OpenColorIO (python3) and Chrome are; the files come from library/ by their CIDs,
// or from the database into a cache.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir, tmpdir } from "node:os";
import { API, call, keyFor, say, SITE, upload } from "../../api/scripts/media-client";
import { DIR as LIB, get, put, save } from "../../api/scripts/library";
import { cleanCdl, PRESETS, type Cdl } from "../../game/film/color.js";
import { PREVIEW, TRANSFORMS } from "../../game/film/transforms.js";
import { bakedLut, checkFfmpeg, hevcEncoder, ocioVersion, SETPARAMS, TAGS } from "./color/ffmpeg.mjs";
import { EXT, inputArgs, sourceOf, type Source } from "./sources.mjs";
import { blackFilters, pieceFilters } from "./picture.mjs";
import { platesFor, worldModules } from "./plates.mjs";
import { loudness, qc, type Qc } from "./qc.mjs";
import { makeProxy } from "./proxy.mjs";

/** A clip on the timeline (contract C1). */
type Clip = {
  id: string; track: string; start: number; in: number; dur: number; vol: number; fin?: number; fout?: number;
  kind?: "media" | "world"; cid?: string; shot?: string; shotVersion?: number; grade?: unknown;
  frame?: Record<string, { x?: number; y?: number; zoom?: number }>;
};
type Timeline = {
  id: string; name: string; project: string | null; variant: string | null; aspect: string; clips: Clip[];
  grade?: { look?: unknown; preset?: string } | null;
};
type Media = { cid: string; mime: string; kind: string; size: number; created: string; title: string; tags: string[]; meta: Record<string, any> };
type Job = { id: string; kind?: "render" | "proxy" | "lut"; timeline_id: string | null; media_cid?: string | null };

const FPS = 30;
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
// Picture is 10-bit from the first filter to the HEVC master; only the H.264 copies are 8-bit, dithered.
const masterOf = (aspect: string) => (aspect === "16:9" ? 2 : 1);
const CACHE_MEDIA = join(homedir(), ".cache", "maiacity", "media");
const report = (id: string, body: object) => call(`/api/renders/${id}`, { method: "PUT", body: JSON.stringify(body) }).catch(() => {});

/** The file for a CID: library/<cid>.<ext> — or, when only the database holds it, a copy fetched into a cache. */
async function fileOf(m: Media): Promise<string> {
  const name = `${m.cid}.${EXT[m.mime] ?? "bin"}`;
  if (existsSync(join(LIB, name))) return join(LIB, name);
  if (existsSync(join(CACHE_MEDIA, name))) return join(CACHE_MEDIA, name);
  mkdirSync(CACHE_MEDIA, { recursive: true });
  const res = await fetch(`${API}/api/media/${m.cid}`, { headers: { authorization: `Bearer ${await keyFor()}` } });
  if (!res.ok) throw new Error(`could not fetch ${m.title || m.cid}: ${res.status}`);
  writeFileSync(join(CACHE_MEDIA, `${name}.part`), new Uint8Array(await res.arrayBuffer()));
  renameSync(join(CACHE_MEDIA, `${name}.part`), join(CACHE_MEDIA, name));
  say(`  ${m.title || m.cid} is not in library/ — fetched from the database`);
  return join(CACHE_MEDIA, name);
}

const mediaByCid = async (cid: string) => (await call<{ media: Media[] }>(`/api/media?q=${encodeURIComponent(cid)}`)).media.find((m) => m.cid === cid) ?? null;

/** Captions: the voice clips' words, in short phrases broken at the punctuation, on the timeline's clock. */
function phrasesOf(t: Timeline, media: Map<string, Media>) {
  const out: { text: string; start: number; end: number }[] = [];
  for (const c of t.clips.filter((c) => c.track === "A1" && c.cid)) {
    const words = (media.get(c.cid!)?.meta?.words ?? []) as { word: string; start: number; end: number }[];
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
  if (!phrases.length) return [];
  const font = pathToFileURL(resolve("node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2")).href;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: process.env.CHROME_ARGS?.split(" ") ?? [] });
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
    const f = join(dir, `cap-${W}x${H}-${String(i).padStart(3, "0")}.png`);
    await page.screenshot({ path: f as `${string}.png`, omitBackground: true });
    files.push(f);
  }
  await browser.close();
  return files;
}

/** Run ffmpeg with progress; on failure its command and error are kept beside the work. */
function runFfmpeg(args: string[], work: string, onSeconds: (s: number) => void = () => {}) {
  return new Promise<void>((ok, bad) => {
    const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...args]);
    let err = "";
    p.stdout.on("data", (d) => {
      const us = /out_time_us=(\d+)/.exec(String(d))?.[1];
      if (us) onSeconds(Number(us) / 1e6);
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? ok() : (writeFileSync(join(work, "ffmpeg-error.txt"), `${args.join(" ")}\n\n${err}`), bad(new Error(err.slice(-400) || `ffmpeg exited ${code}`)))));
  });
}

/** The encoders' arguments: the HEVC Main10 master (VideoToolbox on the Mac, x265 elsewhere), the 8-bit H.264 copies. */
function masterArgs() {
  const enc = hevcEncoder();
  // YouTube's 4K upload bitrate (35–68 Mbps recommended) — the platforms re-encode it anyway
  const rate = ["-b:v", "50M", "-maxrate", "68M", "-bufsize", "100M"];
  return enc.hevc === "libx265"
    ? [...enc.args, "-pix_fmt", "yuv420p10le", ...rate, "-x265-params", "log-level=error", "-tag:v", "hvc1", ...TAGS]
    : [...enc.args, "-pix_fmt", "p010le", ...rate, "-tag:v", "hvc1", ...TAGS];
}
const h264Args = (portrait: boolean) => ["-c:v", "libx264", "-preset", process.env.MAIACITY_X264_PRESET ?? "slow", "-crf", "16", "-profile:v", "high", "-maxrate", portrait ? "12M" : "20M", "-bufsize", "40M", "-pix_fmt", "yuv420p", ...TAGS];
/** 10-bit picture → 8-bit, dithered (error diffusion), still BT.709 / TV range. */
const TO_8BIT = `zscale=d=error_diffusion,format=yuv420p,${SETPARAMS}`;

/** Every format a film goes out in, by the shape it is cut for (Zernio's platform pages set the limits). */
type Output = { file: string; name: string; channels: string[]; format: string; aspect: string; width: number; height: number; codec: "hevc" | "h264"; note?: string; qc?: Qc; loudness?: ReturnType<typeof loudness> };

/** The film's look: its CDL, else its preset's, else none. */
function lookOf(t: Timeline): Cdl | null {
  const g = t.grade;
  if (!g) return null;
  return cleanCdl(g.look) ?? (g.preset && g.preset in PRESETS ? cleanCdl(PRESETS[g.preset as keyof typeof PRESETS].cdl) : null);
}

async function render(job: Job) {
  const t = (await call<Timeline[]>("/api/timelines")).find((x) => x.id === job.timeline_id);
  if (!t) throw new Error("the timeline is gone");
  const media = new Map((await call<{ media: Media[] }>("/api/media")).media.map((m) => [m.cid, m]));
  const isWorld = (c: Clip) => c.kind === "world";
  const clips = t.clips.filter((c) => (isWorld(c) ? c.track === "V1" : media.has(c.cid ?? ""))).sort((a, b) => a.start - b.start);
  const total = clips.reduce((n, c) => Math.max(n, c.start + c.dur), 0);
  if (!total) throw new Error("the timeline is empty");
  const look = lookOf(t);
  const warnings: string[] = [];
  const conformed: { clip: string; proxy: string; original: string }[] = [];
  await report(job.id, { note: "fetching files", progress: 0.02 });

  // conform: originals only — a proxy cut into the timeline is swapped for the file it stands for
  const originalOf = async (cid: string): Promise<Media> => {
    const m = media.get(cid)!;
    const of = m.meta?.proxyOf as string | undefined;
    if (!of) return m;
    const o = media.get(of) ?? (await mediaByCid(of));
    if (!o) throw new Error(`${m.title || cid} is a proxy whose original (${of}) the library does not hold`);
    media.set(o.cid, o);
    return o;
  };
  const files = new Map<string, string>(); // by the timeline's CID: the original's file
  const sources = new Map<string, Source>(); // picture sources, by the timeline's CID
  for (const c of clips.filter((c) => !isWorld(c))) {
    const cid = c.cid!;
    if (files.has(cid)) continue;
    const m = await originalOf(cid);
    if (m.cid !== cid) conformed.push({ clip: c.id, proxy: cid, original: m.cid });
    files.set(cid, await fileOf(m));
  }
  // A title card's marker on the picture track is not a picture: it marks where the hook goes, and names the day's
  // cards by CID (its meta: cards and hooks, one per shape — written by thumbnail.mjs): the title card delivered with
  // the film, and the hook layer laid over the first seconds of the social copies (the same title, transparent). The
  // film itself runs from its first frame: a still card there would stop it, and the Short's and X's cover is a frame.
  type Marker = { cards?: Record<string, string>; hooks?: Record<string, string> };
  const card = clips.find((c) => c.track === "V1" && !isWorld(c) && (media.get(c.cid!)?.meta as Marker | undefined)?.cards);
  const named = card ? (media.get(card.cid!)!.meta as Marker) : {};
  const thumbnails = new Map<string, Media>(); // by shape: the title card delivered with its film
  const hooks = new Map<string, string>(); // by shape: the hook layer's file
  for (const aspect of Object.keys(FRAME)) {
    const shape = aspect.replace(":", "x"), thumb = media.get(named.cards?.[shape] ?? ""), hook = media.get(named.hooks?.[shape] ?? "");
    if (thumb) thumbnails.set(aspect, thumb);
    if (hook) hooks.set(aspect, await fileOf(hook));
  }
  const pictures = clips.filter((c) => c.track === "V1" && c !== card);
  for (const c of pictures.filter((c) => !isWorld(c))) {
    if (sources.has(c.cid!)) continue;
    const m = media.get(conformed.find((x) => x.proxy === c.cid)?.original ?? c.cid!)!;
    const s = sourceOf(files.get(c.cid!)!, m);
    if (s.profile === "unknown") warnings.push(`${m.title || m.cid}: colour unknown (${s.color.detectedFrom}) — rendered as Rec.709; set it in the studio`);
    sources.set(c.cid!, s);
  }

  const work = resolve("studio/film/.render", job.id);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const phrases = phrasesOf(t, media);
  const base = `${(t.project ?? "film").toLowerCase().replace(/\s+/g, "-")}${t.variant ? `-${t.variant.toLowerCase()}` : ""}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;

  // every shape it is delivered in: 16:9 (the default: YouTube, X, LinkedIn), 9:16 (TikTok, Reels, Shorts), 1:1 (the
  // Instagram feed: a film longer than a Reel goes there), and the timeline's own frame too (4:5). A shape the edit
  // was not framed for is cut from the middle of each shot (or where its reframing puts it).
  const shapes = [...new Set(["16:9", "9:16", "1:1", t.aspect in FRAME ? t.aspect : "16:9"])];
  const sizes = shapes.map((aspect) => ({ aspect, width: FRAME[aspect]![0] * masterOf(aspect), height: FRAME[aspect]![1] * masterOf(aspect) }));

  // world clips: one ACEScct plate per shape, at the shape's own resolution (stream B's renderPlate, cached)
  const plates = new Map<string, Map<string, { file: string; key: string; fingerprint: string; reused: boolean }>>();
  const worldClips = pictures.filter(isWorld);
  if (worldClips.length) {
    await report(job.id, { note: "rendering world plates", progress: 0.03 });
    const { renderPlate, fingerprint } = await worldModules();
    for (const c of worldClips)
      plates.set(c.id, await platesFor(c, sizes, {
        fps: FPS, site: process.env.MAIACITY_SITE ?? SITE, renderPlate, fingerprint, say,
        fetchShot: (id, v) => call(`/api/shots/${encodeURIComponent(id)}${v ? `?version=${v}` : ""}`),
      }));
  }

  const used: Record<string, string> = {};
  let bypassed = 0, managed = 0;
  const outputs: Output[] = [];
  for (const [k, aspect] of shapes.entries()) {
    const span = 0.84 / shapes.length, from = 0.04 + k * span;
    outputs.push(...(await shape(aspect, from, from + span)));
  }

  async function shape(aspect: string, p0: number, p1: number): Promise<Output[]> {
    const [W1, H1] = FRAME[aspect]!;
    const MASTER = masterOf(aspect);
    const [W, H] = [W1 * MASTER, H1 * MASTER];
    await report(job.id, { note: "setting the captions", progress: p0 });
    const caps = await captionImages(phrases, [W, H], work);
    const hook = hooks.get(aspect) ?? null, hook0 = hook && card ? card.start : null;

    const args: string[] = [];
    const f: string[] = [];
    let n = 0;
    // pictures: one stream, the clips joined end to end (a hard cut is a join, not a layer — laying 43 clips over
    // each other made every 4K frame composite all of them). Where clips overlap, the later one is on top (the
    // thumbnail over the first frame); a gap is black. Each piece is cut to its exact frame count on the film's
    // clock, so the cuts stay on their words however many pieces there are. Every piece arrives as 10-bit YUV.
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
        f.push(`${blackFilters(W, H, FPS, frames)}[q${i}]`);
        joins.push(`[q${i}]`);
        continue;
      }
      const c = p.clip;
      let src: Source, from: number;
      if (isWorld(c)) {
        // the plate starts at the clip's in point, at this shape's own resolution
        src = sourceOf(plates.get(c.id)!.get(aspect)!.file, null, { profile: "acescct" });
        from = p.a / FPS - c.start;
      } else {
        src = sources.get(c.cid!)!;
        from = c.in + (p.a / FPS - c.start);
      }
      args.push(...inputArgs(src, from, frames / FPS + 0.5, FPS));
      const piece = pieceFilters({ source: src, grade: c.grade, look, frame: c.frame?.[aspect] ?? c.frame?.[aspect.replace(":", "x")], W, H, frames, fps: FPS });
      Object.assign(used, piece.used);
      if (aspect === shapes[0]) piece.bypass ? bypassed++ : managed++;
      f.push(`[${n}:v]${piece.filters.join(",")}[q${i}]`);
      joins.push(`[q${i}]`);
      n++;
    }
    f.push(`${joins.join("")}concat=n=${joins.length}:v=1:a=0[joined]`);
    // a film with a hook opens on its moving picture (the title over it); one without fades up from black — in
    // display space, after the output transform
    f.push(`[joined]${hook0 === null ? "fade=t=in:st=0:d=1.2," : ""}fade=t=out:st=${Math.max(0, total - 2.5).toFixed(3)}:d=2.5[pic]`);
    let last = "pic";
    // graphics on top, never graded: captions, each fading in and out on its phrase
    for (const [i, p] of phrases.entries()) {
      // each caption only for its own phrase (looping every one over the whole film ran ffmpeg out of resources)
      const a = Math.max(0, p.start - 0.08), b = Math.min(total, p.end + 0.3), d = Math.max(0.3, b - a);
      args.push("-loop", "1", "-t", d.toFixed(3), "-framerate", String(FPS), "-i", caps[i]!);
      f.push(`[${n}:v]scale=out_color_matrix=bt709:out_range=tv,format=yuva420p10le,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${(d - 0.25).toFixed(3)}:d=0.25:alpha=1,setpts=PTS-STARTPTS+${a.toFixed(3)}/TB[c${i}]`);
      f.push(`[${last}][c${i}]overlay=0:0:format=yuv420p10:eof_action=pass:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[o${i}]`);
      last = `o${i}`;
      n++;
    }
    // the hook over the first seconds — in a copy rendered straight (a 4K master stays clean: YouTube takes its title
    // card as a thumbnail; its 1080 copy gets the hook below)
    if (hook && MASTER === 1) {
      args.push("-loop", "1", "-framerate", String(FPS), "-t", HOOK.toFixed(3), "-i", hook);
      f.push(`[${n}:v]scale=${W}:${H}:out_color_matrix=bt709:out_range=tv,format=yuva420p10le,setpts=PTS-STARTPTS+${hook0!.toFixed(3)}/TB[hk]`);
      f.push(`[${last}][hk]overlay=0:0:format=yuv420p10:eof_action=pass:enable='between(t,${hook0!.toFixed(3)},${(hook0! + HOOK).toFixed(3)})'[hko]`);
      last = "hko";
      n++;
    }
    f.push(`[${last}]${MASTER > 1 ? SETPARAMS : TO_8BIT}[vout]`);
    // sound: every audio clip from where it is trimmed, at its volume, with its own fades (or a short one at both
    // ends); voice, music and sounds mixed apart, so the music can step back while the voice speaks
    const tracks: Record<"voice" | "music" | "fx", string[]> = { voice: [], music: [], fx: [] };
    let k = 0;
    for (const c of clips.filter((c) => c.track.startsWith("A") && c.cid)) {
      args.push("-ss", c.in.toFixed(3), "-t", c.dur.toFixed(3), "-i", files.get(c.cid!)!);
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
      ? `${parts.join("")}amix=inputs=${parts.length}:normalize=0:duration=longest,alimiter=limit=0.95,apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[aout]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(3)}[aout]`);

    const tag = `${base}-${aspect.replace(":", "x")}`;
    const masterName = `${tag}-4k-hevc.mp4`, name = `${tag}.mp4`;
    const master = join(work, masterName), out = join(work, name);
    args.push("-filter_complex", f.join(";"), "-map", "[vout]", "-map", "[aout]",
      ...(MASTER > 1 ? masterArgs() : h264Args(H1 > W1)),
      "-r", String(FPS), "-c:a", "aac", "-b:a", MASTER > 1 ? "384k" : "192k", "-movflags", "+faststart", MASTER > 1 ? master : out);

    const pr = (x: number) => p0 + (p1 - p0) * x;
    await report(job.id, { note: "rendering", progress: pr(0.05) });
    let lastReport = 0;
    await runFfmpeg(args, work, (s) => {
      if (Date.now() - lastReport < 3000) return;
      lastReport = Date.now();
      void report(job.id, { progress: pr(0.05 + (MASTER > 1 ? 0.75 : 0.9) * Math.min(1, s / total)), note: "rendering" });
    });

    // the 1080 copy, from the master: scaled in 10 bits, the hook on top, then dithered to 8
    if (MASTER > 1) {
      await report(job.id, { note: "rendering", progress: pr(0.82) });
      const scaled = `[0:v]zscale=w=${W1}:h=${H1}:f=lanczos`;
      const graph = hook
        ? ["-loop", "1", "-framerate", String(FPS), "-t", HOOK.toFixed(3), "-i", hook, "-filter_complex",
          `${scaled}[v];[1:v]scale=${W1}:${H1}:out_color_matrix=bt709:out_range=tv,format=yuva420p10le,setpts=PTS-STARTPTS+${hook0!.toFixed(3)}/TB[hk];[v][hk]overlay=0:0:format=yuv420p10:eof_action=pass:enable='between(t,${hook0!.toFixed(3)},${(hook0! + HOOK).toFixed(3)})',${TO_8BIT}[o]`,
          "-map", "[o]", "-map", "0:a"]
        : ["-filter_complex", `${scaled},${TO_8BIT}[o]`, "-map", "[o]", "-map", "0:a"];
      await runFfmpeg(["-i", master, ...graph, ...h264Args(false), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], work);
    }
    const long = total > 90 ? "Instagram Reels take at most 90 s (via Zernio): post it as a feed video, or cut it down" : undefined;
    const hooked = hook ? ` · the hook over its first ${HOOK} s` : "";
    const made: Output[] = aspect === "16:9"
      ? [
        { file: master, name: masterName, channels: ["youtube"], format: `4K master · HEVC 10-bit · ${W}×${H}`, aspect, width: W, height: H, codec: "hevc" },
        { file: out, name, channels: ["x", "linkedin"], format: `H.264 · ${W1}×${H1}${hooked}`, aspect, width: W1, height: H1, codec: "h264" },
      ]
      : aspect === "9:16"
        ? [{ file: out, name, channels: total <= 180 ? ["instagram", "youtube"] : ["instagram"], format: `H.264 · ${W1}×${H1} · 30 fps · Reel${total <= 180 ? " and Short" : ""}${hooked}`, aspect, width: W1, height: H1, codec: "h264", ...(long ? { note: long } : {}) }]
        : [{ file: out, name, channels: ["instagram"], format: `H.264 · ${W1}×${H1} · feed${hooked}`, aspect, width: W1, height: H1, codec: "h264" }];
    // QC: nothing goes into the library that is not what it says it is
    await report(job.id, { note: "checking", progress: pr(0.95) });
    for (const o of made) {
      o.qc = qc(o.file, {
        seconds: total, fps: FPS, bitDepth: o.codec === "hevc" ? 10 : 8, width: o.width, height: o.height, codec: o.codec,
        maxBitrate: o.codec === "hevc" ? 68e6 : o.height > o.width ? 12e6 : 25e6,
        ...(o.aspect === "9:16" ? { maxBytes: 300e6, maxSeconds: 180 } : {}),
      });
      if (!o.qc.ok) throw new Error(`QC: ${o.name} — ${o.qc.errors.join("; ")}`);
      o.loudness = loudness(o.file);
    }
    return made;
  }

  // into the library, and onto the calendar (the job's report carries them): ready for the upload step
  await report(job.id, { note: "into the library", progress: 0.94 });
  const color = { working: "acescct", output: "odt-rec709", ocio: ocioVersion(), transforms: used, clips: { managed, bypassed }, look };
  // each file into library/ first (copied, described), then the database — tagged by what it is, never named
  const title = `${t.project ?? ""} ${t.variant ?? ""} · ${t.name}`.trim();
  const deliveries = [];
  for (const o of outputs) {
    const qcMeta = { frames: o.qc!.frames, seconds: Number(o.qc!.seconds.toFixed(3)), bitDepth: o.qc!.bitDepth, tags: o.qc!.tags, bitrate: o.qc!.bitrate, warnings: o.qc!.warnings };
    const d = await put(o.file, {
      title: `${title} · ${o.aspect} ${o.codec}`,
      description: `${o.format} · for ${o.channels.join(", ")}`,
      tags: [t.project ?? "film", "role:render", ...(t.variant ? [`cut:${t.variant}`] : []), `aspect:${o.aspect}`, `codec:${o.codec}`],
      meta: { timeline: t.id, duration_s: Number(total.toFixed(2)), format: o.format, color, qc: qcMeta, loudness: o.loudness },
    });
    const bytes = new Uint8Array(await Bun.file(o.file).arrayBuffer());
    await upload(bytes, { cid: d.cid, mime: d.mime, title: d.title, description: d.description, tags: d.tags, meta: d.meta, public: d.public });
    deliveries.push({
      channels: o.channels, cid: d.cid, format: o.format, aspect: o.aspect, width: o.width, height: o.height, codec: o.codec, bytes: bytes.length,
      seconds: Number(total.toFixed(2)), qc: qcMeta, loudness: o.loudness, ...(o.note ? { note: o.note } : {}),
    });
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
  const platesUsed = [...plates.entries()].flatMap(([clip, m]) => [...m.entries()].map(([aspect, p]) => ({ clip, aspect, key: p.key, fingerprint: p.fingerprint, reused: p.reused })));
  const rep = { color, conformed, plates: platesUsed, warnings, deliveries: deliveries.filter((d: any) => d.kind !== "thumbnail").map((d: any) => ({ cid: d.cid, aspect: d.aspect, codec: d.codec, qc: d.qc, loudness: d.loudness })) };
  return { cid: own.cid, deliveries, report: rep };
}

/** A proxy job: the file's colour read into meta.color, its HD log proxy made and linked both ways. */
async function proxy(job: Job) {
  const cid = job.media_cid!;
  const m = await mediaByCid(cid);
  if (!m) throw new Error("the library does not hold that file");
  if (m.meta?.proxyOf) return { note: "a proxy itself: nothing to do", report: {} };
  await report(job.id, { note: "fetching the file", progress: 0.05 });
  const file = await fileOf(m);
  const src = sourceOf(file, m, { fresh: true });
  await report(job.id, { note: `making the proxy (${src.profile})`, progress: 0.1 });
  const dir = mkdtempSync(join(tmpdir(), "maiacity-proxy-"));
  try {
    let lastReport = 0;
    const made = await makeProxy(src, dir, (x) => {
      if (Date.now() - lastReport < 3000) return;
      lastReport = Date.now();
      void report(job.id, { progress: 0.1 + 0.8 * x, note: "making the proxy" });
    });
    let proxyCid: string | null = null;
    if (made) {
      const d = await put(made.file, {
        title: `${m.title || m.cid.slice(0, 12)} · proxy`,
        description: `HD proxy (${made.width}×${made.height}) in ${made.profile}, for editing — of ${m.cid}`,
        tags: ["role:proxy"],
        meta: {
          proxyOf: m.cid, width: made.width, height: made.height, ...(made.seconds ? { duration_s: Number(made.seconds.toFixed(3)) } : {}),
          color: { profile: made.profile, primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "tv", bitDepth: made.mime === "video/mp4" ? 10 : 16, detectedFrom: `proxy of ${m.cid}` },
          transforms: made.used,
        },
      });
      const bytes = new Uint8Array(await Bun.file(join(LIB, d.file)).arrayBuffer());
      await upload(bytes, { cid: d.cid, mime: d.mime, title: d.title, description: d.description, tags: d.tags, meta: d.meta, public: false });
      proxyCid = d.cid;
    }
    // the original learns its colour and its proxy: re-read just before, so nothing written meanwhile is lost
    const now = (await mediaByCid(cid)) ?? m;
    const colorMeta = { ...src.color, ...(now.meta?.color?.override ? { override: now.meta.color.override } : {}) };
    const meta = { ...now.meta, color: colorMeta, ...(proxyCid ? { proxy: proxyCid } : {}), width: src.width, height: src.height };
    await call("/api/media/describe", { method: "POST", body: JSON.stringify({ cid, meta }) });
    const doc = await get(cid);
    if (doc) await save({ ...doc, meta: { ...doc.meta, ...meta } });
    return {
      output_cid: proxyCid,
      note: proxyCid ? `proxy ready · ${made!.profile} · ${src.color.detectedFrom}` : `colour read: ${src.profile} (${src.color.detectedFrom}) · no proxy needed`,
      report: { color: colorMeta, proxy: proxyCid, proxyProfile: made?.profile ?? null, transforms: made?.used ?? {} },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The studio viewer's preview LUTs: baked from the configs, into the library when the library lacks that hash. */
async function luts() {
  const have = await call<Record<string, { cid: string; hash: string; size: number }>>("/api/film/luts");
  const made: Record<string, string> = {};
  for (const name of PREVIEW) {
    const { file, hash } = bakedLut(TRANSFORMS[name], { format: "mlut", name });
    if (have[name]?.hash === hash) continue;
    const d = await put(file, {
      mime: "application/octet-stream",
      title: `preview LUT · ${name}`,
      description: `The studio viewer's ${name}, 65³, baked from its config (hash ${hash}) — a cache, made again from the config at will`,
      tags: ["role:lut", `transform:${name}`],
      meta: { transform: name, hash, size: 65, format: "mlut1", ocio: ocioVersion() },
    });
    const bytes = new Uint8Array(await Bun.file(join(LIB, d.file)).arrayBuffer());
    await upload(bytes, { cid: d.cid, mime: d.mime, title: d.title, description: d.description, tags: d.tags, meta: d.meta, public: false });
    made[name] = d.cid;
  }
  return made;
}

if (import.meta.main) {
  checkFfmpeg();
  say(`render worker on ${API} — OpenColorIO ${ocioVersion()}, ${hevcEncoder().hevc} — waiting for jobs`);
  mkdirSync(LIB, { recursive: true });
  // the preview LUTs, whenever the configs changed
  await luts().then((m) => Object.keys(m).length && say(`preview LUTs baked: ${Object.keys(m).join(", ")}`)).catch((e) => say(`preview LUTs: ${(e as Error).message}`));
  const once = process.argv.includes("--once");
  for (;;) {
    // the API away for a moment (restarted, rebuilt) is waited out, not a crash
    const res = await fetch(`${API}/api/renders/claim`, { method: "POST", headers: { authorization: `Bearer ${await keyFor()}` } }).catch(() => null);
    if (!res) {
      await Bun.sleep(5000);
      continue;
    }
    if (res.status === 204) {
      if (once) break;
      await Bun.sleep(3000);
      continue;
    }
    if (!res.ok) {
      say(`claim failed: ${res.status}`);
      await Bun.sleep(10000);
      continue;
    }
    const job = (await res.json()) as Job;
    const kind = job.kind ?? "render";
    say(`job ${job.id}: ${kind} ${job.timeline_id ?? job.media_cid ?? ""}`);
    try {
      if (kind === "proxy") {
        const r = await proxy(job);
        await report(job.id, { status: "done", progress: 1, note: r.note, ...(r.output_cid ? { output_cid: r.output_cid } : {}), report: r.report });
        say(`job ${job.id}: ${r.note}`);
      } else if (kind === "lut") {
        const made = await luts();
        await report(job.id, { status: "done", progress: 1, note: Object.keys(made).length ? `baked ${Object.keys(made).join(", ")}` : "every preview LUT is current", report: { luts: made } });
        say(`job ${job.id}: preview LUTs done`);
      } else {
        const { cid, deliveries, report: rep } = await render(job);
        const hashes = Object.entries(rep.color.transforms).map(([k, v]) => `${k}@${v.slice(0, 8)}`).join(" ");
        await report(job.id, { status: "done", progress: 1, note: `in the library and on the calendar: ${deliveries.length} files · ${hashes}`.slice(0, 300), output_cid: cid, deliveries, report: rep });
        say(`job ${job.id}: done → ${cid}`);
      }
    } catch (e) {
      await report(job.id, { status: "failed", note: (e as Error).message.slice(0, 280) });
      say(`job ${job.id}: failed — ${(e as Error).message}`);
    }
  }
}
