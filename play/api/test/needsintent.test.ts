// No work without an intent (intent 706ed873, play/SPEC.md §4.12) against a real Postgres: set TEST_DATABASE_URL, as
// for ./api.test.ts.
//
// Every tool in tools/list that proposes or edits work (each propose_*, add_artifact, update_artifact, doc_edit) and
// POST /api/intents: without `intent` refused, naming add_intent, nothing written; naming an intent at any stage but
// Build or Proposal refused, nothing written; naming one in Build with every must check passed, taken, the intent at
// Proposal with that work and its spec. And Postgres holds it: an intent in Build, at Proposal or in Ship has a spec.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COOP } from "../src/access";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import * as docs from "../src/docs";
import { Rate } from "../src/limits";
import { migrate, MIGRATIONS } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { seedDoc } from "../src/versioned";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

const SOURCE = (line: string) => `module.exports.recipe = function (id, v) {\n  // ${line}\n  return { meta: { id, v }, build: () => null };\n};\n`;
const SPEC = {
  goal: "Work comes with its intent.",
  nothing_to_reduce: "A test fixture: nothing to reduce.",
  scope: "Every propose path.",
  checks: [{ check: "It holds", how: "test", by: "true", run: "true" }],
};
const words = (k: number, w: string) => Array.from({ length: k }, () => w).join(" ");
const SUMMARY = `## What it is\n\n${words(200, "artifact")}\n\n## Key points\n\n${Array.from({ length: 20 }, () => `- ${words(10, "point")}`).join("\n")}\n\n## The topic\n\n${words(193, "topic")}`;
const ARTIFACT = (url: string) => ({ url, title: "A page with its intent", description: "A page kept only for an intent.", summary: SUMMARY, authors: [{ name: "Ann Author", kind: "person" }], kind: "page", origin: "human" });
const BODY = { format: "9:16", fps: 30, tracks: [{ id: "voice", kind: "voice", clips: [{ id: "v1", at: 0, duration: 4, who: "MAIA", line: "One." }] }] };
/** the tools that propose or edit work: every propose_*, and these */
const isWork = (name: string) => name.startsWith("propose_") || ["doc_edit"].includes(name);
const CONSTRAINT = "202611070300-706ed873-intents-specified";

async function freshDb(prefix: string) {
  const name = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Bun.SQL(URL_!);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const u = new URL(URL_!);
  u.pathname = `/${name}`;
  const sql = new Bun.SQL(u.toString());
  return { name, admin, sql, db: fromBunSql(sql) };
}

