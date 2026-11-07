// No write past an Accept (intent 847c5d38, play/SPEC.md "Version control") against a real Postgres: set
// TEST_DATABASE_URL, as for ./api.test.ts.
//
// Every MCP tool that is not a read (tools/list, enumerated) and every HTTP route that writes (app.ts, enumerated) is
// called here with work it takes, and every document's Main is found unchanged after each call: what they propose waits
// at Proposal. Then each intent the calls put there is accepted, and only that Accept moves Main, only of the documents
// that intent holds. doc_edit without an intent is refused. A tool or a route added later fails this test until it is
// called here too.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import * as docs from "../src/docs";
import { Rate } from "../src/limits";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { seedDoc } from "../src/versioned";
import { RULE, SCHEMA } from "../src/ids";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

/** the tools that only read: everything else tools/list holds is called below */
const READS = ["list_assets", "get_asset", "get_file", "list_docs", "doc_at", "doc_history", "doc_changes", "list_sandboxes", "get_sandbox", "list_stories", "get_story", "list_intents", "get_intent", "list_artifacts", "get_artifact", "list_authors", "get_author"];

const SOURCE = (line: string) => `module.exports.recipe = function (id, v) {\n  // ${line}\n  return { meta: { id, v }, build: () => null };\n};\n`;
const SPEC = {
  goal: "Nothing passes the Accept.",
  nothing_to_reduce: "A test fixture: nothing to reduce.",
  scope: "Every write path.",
  checks: [{ check: "It holds", how: "test", by: "true", run: "true" }],
};
const words = (k: number, w: string) => Array.from({ length: k }, () => w).join(" ");
const SUMMARY = `## What it is\n\n${words(200, "artifact")}\n\n## Key points\n\n${Array.from({ length: 20 }, () => `- ${words(10, "point")}`).join("\n")}\n\n## The topic\n\n${words(193, "topic")}`;
const ARTIFACT = (url: string) => ({ url, title: "A page that waits", description: "A page kept only once it is accepted.", summary: SUMMARY, authors: [{ name: "Ann Author", kind: "person" }], kind: "page", origin: "human" });
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

