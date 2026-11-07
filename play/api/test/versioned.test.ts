// One version control (src/versioned.ts, play/SPEC.md "Version control") against a real Postgres: set TEST_DATABASE_URL,
// as for ./api.test.ts.
//
// c1: a kind is one entry. A kind registered here alone (a gadget, its type and its row table made in this file) gets
// everything every kind gets: listed, read at a version, an edit and an intent's variant, its history with its
// variants, edited, proposed with an intent, reviewed and accepted or archived, over MCP (list_docs, doc_at,
// doc_history, doc_edit, propose_doc_version), over HTTP (/api/docs/<uuid>, /history, /changes) and in the board's
// review, with no other file changed.
//
// c2: every kind play keeps round-trips through the one module: an asset, a story, a factory, a levels config and a
// skill each edited twice in an intent variant, proposed, reviewed field by field, accepted as Main's next version (an
// asset's and a story's frozen rows written), archived, and a clash on a moved seed archived; get_asset and get_story
// read an intent's variant too.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import { createDoc } from "../src/docs";
import { COOP, SCHEMA } from "../src/ids";
import { Rate } from "../src/limits";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { register, seedDoc, unregister } from "../src/versioned";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

/** the test's own kind: a gadget, a label, a count of cogs and a note */
/** the gadget's schema: a document of the meta-schema like every schema, made here as its test's setup */
const GADGET_SCHEMA = "9ad9e7c0-0000-4000-8000-00000000ca75";
const GADGET = {
  label: "Gadget",
  name: "gadget/1",
  type: "gadget",
  node: {
    type: "object",
    required: ["schema", "label", "cogs"],
    properties: {
      schema: { const: "gadget/1" },
      label: { type: "string", minLength: 1, maxLength: 100 },
      cogs: { type: "integer", minimum: 0, maximum: 1000 },
      colour: { type: "string", maxLength: 40 },
      note: { type: "string", maxLength: 4000, "x-loro": "text" },
    },
    additionalProperties: false,
  },
};
const gadgetCheck = (doc: any) => [...(doc.cogs === 13 ? ["a gadget never has 13 cogs"] : []), ...(doc.colour && doc.colour === doc.label ? ["a gadget is never named its colour"] : [])];

const SOURCE = (line: string) => `module.exports.recipe = function (id, v) {\n  // ${line}\n  return { meta: { id, v }, build: () => null };\n};\n`;
const SPEC = {
  goal: "A document says more.",
  nothing_to_reduce: "A test fixture: nothing to reduce.",
  scope: "One document. Nothing else changes.",
  checks: [{ check: "It holds", how: "test", by: "true", run: "true" }],
};

