/**
 * The shot analysis: what every ingested picture shows, tagged for the edit — Prem's confidential Qwen (vision), in the
 * vocabulary of game/film/vocabulary.json (base tags with fixed values, free tags, time-ranged cues).
 *
 * RETIRED CALLER: the analysis now runs on the Mac (vault/app/src/analyse/: frames sampled natively, Prem asked from
 * the Mac through Prem's confidential proxy, the same prompt, schema and validation ported to Rust). The vault server's
 * analyse.rs is gone, so nothing calls this route any more; it stays until it is removed on purpose.
 *
 * The vault server (vault/crates/vault-server/src/analyse.rs) samples a proxy's frames, takes them through the ACES 2.0
 * output transform (the model sees what a screen shows) and sends them here a stretch at a time, with the words said
 * in it; then once more, text only, every stretch's answer — to group the repeated attempts of an action into takes,
 * rank them, and write the file's tags, summary and thumbnail pick. Prem's SDK encrypts in this process (the same
 * RVENC client as speech to text, stt.ts): neither Prem's gateway nor anyone on the way sees the frames or the words.
 *
 * The model answers JSON (a JSON schema from the vocabulary, as Prem's `response_format` takes it; `json_object` where
 * the schema is refused); every answer is validated against the vocabulary — values it does not know are dropped,
 * times clamped to the stretch — and an answer that cannot be used at all is sent back once to be repaired.
 *
 *   POST /api/analysis   { mode: "frames", file, stretch: { s, e, index, of }, frames: [{ t, jpeg }], words, before? }
 *                         → { tags, free, cues, summary, thumbnail: { index, why } | null, model, vocabulary }
 *                        { mode: "reduce", file, stretches: [{ s, e, summary, tags, cues, thumbnail }], text }
 *                         → { tags, free, summary: { line, best_use }, takes, thumbnail: { t, why } | null, model, vocabulary }
 *   GET  /api/analysis   → { ready, model, vocabulary }
 *
 * Who may ask: the vault server (its own token), or a key with media:admin — as for speech to text. Prem's failures
 * read as prem.ts classifies them; one that is Prem's for now answers `transient: true` (the file waits, queued).
 */
import VOCAB from "../../game/film/vocabulary.json";
import { authorize } from "./stt";
import { call, failure, models, paused, pick, prem, PremError } from "./prem";

/** Prem's confidential vision model: Qwen 3.8 27B (text, image, video) — docs.prem.io/models-and-pricing. */
export const MODEL = "qwen38-27b";
export const VOCABULARY = VOCAB.version;
/** Frames in one request at most, and one frame's JPEG (base64) at most. */
export const MAX_FRAMES = 24;
export const MAX_JPEG = 2 * 1024 * 1024;

type FieldType = "one" | "many" | "number" | "text" | "names";
type Field = { label: string; type: FieldType; values?: string[]; about: string };
const BASE = VOCAB.base as Record<string, Field>;
const KINDS = Object.keys(VOCAB.cues.kinds) as CueKind[];

export type CueKind = "take" | "action" | "emotion" | "cut" | "transition" | "highlight" | "problem";
export type Cue = { s: number; e: number; kind: CueKind; label: string; confidence: number; note?: string; why?: string; take_of?: string; take?: number };
export type Tags = Record<string, string | string[] | number>;
export type FramesAnswer = { tags: Tags; free: string[]; cues: Cue[]; summary: string; thumbnail: { index: number; why: string } | null };
export type Take = { s: number; e: number; take: number; rank?: number; note?: string; confidence?: number };
export type TakeGroup = { take_of: string; best?: number; why?: string; takes: Take[] };
export type ReduceAnswer = { tags: Tags; free: string[]; summary: { line: string; best_use: string }; takes: TakeGroup[]; thumbnail: { t: number; why: string } | null };

