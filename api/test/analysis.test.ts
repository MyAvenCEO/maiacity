// The shot analysis: Qwen's answers validated into the vocabulary (game/film/vocabulary.json), the requests it gets
// (frames as data URIs, the JSON schema), the repair of an unusable answer, and who may ask — against fixtures in the
// shape of Prem's chat completions (test/fixtures/qwen-*.json, written by hand: Prem is not called here).
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { initRoles } from "../src/acl";
import { useClock } from "../src/prem";
import { analyseRoute, canonical, cleanCues, MODEL, parseAnswer, SCHEMAS, statusRoute, useAnalysisClient, validateFrames, validateReduce, VOCABULARY, vocabularyText } from "../src/analysis";
import VOCAB from "../../game/film/vocabulary.json";
import frames from "./fixtures/qwen-frames.json";
import reduce from "./fixtures/qwen-reduce.json";

const pg = new PGlite();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const MEDIA_KEY = "mck_media_admin_key_a";
const OTHER_KEY = "mck_ideas_only_key_a";
const SERVER_TOKEN = "vst_the_vault_servers_token_a";

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
  useAnalysisClient(null);
  useClock(null);
  if (saved === undefined) delete process.env.PREMAI_API_KEY;
  else process.env.PREMAI_API_KEY = saved;
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]).toString("base64");
const framesBody = {
  mode: "frames",
  file: { name: "C0042.MP4", kind: "video", seconds: 30 },
  stretch: { s: 0, e: 12, index: 0, of: 3 },
  frames: Array.from({ length: 12 }, (_, i) => ({ t: i, jpeg })),
  words: [{ s: 0.4, e: 3.8, text: "Day twenty. The city starts with one street." }],
};
const reduceBody = { mode: "reduce", file: { name: "C0042.MP4", kind: "video", seconds: 30 }, stretches: [{ s: 0, e: 12, summary: "x", tags: {}, cues: [] }], text: "Day twenty." };
const post = (body: unknown, auth = SERVER_TOKEN) =>
  new Request("http://api/api/analysis", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) } });
const answering = (...answers: unknown[]) => {
  const asked: any[] = [];
  useAnalysisClient({ chat: { completions: { create: async (body) => (asked.push(body), answers.length > 1 ? answers.shift() : answers[0]) } } });
  return asked;
};

describe("the vocabulary", () => {
  test("its values, and the ways a model says them", () => {
    expect(canonical("shot_size", "medium close-up")).toBe("MCU");
    expect(canonical("shot_size", "CU")).toBe("CU");
    expect(canonical("angle", "Over the shoulder")).toBe("OTS");
    expect(canonical("movement", "Steadicam")).toBe("gimbal");
    expect(canonical("scene", "B-roll")).toBe("b-roll");
    expect(canonical("shot_size", "gigantic")).toBeNull();
    // the prompt carries every base tag and every cue kind
    const t = vocabularyText();
    for (const k of Object.keys(VOCAB.base)) expect(t).toContain(`- ${k} (`);
    for (const k of Object.keys(VOCAB.cues.kinds)) expect(t).toContain(`- ${k}: `);
    // and the schema is the vocabulary's
    const props = (SCHEMAS.frames as any).properties.tags.properties;
    expect(props.shot_size.enum).toEqual(VOCAB.base.shot_size.values);
    expect(VOCABULARY).toBe(VOCAB.version);
  });
});

