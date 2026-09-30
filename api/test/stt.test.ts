// Speech to text: Deepgram's answer normalised into the catalog's transcript, and who may ask the route — against a
// recorded Nova 3 response (test/fixtures/deepgram-nova3.json); Prem itself is stood in for.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { initRoles } from "../src/acl";
import { clientKek, MAX_BYTES, normalize, statusRoute, transcribeRoute, useSttClient, type DeepgramResponse } from "../src/stt";
import fixture from "./fixtures/deepgram-nova3.json";

const pg = new PGlite();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const MEDIA_KEY = "mck_media_admin_key";
const OTHER_KEY = "mck_ideas_only_key";
const SERVER_TOKEN = "vst_the_vault_servers_token";

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
  await pg.query("INSERT INTO founders (id, name, role) VALUES ('first', 'first', 'admin')");
  await pg.query("INSERT INTO api_keys (founder_id, hash, scope, label) VALUES ('first', $1, 'media:admin', 'Mac'), ('first', $2, 'ideas:admin', 'notes')", [sha(MEDIA_KEY), sha(OTHER_KEY)]);
  await pg.query("INSERT INTO vault_config (key, value) VALUES ('api_token', $1)", [sha(SERVER_TOKEN)]);
});

const saved = process.env.PREMAI_API_KEY;
afterEach(() => {
  useSttClient(null);
  if (saved === undefined) delete process.env.PREMAI_API_KEY;
  else process.env.PREMAI_API_KEY = saved;
});

const audio = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32]); // an m4a's first bytes: enough for a stand-in
const post = (auth?: string, body: BodyInit = audio, type = "audio/mp4") =>
  new Request("http://api/api/transcripts", { method: "POST", body, headers: { "content-type": type, ...(auth ? { authorization: `Bearer ${auth}` } : {}) } });

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
  test("nobody, a wrong server token, or a key without media:admin is turned away", async () => {
    process.env.PREMAI_API_KEY = "set";
    expect((await transcribeRoute(post())).status).toBe(401);
    expect((await transcribeRoute(post("vst_not_it"))).status).toBe(403);
    expect((await transcribeRoute(post(OTHER_KEY))).status).toBe(403);
    expect((await transcribeRoute(post("mck_unknown"))).status).toBe(401);
  });

  test("without Prem's key it says so: 503, in a sentence", async () => {
    delete process.env.PREMAI_API_KEY;
    const res = await transcribeRoute(post(SERVER_TOKEN));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/PREMAI_API_KEY is missing/);
    expect(await (await statusRoute(new Request("http://api/api/transcripts", { headers: { authorization: `Bearer ${MEDIA_KEY}` } }))).json()).toMatchObject({ ready: false });
  });

  test("the vault server's audio goes to Prem as an m4a with diarize and smart_format; the transcript comes back", async () => {
    const asked: any[] = [];
    useSttClient({ audio: { transcriptions: { create: async (body) => (asked.push(body), fixture) } } });
    const res = await transcribeRoute(post(SERVER_TOKEN));
    expect(res.status).toBe(200);
    const t = await res.json();
    expect(t.words).toHaveLength(11);
    expect(t.utterances).toHaveLength(3);
    expect(asked[0]).toMatchObject({ model: "deepgram/general-nova-3", diarize: true, smart_format: true });
    expect(asked[0].file.name).toBe("speech.m4a");
    expect(asked[0].file.type).toBe("audio/mp4");
    expect(new Uint8Array(await asked[0].file.arrayBuffer())).toEqual(audio);
  });

  test("the app's key may ask too, as multipart", async () => {
    useSttClient({ audio: { transcriptions: { create: async () => fixture } } });
    const form = new FormData();
    form.set("file", new File([audio], "take.m4a", { type: "audio/mp4" }));
    const res = await transcribeRoute(new Request("http://api/api/transcripts", { method: "POST", body: form, headers: { authorization: `Bearer ${MEDIA_KEY}` } }));
    expect(res.status).toBe(200);
  });

  test("empty and too large are refused before Prem is asked; Prem's refusals become sentences", async () => {
    let calls = 0;
    useSttClient({ audio: { transcriptions: { create: async () => (calls++, Promise.reject({ status: 429, error: "Rate limit exceeded. Please try again later." })) } } });
    expect((await transcribeRoute(post(SERVER_TOKEN, new Uint8Array()))).status).toBe(400);
    expect((await transcribeRoute(post(SERVER_TOKEN, new Uint8Array(MAX_BYTES + 1)))).status).toBe(413);
    expect(calls).toBe(0);
    const res = await transcribeRoute(post(SERVER_TOKEN));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/rate limiting/);
    expect(calls).toBe(1); // a 4xx is not tried twice
  });
});

test("our key encryption key is made once and kept", async () => {
  delete process.env.PREMAI_CLIENT_KEK;
  const a = await clientKek();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(await clientKek()).toBe(a);
});