export class AnalysisError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ── the vocabulary's words, as a model might write them ──
const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Other ways of saying a base value, per field (squashed → the vocabulary's own). */
const ALIASES: Record<string, Record<string, string>> = {
  shot_size: { extremewide: "EWS", extremewideshot: "EWS", ews: "EWS", wide: "WS", wideshot: "WS", long: "WS", longshot: "WS", full: "FS", fullshot: "FS", medium: "MS", mediumshot: "MS", mediumcloseup: "MCU", closeup: "CU", close: "CU", extremecloseup: "ECU", detail: "insert", insertshot: "insert" },
  angle: { eyelevel: "eye", highangle: "high", lowangle: "low", birdseye: "overhead", birdseyeview: "overhead", topdown: "overhead", dutchangle: "dutch", overtheshoulder: "OTS", pointofview: "POV" },
  movement: { still: "static", locked: "static", lockedoff: "static", tripod: "static", steadicam: "gimbal", stabilized: "gimbal", jib: "crane", aerial: "drone", push: "dolly", pushin: "dolly", pull: "dolly", pullout: "dolly", track: "dolly", tracking: "dolly", trucking: "dolly" },
  lens: { wideangle: "wide", standard: "normal", telephoto: "tele", long: "tele" },
  time_of_day: { daytime: "day", nighttime: "night", goldenhour: "golden hour", bluehour: "blue hour", dusk: "blue hour", dawn: "blue hour", sunset: "golden hour", sunrise: "golden hour" },
  location: { inside: "interior", indoor: "interior", indoors: "interior", int: "interior", outside: "exterior", outdoor: "exterior", outdoors: "exterior", ext: "exterior" },
  scene: { monologue: "monologue to camera", piecetocamera: "monologue to camera", talkinghead: "monologue to camera", broll: "b-roll", establishingshot: "establishing", screen: "text/screen", text: "text/screen", screenrecording: "text/screen" },
  quality: { outoffocus: "focus miss", soft: "focus miss", blurry: "focus miss", blown: "overexposed", blownout: "overexposed", dark: "underexposed", shake: "shaky", obstructed: "blocked", clipping: "audio clipping" },
};
const CUE_ALIASES: Record<string, CueKind> = { attempt: "take", repeat: "take", cutpoint: "cut", edit: "cut", in: "cut", out: "cut", moment: "highlight", best: "highlight", mistake: "problem", flub: "problem", falsestart: "problem", expression: "emotion", mood: "emotion" };

/** A value as the vocabulary writes it, or null. */
export function canonical(field: string, value: unknown): string | null {
  const f = BASE[field];
  if (!f?.values || typeof value !== "string") return null;
  const k = squash(value);
  return f.values.find((v) => squash(v) === k) ?? ALIASES[field]?.[k] ?? null;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** The base tags, each as the vocabulary allows; what it does not know goes into `errors`. */
export function cleanTags(raw: unknown, errors: string[]): Tags {
  const out: Tags = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = BASE[k];
    if (!f) {
      errors.push(`unknown tag ${k}`);
      continue;
    }
    if (v === null || v === undefined || v === "") continue;
    if (f.type === "one") {
      const c = canonical(k, Array.isArray(v) ? v[0] : v);
      if (c) out[k] = c;
      else errors.push(`${k}: ${JSON.stringify(v)} is not one of ${f.values!.join(", ")}`);
    } else if (f.type === "many") {
      const vals = (Array.isArray(v) ? v : [v]).map((x) => {
        const c = canonical(k, x);
        if (!c) errors.push(`${k}: ${JSON.stringify(x)} is not one of ${f.values!.join(", ")}`);
        return c;
      });
      out[k] = [...new Set(vals.filter((x): x is string => !!x))];
    } else if (f.type === "number") {
      const n = num(v);
      if (n !== null && n >= 0 && n < 100000) out[k] = Math.round(n);
      else errors.push(`${k}: ${JSON.stringify(v)} is not a number`);
    } else if (f.type === "text") {
      const t = text(v, 80);
      if (t) out[k] = t;
    } else {
      const names = (Array.isArray(v) ? v : [v]).map((x) => text(x, 40)).filter(Boolean);
      out[k] = [...new Set(names)].slice(0, 8);
    }
  }
  return out;
}

/** Free tags: lower case, short, each once. */
export function cleanFree(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const t = text(x, VOCAB.free.max_length).toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, VOCAB.free.max);
}