suite("one version control", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  const who: Record<string, { id: string; cookie: string }> = {};
  let token = "";

  beforeAll(async () => {
    name = `play_versioned_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    await initSessions(db);
    // c1's kind: its row table and its entry, here and nowhere else
    await db.query(`CREATE TABLE play.gadgets (id UUID PRIMARY KEY, coop_id UUID NOT NULL REFERENCES play.coops(id), label TEXT NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await db.query(`INSERT INTO play.records (id, coop_id, kind, label) VALUES ($1, $2, 'schema', 'Gadget')`, [GADGET_SCHEMA, COOP]);
    await createDoc(db, { id: `schema:${GADGET_SCHEMA}`, schema: SCHEMA.meta, json: GADGET, author: { human: null, via: "import" }, version: "v1" });
    register({ name: "gadget", prefix: "gadget", schema: GADGET_SCHEMA, check: gadgetCheck, work: "gadget_version", table: "play.gadgets", label: "gadget", group: "gadgets", item: (j) => ({ cogs: j.cogs }) });
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0) });
    for (const n of ["ada", "cit"]) {
      const h = await createHuman(db, n);
      who[n] = { id: h.id, cookie: `play_session=${tokenFor(h.id)}` };
    }
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [who.ada.id]);
    await db.query(`UPDATE play.memberships SET level = 'citizen' WHERE human_id = $1`, [who.cit.id]);
    token = (await call("ada", "POST", "/api/tokens", { name: "agent" })).data.token;
  });
  afterAll(async () => {
    unregister("gadget");
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  const call = async (as: string | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (as) headers.cookie = who[as].cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await api.fetch(new Request(`http://play.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  let n = 0;
  /** a tool called over MCP by ada's token: its result as JSON, or its error's text */
  const tool = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const r = await api.fetch(
      new Request("http://play.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }),
      }),
    );
    const res = (await r.json()).result;
    const text = res.content[0].text;
    return res.isError ? { error: text as string } : JSON.parse(text);
  };
  /** an intent in Build, its spec approved, its one must check passed: ready to take work */
  const readyIntent = async (title: string) => {
    const i = await tool("add_intent", { title });
    await tool("specify_intent", { intent: i.id, ...SPEC });
    expect((await call("ada", "POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] })).stage).toBe("proposal");
    return i.id as string;
  };

  // ---- c1

  test("c1: a kind registered in this file alone gets list, read, history, edit, propose, review and decide, over MCP and HTTP", async () => {
    const G = crypto.randomUUID();
    expect(await seedDoc(db, "gadget", { id: G, json: { schema: "gadget/1", label: "A gadget", cogs: 3, note: "Turns." }, note: "the first gadget" })).toBe(true);
    expect(await seedDoc(db, "gadget", { id: G, json: { schema: "gadget/1", label: "Again", cogs: 1 }, note: "x" })).toBe(false);

    // listed, by its kind; read at Main's newest version
    const tools = (await (await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }))).json()).result.tools;
    expect(tools.find((t: any) => t.name === "list_docs").inputSchema.properties.kind.enum).toContain("gadget");
    expect(await tool("list_docs", { kind: "gadget" })).toEqual([expect.objectContaining({ id: G, kind: "gadget", label: "A gadget", number: 1, versions: 1, cogs: 3 })]);
    expect((await call("ada", "GET", "/api/docs?kind=gadget")).data).toEqual([expect.objectContaining({ id: G, kind: "gadget" })]);
    expect((await call("cit", "GET", "/api/docs?kind=gadget")).status).toBe(403);
    expect((await call(null, "GET", `/api/docs/${G}`)).status).toBe(401);
    expect(await tool("doc_at", { doc: G })).toMatchObject({ id: G, kind: "gadget", number: 1, version: 1, json: { label: "A gadget", cogs: 3 } });

    // no edit without an intent: refused, nothing kept; an intent still in Idea takes none either
    expect((await tool("doc_edit", { doc: G, message: "no intent", edits: [{ op: "set", path: ["cogs"], value: 4 }] })).error).toContain("intent");
    const idea = await tool("add_intent", { title: "A teal gadget" });
    expect((await tool("doc_edit", { doc: G, intent: idea.id, message: "too early", edits: [{ op: "set", path: ["cogs"], value: 4 }] })).error).toContain("idea stage");
    expect((await tool("doc_history", { doc: G })).variants).toHaveLength(1);
    const ready = await readyIntent("A teal gadget, specified");
    // edited twice in an intent variant, each edit checked whole; a broken edit refused and kept nowhere
    const one = await tool("doc_edit", { doc: G, intent: ready, message: "more cogs", edits: [{ op: "set", path: ["cogs"], value: 5 }] });
    expect(one).toMatchObject({ doc: G, kind: "gadget", changed: true, edits: 1, changes: 1 });
    expect((await tool("doc_edit", { doc: G, intent: ready, variant: one.variant, message: "unlucky", edits: [{ op: "set", path: ["cogs"], value: 13 }] })).error).toContain("13 cogs");
    const two = await tool("doc_edit", { doc: G, intent: ready, message: "a colour", edits: [{ op: "set", path: ["colour"], value: "teal" }] });
    expect(two).toMatchObject({ variant: one.variant, edits: 2, changes: 2 });

    // its history: Main's edits and versions, Main and the open intent variant, seeded from v1; one variant's own edits
    const h = await tool("doc_history", { doc: G });
    expect(h.edits.map((e: any) => e.message)).toEqual(["v1: the first gadget"]);
    expect(h.variants).toEqual([
      expect.objectContaining({ type: "main", status: "open" }),
      expect.objectContaining({ id: one.variant, type: "intent", status: "open", seed: 1, edits: 2, intent: expect.objectContaining({ id: ready }) }),
    ]);
    const own = await tool("doc_history", { doc: G, variant: one.variant });
    expect(own.edits.map((e: any) => e.message)).toEqual(["more cogs", "a colour"]);
    // read at an edit, over MCP and HTTP; what an edit changes
    expect((await tool("doc_at", { doc: G, edit: own.edits[0].seq })).json).toMatchObject({ cogs: 5 });
    expect((await tool("doc_at", { doc: G, edit: own.edits[0].seq })).json.colour).toBeUndefined();
    expect((await call("ada", "GET", `/api/docs/${G}?edit=${own.edits[1].seq}`)).data.json).toMatchObject({ cogs: 5, colour: "teal" });
    expect((await call("ada", "GET", `/api/docs/${G}/changes?edit=${own.edits[1].seq}`)).data.changes).toEqual([{ path: "$.colour", kind: "added", to: "teal" }]);
    const changed = (await call("ada", "GET", `/api/docs/${G}/changes?variant=${one.variant}`)).data;
    expect(changed).toMatchObject({ seed: 1, variant: one.variant });
    expect(changed.changes).toEqual(expect.arrayContaining([{ path: "$.cogs", kind: "changed", from: 3, to: 5 }, { path: "$.colour", kind: "added", to: "teal" }]));
    expect(changed.edits.map((e: any) => e.message)).toEqual(["more cogs", "a colour"]);
    expect((await call("ada", "GET", `/api/docs/${G}/history?variant=${one.variant}`)).data.edits).toHaveLength(2);

    // proposed for an intent: refused for one not ready, and for any but the one it was made for; then the intent at Proposal with the work
    expect((await tool("propose_doc_version", { doc: G, variant: one.variant, note: "teal", intent: idea.id })).error).toBeTruthy();
    expect((await tool("propose_doc_version", { doc: G, variant: one.variant, note: "teal" })).error).toContain("add_intent");
    const other = await readyIntent("Another gadget intent");
    expect((await tool("propose_doc_version", { doc: G, variant: one.variant, note: "teal", intent: other })).error).toContain(ready);
    const p = await tool("propose_doc_version", { doc: G, variant: one.variant, note: "five teal cogs", intent: ready });
    expect(p).toMatchObject({ intent: ready, stage: "proposal", doc: G, kind: "gadget", number: 2, variant: one.variant, edits: 2, changes: 2 });
    expect((await tool("doc_edit", { doc: G, intent: ready, variant: one.variant, message: "late", edits: [{ op: "set", path: ["cogs"], value: 6 }] })).error).toContain("proposed already");
    // the board: its work named by its document and variant, reviewed field by field with its edits
    const listed = (await call("ada", "GET", "/api/intents?stage=proposal")).data.find((x: any) => x.id === ready);
    expect(listed.work).toMatchObject({ kind: "gadget_version", doc: G, doc_id: `gadget:${G}`, doc_variant: one.variant, grp: "gadgets", label: "A gadget", number: 2 });
    const review = (await call("ada", "GET", `/api/intents/${ready}`)).data.review;
    expect(review).toMatchObject({ doc: { id: G, kind: "gadget", label: "A gadget" }, seedNumber: 1, moved: false });
    expect(review.changes.map((c: any) => c.path).sort()).toEqual(["$.cogs", "$.colour"]);
    expect(review.edits.map((e: any) => e.message)).toEqual(["more cogs", "a colour"]);
    // read as the intent's variant would make it, Main as it was
    expect((await tool("doc_at", { doc: G, intent: ready })).json).toMatchObject({ cogs: 5, colour: "teal" });
    expect((await call("ada", "GET", `/api/docs/${G}?intent=${ready}`)).data.intent).toMatchObject({ id: ready, stage: "proposal", variant: one.variant });
    expect((await tool("doc_at", { doc: G })).json.cogs).toBe(3);
    expect((await tool("doc_history", { doc: G })).variants.find((v: any) => v.id === one.variant)).toMatchObject({ status: "proposed", intent: { id: ready, stage: "proposal" } });

    // accepted: Main's v2, its row's label kept; v1 still read
    expect((await call("ada", "POST", `/api/intents/${ready}/accept`)).data).toMatchObject({ stage: "accepted", decision: { status: "accepted", number: 2 } });
    expect(await tool("doc_at", { doc: G })).toMatchObject({ number: 2, version: 2, json: { cogs: 5, colour: "teal" } });
    expect((await tool("doc_at", { doc: G, version: 1 })).json).toEqual({ schema: "gadget/1", label: "A gadget", cogs: 3, note: "Turns." });
    const after = await tool("doc_history", { doc: G });
    expect(after.edits.at(-1)).toMatchObject({ kind: "merge", version: 2 });
    expect(after.edits.map((e: any) => e.message)).toEqual(expect.arrayContaining(["more cogs", "a colour"]));

    // proposed at once without an intent: refused, nothing kept (no work without an intent)
    const variantsBefore = (await tool("doc_history", { doc: G })).variants.length;
    expect((await tool("propose_doc_version", { doc: G, note: "a new name", edits: [{ op: "set", path: ["label"], value: "The gadget" }] })).error).toContain("add_intent");
    expect((await tool("doc_history", { doc: G })).variants).toHaveLength(variantsBefore);
    // proposed at once for an intent; archived, Main stays
    const q = await tool("propose_doc_version", { doc: G, note: "a new name", edits: [{ op: "set", path: ["label"], value: "The gadget" }], intent: await readyIntent("A new name") });
    expect(q).toMatchObject({ stage: "proposal", number: 3, edits: 1 });
    expect((await call("ada", "GET", `/api/intents/${q.intent}`)).data).toMatchObject({ title: "A new name", work: { kind: "gadget_version" } });
    expect((await call("ada", "POST", `/api/intents/${q.intent}/archive`)).data.decision.status).toBe("archived");
    expect((await tool("doc_at", { doc: G })).json.label).toBe("A gadget");
    expect((await tool("doc_history", { doc: G })).variants.find((v: any) => v.intent?.id === q.intent)).toMatchObject({ status: "archived" });
    // accepted, its row keeps the version's label
    const r = await tool("propose_doc_version", { doc: G, note: "a new name, again", whole: { label: "The gadget", cogs: 5, colour: "teal", note: "Turns." }, intent: await readyIntent("A new name, again") });
    expect((await call("ada", "POST", `/api/intents/${r.intent}/accept`)).data.decision).toMatchObject({ status: "accepted", number: 3 });
    expect((await db.query<any>(`SELECT label FROM play.gadgets WHERE id = $1`, [G])).rows[0].label).toBe("The gadget");
    // nothing changed is no proposal; a document by anything but its UUID is none
    expect((await tool("propose_doc_version", { doc: G, note: "same", edits: [{ op: "set", path: ["cogs"], value: 5 }], intent: await readyIntent("Nothing") })).error).toContain("nothing changed");
    expect((await tool("doc_at", { doc: "A gadget" })).error).toContain("UUID");
    expect((await call("ada", "GET", `/api/docs/${crypto.randomUUID()}`)).status).toBe(404);
  });

  // ---- c2

  type Kind = {
    kind: string;
    id: () => Promise<string>;
    first: unknown[];
    second: unknown[];
    clash: (value: string) => unknown[];
    /** what Main holds once the first two edits are in */
    holds: (json: any) => void;
    /** its frozen rows, where it keeps them */
    frozen?: (id: string, number: number) => Promise<void>;
    /** its own read of an intent's variant */
    read?: (id: string, intent: string) => Promise<void>;
  };

  const KINDS: Kind[] = [
    {
      kind: "asset",
      id: async () => {
        const made = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Round fern", source: SOURCE("a round fern"), note: "its first version", intent: await readyIntent("A round fern") });
        await call("ada", "POST", `/api/intents/${made.intent}/accept`);
        return made.asset;
      },
      first: [{ op: "replace", find: "a round fern", replace: "a rounder fern" }],
      second: [{ op: "set", path: ["note"], value: "rounder" }],
      clash: (v) => [{ op: "replace", find: "// a rounder fern", replace: `// ${v}` }],
      holds: (j) => expect(j.source).toContain("a rounder fern"),
      frozen: async (id, number) => {
        const { rows } = await db.query<any>(`SELECT a.head, v.number, v.source_hash FROM play.assets a JOIN play.asset_versions v ON v.id = a.head WHERE a.id = $1`, [id]);
        expect(rows[0].number).toBe(number);
      },
      read: async (id, intent) => expect((await tool("get_asset", { asset: id, intent })).source).toContain("a rounder fern"),
    },
    {
      kind: "story",
      id: async () => {
        const body = { format: "9:16", fps: 30, tracks: [{ id: "voice", kind: "voice", clips: [{ id: "v1", at: 0, duration: 4, who: "MAIA", line: "One." }, { id: "v2", at: 4, duration: 3, who: "MAIA", line: "Two." }] }] };
        const made = await tool("propose_story", { title: "A round film", body, note: "its first version", intent: await readyIntent("A round film") });
        await call("ada", "POST", `/api/intents/${made.intent}/accept`);
        return made.story;
      },
      first: [{ op: "set_clip", track: "voice", clip: "v1", fields: { line: "One, again." } }],
      second: [{ op: "set", fields: { fps: 25 } }],
      clash: (v) => [{ op: "set_clip", track: "voice", clip: "v2", fields: { line: v } }],
      holds: (j) => expect(j).toMatchObject({ fps: 25, tracks: [{ clips: [{ line: "One, again." }, {}] }] }),
      frozen: async (id, number) => {
        const { rows } = await db.query<any>(`SELECT v.number, v.body FROM play.stories s JOIN play.story_versions v ON v.id = s.head WHERE s.id = $1`, [id]);
        expect(rows[0].number).toBe(number);
        expect(rows[0].body.fps).toBe(25);
      },
      read: async (id, intent) => expect((await tool("get_story", { story: id, intent })).tracks[0].clips[0].line).toBe("One, again."),
    },
    {
      kind: "factory",
      id: async () => {
        const id = crypto.randomUUID();
        const line = { product: { name: "a cog" }, demand: { perDay: 10 }, calendar: {}, stations: [{ id: "cut", name: "Cut", machine: "laser" }, { id: "weld", name: "Weld", machine: "robot", after: ["cut"] }] };
        await seedDoc(db, "factory", { id, json: { schema: "factory/1", label: "A round line", line, parts: [{ id: "plate", label: "Plate", qty: 1, ops: [{ at: "cut", s: 30 }] }] }, note: "its first version" });
        return id;
      },
      first: [{ op: "set", path: ["line", "demand", "perDay"], value: 20 }],
      second: [{ op: "set", path: ["line", "stations", { id: "weld" }, "buffer"], value: 4 }],
      clash: (v) => [{ op: "set", path: ["line", "stations", { id: "cut" }, "name"], value: v }],
      holds: (j) => expect(j.line).toMatchObject({ demand: { perDay: 20 }, stations: [{}, { buffer: 4 }] }),
    },
    {
      kind: "game_config",
      id: async () => {
        const id = crypto.randomUUID();
        const json = { schema: "levels/1", label: "Round levels", villager: { euros: 100, hearts: 10 }, minds: { heartsPerMind: 10, step: 1, heartsPerEuro: 4 }, levels: [{ id: "l1", villagers: 1, phase: "tents", investor: 0, unlocks: [{ label: "A tent", cost: 1000 }] }, { id: "l2", villagers: 2, phase: "tents", investor: 1, unlocks: [] }] };
        await seedDoc(db, "game_config", { id, json, note: "its first version" });
        return id;
      },
      first: [{ op: "set", path: ["villager", "euros"], value: 150 }],
      second: [{ op: "set", path: ["levels", { id: "l2" }, "phase"], value: "containers" }],
      clash: (v) => [{ op: "set", path: ["levels", { id: "l1" }, "phase"], value: v }],
      holds: (j) => expect(j).toMatchObject({ villager: { euros: 150 }, levels: [{}, { phase: "containers" }] }),
    },
    {
      kind: "skill",
      id: async () => {
        const id = crypto.randomUUID();
        await seedDoc(db, "skill", { id, json: { schema: "skill/1", label: "A round skill", group: "tests", system: "Say it once." }, note: "its first version" });
        return id;
      },
      first: [{ op: "text", path: ["system"], index: 0, insert: "Always: " }],
      second: [{ op: "set", path: ["note"], value: "taught to test" }],
      clash: (v) => [{ op: "set", path: ["group"], value: v }],
      holds: (j) => expect(j).toMatchObject({ system: "Always: Say it once.", note: "taught to test" }),
    },
  ];

  for (const k of KINDS)
    test(`c2: ${k.kind}: edited twice in an intent variant, proposed, reviewed, accepted as Main's next version, archived, a clash on a moved seed archived`, async () => {
      const id = await k.id();
      const at = await tool("doc_at", { doc: id });
      expect(at).toMatchObject({ id, kind: k.kind });
      const was = at.number;

      // two edits on one intent variant, for its intent, Main as it was
      const intent = await readyIntent(`A ${k.kind} round trip`);
      const one = await tool("doc_edit", { doc: id, intent, message: `${k.kind}: the first edit`, edits: k.first });
      expect(one).toMatchObject({ doc: id, kind: k.kind, changed: true, edits: 1 });
      const two = await tool("doc_edit", { doc: id, intent, variant: one.variant, message: `${k.kind}: the second edit`, edits: k.second });
      expect(two).toMatchObject({ variant: one.variant, edits: 2 });
      expect((await tool("doc_at", { doc: id })).json).toEqual(at.json);

      // proposed for its intent, reviewed field by field with its edits, read as the intent's variant would make it
      const p = await tool("propose_doc_version", { doc: id, variant: one.variant, note: `${k.kind}: two edits`, intent });
      expect(p).toMatchObject({ intent, stage: "proposal", doc: id, kind: k.kind, variant: one.variant, edits: k.kind === "asset" ? 3 : 2 });
      const review = (await call("ada", "GET", `/api/intents/${intent}`)).data.review;
      expect(review).toMatchObject({ doc: { id, kind: k.kind }, seedNumber: was, moved: false });
      expect(review.changes.length).toBeGreaterThanOrEqual(2);
      expect(review.edits.map((e: any) => e.message).slice(0, 2)).toEqual([`${k.kind}: the first edit`, `${k.kind}: the second edit`]);
      k.holds((await tool("doc_at", { doc: id, intent })).json);
      await k.read?.(id, intent);

      // accepted: Main's next version, its frozen rows written where it keeps them
      expect((await call("ada", "POST", `/api/intents/${intent}/accept`)).data).toMatchObject({ stage: "accepted", decision: { status: "accepted", number: was + 1 } });
      const now = await tool("doc_at", { doc: id });
      expect(now).toMatchObject({ number: was + 1, version: was + 1 });
      k.holds(now.json);
      await k.frozen?.(id, was + 1);
      expect((await tool("doc_history", { doc: id })).variants.find((v: any) => v.id === one.variant)).toMatchObject({ status: "accepted", intent: { id: intent, stage: "accepted" } });

      // archived: Main stays, the variant closed and kept
      const gone = await tool("propose_doc_version", { doc: id, note: `${k.kind}: not this`, edits: k.clash("not this"), intent: await readyIntent(`${k.kind}: not this`) });
      expect(gone.error).toBeUndefined();
      expect((await call("ada", "POST", `/api/intents/${gone.intent}/archive`)).data).toMatchObject({ stage: "archived", decision: { status: "archived" } });
      expect((await tool("doc_at", { doc: id })).json).toEqual(now.json);
      expect((await tool("doc_history", { doc: id, variant: gone.variant })).edits.length).toBeGreaterThanOrEqual(1);

      // two seeded from the same version that touch the same field: the first in, the second archived when its seed moved
      const a = await tool("propose_doc_version", { doc: id, note: `${k.kind}: A`, edits: k.clash("A"), intent: await readyIntent(`${k.kind}: A`) });
      const b = await tool("propose_doc_version", { doc: id, note: `${k.kind}: B`, edits: k.clash("B"), intent: await readyIntent(`${k.kind}: B`) });
      expect((await call("ada", "POST", `/api/intents/${a.intent}/accept`)).data.decision).toMatchObject({ status: "accepted", number: was + 2 });
      if (k.kind === "asset") {
        // an asset's work goes in only on the head it was made on: the other work on that head is archived at once, its
        // intent (specified, as every intent with work is) back in Build
        expect((await call("ada", "GET", `/api/intents/${b.intent}`)).data).toMatchObject({ stage: "build", review: { status: "archived" } });
      } else {
        expect((await call("ada", "GET", `/api/intents/${b.intent}`)).data.review.moved).toBe(true);
        const late = (await call("ada", "POST", `/api/intents/${b.intent}/accept`)).data;
        expect(late.stage).toBe("build");
        expect(late.decision.status).toBe("archived");
        expect(late.message).toContain("newer version");
      }
      expect((await tool("doc_at", { doc: id })).number).toBe(was + 2);
    });

  // ---- intent 847c5d38's c4: one intent, several documents

  test("several documents: an intent holding variants of two is reviewed with both, accepted in one transaction, refused whole when one is invalid or clashes, archived whole", async () => {
    const A = crypto.randomUUID(), B = crypto.randomUUID();
    await seedDoc(db, "gadget", { id: A, json: { schema: "gadget/1", label: "Gadget A", cogs: 1 }, note: "A" });
    await seedDoc(db, "gadget", { id: B, json: { schema: "gadget/1", label: "Gadget B", cogs: 1 }, note: "B" });
    const number = async (id: string) => (await tool("doc_at", { doc: id })).number;
    const variantOf = async (id: string, v: number) => (await tool("doc_history", { doc: id })).variants.find((x: any) => x.id === v);

    // both edited for one intent and proposed naming it: one intent at Proposal holding both
    const both = await readyIntent("Two gadgets, one change");
    const ea = await tool("doc_edit", { doc: A, intent: both, message: "A: more cogs", edits: [{ op: "set", path: ["cogs"], value: 2 }] });
    const eb = await tool("doc_edit", { doc: B, intent: both, message: "B: more cogs", edits: [{ op: "set", path: ["cogs"], value: 3 }] });
    expect((await tool("propose_doc_version", { doc: A, variant: ea.variant, note: "A's cogs", intent: both })).intent).toBe(both);
    expect((await tool("propose_doc_version", { doc: B, variant: eb.variant, note: "B's cogs", intent: both })).intent).toBe(both);
    const listed = (await call("ada", "GET", "/api/intents?stage=proposal")).data.find((x: any) => x.id === both);
    expect(listed.work).toMatchObject({ kind: "gadget_version", doc: A, docs: 2 });
    const review = (await call("ada", "GET", `/api/intents/${both}`)).data.review;
    expect(review.docs.map((d: any) => [d.doc.id, d.variant, d.changes.map((c: any) => c.to)])).toEqual([[A, ea.variant, [2]], [B, eb.variant, [3]]]);
    // Main of neither moved before the Accept; then both in one decision
    expect([await number(A), await number(B)]).toEqual([1, 1]);
    const ok = (await call("ada", "POST", `/api/intents/${both}/accept`)).data;
    expect(ok).toMatchObject({ stage: "accepted", decision: { status: "accepted", numbers: [2, 2] } });
    expect([(await tool("doc_at", { doc: A })).json.cogs, (await tool("doc_at", { doc: B })).json.cogs]).toEqual([2, 3]);

    // a clash on one: neither goes in, the intent archived whole (back to Build, its spec approved), both variants closed
    const clash = await readyIntent("Two gadgets, one clashing");
    const ca = await tool("propose_doc_version", { doc: A, note: "A: a colour", edits: [{ op: "set", path: ["colour"], value: "blue" }], intent: clash });
    const cb = await tool("propose_doc_version", { doc: B, note: "B: more cogs", edits: [{ op: "set", path: ["cogs"], value: 7 }], intent: clash });
    const first = await tool("propose_doc_version", { doc: B, note: "B: fewer cogs", edits: [{ op: "set", path: ["cogs"], value: 1 }], intent: await readyIntent("B: fewer cogs") });
    expect((await call("ada", "POST", `/api/intents/${first.intent}/accept`)).data.decision.status).toBe("accepted");
    const refused = (await call("ada", "POST", `/api/intents/${clash}/accept`)).data;
    expect(refused.decision.status).toBe("archived");
    expect(refused.message).toContain("nothing of this intent went in");
    expect(refused.stage).toBe("build");
    expect([await number(A), (await tool("doc_at", { doc: A })).json.colour, (await tool("doc_at", { doc: B })).json.cogs]).toEqual([2, undefined, 1]);
    expect([(await variantOf(A, ca.variant)).status, (await variantOf(B, cb.variant)).status]).toEqual(["archived", "archived"]);

    // invalid once merged on one: neither goes in
    const bad = await readyIntent("Two gadgets, one invalid");
    await tool("propose_doc_version", { doc: A, note: "A: a name", edits: [{ op: "set", path: ["label"], value: "red" }], intent: bad });
    await tool("propose_doc_version", { doc: B, note: "B: red", edits: [{ op: "set", path: ["colour"], value: "red" }], intent: bad });
    const named = await tool("propose_doc_version", { doc: B, note: "B: named red", edits: [{ op: "set", path: ["label"], value: "red" }], intent: await readyIntent("B: named red") });
    expect((await call("ada", "POST", `/api/intents/${named.intent}/accept`)).data.decision.status).toBe("accepted");
    const invalid = (await call("ada", "POST", `/api/intents/${bad}/accept`)).data;
    expect(invalid.decision.status).toBe("archived");
    expect(invalid.message).toContain("never named its colour");
    expect((await tool("doc_at", { doc: A })).json.label).toBe("Gadget A");

    // archived whole by an admin: both variants closed, Main as it was
    const gone = await readyIntent("Two gadgets, archived");
    const ga = await tool("propose_doc_version", { doc: A, note: "A: teal", edits: [{ op: "set", path: ["colour"], value: "teal" }], intent: gone });
    const gb = await tool("propose_doc_version", { doc: B, note: "B: teal", edits: [{ op: "set", path: ["colour"], value: "teal" }], intent: gone });
    expect((await call("ada", "POST", `/api/intents/${gone}/archive`)).data.decision.status).toBe("archived");
    expect([(await variantOf(A, ga.variant)).status, (await variantOf(B, gb.variant)).status]).toEqual(["archived", "archived"]);
    expect([await number(A), await number(B)]).toEqual([2, 4]);
  });
  // ---- intent 484aae5f: an intent variant's status is the variant's own

  test("doc_at intent gives the variant its own status", async () => {
    const D = crypto.randomUUID();
    await seedDoc(db, "gadget", { id: D, json: { schema: "gadget/1", label: "Gadget S", cogs: 1 }, note: "S" });
    const both = async (intent: string, variant: number) => {
      const mcp = (await tool("doc_at", { doc: D, intent })).intent;
      const http = (await call("ada", "GET", `/api/docs/${D}?intent=${intent}`)).data.intent;
      const hist = (await tool("doc_history", { doc: D })).variants.find((v: any) => v.id === variant).status;
      expect(mcp.status).toBe(hist);
      expect(http.status).toBe(hist);
      return { stage: mcp.stage as string, status: mcp.status as string };
    };

    // an intent in Build, its variant being edited: open, not "archived"
    const i = (await tool("add_intent", { title: "A variant's own status" })).id as string;
    await tool("specify_intent", { intent: i, ...SPEC });
    expect((await call("ada", "POST", `/api/intents/${i}/approve`)).data.stage).toBe("build");
    const e = await tool("doc_edit", { doc: D, intent: i, message: "more cogs", edits: [{ op: "set", path: ["cogs"], value: 2 }] });
    expect(await both(i, e.variant)).toEqual({ stage: "build", status: "open" });
    // proposed at Proposal, then accepted
    expect((await tool("check_intent", { intent: i, results: [{ check: "c1", pass: true, evidence: "exit 0" }] })).stage).toBe("proposal");
    expect((await tool("propose_doc_version", { doc: D, variant: e.variant, note: "two cogs", intent: i })).stage).toBe("proposal");
    expect(await both(i, e.variant)).toEqual({ stage: "proposal", status: "proposed" });
    expect((await call("ada", "POST", `/api/intents/${i}/accept`)).data.stage).toBe("accepted");
    expect(await both(i, e.variant)).toEqual({ stage: "accepted", status: "accepted" });

    // another, archived: archived
    const gone = await readyIntent("A variant archived");
    const g = await tool("propose_doc_version", { doc: D, note: "teal", edits: [{ op: "set", path: ["colour"], value: "teal" }], intent: gone });
    expect((await call("ada", "POST", `/api/intents/${gone}/archive`)).data.decision.status).toBe("archived");
    expect((await both(gone, g.variant)).status).toBe("archived");
  });
});