suite("no work without an intent", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  const who: Record<string, { id: string; cookie: string }> = {};
  let token = "";
  let n = 0;
  let K = "", asset = "", art = "", story = "";

  const call = async (as: string | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (as) headers.cookie = who[as].cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await api.fetch(new Request(`http://play.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const rpc = async (method: string, params?: unknown) =>
    (await (await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) }))).json()).result;
  const tool = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const res = await rpc("tools/call", { name, arguments: args });
    const text = res.content[0].text;
    return res.isError ? { error: text as string } : JSON.parse(text);
  };
  /** an intent in Build, its spec approved and every must check passed */
  const readyIntent = async (title: string) => {
    const i = await tool("add_intent", { title });
    await tool("specify_intent", { intent: i.id, ...SPEC });
    await call("ada", "POST", `/api/intents/${i.id}/approve`);
    await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] });
    return i.id as string;
  };
  /** how many rows the work would write: intents, variants, edits, artifacts, asset and story versions */
  const written = async () => {
    const out: Record<string, number> = {};
    for (const t of ["intents", "doc_variants", "doc_edits", "artifacts", "asset_versions", "story_versions", "intent_variants"])
      out[t] = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM play.${t}`)).rows[0].n);
    out.proposal = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM play.intents WHERE stage = 'proposal'`)).rows[0].n);
    return out;
  };
  /** each work path, with work it takes, for intent `intent` (left out where undefined) */
  const PATHS: Record<string, (intent?: string) => Promise<{ error?: string; status?: number; intent?: string }>> = {
    propose_asset: (intent) => tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: `A fern ${++n}`, source: SOURCE(`a fern ${n}`), note: "a new asset", ...(intent ? { intent } : {}) }),
    propose_story: (intent) => tool("propose_story", { title: `A film ${++n}`, body: BODY, note: "a new story", ...(intent ? { intent } : {}) }),
    propose_doc_version: (intent) => tool("propose_doc_version", { doc: K, note: `more ${++n}`, edits: [{ op: "set", path: ["system"], value: `Say it ${n}.` }], ...(intent ? { intent } : {}) }),
    doc_edit: (intent) => tool("doc_edit", { doc: K, message: `an edit ${++n}`, edits: [{ op: "set", path: ["system"], value: `Edited ${n}.` }], ...(intent ? { intent } : {}) }),
    "POST /api/intents": async (intent) => {
      const r = await call("ada", "POST", "/api/intents", { asset, note: "from the page", source: SOURCE(`from the page ${++n}`), ...(intent ? { intent } : {}) });
      return r.status >= 400 ? { error: r.data?.error, status: r.status } : { ...r.data, status: r.status };
    },
  };

  beforeAll(async () => {
    ({ name, admin, sql, db } = await freshDb("play_needsintent"));
    await migrate(db);
    await initSessions(db);
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0) });
    const made = await createHuman(db, "ada");
    who.ada = { id: made.id, cookie: `play_session=${tokenFor(made.id)}` };
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [who.ada.id]);
    token = (await call("ada", "POST", "/api/tokens", { name: "agent" })).data.token;
    // what the paths change: a skill, an asset, an artifact, each accepted for an intent of its own
    K = crypto.randomUUID();
    await seedDoc(db, "skill", { id: K, json: { schema: "skill/1", label: "A skill", group: "tests", system: "Say it." }, note: "v1" });
    const a = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "The fern", source: SOURCE("the fern"), note: "v1", intent: await readyIntent("The fern") });
    expect((await call("ada", "POST", `/api/intents/${a.intent}/accept`)).status).toBe(200);
    asset = a.asset;
    const r = await tool("add_artifact", { ...ARTIFACT("https://needsintent.example/kept"), intent: await readyIntent("A page kept") });
    expect((await call("ada", "POST", `/api/intents/${r.intent}/accept`)).status).toBe(200);
    art = r.id;
    const s = await tool("propose_story", { title: "The film", body: BODY, note: "v1", intent: await readyIntent("The film") });
    expect((await call("ada", "POST", `/api/intents/${s.intent}/accept`)).status).toBe(200);
    story = s.story;
  });
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  test("no work without an intent: every work tool and POST /api/intents, called without one, is refused naming add_intent, nothing written", async () => {
    const tools: string[] = (await rpc("tools/list")).tools.map((t: any) => t.name).filter(isWork);
    expect(tools.length).toBeGreaterThan(0);
    // every work tool in tools/list is one this test calls, and POST /api/intents beside them
    expect([...tools, "POST /api/intents"].sort()).toEqual(Object.keys(PATHS).sort());
    const before = await written();
    for (const [path, run] of Object.entries(PATHS)) {
      for (const none of [undefined, ""]) {
        const r = await (path === "POST /api/intents" ? run(none) : path === "doc_edit" ? tool("doc_edit", { doc: K, message: "no intent", edits: [{ op: "set", path: ["system"], value: "x" }], ...(none === "" ? { intent: "" } : {}) }) : run(none));
        expect([path, r.error]).toEqual([path, expect.stringContaining("add_intent")]);
        expect(r.error).toContain("specify_intent");
        if (path === "POST /api/intents") expect(r.status).toBe(400);
        expect([path, await written()]).toEqual([path, before]);
      }
    }
    // who may propose is asked first: a visitor 401, a citizen 403
    const cit = await createHuman(db, "cit");
    const citizen = `play_session=${tokenFor(cit.id)}`;
    const post = (cookie?: string) => api.fetch(new Request("http://play.test/api/intents", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ asset, source: SOURCE("a citizen's") }) }));
    expect((await post()).status).toBe(401);
    expect((await post(citizen)).status).toBe(403);
    expect(await written()).toEqual(before);
    expect(story).toBeString();
  });

  test("only an intent in Build or at Proposal takes work: Idea, Specify, Ship, Accepted, Archived refused; Build with every must passed taken", async () => {
    // an intent at each stage that takes no work (and one in Build whose checks have not passed)
    const idea = (await tool("add_intent", { title: "At Idea" })).id;
    const specify = (await tool("add_intent", { title: "At Specify" })).id;
    await tool("specify_intent", { intent: specify, ...SPEC });
    const at = async (stage: string) => {
      const i = await readyIntent(`At ${stage}`);
      await db.query(`UPDATE play.intents SET stage = $2, decided_at = CASE WHEN $2 IN ('accepted', 'archived') THEN now() END WHERE id = $1`, [i, stage]);
      return i;
    };
    const stages: Record<string, string> = { idea, specify, ship: await at("ship"), accepted: await at("accepted"), archived: await at("archived") };
    const unchecked = (await tool("add_intent", { title: "In Build, not checked" })).id;
    await tool("specify_intent", { intent: unchecked, ...SPEC });
    await call("ada", "POST", `/api/intents/${unchecked}/approve`);
    for (const [stage, id] of Object.entries(stages))
      expect([stage, (await db.query<{ stage: string }>(`SELECT stage FROM play.intents WHERE id = $1`, [id])).rows[0].stage]).toEqual([stage, stage]);

    const before = await written();
    for (const [path, run] of Object.entries(PATHS)) {
      for (const [stage, id] of Object.entries(stages)) {
        const r = await run(id);
        expect([path, stage, r.error]).toEqual([path, stage, expect.stringContaining(id === idea || id === specify ? "stage" : "")]);
        expect(r.error).toBeString();
        if (path === "POST /api/intents") expect(r.status).toBe(409);
        expect([path, stage, await written()]).toEqual([path, stage, before]);
      }
      // a propose (not an edit) waits for every must check
      if (path !== "doc_edit") {
        const r = await run(unchecked);
        expect([path, r.error]).toEqual([path, expect.any(String)]);
        expect([path, await written()]).toEqual([path, before]);
      }
    }

    // in Build with every must check passed: taken, the intent at Proposal with that work and its spec
    for (const [path, run] of Object.entries(PATHS)) {
      const ready = await readyIntent(`Ready for ${path}`);
      const r = await run(ready);
      expect([path, r.error]).toEqual([path, undefined]);
      if (path === "doc_edit") {
        expect((r as any).intent).toBe(ready);
        const v = (r as any).variant;
        expect((await tool("propose_doc_version", { doc: K, variant: v, note: "the edit, proposed", intent: ready })).error).toBeUndefined();
      } else expect(r.intent).toBe(ready);
      const i = await tool("get_intent", { intent: ready });
      expect([path, i.stage, !!i.spec, !!i.work, i.approved_at != null]).toEqual([path, "proposal", true, true, true]);
      // at Proposal it still takes work (its work replaced or added to)
      expect(["at proposal", path, (await run(ready)).error]).toEqual(["at proposal", path, undefined]);
      await call("ada", "POST", `/api/intents/${ready}/archive`);
    }
  });

  test("intent is required: every work tool's inputSchema.required holds intent, and no description says what happens without one", async () => {
    const list: any[] = (await rpc("tools/list")).tools;
    const work = list.filter((t) => isWork(t.name));
    expect(work.map((t) => t.name).sort()).toEqual(Object.keys(PATHS).filter((p) => !p.startsWith("POST")).sort());
    for (const t of work) {
      expect([t.name, t.inputSchema.required]).toEqual([t.name, expect.arrayContaining(["intent"])]);
      expect([t.name, typeof t.inputSchema.properties.intent?.description]).toEqual([t.name, "string"]);
    }
    for (const t of list) {
      const texts = [t.description, ...Object.values(t.inputSchema.properties ?? {}).map((p: any) => p.description ?? "")];
      for (const s of texts) expect([t.name, /without it\b/i.test(s), /a new intent (at Proposal )?of its own/i.test(s)]).toEqual([t.name, false, false]);
    }
  });
});

suite("every intent at Proposal has a spec", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  beforeAll(async () => {
    ({ name, admin, sql, db } = await freshDb("play_specified"));
  });
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  test("every intent at Proposal has a spec: after migrate, Build, Proposal and Ship refuse an intent without one; a spec-less one at Proposal from before ends archived, its variant kept", async () => {
    const at = MIGRATIONS.findIndex((m) => m.id === CONSTRAINT);
    expect(at).toBeGreaterThan(0);
    await migrate(db, { until: MIGRATIONS[at - 1].id });
    const ada = await createHuman(db, "ada");
    // a document and an intent variant of it, held by a spec-less intent at Proposal (as one proposed without an intent was)
    const K = crypto.randomUUID();
    await seedDoc(db, "skill", { id: K, json: { schema: "skill/1", label: "A skill", group: "tests", system: "Say it." }, note: "v1" });
    const docId = `skill:${K}`;
    const v = await docs.variant(db, docId, { author: { human: ada.id, via: "mcp" }, note: "spec-less work" });
    const intent = (s: string, title: string) => {
      const id = crypto.randomUUID();
      return db.query(`INSERT INTO play.intents (id, coop_id, kind, title, note, stage, author, via) VALUES ($1, $2, 'improve', $3, 'from before', $4, $5, 'mcp')`, [id, COOP, title, s, ada.id]).then(() => id);
    };
    const waiting = await intent("proposal", "Proposed without an intent");
    await db.query(`UPDATE play.intents SET work = 'skill_version' WHERE id = $1`, [waiting]);
    await db.query(`UPDATE play.doc_variants SET status = 'proposed', intent_id = $2 WHERE id = $1`, [v.id, waiting]);
    await db.query(`INSERT INTO play.intent_variants (intent_id, doc_id, variant_id, seed) VALUES ($1, $2, $3, '[]')`, [waiting, docId, v.id]);
    const accepted = await intent("accepted", "Accepted long ago");
    const archived = await intent("archived", "Archived long ago");
    const row = async (id: string) => (await db.query<any>(`SELECT stage, note, decided_at FROM play.intents WHERE id = $1`, [id])).rows[0];
    const keptBefore = [await row(accepted), await row(archived)];

    await migrate(db);
    // the spec-less one at Proposal: archived, saying why; its variant archived and kept, still held in its history
    const w = await row(waiting);
    expect(w.stage).toBe("archived");
    expect(w.note).toContain("no work without an intent: propose it again for an intent");
    expect(w.note).toContain("from before");
    const vr = (await db.query<any>(`SELECT status FROM play.doc_variants WHERE id = $1`, [v.id])).rows[0];
    expect(vr.status).toBe("archived");
    expect((await db.query(`SELECT 1 FROM play.intent_variants WHERE variant_id = $1`, [v.id])).rows.length).toBe(1);
    // Accepted and Archived ones without a spec, untouched
    expect([await row(accepted), await row(archived)]).toEqual(keptBefore);

    // and from now on Postgres refuses an intent in Build, at Proposal or in Ship without a spec
    for (const s of ["build", "proposal", "ship"]) {
      await expect(intent(s, `At ${s}, no spec`)).rejects.toThrow(/intents_specified|intents_spec_before_build/);
      const id = await intent("idea", `To ${s}`);
      await expect(db.query(`UPDATE play.intents SET stage = $2, approved_at = now() WHERE id = $1`, [id, s])).rejects.toThrow(/intents_specified/);
    }
    // with a spec it may be there
    const ok = await intent("idea", "Specified");
    await db.query(`UPDATE play.intents SET stage = 'proposal', spec = ($2::text)::jsonb, approved_at = now() WHERE id = $1`, [ok, JSON.stringify({ goal: "g", scope: "s", checks: [] })]);
    expect((await row(ok)).stage).toBe("proposal");
  });
});