/** Cues inside [from, to] (a little slack at the edges), in the vocabulary's kinds, in order. */
export function cleanCues(raw: unknown, from: number, to: number, errors: string[]): Cue[] {
  if (!Array.isArray(raw)) return [];
  const lo = Math.max(0, from - 0.5), hi = to + 0.5;
  const out: Cue[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const k = typeof o.kind === "string" ? squash(o.kind) : "";
    const kind = (KINDS.find((x) => x === k) ?? CUE_ALIASES[k]) as CueKind | undefined;
    const label = text(o.label, 80);
    let s = num(o.s), e = num(o.e);
    if (!kind || !label || s === null) {
      errors.push(`a cue without ${!kind ? `a known kind (${JSON.stringify(o.kind)})` : !label ? "a label" : "a start"} was dropped`);
      continue;
    }
    if (e === null) e = s;
    if (e < s) [s, e] = [e, s];
    if (e < lo || s > hi) {
      errors.push(`a cue at ${s}–${e} s lies outside the stretch ${from}–${to} s`);
      continue;
    }
    const cue: Cue = { s: round3(Math.min(Math.max(s, lo), hi)), e: round3(Math.min(Math.max(e, lo), hi)), kind, label, confidence: Math.min(1, Math.max(0, num(o.confidence) ?? 0.5)) };
    const note = text(o.note, 240), why = text(o.why, 240), takeOf = text(o.take_of, 60), take = num(o.take);
    if (note) cue.note = note;
    if (why) cue.why = why;
    if (kind === "take" && takeOf) cue.take_of = takeOf;
    if (kind === "take" && take !== null && take >= 1) cue.take = Math.round(take);
    out.push(cue);
  }
  return out.sort((a, b) => a.s - b.s || a.e - b.e);
}

/** The model's text → its JSON: without a reasoning block or a code fence around it. */
export function parseAnswer(content: unknown): unknown {
  if (content && typeof content === "object") return content;
  if (typeof content !== "string") return null;
  let t = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1]!.trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

type Checked<T> = { value: T; errors: string[]; fatal: boolean };

/** A stretch's answer, as the catalog keeps it. */
export function validateFrames(raw: unknown, stretch: { s: number; e: number }, frames: number): Checked<FramesAnswer> {
  const errors: string[] = [];
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { value: { tags: {}, free: [], cues: [], summary: "", thumbnail: null }, errors: ["the answer is not a JSON object"], fatal: true };
  const fatal = !(o.tags && typeof o.tags === "object") && !Array.isArray(o.cues);
  if (fatal) errors.push("the answer has neither tags nor cues");
  const th = o.thumbnail as Record<string, unknown> | undefined;
  const idx = num(th?.index);
  return {
    value: {
      tags: cleanTags(o.tags, errors),
      free: cleanFree(o.free),
      cues: cleanCues(o.cues, stretch.s, stretch.e, errors),
      summary: text(o.summary, 300),
      thumbnail: idx !== null && idx >= 0 && idx < frames ? { index: Math.round(idx), why: text(th?.why, 200) } : null,
    },
    errors,
    fatal,
  };
}

