// Prem's failures, read as they are: the attestation is per model, so an attestation error is checked against the
// gateway's attestation route for that model (stood in for here) — 5xx: Prem's report is unavailable for now
// (transient, the file waits), 401/403: our key, 200 while the SDK's verification failed: a genuine failure. And the
// endpoints Prem publishes, and the models this key lists.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { initRoles } from "../src/acl";
import { call, checkModels, classify, discover, endpoints, MAX_PAUSE, paused, pick, PremError, useClock, useModels, useProbe } from "../src/prem";
import { transcribeRoute, useSttClient } from "../src/stt";

const pg = new PGlite();
const SERVER_TOKEN = "vst_the_vault_servers_token_p";

beforeAll(async () => {
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  const db: Db = {
    query: async (text, params = []) => {
      const r = await pg.query<any>(text, params as any[]);
      return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
    },
    exec: async (text) => void (await pg.exec(text)),
    transaction: (fn) => pg.transaction((tx) => fn({ query: async (t, p = []) => { const r = await tx.query<any>(t, p as any[]); return { rows: r.rows, affectedRows: r.affectedRows ?? 0 }; } })),
  };
  useDb(db);
  await initRoles();
  await pg.query("INSERT INTO vault_config (key, value) VALUES ('api_token', $1)", [createHash("sha256").update(SERVER_TOKEN).digest("hex")]);
});

afterEach(() => {
  useClock(null);
  delete process.env.PREMAI_PAUSED;
  useProbe(null);
  useModels(undefined);
  useSttClient(null);
});

// what the SDK throws when the attestation's first request gets no JSON
const attestationError = () => Object.assign(new Error("failed to request modules from attestation server"), { name: "AttestationError" });
const gateway = (status: number, body: string, type = "text/plain") => {
  const asked: string[] = [];
  useProbe((async (url: string) => (asked.push(url), new Response(body, { status, headers: { "content-type": type } }))) as unknown as typeof fetch);
  return asked;
};

