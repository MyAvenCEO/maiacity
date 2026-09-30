/**
 * Speech to text: every recording's words, with their times — Deepgram Nova 3, through Prem's encrypted API.
 *
 * The vault server (vault/crates/vault-server/src/transcribe.rs) extracts a recording's speech track when the file
 * reaches Object Storage and sends it here; this route hands it to Prem and answers the words, normalised to what the
 * catalog keeps in the original's `meta.transcript` (times in seconds of the audio sent — the server shifts a chunk's
 * words by the chunk's start). Prem's SDK encrypts in this process (ML-KEM with Prem's attested enclave, XChaCha20):
 * neither Prem's gateway nor anyone on the way reads the audio or the words, and Prem keeps neither.
 *
 *   PREMAI_API_KEY     Prem's API key (a GitHub secret, into this container's env by the deploy) — never on a Mac
 *   PREMAI_CLIENT_KEK  optional: our own 32-byte key encryption key (64 hex). Without it, one is made once and kept
 *                      in the database's `secrets`, like the session key. Prem never sees it; transcription does not
 *                      depend on it (the SDK wraps its file keys with it), the SDK only insists on one.
 *
 * Who may ask: the vault server (its own token, whose hash it publishes in vault_config as `api_token`), or a key the
 * admin approved with `media:admin` (the Mac app's).
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "./pg";
import { can } from "./acl";
import { keyHolder } from "./keys";

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
export function normalize(raw: DeepgramResponse): Transcript {
  const channel = raw?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  if (!alt) throw new SttError("The transcription came back without a channel.", 502);
  const words: Word[] = (alt.words ?? [])
    .filter((w) => (w.punctuated_word ?? w.word ?? "").trim())
    .map((w) => ({ w: (w.punctuated_word ?? w.word ?? "").trim(), s: ms(w.start), e: ms(w.end), c: Math.round(Number(w.confidence ?? 0) * 100) / 100, ...speaker(w.speaker) }));
  // the plain transcript: with diarize, Deepgram's paragraphs carry "Speaker 0:" labels
  const text = (alt.transcript ?? words.map((w) => w.w).join(" ")).trim();
  const language = channel?.detected_language ?? alt.languages?.[0] ?? "en";
  return { model: MODEL, language, text, words, utterances: utterances(raw, alt, words) };
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

// ── Prem ──
type Client = { audio: { transcriptions: { create(body: { file: File; model: `deepgram/${string}`; diarize?: boolean; smart_format?: boolean }): Promise<unknown> } } };
let client: Promise<Client> | null = null;
let testClient: Client | null = null;

/** Is speech to text set up here (Prem's key in the environment)? */
export const sttReady = () => !!testClient || !!process.env.PREMAI_API_KEY;

/** For the tests: a stand-in for Prem (null: Prem again). */
export function useSttClient(c: Client | null) {
  testClient = c;
}

/**
 * Our key encryption key: PREMAI_CLIENT_KEK when set, else made once and kept in the database's `secrets` (like the
 * session key) — never in the repository, the .env or a log.
 */
export async function clientKek(): Promise<string> {
  const env = process.env.PREMAI_CLIENT_KEK?.trim();
  if (env && /^[0-9a-fA-F]{64}$/.test(env)) return env;
  const read = async () => (await db.query<{ value: string }>("SELECT value FROM secrets WHERE key = 'premai_client_kek'")).rows[0]?.value;
  const have = await read();
  if (have) return have;
  await db.query("INSERT INTO secrets (key, value) VALUES ('premai_client_kek', $1) ON CONFLICT (key) DO NOTHING", [randomBytes(32).toString("hex")]);
  return (await read())!; // whoever won the race owns the key
}

async function premClient(): Promise<Client> {
  if (testClient) return testClient;
  if (!client) {
    client = (async () => {
      // loaded only when first needed: the SDK is large, and nothing else in the API uses it
      const { createRvencClient } = await import("@premai/api-sdk");
      const c = await createRvencClient({
        apiKey: process.env.PREMAI_API_KEY!,
        clientKEK: await clientKek(),
        config: {
          endpoints: {
            proxy: process.env.PREMAI_PROXY_URL ?? "https://gateway.prem.io",
            enclave: process.env.PREMAI_ENCLAVE_URL ?? "https://conf-engine.prem.io",
          },
        },
      });
      return c as unknown as Client;
    })();
    client.catch(() => (client = null));
  }
  return client;
}

/** A thrown SDK error → a sentence and a status (Prem answers `{ status, error }`; the key never appears). */
function premError(e: unknown): SttError {
  const o = (e ?? {}) as { status?: number; error?: unknown; message?: unknown; cause?: unknown };
  const status = typeof o.status === "number" ? o.status : 0;
  // the attestation's errors say what went wrong in `cause` ("Authentication token is invalid")
  const cause = Array.isArray(o.cause) ? ` (${o.cause.map(String).join(": ")})` : "";
  const why = (String(o.error ?? o.message ?? e) + cause).slice(0, 300);
  if (status === 413) return new SttError(`Prem refused the audio as too large: ${why}`, 413);
  if (status === 429) return new SttError(`Prem is rate limiting: ${why}`, 429);
  if (status === 401 || status === 403) return new SttError(`Prem refused our key (${status}): ${why}`, 502);
  return new SttError(`Prem could not transcribe this: ${why}`, 502);
}

/** Transcribe one audio file (at most 25 MB) — Deepgram's answer, normalised. */
export async function transcribe(bytes: Uint8Array, mime = "audio/mp4", name = "speech.m4a"): Promise<Transcript> {
  if (!sttReady()) throw new SttError("Speech to text is not set up on this server: PREMAI_API_KEY is missing.", 503);
  if (!bytes.length) throw new SttError("No audio in the request.");
  if (bytes.length > MAX_BYTES) throw new SttError(`The audio is ${bytes.length} bytes; one request takes at most ${MAX_BYTES} (25 MB) — send it in chunks.`, 413);
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name, { type: mime });
  const ask = async () => (await premClient()).audio.transcriptions.create({ file, model: MODEL, smart_format: true, diarize: true });
  let raw: unknown;
  try {
    raw = await ask();
  } catch (first) {
    const status = (first as { status?: unknown })?.status;
    if (typeof status === "number" && status >= 400 && status < 500) throw premError(first);
    // the enclave's key may have turned since the client was made: once more with a fresh client
    client = null;
    try {
      raw = await ask();
    } catch (e) {
      throw premError(e);
    }
  }
  return normalize(raw as DeepgramResponse);
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
  if (!key) return Response.json({ error: "Speech to text needs the vault server's token or the app's key." }, { status: 401 });
  if (!(key.scope.includes("media:admin") && can(key, "media:admin"))) return Response.json({ error: "This key cannot work with the media vault." }, { status: 403 });
  return true;
}

/** GET /api/transcripts — is speech to text set up here? (The vault server asks before it starts a round.) */
export async function statusRoute(req: Request): Promise<Response> {
  const ok = await authorize(req);
  if (ok !== true) return ok;
  return Response.json({ ready: sttReady(), model: MODEL, max_bytes: MAX_BYTES });
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
    console.error("stt:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Something went wrong on our side." }, { status: 500 });
  }
}