/** The file's answer: its tags, summary, takes and thumbnail. */
export function validateReduce(raw: unknown, seconds: number): Checked<ReduceAnswer> {
  const errors: string[] = [];
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const empty: ReduceAnswer = { tags: {}, free: [], summary: { line: "", best_use: "" }, takes: [], thumbnail: null };
  if (!o) return { value: empty, errors: ["the answer is not a JSON object"], fatal: true };
  const sum = (o.summary && typeof o.summary === "object" ? o.summary : { line: o.summary }) as Record<string, unknown>;
  if (!text(sum.line, 300)) errors.push("the summary has no line");
  const end = Math.max(seconds, 0) + 0.5;
  const takes: TakeGroup[] = [];
  for (const g of Array.isArray(o.takes) ? o.takes : []) {
    if (!g || typeof g !== "object") continue;
    const gg = g as Record<string, unknown>;
    const list: Take[] = [];
    for (const t of Array.isArray(gg.takes) ? gg.takes : []) {
      const tt = (t ?? {}) as Record<string, unknown>;
      let s = num(tt.s), e = num(tt.e);
      if (s === null || e === null) continue;
      if (e < s) [s, e] = [e, s];
      if (s > end) continue;
      const take: Take = { s: round3(Math.max(0, s)), e: round3(Math.min(e, end)), take: Math.round(num(tt.take) ?? list.length + 1) };
      const rank = num(tt.rank), note = text(tt.note, 200);
      if (rank !== null && rank >= 1) take.rank = Math.round(rank);
      if (note) take.note = note;
      list.push(take);
    }
    // a take is one of at least two attempts
    if (list.length < 2) continue;
    const best = num(gg.best);
    const group: TakeGroup = { take_of: text(gg.take_of, 60) || "take", takes: list.sort((a, b) => a.s - b.s) };
    if (best !== null && list.some((t) => t.take === Math.round(best))) group.best = Math.round(best);
    const why = text(gg.why, 240);
    if (why) group.why = why;
    takes.push(group);
  }
  const th = o.thumbnail as Record<string, unknown> | undefined;
  const t = num(th?.t);
  return {
    value: {
      tags: cleanTags(o.tags, errors),
      free: cleanFree(o.free),
      summary: { line: text(sum.line, 300), best_use: text(sum.best_use, 300) },
      takes,
      thumbnail: t !== null && t >= 0 && t <= end ? { t: round3(t), why: text(th?.why, 200) } : null,
    },
    errors,
    fatal: !text(sum.line, 300) && !o.tags,
  };
}

// ── what the model is told ──

/** The vocabulary, as the model reads it. */
export function vocabularyText(): string {
  const base = Object.entries(BASE)
    .map(([k, f]) => `- ${k} (${f.type === "one" ? "one of" : f.type === "many" ? "a list of" : f.type === "number" ? "a number" : f.type === "names" ? "a list of names" : "a few words"}${f.values ? `: ${f.values.map((v) => JSON.stringify(v)).join(", ")}` : ""}) — ${f.about}`)
    .join("\n");
  const kinds = Object.entries(VOCAB.cues.kinds).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const labels = Object.entries(VOCAB.cues.labels).map(([k, v]) => `- ${k}: ${(v as string[]).join(", ")}`).join("\n");
  return `BASE TAGS (use exactly these keys and values; leave a tag out when it cannot be judged):\n${base}\n\nFREE TAGS: ${VOCAB.free.about} (at most ${VOCAB.free.max}).\n\nCUE KINDS (${VOCAB.cues.about}):\n${kinds}\n\nSuggested cue labels:\n${labels}`;
}

const SYSTEM = `You are an experienced film editor's assistant logging footage for the edit. You see frames sampled from one camera file (each with its time in seconds of the file) and the words said in that stretch, with their times. Describe only what you can see and hear — never invent people, names or events. Times are seconds of the file; a cue lies inside the stretch you are shown. Answer with one JSON object only, no prose around it.

${vocabularyText()}`;