suite("no write past an Accept", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  const who: Record<string, { id: string; cookie: string }> = {};
  let token = "";
  let n = 0;

  beforeAll(async () => {
    name = `play_nobypass_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    await initSessions(db);
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0) });
    for (const h of ["ada", "cit"]) {
      const made = await createHuman(db, h);
      who[h] = { id: made.id, cookie: `play_session=${tokenFor(made.id)}` };
    }
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [who.ada.id]);
    await db.query(`UPDATE play.memberships SET level = 'citizen' WHERE human_id = $1`, [who.cit.id]);
    token = (await call("ada", "POST", "/api/tokens", { name: "agent" })).data.token;
  });
  afterAll(async () => {
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
  const rpc = async (method: string, params?: unknown) =>
    (await (await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) }))).json()).result;
  const tool = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const res = await rpc("tools/call", { name, arguments: args });
    const text = res.content[0].text;
    return res.isError ? { error: text as string } : JSON.parse(text);
  };
  const readyIntent = async (title: string) => {
    const i = await tool("add_intent", { title });
    await tool("specify_intent", { intent: i.id, ...SPEC });
    await call("ada", "POST", `/api/intents/${i.id}/approve`);
    await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] });
    return i.id as string;
  };
  /** every document's Main: its JSON and how many versions it has named */
  const mains = async () => {
    const out = new Map<string, string>();
    for (const r of (await db.query<{ id: string }>(`SELECT id FROM play.docs ORDER BY id`)).rows) {
      const d = await docs.readDoc(db, r.id);
      out.set(r.id, JSON.stringify([d.versions.length, d.json]));
    }
    return out;
  };
  /** the documents whose Main moved since `was` (a document new since then with no version yet has not) */
  const moved = (was: Map<string, string>, now: Map<string, string>) =>
    [...now].filter(([id, m]) => (was.has(id) ? was.get(id) !== m : JSON.parse(m)[0] > 0)).map(([id]) => id).sort();

  test("every write tool and route leaves every Main as it was; only an intent's Accept moves Main, of the documents it holds", async () => {
    // a document of every kind, each with its v1
    const F = crypto.randomUUID(), L = crypto.randomUUID(), K = crypto.randomUUID();
    const line = { product: { name: "a cog" }, demand: { perDay: 10 }, calendar: {}, stations: [{ id: "cut", name: "Cut", machine: "laser" }] };
    await seedDoc(db, "factory", { id: F, json: { schema: "factory/1", label: "A line", line, parts: [] }, note: "v1" });
    await seedDoc(db, "game_config", { id: L, json: { schema: "levels/1", label: "Levels", villager: { euros: 1, hearts: 1 }, minds: { heartsPerMind: 1, step: 1, heartsPerEuro: 1 }, levels: [{ id: "l1", villagers: 1, phase: "tents", investor: 0, unlocks: [] }] }, note: "v1" });
    await seedDoc(db, "skill", { id: K, json: { schema: "skill/1", label: "A skill", group: "tests", system: "Say it." }, note: "v1" });
    const asset = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "A fern", source: SOURCE("a fern"), note: "v1", intent: await readyIntent("A fern") });
    await call("ada", "POST", `/api/intents/${asset.intent}/accept`);
    const body = { format: "9:16", fps: 30, tracks: [{ id: "voice", kind: "voice", clips: [{ id: "v1", at: 0, duration: 4, who: "MAIA", line: "One." }] }] };
    const story = await tool("propose_story", { title: "A film", body, note: "v1", intent: await readyIntent("A film") });
    await call("ada", "POST", `/api/intents/${story.intent}/accept`);
    const art = await tool("add_artifact", { ...ARTIFACT("https://nobypass.example/kept"), intent: await readyIntent("A page kept") });
    await call("ada", "POST", `/api/intents/${art.intent}/accept`);
    const ready = await readyIntent("Every edit an intent's");
    const own = await tool("propose_doc_version", { doc: K, note: "to be archived", edits: [{ op: "set", path: ["note"], value: "x" }], intent: await readyIntent("To be archived") });
    const fresh = (await tool("add_intent", { title: "Specified here" })).id;
    const checked = (await tool("add_intent", { title: "Checked here" })).id;
    await tool("specify_intent", { intent: checked, ...SPEC });
    await call("ada", "POST", `/api/intents/${checked}/approve`);
    // no work without an intent: each call below that brings work names one ready for it
    const forWork: Record<string, string> = {};
    for (const k of ["propose_asset", "propose_doc_version", "propose_story", "add_artifact", "update_artifact", "page", "board"]) forWork[k] = await readyIntent(`Work of ${k}`);
    let S0 = await mains();
    expect([...S0.keys()].filter((id) => !id.startsWith("schema:") && !id.startsWith("rules:")).length).toBe(6);

    // every tool that is not a read, called with work it takes
    const CALLS: Record<string, Record<string, unknown>> = {
      propose_asset: { lod: { levels: "derived" }, group: "plants", label: "A second fern", source: SOURCE("a second fern"), note: "a new asset", intent: forWork.propose_asset },
      doc_edit: { doc: F, intent: ready, message: "more demand", edits: [{ op: "set", path: ["line", "demand", "perDay"], value: 12 }] },
      propose_doc_version: { doc: L, note: "more euros", edits: [{ op: "set", path: ["villager", "euros"], value: 2 }], intent: forWork.propose_doc_version },
      propose_story: { title: "A second film", body, note: "a new story", intent: forWork.propose_story },
      add_story_frame: { data: PNG, media_type: "image/png", label: "a pixel" },
      add_story_video: { data: Buffer.from("not a video").toString("base64"), media_type: "video/mp4" },
      add_story_audio: { data: Buffer.from("not a recording").toString("base64"), media_type: "audio/mpeg" },
      add_document: { text: "# A data sheet\n\nIts numbers.", label: "a data sheet" },
      add_intent: { title: "Added here" },
      specify_intent: { intent: fresh, ...SPEC },
      check_intent: { intent: checked, results: [{ check: "c1", pass: true, evidence: "exit 0" }] },
      archive_intent: { intent: own.intent },
      depend_intent: { intent: fresh, on: checked },
      step_back_intent: { intent: checked, reason: "back to Specify, for a test" },
      // no tap for an artifact (intent de24f1c5): with no intent named, each makes its own, which the first rule accepts
      add_artifact: { ...ARTIFACT("https://nobypass.example/new") },
      update_artifact: { artifact: art.id, title: "A page, corrected" },
    };
    const names: string[] = (await rpc("tools/list")).tools.map((t: any) => t.name);
    expect(names.filter((x) => !READS.includes(x)).sort()).toEqual(Object.keys(CALLS).sort());
    const waiting: string[] = [];
    for (const [name, args] of Object.entries(CALLS)) {
      const r = await tool(name, args);
      if (name === "add_artifact" || name === "update_artifact") {
        // Main written only by its own intent's Accept, by the first rule
        const i = await tool("get_intent", { intent: r.intent });
        expect([name, i.stage, i.auto?.accept?.rule, i.decided_by, i.work_kind]).toEqual([name, "accepted", RULE.artifacts, null, [SCHEMA.artifact]]);
        expect([name, moved(S0, await mains())]).toEqual([name, [`artifact:${r.id}`]]);
        S0 = await mains();
        continue;
      }
      expect([name, moved(S0, await mains())]).toEqual([name, []]);
      if (r?.intent && r.stage === "proposal") waiting.push(r.intent);
    }
    // doc_edit without an intent: refused, and nothing kept
    const edits = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM play.doc_edits`)).rows[0].n);
    expect((await tool("doc_edit", { doc: F, message: "no intent", edits: [{ op: "set", path: ["label"], value: "x" }] })).error).toContain("intent");
    expect(Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM play.doc_edits`)).rows[0].n)).toBe(edits);
    // the variant doc_edit made, proposed for its intent: still Main as it was
    const v = (await tool("doc_history", { doc: F })).variants.find((x: any) => x.intent?.id === ready).id;
    await tool("propose_doc_version", { doc: F, variant: v, note: "more demand", intent: ready });
    waiting.push(ready);
    expect(moved(S0, await mains())).toEqual([]);

    // every route that writes (app.ts), called; the intents' verdicts but Accept move nothing either
    const ROUTES: Record<string, () => Promise<unknown>> = {
      "POST /api/passkey/register/options": () => call(null, "POST", "/api/passkey/register/options", { name: "eve" }),
      "POST /api/passkey/register/finish": () => call(null, "POST", "/api/passkey/register/finish", {}),
      "POST /api/passkey/login/options": () => call(null, "POST", "/api/passkey/login/options", {}),
      "POST /api/passkey/login/finish": () => call(null, "POST", "/api/passkey/login/finish", {}),
      "POST /api/signout": () => call("cit", "POST", "/api/signout"),
      "POST /api/intents": async () => {
        const r: any = await call("ada", "POST", "/api/intents", { asset: asset.asset, note: "from the page", source: SOURCE("a fern from the page"), intent: forWork.page });
        if (r.data?.intent) waiting.push(r.data.intent);
      },
      "POST /api/intents/:id/:verdict": async () => {
        for (const verdict of ["approve", "respecify", "reject", "reopen"]) await call("ada", "POST", `/api/intents/${fresh}/${verdict}`);
        const no = await tool("propose_doc_version", { doc: K, note: "archived on the board", edits: [{ op: "set", path: ["note"], value: "y" }], intent: forWork.board });
        await call("ada", "POST", `/api/intents/${no.intent}/archive`);
        await call("cit", "POST", `/api/intents/${waiting[0]}/accept`);
      },
      "POST /api/members/:id/level": () => call("ada", "POST", `/api/members/${who.cit.id}/level`, { level: "citizen" }),
      "POST /api/me/name": () => call("ada", "POST", "/api/me/name", { name: "Ada" }),
      "POST /api/members/:id/name": () => call("ada", "POST", `/api/members/${who.cit.id}/name`, { name: "Cit" }),
      "DELETE /api/members/:id": () => call("ada", "DELETE", `/api/members/${crypto.randomUUID()}`),
      "POST /api/invites": () => call("ada", "POST", "/api/invites"),
      "POST /api/tokens": () => call("ada", "POST", "/api/tokens", { name: "another" }),
      "DELETE /api/tokens/:id": () => call("ada", "DELETE", `/api/tokens/${crypto.randomUUID()}`),
      "POST /api/tokens/:id/avenbox": () => call("ada", "POST", `/api/tokens/${crypto.randomUUID()}/avenbox`, { avenbox: true }),
      "POST /api/mcp": () => rpc("tools/call", { name: "doc_edit", arguments: { doc: K, message: "no intent", edits: [{ op: "set", path: ["note"], value: "z" }] } }),
      "POST /api/library/:hash/label": async () => {
        const f = await tool("add_document", { text: "# Another sheet", label: "a sheet" });
        await call("ada", "POST", `/api/library/${f.hash}/label`, { label: "relabelled" });
      },
    };
    const routes = [...readFileSync(join(import.meta.dir, "../src/app.ts"), "utf8").matchAll(/on\("(POST|PUT|PATCH|DELETE)", "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(routes.sort()).toEqual(Object.keys(ROUTES).sort());
    for (const [route, run] of Object.entries(ROUTES)) {
      await run();
      expect([route, moved(S0, await mains())]).toEqual([route, []]);
    }

    // then each waiting intent accepted, one at a time: only its Accept moves Main, of the documents it holds
    // (the two artifacts accepted by the first rule above wait for no one)
    expect(waiting.length).toBeGreaterThanOrEqual(4);
    let was = await mains();
    for (const id of [...new Set(waiting)]) {
      const review = (await call("ada", "GET", `/api/intents/${id}`)).data.review;
      const held = (review?.docs ?? []).map((d: any) => `${d.doc.kind === "game_config" ? "game" : d.doc.kind}:${d.doc.id}`).sort();
      const d = (await call("ada", "POST", `/api/intents/${id}/accept`)).data;
      const now = await mains();
      if (d.decision?.status === "accepted") expect([id, moved(was, now)]).toEqual([id, held]);
      else expect([id, moved(was, now)]).toEqual([id, []]);
      was = now;
    }
    expect(moved(S0, was).length).toBeGreaterThanOrEqual(5);
  });
});