describe("an attestation failure, classified by the gateway's answer for the model", () => {
  test("5xx: the report is unavailable for now — transient, and the probe asked for that model", async () => {
    const asked = gateway(502, "Error code: 502");
    const e = await classify(attestationError(), "deepgram/general-nova-3", "transcribe this");
    expect(e.transient).toBe(true);
    expect(e.status).toBe(503);
    expect(e.message).toBe("Prem's attestation report for deepgram/general-nova-3 is unavailable right now (gateway 502: Error code: 502) — retrying");
    expect(asked[0]).toBe(`${endpoints.proxy}/attestation/modules?model=deepgram%2Fgeneral-nova-3`);
  });

  test("404 with no deployment: the model is not enabled for our key — transient, with exactly that reason", async () => {
    gateway(404, '{"model":"deepgram/general-nova-3","data":[]}', "application/json");
    const e = await classify(attestationError(), "deepgram/general-nova-3", "transcribe this");
    expect(e.transient).toBe(true);
    expect(e.message).toBe("deepgram/general-nova-3 is not enabled for confidential use on our Prem key");
    // a 200 that lists no deployment says the same
    gateway(200, '{"model":"qwen38-27b","data":[]}', "application/json");
    expect((await classify(attestationError(), "qwen38-27b", "analyse this")).message).toBe("qwen38-27b is not enabled for confidential use on our Prem key");
  });

  test("200 while the SDK's verification failed: a genuine attestation failure, not transient", async () => {
    gateway(200, '{"cpu":"Tdx","gpu":null}', "application/octet-stream");
    const e = await classify(attestationError(), "qwen38-27b", "analyse this");
    expect(e.transient).toBe(false);
    expect(e.message).toMatch(/^Prem's attestation of qwen38-27b failed verification/);
  });

  test("401/403: our key or its scope — not transient", async () => {
    gateway(403, '{"error":"API key lacks scope rvenc","support_id":"abc"}', "application/json");
    const e = await classify(attestationError(), "deepgram/general-nova-3", "transcribe this");
    expect(e.transient).toBe(false);
    expect(e.message).toBe("Prem refused our key for deepgram/general-nova-3's attestation (gateway 403: API key lacks scope rvenc (abc))");
    // the SDK saying 401 itself needs no probe
    const k = await classify({ status: 401, error: "Invalid API key" }, "deepgram/general-nova-3", "transcribe this");
    expect(k.message).toMatch(/refused our key \(401\)/);
    expect(k.transient).toBe(false);
  });

  test("the route says transient to the vault server, which keeps the file queued", async () => {
    process.env.PREMAI_API_KEY ??= "set";
    gateway(502, "Error code: 502");
    useSttClient({ audio: { transcriptions: { create: async () => Promise.reject(attestationError()) } } });
    const res = await transcribeRoute(
      new Request("http://api/api/transcripts", { method: "POST", body: new Uint8Array([1, 2, 3]), headers: { "content-type": "audio/mp4", authorization: `Bearer ${SERVER_TOKEN}` } }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("unavailable right now (gateway 502"), transient: true, pause: "provider", paused_until: expect.any(String) });
  });

  test("rate limiting and Prem's own 5xx are transient; anything else is not", async () => {
    expect((await classify({ status: 429, error: "slow down" }, "m", "x")).transient).toBe(true);
    expect((await classify({ status: 500, error: "boom" }, "m", "x")).transient).toBe(true);
    expect((await classify(new Error("bad audio"), "m", "transcribe this")).message).toBe("Prem could not transcribe this: bad audio");
    const own = new PremError("as it is", 418);
    expect(await classify(own, "m", "x")).toBe(own);
  });
});

describe("never hammering Prem: the breaker and the rate limit", () => {
  const route = () =>
    transcribeRoute(new Request("http://api/api/transcripts", { method: "POST", body: new Uint8Array([1, 2, 3]), headers: { "content-type": "audio/mp4", authorization: `Bearer ${SERVER_TOKEN}` } }));

  test("many queued files and a failing provider: exactly one Prem call per pause, the pause doubling", async () => {
    process.env.PREMAI_API_KEY ??= "set";
    let now = 1_000_000;
    useClock(() => now);
    const probes = gateway(404, '{"model":"deepgram/general-nova-3","data":[]}', "application/json");
    let calls = 0;
    useSttClient({ audio: { transcriptions: { create: async () => (calls++, Promise.reject(attestationError())) } } });
    // twenty files in a row, as a round would send them
    const answers = [];
    for (let i = 0; i < 20; i++) answers.push(await route());
    expect(calls).toBe(1);
    expect(probes).toHaveLength(1);
    const first = await answers[0]!.json();
    expect(first).toMatchObject({ error: "deepgram/general-nova-3 is not enabled for confidential use on our Prem key", transient: true, pause: "provider" });
    expect(Date.parse(first.paused_until)).toBe(now + 60_000);
    // the others: at once, without Prem
    const later = await answers[19]!.json();
    expect(answers[19]!.status).toBe(503);
    expect(later.paused_until).toBe(first.paused_until);
    // a minute on: one call again; it fails, the pause doubles
    now += 60_001;
    for (let i = 0; i < 5; i++) await route();
    expect(calls).toBe(2);
    expect(paused("deepgram/general-nova-3")!.until).toBe(now + 120_000);
    // and once Prem answers, the breaker closes by itself
    now += 120_001;
    useSttClient({ audio: { transcriptions: { create: async () => (calls++, { results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } }) } } });
    expect((await route()).status).toBe(200);
    expect(paused("deepgram/general-nova-3")).toBeNull();
    // never longer than 30 minutes
    let len = 0;
    for (let i = 0; i < 12; i++) {
      try {
        await call("m", "x", () => Promise.reject({ status: 500, error: "boom" }));
      } catch {}
      len = paused("m")!.until - now;
      now += len + 1;
    }
    expect(len).toBe(MAX_PAUSE);
  });

  test("the hard rate limit: at most six Deepgram calls a minute, then paused until the oldest is a minute old", async () => {
    let now = 5_000_000;
    useClock(() => now);
    let calls = 0;
    const ok = () => (calls++, Promise.resolve("words"));
    for (let i = 0; i < 6; i++) await call("deepgram/general-nova-3", "x", ok), (now += 1000);
    const e = await call("deepgram/general-nova-3", "x", ok).catch((x) => x as PremError);
    expect(calls).toBe(6);
    expect(e).toBeInstanceOf(PremError);
    expect((e as PremError).pause).toBe("rate");
    expect((e as PremError).pausedUntil).toBe(5_000_000 + 60_000);
    now = 5_000_000 + 60_001;
    await call("deepgram/general-nova-3", "x", ok);
    expect(calls).toBe(7);
  });

  test("the kill switch and the check at the start: nothing is asked", async () => {
    process.env.PREMAI_PAUSED = "1";
    let calls = 0;
    const e = await call("qwen38-27b", "x", () => (calls++, Promise.resolve(1))).catch((x) => x as PremError);
    expect(calls).toBe(0);
    expect((e as PremError).message).toMatch(/PREMAI_PAUSED/);
    delete process.env.PREMAI_PAUSED;
    let now = 9_000_000;
    useClock(() => now);
    useModels([{ id: "qwen38-27b", type: "CHAT" }]);
    gateway(404, '{"model":"deepgram/general-nova-3","data":[]}', "application/json");
    await checkModels(["deepgram/general-nova-3", "qwen38-27b"]);
    expect(paused("deepgram/general-nova-3")).toEqual({ until: now + MAX_PAUSE, reason: "deepgram/general-nova-3 is not listed for our Prem key" });
    expect(paused("qwen38-27b")).toEqual({ until: now + MAX_PAUSE, reason: "qwen38-27b is not enabled for confidential use on our Prem key" });
  });
});

describe("the models and the endpoints", () => {
  test("the model we name when the key lists it (or the list is unknown); else the key's own of that kind", async () => {
    useModels([{ id: "deepgram/general-nova-3", type: "AUDIO_TRANSCRIPTION" }, { id: "qwen38-27b", type: "CHAT" }]);
    expect(await pick("deepgram/general-nova-3", "AUDIO_TRANSCRIPTION", /^deepgram\//)).toBe("deepgram/general-nova-3");
    useModels([{ id: "deepgram/nova-3-confidential", type: "AUDIO_TRANSCRIPTION" }, { id: "qwen38-27b", type: "CHAT" }]);
    expect(await pick("deepgram/general-nova-3", "AUDIO_TRANSCRIPTION", /^deepgram\//)).toBe("deepgram/nova-3-confidential");
    useModels(null);
    expect(await pick("qwen38-27b", "CHAT", /^qwen/)).toBe("qwen38-27b");
  });

  test("Prem's published endpoints are followed where nothing is pinned", async () => {
    delete process.env.PREMAI_PROXY_URL;
    delete process.env.PREMAI_ENCLAVE_URL;
    await discover((async () => Response.json({ proxy: "https://gateway2.prem.io", enclave: "https://conf-engine2.prem.io/" })) as unknown as typeof fetch);
    expect(endpoints).toEqual({ proxy: "https://gateway2.prem.io", enclave: "https://conf-engine2.prem.io" });
  });
});