type Json = Record<string, unknown>;
const schemaTags = () => ({
  type: "object",
  properties: Object.fromEntries(
    Object.entries(BASE).map(([k, f]) => [
      k,
      f.type === "one" ? { type: "string", enum: f.values } : f.type === "many" ? { type: "array", items: { type: "string", enum: f.values } } : f.type === "number" ? { type: "number" } : f.type === "names" ? { type: "array", items: { type: "string" } } : { type: "string" },
    ]),
  ),
  additionalProperties: false,
});
const cueSchema = {
  type: "object",
  properties: { s: { type: "number" }, e: { type: "number" }, kind: { type: "string", enum: KINDS }, label: { type: "string" }, confidence: { type: "number" }, note: { type: "string" }, why: { type: "string" }, take_of: { type: "string" }, take: { type: "integer" } },
  required: ["s", "e", "kind", "label", "confidence"],
};
/** The JSON schemas the model answers in (Prem's response_format json_schema). */
export const SCHEMAS: Record<"frames" | "reduce", Json> = {
  frames: {
    type: "object",
    properties: {
      tags: schemaTags(),
      free: { type: "array", items: { type: "string" } },
      cues: { type: "array", items: cueSchema },
      summary: { type: "string" },
      thumbnail: { type: "object", properties: { index: { type: "integer" }, why: { type: "string" } }, required: ["index", "why"] },
    },
    required: ["tags", "free", "cues", "summary", "thumbnail"],
  },
  reduce: {
    type: "object",
    properties: {
      tags: schemaTags(),
      free: { type: "array", items: { type: "string" } },
      summary: { type: "object", properties: { line: { type: "string" }, best_use: { type: "string" } }, required: ["line", "best_use"] },
      takes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            take_of: { type: "string" },
            best: { type: "integer" },
            why: { type: "string" },
            takes: { type: "array", items: { type: "object", properties: { s: { type: "number" }, e: { type: "number" }, take: { type: "integer" }, rank: { type: "integer" }, note: { type: "string" } }, required: ["s", "e", "take", "rank"] } },
          },
          required: ["take_of", "best", "takes"],
        },
      },
      thumbnail: { type: "object", properties: { t: { type: "number" }, why: { type: "string" } }, required: ["t", "why"] },
    },
    required: ["tags", "free", "summary", "takes", "thumbnail"],
  },
};

const clock = (s: number) => `${s.toFixed(1)} s`;
type Words = { s: number; e: number; text: string; sp?: number }[];
const said = (w: unknown) =>
  Array.isArray(w) && w.length
    ? (w as Words).filter((u) => u && typeof u.text === "string").map((u) => `[${clock(Number(u.s))}–${clock(Number(u.e))}]${u.sp !== undefined ? ` speaker ${u.sp}:` : ""} ${u.text}`).join("\n")
    : "(nothing is said)";

type FileInfo = { name?: string; title?: string; kind?: string; seconds?: number; description?: string; tags?: unknown };
const fileLine = (f: FileInfo) =>
  `File: ${f.name || "unnamed"}${f.title && f.title !== f.name ? ` ("${f.title}")` : ""} · ${f.kind === "image" ? "a still" : `a ${clock(Number(f.seconds) || 0)} camera file`}${f.description ? ` · described as: ${f.description}` : ""}`;

