/**
 * Prem, confidential: one RVENC client per process (the SDK encrypts here, to Prem's attested enclave), shared by
 * speech to text (stt.ts) and the shot analysis (analysis.ts). Attestation stays on for every model — Deepgram too:
 * nothing goes to a model whose enclave has not proven itself.
 *
 *   PREMAI_API_KEY      Prem's API key (a GitHub secret, into this container's env by the deploy) — never on a Mac
 *   PREMAI_CLIENT_KEK   optional: our own 32-byte key encryption key (64 hex). Without it, one is made once and kept
 *                       in the database's `secrets`, like the session key. Prem never sees it.
 *   PREMAI_PAUSED=1     the kill switch: no call reaches Prem (every model answers paused), whatever else is set
 *   PREMAI_MAX_PER_MINUTE  optional: the hard limit of calls per model per minute (default 6 for Deepgram, 20 else)
 *   PREMAI_PROXY_URL, PREMAI_ENCLAVE_URL   optional pins; otherwise the values Prem publishes at
 *                       dashboard.prem.io/endpoints.json (read once, when the client is first made), else the defaults
 *
 * When a call fails, the error says what Prem really answered, classified the way Prem's docs ask (and as
 * avenVICTORIO's attestation guard does): the attestation is per model, so the gateway's attestation route is asked
 * once more for that model — 404 or an empty `data`: the model has no attested deployment for our key ("not enabled
 * for confidential use on our Prem key"); 5xx: Prem's report for the model is unavailable right now — both transient:
 * the file waits, queued with the reason, and is tried again each round without using up a try; 401/403: our key or
 * its scope; 200 while the SDK's verification failed: a genuine attestation failure. A 429 is transient too.
 */
import { randomBytes } from "node:crypto";
import { db } from "./pg";

export type Endpoints = { proxy: string; enclave: string };
const DEFAULTS: Endpoints = { proxy: "https://gateway.prem.io", enclave: "https://conf-engine.prem.io" };
const DISCOVERY_URL = "https://dashboard.prem.io/endpoints.json";
const pinned = (): Partial<Endpoints> => ({
  ...(process.env.PREMAI_PROXY_URL ? { proxy: process.env.PREMAI_PROXY_URL } : {}),
  ...(process.env.PREMAI_ENCLAVE_URL ? { enclave: process.env.PREMAI_ENCLAVE_URL } : {}),
});
/** Where Prem is: the pins, else what Prem publishes, else the defaults. */
export const endpoints: Endpoints = { ...DEFAULTS, ...pinned() };

const clean = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s/]+\/?$/.test(v) ? v.replace(/\/$/, "") : null);
let discovered: Promise<void> | null = null;

