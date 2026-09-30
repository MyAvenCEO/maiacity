/**
 * Speech to text: every recording's words, with their times — Deepgram Nova 3, through Prem's encrypted API.
 *
 * The vault server (vault/crates/vault-server/src/transcribe.rs) extracts a recording's speech track when the file
 * reaches Object Storage and sends it here; this route hands it to Prem and answers the words, normalised to what the
 * catalog keeps in the original's `meta.transcript` (times in seconds of the audio sent — the server shifts a chunk's
 * words by the chunk's start). Prem's SDK encrypts in this process (ML-KEM with Prem's attested enclave, XChaCha20):
 * neither Prem's gateway nor anyone on the way reads the audio or the words, and Prem keeps neither.
 *
 * Prem's client, its key and endpoints, and how its failures read: prem.ts (shared with the shot analysis). A failure
 * that is Prem's for now (its attestation report for the model unavailable, a 5xx, rate limiting) answers 503 with
 * `transient: true`: the vault server keeps the recording queued and tries again later, without using up a try.
 *
 * Who may ask: the vault server (its own token, whose hash it publishes in vault_config as `api_token`), or a key the
 * admin approved with `media:admin` (the Mac app's).
 */
import { createHash } from "node:crypto";
import { db } from "./pg";
import { can } from "./acl";
import { keyHolder } from "./keys";
import { call, clientKek, failure, paused, pick, prem, PremError, resetPrem } from "./prem";

export const MODEL = "deepgram/general-nova-3";
/** Prem's limit for one request. */
export const MAX_BYTES = 25 * 1024 * 1024;

// ── what Deepgram answers, as far as we read it ──
type DgWord = { word?: string; punctuated_word?: string; start?: number; end?: number; confidence?: number; speaker?: number };
type DgSentence = { text?: string; start?: number; end?: number };
type DgParagraph = { sentences?: DgSentence[]; speaker?: number; start?: number; end?: number };
type DgAlternative = { transcript?: string; words?: DgWord[]; paragraphs?: { transcript?: string; paragraphs?: DgParagraph[] }; languages?: string[] };
type DgUtterance = { start?: number; end?: number; transcript?: string; speaker?: number };
export type DeepgramResponse = {
  metadata?: { request_id?: string; duration?: number; model_info?: Record<string, { name?: string; version?: string; arch?: string }> };
  results?: { channels?: { alternatives?: DgAlternative[]; detected_language?: string }[]; utterances?: DgUtterance[] };
};

// ── what the catalog keeps ──
export type Word = { w: string; s: number; e: number; c: number; sp?: number };
export type Utterance = { s: number; e: number; text: string; sp?: number };
export type Transcript = { model: string; language: string; text: string; words: Word[]; utterances?: Utterance[] };

const ms = (x: unknown) => Math.round(Number(x ?? 0) * 1000) / 1000;
const speaker = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? { sp: x } : {});

/** Deepgram's answer → the catalog's transcript: every word with its start, end, confidence and speaker; sentences. */
export function normalize(raw: DeepgramResponse, model: string = MODEL): Transcript {
  const channel = raw?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  if (!alt) throw new SttError("The transcription came back without a channel.", 502);
  const words: Word[] = (alt.words ?? [])
    .filter((w) => (w.punctuated_word ?? w.word ?? "").trim())
    .map((w) => ({ w: (w.punctuated_word ?? w.word ?? "").trim(), s: ms(w.start), e: ms(w.end), c: Math.round(Number(w.confidence ?? 0) * 100) / 100, ...speaker(w.speaker) }));
  // the plain transcript: with diarize, Deepgram's paragraphs carry "Speaker 0:" labels
  const text = (alt.transcript ?? words.map((w) => w.w).join(" ")).trim();
  const language = channel?.detected_language ?? alt.languages?.[0] ?? "en";
  return { model, language, text, words, utterances: utterances(raw, alt, words) };
}

/** Sentences with their times: Deepgram's utterances or paragraphs when it sent them, else cut from the words. */
function utterances(raw: DeepgramResponse, alt: DgAlternative, words: Word[]): Utterance[] {
  const given = raw.results?.utterances;
  if (given?.length) return given.map((u) => ({ s: ms(u.start), e: ms(u.end), text: (u.transcript ?? "").trim(), ...speaker(u.speaker) }));
  const paragraphs = alt.paragraphs?.paragraphs;
  if (paragraphs?.length) {
    return paragraphs.flatMap((p) => (p.sentences ?? []).map((s) => ({ s: ms(s.start), e: ms(s.end), text: (s.text ?? "").trim(), ...speaker(p.speaker) })));
  }
  const out: Utterance[] = [];
  let cur: Word[] = [];
  const close = () => {
    if (!cur.length) return;
    out.push({ s: cur[0]!.s, e: cur[cur.length - 1]!.e, text: cur.map((w) => w.w).join(" "), ...speaker(cur[0]!.sp) });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    // a new speaker, or a pause of more than a second
    if (last && (last.sp !== w.sp || w.s - last.e > 1)) close();
    cur.push(w);
    if (/[.?!]$/.test(w.w)) close();
  }
  close();
  return out;
}