/** The request for one stretch: the task, the words, and every frame with its time. */
export function framesMessages(body: { file: FileInfo; stretch: { s: number; e: number; index: number; of: number }; frames: { t: number; jpeg: string }[]; words?: unknown; before?: unknown }) {
  const { file, stretch, frames } = body;
  const still = file.kind === "image";
  const task = still
    ? `This is a still picture. Tag it (base tags, free tags), say in one sentence what it shows (summary), and add cues only if they help an editor (e.g. a highlight, a problem) with s = e = 0. thumbnail.index is 0.`
    : `This is stretch ${stretch.index + 1} of ${stretch.of}: ${clock(stretch.s)} to ${clock(stretch.e)} of the file.${typeof body.before === "string" && body.before ? ` The stretch before showed: ${body.before}` : ""}
Tag the stretch as most of it looks (base tags, free tags). Mark cues in it: every repeated attempt of the same action as a take (with take_of naming the action and take numbering them as you see them), actions, the actor's emotions (from face and words), good cut points (an action starting or ending, a look, a breath or pause between sentences — from the word times), transition opportunities, highlights (with why), and problems (flubs, false starts, someone walking in). Summary: one sentence of what this stretch shows. thumbnail: the index (0-based, in the order shown) of the frame that best represents this stretch — sharp, well exposed, a face or the subject clearly seen — and why.`;
  const content: Json[] = [
    { type: "text", text: `${fileLine(file)}\n\n${task}\n\nWords said in this stretch (times in seconds of the file):\n${said(body.words)}\n\nThe frames:` },
  ];
  frames.forEach((f, i) => {
    content.push({ type: "text", text: `Frame ${i} at ${clock(f.t)}` });
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.jpeg}` } });
  });
  return [{ role: "system", content: SYSTEM }, { role: "user", content }];
}

/** The request for the whole file: every stretch's answer (text only) and the words. */
export function reduceMessages(body: { file: FileInfo; stretches: unknown[]; text?: unknown }) {
  const task = `Here is what each stretch of the file shows, as logged from its frames. Now for the whole file:
- tags: the base tags as most of the file looks; free: the free tags that matter most.
- summary.line: one sentence of what the file shows; summary.best_use: one sentence of where it serves an edit best.
- takes: when the camera kept rolling while the same action was done again and again, group those attempts (look across stretches: similar actions, similar words), give each attempt its in (s) and out (e), number them in order (take), rank them (1 = best) and name the best one with why (a clean performance, no flub, the best look, the best light). Only actions attempted at least twice. An empty list when there are none.
- thumbnail: the time t of the frame that best represents the whole file (one of the stretches' thumbnail picks), and why.`;
  const content = `${fileLine(body.file)}\n\n${task}\n\nThe stretches:\n${JSON.stringify(body.stretches)}\n\nEverything said in the file:\n${typeof body.text === "string" && body.text ? body.text : "(nothing is said)"}`;
  return [{ role: "system", content: SYSTEM }, { role: "user", content }];
}

// ── Prem ──
type Chat = { chat: { completions: { create(body: Json): Promise<unknown> } } };
let testClient: Chat | null = null;
/** Does Prem take our JSON schema? (Learnt from its first refusal; then json_object.) */
let schemaTaken = true;

export const analysisReady = () => !!testClient || !!process.env.PREMAI_API_KEY;

/** For the tests: a stand-in for Prem (null: Prem again). */
export function useAnalysisClient(c: Chat | null) {
  testClient = c;
  schemaTaken = true;
}

const chat = async (): Promise<Chat> => testClient ?? ((await prem()) as Chat);

/** The confidential Qwen this key lists (the one we name, unless Prem renamed it). */
const model = async () => (testClient ? MODEL : pick(MODEL, "CHAT", /^qwen/i));

/** One completion: the model's text. The schema where Prem takes it, else json_object; a fresh client once. */
async function complete(messages: Json[], schema: "frames" | "reduce", model: string): Promise<string> {
  const ask = async () => {
    const body: Json = {
      model,
      messages,
      temperature: 0.2,
      reasoning_effort: "low",
      max_completion_tokens: 6000,
      response_format: schemaTaken ? { type: "json_schema", json_schema: { name: `shot_${schema}`, schema: SCHEMAS[schema], strict: false } } : { type: "json_object" },
    };
    const res = (await (await chat()).chat.completions.create(body)) as { choices?: { message?: { content?: unknown } }[] };
    const content = res?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new AnalysisError("The model answered nothing.", 502);
    return content;
  };
  // behind the model's breaker and the rate limit (prem.ts): one call — a second only when Prem refused our schema
  const refused = (e: unknown) => {
    const o = (e ?? {}) as { status?: unknown; error?: unknown; message?: unknown };
    return o.status === 400 && schemaTaken && /response_format|json_schema|schema/i.test(String(o.error ?? o.message ?? ""));
  };
  const own = (e: unknown) => e instanceof AnalysisError || refused(e);
  try {
    return await call(model, "analyse this", ask, own);
  } catch (e) {
    if (!refused(e)) throw e;
    schemaTaken = false; // json_object from now on
    return call(model, "analyse this", ask, (x) => x instanceof AnalysisError);
  }
}

/** Ask, validate; an answer that cannot be used is sent back once to be repaired (text only). */
async function answer<T>(messages: Json[], schema: "frames" | "reduce", check: (raw: unknown) => Checked<T>): Promise<T & { model: string }> {
  const m = await model();
  const first = await complete(messages, schema, m);
  const a = check(parseAnswer(first));
  if (!a.fatal) return { ...a.value, model: m };
  const repair = [
    messages[0]!,
    { role: "user", content: `Your answer could not be used (${a.errors.slice(0, 5).join("; ")}). Your answer was:\n${first.slice(0, 12000)}\n\nAnswer again: one JSON object with the keys ${Object.keys((SCHEMAS[schema] as { properties: Json }).properties).join(", ")}, in the vocabulary, nothing else.` },
  ];
  const b = check(parseAnswer(await complete(repair, schema, m)));
  if (b.fatal) throw new AnalysisError(`The model's answer could not be used, twice: ${b.errors.slice(0, 3).join("; ")}`, 502);
  return { ...b.value, model: m };
}

/** One stretch of frames → its tags, cues, summary and thumbnail pick. */
export async function analyseFrames(body: Parameters<typeof framesMessages>[0]): Promise<FramesAnswer & { model: string }> {
  if (!Array.isArray(body.frames) || !body.frames.length) throw new AnalysisError("No frames in the request.");
  if (body.frames.length > MAX_FRAMES) throw new AnalysisError(`${body.frames.length} frames; one request takes at most ${MAX_FRAMES}.`, 413);
  for (const f of body.frames) {
    if (typeof f?.jpeg !== "string" || !f.jpeg || !Number.isFinite(f.t)) throw new AnalysisError("Every frame is { t, jpeg } — its time in seconds and its JPEG in base64.");
    if (f.jpeg.length > MAX_JPEG) throw new AnalysisError(`A frame of ${f.jpeg.length} bytes; at most ${MAX_JPEG}.`, 413);
  }
  const st = body.stretch ?? { s: 0, e: 0, index: 0, of: 1 };
  const stretch = { s: Number(st.s) || 0, e: Number(st.e) || 0, index: Number(st.index) || 0, of: Number(st.of) || 1 };
  return answer(framesMessages({ ...body, stretch }), "frames", (raw) => validateFrames(raw, stretch, body.frames.length));
}

/** Every stretch's answer → the file's tags, summary, takes and thumbnail. */
export async function analyseFile(body: Parameters<typeof reduceMessages>[0]): Promise<ReduceAnswer & { model: string }> {
  if (!Array.isArray(body.stretches) || !body.stretches.length) throw new AnalysisError("No stretches in the request.");
  return answer(reduceMessages(body), "reduce", (raw) => validateReduce(raw, Number(body.file?.seconds) || 0));
}

/** GET /api/analysis — is the analysis set up here? */
export async function statusRoute(req: Request): Promise<Response> {
  const ok = await authorize(req);
  if (ok !== true) return ok;
  // the model this key really runs (ours, or its own of the family), and every model the key lists — ids and inputs only
  const ready = analysisReady();
  const using = ready ? await model().catch(() => MODEL) : MODEL;
  // every model the key lists, as Prem describes it (its id, names, kind and inputs — no key, no secret)
  const listed = ready ? await models().catch(() => null) : undefined;
  const p = paused(using) ?? paused(MODEL);
  return Response.json({ ready, model: MODEL, ...(ready ? { using, listed } : {}), vocabulary: VOCABULARY, ...(p ? { paused_until: new Date(p.until).toISOString(), reason: p.reason } : {}) });
}

/** POST /api/analysis — a stretch's frames, or the whole file's stretches. */
export async function analyseRoute(req: Request): Promise<Response> {
  const ok = await authorize(req);
  if (ok !== true) return ok;
  if (!analysisReady()) return Response.json({ error: "The analysis is not set up on this server: PREMAI_API_KEY is missing." }, { status: 503 });
  try {
    const body = (await req.json().catch(() => null)) as Json | null;
    if (!body || typeof body !== "object") throw new AnalysisError("Send JSON: { mode: \"frames\" | \"reduce\", … }.");
    const out =
      body.mode === "frames"
        ? await analyseFrames(body as never)
        : body.mode === "reduce"
          ? await analyseFile(body as never)
          : (() => {
              throw new AnalysisError("mode is frames or reduce.");
            })();
    return Response.json({ ...out, vocabulary: VOCABULARY });
  } catch (e) {
    if (e instanceof AnalysisError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof PremError) return failure(e);
    console.error("analysis:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Something went wrong on our side." }, { status: 500 });
  }
}