describe("validating an answer", () => {
  test("a stretch's answer: values in the vocabulary, cues in the stretch, free tags lower case and once", () => {
    const raw = parseAnswer(frames.choices[0]!.message.content);
    const { value, errors, fatal } = validateFrames(raw, { s: 0, e: 12 }, 12);
    expect(fatal).toBe(false);
    expect(value.tags).toMatchObject({ shot_size: "MCU", angle: "eye", movement: ["handheld"], focal_mm: 35, people: 1, who: ["Samuel"], scene: ["monologue to camera"], quality: [], location_note: "a desk by a window, two screens" });
    expect(value.tags.mood).toBeUndefined();
    expect(value.free).toEqual(["laptop", "window light", "coffee cup"]);
    expect(value.cues.map((c) => c.kind)).toEqual(["take", "problem", "cut", "take", "emotion", "highlight"]);
    expect(value.cues[0]).toEqual({ s: 0.4, e: 3.8, kind: "take", label: "opening line", confidence: 0.8, note: "stumbles on 'twenty'", take_of: "opening line", take: 1 });
    expect(value.cues.find((c) => c.kind === "highlight")!.why).toBe("the most alive moment");
    expect(value.thumbnail).toEqual({ index: 7, why: "his face lit by the window, eyes to the lens" });
    // what was dropped is said
    expect(errors.some((e) => e.includes("slow push"))).toBe(true);
    expect(errors.some((e) => e.includes("unknown tag mood"))).toBe(true);
    expect(errors.some((e) => e.includes("outside the stretch"))).toBe(true);
    expect(errors.some((e) => e.includes('"vibe"'))).toBe(true);
  });

  test("cues: times clamped to the stretch, reversed ones turned round, confidence bounded", () => {
    const errs: string[] = [];
    const c = cleanCues([{ s: 13, e: 11.9, kind: "Action", label: " stands up ", confidence: 3 }, { s: 20, e: 21, kind: "action", label: "far" }], 0, 12, errs);
    expect(c).toEqual([{ s: 11.9, e: 12.5, kind: "action", label: "stands up", confidence: 1 }]);
    expect(errs).toHaveLength(1);
  });

  test("the file's answer: takes of at least two attempts, the best among them, the thumbnail inside the file", () => {
    const { value, fatal } = validateReduce(parseAnswer(reduce.choices[0]!.message.content), 30);
    expect(fatal).toBe(false);
    expect(value.summary).toEqual({ line: "Samuel opens Day 20 at his desk, in two takes.", best_use: "The film's opener: take 2, from the breath." });
    expect(value.takes).toHaveLength(1);
    expect(value.takes[0]).toMatchObject({ take_of: "opening line", best: 2, why: "no stumble, a smile at the end" });
    expect(value.takes[0]!.takes[0]).toEqual({ s: 0.4, e: 3.8, take: 1, rank: 2, note: "stumbles" });
    expect(value.thumbnail).toEqual({ t: 7.5, why: "his face lit by the window" });
    expect(value.tags).toEqual({ shot_size: "MCU", scene: ["monologue to camera"], people: 1 });
  });

  test("what is not JSON is fatal; a fence or a reasoning block around JSON is not", () => {
    expect(parseAnswer("I cannot see the frames.")).toBeNull();
    expect(parseAnswer('<think>hm</think>\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(validateFrames(null, { s: 0, e: 1 }, 1).fatal).toBe(true);
    expect(validateFrames({ summary: "only words" }, { s: 0, e: 1 }, 1).fatal).toBe(true);
  });
});

describe("POST /api/analysis", () => {
  test("nobody, a wrong server token, or a key without media:admin is turned away", async () => {
    process.env.PREMAI_API_KEY = "set";
    expect((await analyseRoute(post(framesBody, ""))).status).toBe(401);
    expect((await analyseRoute(post(framesBody, "vst_not_it"))).status).toBe(403);
    expect((await analyseRoute(post(framesBody, OTHER_KEY))).status).toBe(403);
  });

  test("without Prem's key it says so: 503 — and the status route tells the vault server", async () => {
    delete process.env.PREMAI_API_KEY;
    expect((await analyseRoute(post(framesBody))).status).toBe(503);
    const st = await (await statusRoute(new Request("http://api/api/analysis", { headers: { authorization: `Bearer ${SERVER_TOKEN}` } }))).json();
    expect(st).toEqual({ ready: false, model: MODEL, vocabulary: VOCAB.version });
  });

  test("a stretch goes to Qwen as frames with their times and the words, in the schema; the answer comes back clean", async () => {
    const asked = answering(frames);
    const res = await analyseRoute(post(framesBody));
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(a).toMatchObject({ model: "qwen38-27b", vocabulary: VOCAB.version, tags: { shot_size: "MCU" }, thumbnail: { index: 7 } });
    const body = asked[0];
    expect(body.model).toBe("qwen38-27b");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.schema).toEqual(SCHEMAS.frames);
    const parts = body.messages[1].content as any[];
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(12);
    expect(parts[2].image_url.url).toBe(`data:image/jpeg;base64,${jpeg}`);
    expect(parts[1].text).toBe("Frame 0 at 0.0 s");
    expect(parts[0].text).toContain("[0.4 s–3.8 s] Day twenty. The city starts with one street.");
    expect(parts[0].text).toContain("stretch 1 of 3: 0.0 s to 12.0 s");
    expect(body.messages[0].content).toContain("shot_size (one of");
  });

  test("an unusable answer is sent back once to be repaired (text only); twice unusable is a 502", async () => {
    const garbage = { choices: [{ message: { content: "Sorry, here are my thoughts about the frames." } }] };
    const asked = answering(garbage, frames);
    const res = await analyseRoute(post(framesBody));
    expect(res.status).toBe(200);
    expect(asked).toHaveLength(2);
    expect(typeof asked[1].messages[1].content).toBe("string");
    expect(asked[1].messages[1].content).toContain("could not be used");
    const again = answering(garbage);
    const bad = await analyseRoute(post(framesBody));
    expect(bad.status).toBe(502);
    expect(again).toHaveLength(2);
  });

  test("Prem refusing the JSON schema: json_object from then on", async () => {
    let calls = 0;
    const asked: any[] = [];
    useAnalysisClient({
      chat: {
        completions: {
          create: async (body) => {
            asked.push(body);
            if (calls++ === 0) throw { status: 400, error: "response_format json_schema is not supported for this model" };
            return frames;
          },
        },
      },
    });
    expect((await analyseRoute(post(framesBody))).status).toBe(200);
    expect(asked[1].response_format).toEqual({ type: "json_object" });
  });

  test("the whole file: the stretches as text, the takes and summary back", async () => {
    const asked = answering(reduce);
    const res = await analyseRoute(post(reduceBody));
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(a.takes[0].best).toBe(2);
    expect(a.summary.best_use).toContain("opener");
    expect(asked[0].response_format.json_schema.schema).toEqual(SCHEMAS.reduce);
    expect(typeof asked[0].messages[1].content).toBe("string");
  });

  test("a request out of bounds is refused before Qwen is asked", async () => {
    const asked = answering(frames);
    expect((await analyseRoute(post({ ...framesBody, frames: [] }))).status).toBe(400);
    expect((await analyseRoute(post({ ...framesBody, frames: Array.from({ length: 30 }, (_, i) => ({ t: i, jpeg })) }))).status).toBe(413);
    expect((await analyseRoute(post({ ...framesBody, mode: "guess" }))).status).toBe(400);
    expect(asked).toHaveLength(0);
  });
});