export class SttError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ── Prem (prem.ts: the shared confidential client, attested per model) ──
type Client = { audio: { transcriptions: { create(body: { file: File; model: `deepgram/${string}`; diarize?: boolean; smart_format?: boolean }): Promise<unknown> } } };
let testClient: Client | null = null;

/** Is speech to text set up here (Prem's key in the environment)? */
/**
 * Paused (2026-09-30): Prem answers "model not found" for deepgram/general-nova-3, and our server's retries hit its
 * gateway far too often. Until the circuit breaker ships, no Prem call is made: the vault server sees "not ready" and
 * waits. The tests' stand-in still works.
 */
const PAUSED = true;
export const sttReady = () => !!testClient || (!PAUSED && !!process.env.PREMAI_API_KEY);

/** For the tests: a stand-in for Prem (null: Prem again). */
export function useSttClient(c: Client | null) {
  testClient = c;
}

export { clientKek, prem, resetPrem };

/** Transcribe one audio file (at most 25 MB) — Deepgram's answer, normalised. */
export async function transcribe(bytes: Uint8Array, mime = "audio/mp4", name = "speech.m4a"): Promise<Transcript> {
  if (!sttReady()) throw new SttError("Speech to text is not set up on this server: PREMAI_API_KEY is missing.", 503);
  if (!bytes.length) throw new SttError("No audio in the request.");
  if (bytes.length > MAX_BYTES) throw new SttError(`The audio is ${bytes.length} bytes; one request takes at most ${MAX_BYTES} (25 MB) — send it in chunks.`, 413);
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name, { type: mime });
  // the confidential Deepgram this key lists (the one we name, unless Prem renamed it)
  const model = (testClient ? MODEL : await pick(MODEL, "AUDIO_TRANSCRIPTION", /^deepgram\//)) as `deepgram/${string}`;
  const ask = async () => (testClient ?? ((await prem()) as Client)).audio.transcriptions.create({ file, model, smart_format: true, diarize: true });
  // behind the model's breaker and the rate limit (prem.ts): one call, never a retry loop
  const raw = await call(model, "transcribe this", ask);
  return normalize(raw as DeepgramResponse, model);
}

// ── who may ask ──
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The vault server's token (`vst_…`), checked against the hash it published — or null when the request has none. */
async function isVaultServer(req: Request): Promise<boolean | null> {
  const token = /^Bearer (vst_[\w-]+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const { rows } = await db.query<{ value: string }>("SELECT value FROM vault_config WHERE key = 'api_token'");
  return !!rows[0] && rows[0].value === sha256(token);
}

/** The vault server, or a key the admin approved for the media vault — else the response that says why not. */
export async function authorize(req: Request): Promise<true | Response> {
  const server = await isVaultServer(req);
  if (server === true) return true;
  if (server === false) return Response.json({ error: "This vault server token is not the one the server published." }, { status: 403 });
  const key = await keyHolder(req);
  if (!key) return Response.json({ error: "Speech to text and the shot analysis need the vault server's token or the app's key." }, { status: 401 });
  if (!(key.scope.includes("media:admin") && can(key, "media:admin"))) return Response.json({ error: "This key cannot work with the media vault." }, { status: 403 });
  return true;
}

/** GET /api/transcripts — is speech to text set up here? (The vault server asks before it starts a round.) */
export async function statusRoute(req: Request): Promise<Response> {
  const ok = await authorize(req);
  if (ok !== true) return ok;
  const p = paused(MODEL);
  return Response.json({ ready: sttReady(), model: MODEL, max_bytes: MAX_BYTES, ...(p ? { paused_until: new Date(p.until).toISOString(), reason: p.reason } : {}) });
}

/**
 * POST /api/transcripts — the body is the audio (raw bytes with its Content-Type, or multipart with a `file` field);
 * the answer is the transcript: `{ model, language, text, words: [{ w, s, e, c, sp }], utterances: [{ s, e, text, sp }] }`.
 */
export async function transcribeRoute(req: Request): Promise<Response> {
  const ok = await authorize(req);
  if (ok !== true) return ok;
  if (!sttReady()) return Response.json({ error: "Speech to text is not set up on this server: PREMAI_API_KEY is missing." }, { status: 503 });
  try {
    const type = req.headers.get("content-type") ?? "";
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new SttError(`The audio is ${declared} bytes; one request takes at most ${MAX_BYTES} (25 MB) — send it in chunks.`, 413);
    let bytes: Uint8Array;
    let mime = type.split(";")[0]!.trim() || "audio/mp4";
    let name = "speech.m4a";
    if (type.startsWith("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) throw new SttError("Send the audio as the form's `file`.");
      bytes = new Uint8Array(await file.arrayBuffer());
      mime = file.type || "audio/mp4";
      name = file.name || name;
    } else {
      bytes = new Uint8Array(await req.arrayBuffer());
    }
    return Response.json(await transcribe(bytes, mime, name));
  } catch (e) {
    if (e instanceof SttError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof PremError) return failure(e);
    console.error("stt:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Something went wrong on our side." }, { status: 500 });
  }
}