/** Read Prem's published endpoints once (5 s): unpinned values follow them; a pin that differs is said, and kept. */
export function discover(fetcher: typeof fetch = fetch): Promise<void> {
  discovered ??= (async () => {
    try {
      const r = await fetcher(DISCOVERY_URL, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Record<string, unknown>;
      const published = { proxy: clean(j.proxy), enclave: clean(j.enclave) };
      if (!published.proxy || !published.enclave) throw new Error("incomplete");
      const pins = pinned();
      for (const k of ["proxy", "enclave"] as const) {
        if (pins[k]) {
          if (pins[k] !== published[k]) console.warn(`prem: ${k} pinned to ${pins[k]}, Prem publishes ${published[k]} — the pin stays`);
        } else endpoints[k] = published[k]!;
      }
    } catch (e) {
      console.warn(`prem: endpoints.json not readable (${(e as Error)?.message ?? e}) — ${Object.keys(pinned()).length ? "the pins" : "the defaults"} in use`);
    }
  })();
  return discovered;
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

let client: Promise<unknown> | null = null;

/** Prem's confidential client — made once, attested per model by the SDK on every call. */
export async function prem(): Promise<unknown> {
  if (!client) {
    client = (async () => {
      await discover();
      // loaded only when first needed: the SDK is large, and nothing else in the API uses it
      const { createRvencClient } = await import("@premai/api-sdk");
      return (await createRvencClient({ apiKey: process.env.PREMAI_API_KEY!, clientKEK: await clientKek(), config: { endpoints: { ...endpoints } } })) as unknown;
    })();
    client.catch(() => (client = null));
  }
  return client;
}

/** A client made since has a fresh enclave key (Prem turns it now and then). */
export function resetPrem() {
  client = null;
}

// ── what Prem's models are for this key ──
export type PremModel = { id: string; type?: string; input_modalities?: string[] };
let listed: Promise<PremModel[] | null> | null = null;
let testModels: PremModel[] | null | undefined;

/** For the tests: the models Prem lists (undefined: ask Prem again). */
export function useModels(m: PremModel[] | null | undefined) {
  testModels = m;
  listed = null;
}

/** The confidential models this key may use — asked once, logged once (ids only, never the key); null: unknown. */
export function models(): Promise<PremModel[] | null> {
  if (testModels !== undefined) return Promise.resolve(testModels);
  listed ??= (async () => {
    try {
      const c = (await prem()) as { models?: { list(p?: unknown): Promise<unknown> } };
      const raw = (await c.models?.list()) as unknown;
      const data = (Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? [])) as PremModel[];
      const list = data.filter((m) => m && typeof m.id === "string");
      console.log(`prem: models for this key — ${list.map((m) => `${m.id}${m.type ? ` (${m.type.toLowerCase()})` : ""}`).join(", ") || "none"}`);
      return list;
    } catch (e) {
      console.warn(`prem: the models could not be listed (${String((e as Error)?.message ?? e).slice(0, 200)})`);
      listed = null; // asked again next time
      return null;
    }
  })();
  return listed;
}

/**
 * The model to use: the one we want when this key lists it (or the list is unknown); else the key's first model of
 * the same kind (and family) — said once in the log, so a renamed model keeps working.
 */
export async function pick(want: string, type: "AUDIO_TRANSCRIPTION" | "CHAT", family: RegExp): Promise<string> {
  const list = await models();
  if (!list || list.some((m) => m.id === want)) return want;
  const other = list.find((m) => (!m.type || m.type.toUpperCase() === type) && family.test(m.id));
  if (!other) return want;
  if (!warned.has(want)) console.warn(`prem: this key lists no ${want} — using ${other.id}`), warned.add(want);
  return other.id;
}
const warned = new Set<string>();

// ── what went wrong ──

export class PremError extends Error {
  /** while the model is paused (the breaker is open, or the rate limit bites): until when (ms since the epoch) */
  pausedUntil?: number;
  /** why it is paused: "provider" (Prem failed) or "rate" (our own limit) */
  pause?: "provider" | "rate";
  constructor(message: string, public status = 502, public transient = false) {
    super(message);
  }
}

/** The gateway's answer for a model: its status, its message, and whether it has any attested deployment of it. */
type Probe = { status: number; message: string; deployed: boolean } | null;
let probeFetch: typeof fetch | null = null;
/** For the tests: the gateway's attestation route stood in for (null: the real one). */
export function useProbe(f: typeof fetch | null) {
  probeFetch = f;
}

/**
 * What the gateway's attestation route answers this server for a model (the SDK only says "failed to request modules
 * from attestation server"): null when it answers 200, else its status and message.
 */
export async function gatewayProbe(model: string): Promise<Probe> {
  try {
    const r = await (probeFetch ?? fetch)(`${endpoints.proxy}/attestation/modules?model=${encodeURIComponent(model)}`, {
      headers: { authorization: `Bearer ${process.env.PREMAI_API_KEY ?? ""}` },
      signal: AbortSignal.timeout(10_000),
    });
    // Prem's JSON envelope (error, support_id), its model listing ({ model, data: [] } — no deployment of that model
    // for this key), or a bare line from the edge ("Error code: 502"); an HTML page says nothing
    const raw = (await r.text().catch(() => "")).trim();
    const body = raw.startsWith("<") ? "" : raw.replace(/\s+/g, " ");
    let message = r.ok ? "" : body.slice(0, 160);
    let deployed = r.status !== 404;
    try {
      const j = JSON.parse(body) as { error?: string; message?: string; support_id?: string; data?: unknown };
      if (Array.isArray(j.data) && j.data.length === 0) deployed = false;
      if (!r.ok) message = `${j.error ?? j.message ?? ""}${j.support_id ? ` (${j.support_id})` : ""}`.trim();
    } catch {}
    if (r.ok && deployed) return null;
    return { status: r.status, message, deployed };
  } catch (e) {
    return { status: 0, message: `the gateway cannot be reached from this server (${String((e as Error)?.message ?? e).slice(0, 120)})`, deployed: true };
  }
}

/** A thrown SDK error → what it means, in a sentence (the key never appears). `doing`: "transcribe this". */
export async function classify(e: unknown, model: string, doing: string): Promise<PremError> {
  if (e instanceof PremError) return e;
  const o = (e ?? {}) as { status?: number; error?: unknown; message?: unknown; cause?: unknown };
  const status = typeof o.status === "number" ? o.status : 0;
  // the attestation's errors say what went wrong in `cause` ("Authentication token is invalid")
  const cause = Array.isArray(o.cause) ? ` (${o.cause.map(String).join(": ")})` : "";
  const why = (String(o.error ?? o.message ?? e) + cause).slice(0, 300);
  if (status === 413) return new PremError(`Prem refused it as too large: ${why}`, 413);
  if (status === 429) return new PremError(`Prem is rate limiting: ${why}`, 429, true);
  if (status === 401 || status === 403) return new PremError(`Prem refused our key (${status}): ${why}`, 502);
  if (/attestation|reticle|x-session-id/i.test(why)) {
    const p = await gatewayProbe(model);
    const said = (p: NonNullable<Probe>) => `gateway ${p.status || "unreachable"}${p.message ? `: ${p.message}` : ""}`;
    if (!p) return new PremError(`Prem's attestation of ${model} failed verification: ${why}`, 502);
    // no attested deployment of the model for our key: it waits until Prem enables it (checked again every round)
    if (!p.deployed) return new PremError(`${model} is not enabled for confidential use on our Prem key`, 503, true);
    if (p.status >= 500 || p.status === 0 || p.status === 429)
      return new PremError(`Prem's attestation report for ${model} is unavailable right now (${said(p)}) — retrying`, 503, true);
    if (p.status === 401 || p.status === 403) return new PremError(`Prem refused our key for ${model}'s attestation (${said(p)})`, 502);
    return new PremError(`Prem's attestation of ${model} was refused (${said(p)})`, 502);
  }
  if (status >= 500) return new PremError(`Prem could not ${doing} right now (${status}): ${why}`, 503, true);
  return new PremError(`Prem could not ${doing}: ${why}`, 502);
}

/**
 * A failure as the vault server reads it: a transient one carries `transient: true` (the file waits, queued); a paused
 * model answers 503 with `paused_until` (ISO) and `reason` — the server sleeps until then, asking nothing.
 */
export function failure(e: PremError): Response {
  const paused = e.pausedUntil ? { paused_until: new Date(e.pausedUntil).toISOString(), reason: e.message, pause: e.pause } : {};
  return Response.json({ error: e.message, ...(e.transient ? { transient: true } : {}), ...paused }, { status: e.pausedUntil ? 503 : e.status });
}

// ── never hammer Prem: a breaker per model, and a hard rate limit ──
//
// After a failure that is Prem's (its attestation report unavailable, the model not enabled for our key, a 5xx, rate
// limiting, a timeout) the model is paused: 1 minute, doubling to 30 (a Retry-After longer than that is honoured).
// While paused, every request for it is answered at once — 503 with `paused_until` — and Prem is not asked. After the
// pause one request goes through: its success closes the breaker, its failure pauses again for twice as long. And
// whatever happens, no model gets more than MAX_PER_MINUTE calls from this API (logged when it bites).

export const MIN_PAUSE = 60_000;
export const MAX_PAUSE = 30 * 60_000;
/** Prem calls per model per minute at most (PREMAI_MAX_PER_MINUTE overrides; the analysis sends a stretch a call). */
export const maxPerMinute = (model: string) => Number(process.env.PREMAI_MAX_PER_MINUTE) || (/^deepgram\//.test(model) ? 6 : 20);

type Breaker = { until: number; reason: string; pause: number };
const breakers = new Map<string, Breaker>();
const recent = new Map<string, number[]>();
let clock = () => Date.now();

/** For the tests: another clock (null: the real one), and every breaker and count reset. */
export function useClock(f: (() => number) | null) {
  clock = f ?? (() => Date.now());
  breakers.clear();
  recent.clear();
}

/** Is this model paused now? Until when, and why. */
export function paused(model: string): { until: number; reason: string } | null {
  // the kill switch: nothing calls Prem while it is set
  if (process.env.PREMAI_PAUSED === "1") return { until: clock() + MAX_PAUSE, reason: "Prem is paused on this server (PREMAI_PAUSED=1)" };
  const b = breakers.get(model);
  return b && b.until > clock() ? { until: b.until, reason: b.reason } : null;
}

/** Pause a model: for twice its last pause (1 min the first time, 30 at most), or as long as Prem asked. */
export function trip(model: string, reason: string, atLeast = 0): number {
  const last = breakers.get(model)?.pause ?? 0;
  const pause = Math.min(MAX_PAUSE, last ? last * 2 : MIN_PAUSE);
  const until = clock() + Math.max(pause, atLeast);
  breakers.set(model, { until, reason, pause });
  console.warn(`prem: ${model} paused until ${new Date(until).toISOString()} — ${reason}`);
  return until;
}

/** Prem's Retry-After on an error, in ms (0: none said). */
function retryAfter(e: unknown): number {
  const o = (e ?? {}) as { headers?: { get?(k: string): string | null } | Record<string, string>; retryAfter?: unknown };
  const h = o.headers && typeof (o.headers as { get?: unknown }).get === "function" ? (o.headers as { get(k: string): string | null }).get("retry-after") : (o.headers as Record<string, string> | undefined)?.["retry-after"];
  const v = Number(o.retryAfter ?? h);
  return Number.isFinite(v) && v > 0 ? v * 1000 : 0;
}

/** The enclave's key turned since the client was made: the one error a fresh client answers. */
const expiredKey = (e: unknown) => /expired/i.test(String((e as Error)?.message ?? e)) && /key|session/i.test(String((e as Error)?.message ?? e));

/**
 * One Prem call for a model, behind its breaker and the rate limit. `own` errors (the caller's, not Prem's) pass
 * through untouched; Prem's are classified, and a transient one pauses the model.
 */
export async function call<T>(model: string, doing: string, fn: () => Promise<T>, own: (e: unknown) => boolean = () => false): Promise<T> {
  const p = paused(model);
  if (p) throw Object.assign(new PremError(p.reason, 503, true), { pausedUntil: p.until, pause: "provider" as const });
  const now = clock();
  const calls = (recent.get(model) ?? []).filter((t) => t > now - 60_000);
  if (calls.length >= maxPerMinute(model)) {
    const until = calls[0]! + 60_000;
    console.warn(`prem: the rate limit bites — ${model} had ${calls.length} calls in the last minute; the next at ${new Date(until).toISOString()}`);
    recent.set(model, calls);
    throw Object.assign(new PremError(`at most ${maxPerMinute(model)} calls a minute to ${model}`, 503, true), { pausedUntil: until, pause: "rate" as const });
  }
  calls.push(now);
  recent.set(model, calls);
  try {
    const out = await fn();
    breakers.delete(model);
    return out;
  } catch (first) {
    if (own(first)) throw first;
    let e = first;
    if (expiredKey(first)) {
      // a fresh client once — only for this
      resetPrem();
      calls.push(clock());
      try {
        const out = await fn();
        breakers.delete(model);
        return out;
      } catch (again) {
        if (own(again)) throw again;
        e = again;
      }
    }
    const err = await classify(e, model, doing);
    if (err.transient) {
      err.pausedUntil = trip(model, err.message, retryAfter(e));
      err.pause = "provider";
    }
    throw err;
  }
}

/**
 * At the start: is each model we use listed for our key, and does it have an attested deployment? One that is not
 * pauses for 30 minutes with that reason (it is looked at again then, and on every request after).
 */
export async function checkModels(wanted: string[]): Promise<void> {
  if (process.env.PREMAI_PAUSED === "1") return console.warn("prem: paused on this server (PREMAI_PAUSED=1) — nothing is asked");
  const list = await models();
  for (const m of wanted) {
    if (list && !list.some((x) => x.id === m)) {
      breakers.set(m, { until: clock() + MAX_PAUSE, reason: `${m} is not listed for our Prem key`, pause: MAX_PAUSE / 2 });
      console.warn(`prem: ${m} is not listed for our Prem key — paused for 30 minutes`);
      continue;
    }
    const probe = await gatewayProbe(m);
    if (probe && !probe.deployed) {
      breakers.set(m, { until: clock() + MAX_PAUSE, reason: `${m} is not enabled for confidential use on our Prem key`, pause: MAX_PAUSE / 2 });
      console.warn(`prem: ${m} is not enabled for confidential use on our Prem key — paused for 30 minutes`);
    } else if (probe) console.warn(`prem: ${m}'s attestation route answers ${probe.status}${probe.message ? `: ${probe.message}` : ""}`);
  }
}
