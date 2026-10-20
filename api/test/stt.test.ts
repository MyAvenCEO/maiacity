// Speech to text: Deepgram's answer normalised into the catalog's transcript, and who may ask the route — against a
// recorded Nova 3 response (test/fixtures/deepgram-nova3.json); Prem itself is stood in for.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { initRoles } from "../src/acl";
import { useClock } from "../src/prem";
import { MAX_BYTES, normalize, statusRoute, transcribeRoute, useSttClient, type DeepgramResponse } from "../src/stt";
import fixture from "./fixtures/deepgram-nova3.json";
import { avendbStandIn, pass } from "./fixtures/avendb";

const pg = new PGlite();
const avendb = avendbStandIn();
afterAll(avendb.stop);

beforeAll(async () => {
  avendb.start();
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
  await pg.query("INSERT INTO founders (id, name, role) VALUES ('first', 'first', 'admin')");
});

const saved = process.env.PREMAI_API_KEY;
afterEach(() => {
  useSttClient(null);
  useClock(null);
  if (saved === undefined) delete process.env.PREMAI_API_KEY;
  else process.env.PREMAI_API_KEY = saved;
});

const audio = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32]); // an m4a's first bytes: enough for a stand-in
const post = (by: string | null = pass(), body: BodyInit = audio, type = "audio/mp4") =>
  new Request("http://api/api/transcripts", { method: "POST", body, headers: { "content-type": type, ...(by ? { "x-avendb-pass": by } : {}) } });

describe("normalising Deepgram's answer", () => {
  const t = normalize(fixture as DeepgramResponse);

  test("every word with its start, end, confidence and speaker, in seconds of the audio", () => {
    expect(t.model).toBe("deepgram/general-nova-3");
    expect(t.language).toBe("en");
    expect(t.words).toHaveLength(11);
    expect(t.words[0]).toEqual({ w: "Day", s: 0.48, e: 0.8, c: 1, sp: 0 });
    // punctuated, rounded to the millisecond
    expect(t.words[4]).toEqual({ w: "starts", s: 2.4, e: 2.8, c: 1, sp: 0 });
    expect(t.words[10]).toEqual({ w: "hold?", s: 6.32, e: 6.82, c: 0.99, sp: 1 });
  });

  test("the text without speaker labels, and the sentences with their times", () => {
    expect(t.text).toBe("Day twenty. The city starts with one street. Does it hold?");
    expect(t.utterances).toEqual([
      { s: 0.48, e: 1.3, text: "Day twenty.", sp: 0 },
      { s: 1.84, e: 3.78, text: "The city starts with one street.", sp: 0 },
      { s: 5.92, e: 6.82, text: "Does it hold?", sp: 1 },
    ]);
  });

  test("without paragraphs, sentences are cut from the words (sentence ends, pauses, speakers)", () => {
    const raw = structuredClone(fixture) as any;
    delete raw.results.channels[0].alternatives[0].paragraphs;
    expect(normalize(raw).utterances!.map((u) => u.text)).toEqual(["Day twenty.", "The city starts with one street.", "Does it hold?"]);
  });

  test("silence is an empty transcript, not an error; no channel is", () => {
    expect(normalize({ results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } })).toEqual({
      model: "deepgram/general-nova-3", language: "en", text: "", words: [], utterances: [],
    });
    expect(() => normalize({ results: { channels: [] } })).toThrow(/without a channel/);
  });
});

describe("POST /api/transcripts", () => {
  test("nobody, an old key, or anyone not an admin of Maia City is turned away", async () => {
    process.env.PREMAI_API_KEY = "set";
    expect((await transcribeRoute(post(null))).status).toBe(401);
    expect((await transcribeRoute(post(pass("other")))).status).toBe(403);
    const key = new Request("http://api/api/transcripts", { method: "POST", body: audio, headers: { "content-type": "audio/mp4", authorization: "Bearer mck_old_mac" } });
    expect((await transcribeRoute(key)).status).toBe(401);
  });

  test("without Prem's key it says so: 503, in a sentence", async () => {
    delete process.env.PREMAI_API_KEY;
    const res = await transcribeRoute(post());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/PREMAI_API_KEY is missing/);
    expect(await (await statusRoute(new Request("http://api/api/transcripts", { headers: { "x-avendb-pass": pass() } }))).json()).toMatchObject({ ready: false });
  });

  test("the vault server's audio goes to Prem as an m4a with diarize and smart_format; the transcript comes back", async () => {
    const asked: any[] = [];
    useSttClient({ audio: { transcriptions: { create: async (body) => (asked.push(body), fixture) } } });
    const res = await transcribeRoute(post());
    expect(res.status).toBe(200);
    const t = await res.json();
    expect(t.words).toHaveLength(11);
    expect(t.utterances).toHaveLength(3);
    expect(asked[0]).toMatchObject({ model: "deepgram/general-nova-3", diarize: true, smart_format: true });
    expect(asked[0].file.name).toBe("speech.m4a");
    expect(asked[0].file.type).toBe("audio/mp4");
    expect(new Uint8Array(await asked[0].file.arrayBuffer())).toEqual(audio);
  });

  test("The OS may ask as multipart too", async () => {
    useSttClient({ audio: { transcriptions: { create: async () => fixture } } });
    const form = new FormData();
    form.set("file", new File([audio], "take.m4a", { type: "audio/mp4" }));
    const res = await transcribeRoute(new Request("http://api/api/transcripts", { method: "POST", body: form, headers: { "x-avendb-pass": pass() } }));
    expect(res.status).toBe(200);
  });

  test("empty and too large are refused before Prem is asked; Prem's refusals become sentences", async () => {
    let calls = 0;
    useSttClient({ audio: { transcriptions: { create: async () => (calls++, Promise.reject({ status: 429, error: "Rate limit exceeded. Please try again later." })) } } });
    expect((await transcribeRoute(post(pass(), new Uint8Array()))).status).toBe(400);
    expect((await transcribeRoute(post(pass(), new Uint8Array(MAX_BYTES + 1)))).status).toBe(413);
    expect(calls).toBe(0);
    const res = await transcribeRoute(post());
    // Prem rate limiting pauses the model: 503 with until when, and why
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/rate limiting/);
    expect(body.transient).toBe(true);
    expect(Date.parse(body.paused_until)).toBeGreaterThan(Date.now());
    expect(calls).toBe(1); // never tried twice
  });
});

