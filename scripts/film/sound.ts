// A film's sound as timeline clips on A3: every scene's bed, running on under the cuts and crossfading into the next;
// the spot sounds on their shots; the hits, placed so their loudest moment lands where the shot list says (`peak`).
// Used by the timeline builders (api/scripts/.animatic.ts, .full-timeline.ts).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

type Cut = { start: number; end: number; seconds: number };
type Film = {
  shots: { name: string; sfx?: [string, number][] }[];
  cuts: Cut[];
  total: number;
  sound?: {
    beds: { cid: string; from: string; to: string; level: number; loop?: boolean; in?: number; hardOut?: boolean; after?: number; fadeIn?: number }[];
    hits: { cid: string; peak: number; level: number }[];
  };
};
/** The music track (A2): the base score, with the cues cut in. A cue with `replace` takes the score's place over its
 *  stretch; replacing cues less than a second apart leave silence between them (the dip, a beat, the breakfast).
 *  Any other cue lies on top. Each cue's own `fin` / `fout`, else hard in and out for a replacing one. */
export function musicClips(film: any, cid: (path: string) => string, level = 0.6) {
  const id = () => Math.random().toString(36).slice(2, 10);
  type A2 = { id: string; cid: string; track: "A2"; start: number; in: number; dur: number; vol: number; fin: number; fout: number };
  const out: A2[] = [];
  const cues: any[] = film.music.cues ?? [];
  // where the score is silent: the replacing cues, joined across gaps under a second
  // (and how long the score takes to come back after the last of them: a cue's `blend` overlaps the two, the score
  // fading up under the cue as it fades out — a key or tempo change heard as one move, not a switch)
  const gaps: [number, number, number][] = [];
  for (const c of cues.filter((c) => c.replace).sort((a, b) => a.from - b.from)) {
    const last = gaps.at(-1);
    if (last && c.from - last[1] < 1) (last[1] = Math.max(last[1], c.to)), (last[2] = c.blend ?? 0);
    else gaps.push([c.from, c.to, c.blend ?? 0]);
  }
  let t = 0, blend = 0;
  for (const [a, b, bl] of [...gaps, [film.total, film.total, 0] as [number, number, number]]) {
    const from = Math.max(0, t - blend);
    if (a - from > 0.05) out.push({ id: id(), cid: cid(film.music.cid), track: "A2", start: from, in: from, dur: a - from + (a < film.total ? 0.3 : 0), vol: level, fin: t === 0 ? 0.5 : Math.max(0.8, blend), fout: a < film.total ? 0.3 : 3 });
    (t = b), (blend = bl);
  }
  for (const c of cues)
    out.push({ id: id(), cid: cid(c.cid), track: "A2", start: c.from, in: 0, dur: c.to - c.from, vol: c.level ?? level, fin: c.fin ?? (c.replace ? 0.02 : 0.3), fout: c.blend ?? c.fout ?? (c.replace ? 0.05 : 1.5) });
  return out;
}

export type SoundClip = { id: string; cid: string; track: "A3"; start: number; in: number; dur: number; vol: number; fin: number; fout: number };

/** How loud a library sound is against the others, so a level means the same for each. */
const NORMALIZE: Record<string, number> = { "ef0770d0d1b2927adbb95158dcf2a7c1a3abf74bf35f4aab4da3b2885374f25e.mp3": 22.1, "1934113f408410383c16336a37d2e274579e0cc0802e574dcc232982cca02a84.mp3": 0.35, "7605ffd5723a4511ba9320009d5e2beda3f9a734ad244d7765a6120bf4200e82.mp3": 0.66, "646b67cf337fdfdb3446e55b1f1edd4bfc3e6469bc12ea3acd07901cc71cda8f.mp3": 1.5 };
/** A bed crossfades into the next over this long; the picture cut sits in the middle of it. */
const XFADE = 1.2;

/** A sound's file, by its CID: library/<cid>.<ext>. */
const local = (_film: string, ref: string) => {
  const file = `library/${ref.includes(".") ? ref : `${ref}.mp3`}`;
  if (!existsSync(file)) throw new Error(`library/ does not hold ${ref}`);
  return file;
};

const seconds = (file: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

/** Where a sound is loudest: the 20 ms window with the most energy. */
function peakOf(file: string) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  let best = 0, at = 0;
  for (let i = 0; i + 160 <= s.length; i += 160) {
    let e = 0;
    for (let j = i; j < i + 160; j++) e += s[j]! * s[j]!;
    if (e > best) (best = e), (at = i);
  }
  return at / 8000;
}

export function soundClips(name: string, film: Film, cid: (path: string) => string): SoundClip[] {
  const id = () => Math.random().toString(36).slice(2, 10);
  const vol = (path: string, level: number) => Math.min(1, level * (NORMALIZE[path] ?? 1));
  const cutOf = (shot: string) => {
    const i = film.shots.findIndex((s) => s.name === shot);
    if (i < 0) throw new Error(`no shot "${shot}"`);
    return film.cuts[i]!;
  };
  const out: SoundClip[] = [];
  const beds = film.sound?.beds ?? [];

  // the beds: one stretch per scene, the file played on (and looped, if it is shorter than the scene). Most
  // crossfade into the next; a bed with `hardOut` stops dead on its last cut (the dip ending on "Here…"), and one
  // with `after` comes in that long after its first cut — a beat of silence first
  for (const [i, b] of beds.entries()) {
    const start = Math.max(0, cutOf(b.from).start + (b.after ?? (i > 0 ? -XFADE / 2 : 0)));
    const end = Math.min(film.total, cutOf(b.to).end + (b.hardOut ? 0 : i < beds.length - 1 ? XFADE / 2 : 0));
    const length = seconds(local(name, b.cid));
    // a seamless loop joins itself with no fade; any other file overlaps itself for a second, fading across
    const join = b.loop ? 0 : 1;
    let t = start, from = b.in ?? 0;
    while (t < end - 0.05) {
      if (from >= length - 0.5) from = 0;
      const dur = Math.min(length - from, end - t);
      out.push({ id: id(), cid: cid(b.cid), track: "A3", start: t, in: from, dur,
        vol: vol(b.cid, b.level), fin: t === start ? (b.fadeIn ?? (i > 0 ? XFADE : 1.5)) : b.loop ? 0.02 : join, fout: t + dur >= end - 0.05 ? (b.hardOut ? 0.03 : XFADE) : b.loop ? 0.02 : join });
      t += dur - (t + dur >= end - 0.05 ? 0 : join);
      from = 0;
    }
  }

  // the spot sounds: on their shot, in on the cut, a breath of fade out
  for (const [i, s] of film.shots.entries())
    for (const [path, level] of s.sfx ?? [])
      out.push({ id: id(), cid: cid(path), track: "A3", start: film.cuts[i]!.start, in: 0, dur: film.cuts[i]!.seconds, vol: vol(path, level), fin: 0.12, fout: 0.4 });

  // the hits: their loudest moment on the mark
  for (const h of film.sound?.hits ?? []) {
    const file = local(name, h.cid);
    const start = h.peak - peakOf(file);
    const skip = Math.max(0, -start);
    out.push({ id: id(), cid: cid(h.cid), track: "A3", start: Math.max(0, start), in: skip, dur: Math.min(seconds(file) - skip, film.total - Math.max(0, start)), vol: vol(h.cid, h.level), fin: 0.01, fout: 0.3 });
  }
  return out;
}
