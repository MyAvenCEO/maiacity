// Intents (src/intents.ts, play/SPEC.md §4.12) against a real Postgres: set TEST_DATABASE_URL, as for ./api.test.ts.
// Everything on the board is an intent, Idea → Specify → Build → Proposal → Accepted or Archived: added and specified
// over MCP only, its spec (a goal, a scope, checks: test, measure or look, must or nice) approved by an admin before it
// is built, its checks' results recorded while it is being built, and a proposal for it taken only once every must check
// passes. Every proposal is an intent's: one made without an intent gets one of its own, and the intent follows its
// proposals as they are decided.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import { migrate, MIGRATIONS } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { Rate } from "../src/limits";
import { UUID } from "../src/uuid";
import { placeholderIn } from "../src/intents";
import { seedSkills } from "../import/skills";
import { SANDBOX, SKILL } from "../src/ids";
import { seedDoc } from "../src/versioned";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

const SOURCE = "module.exports.recipe = function (id, v) {\n  return { meta: { id, v } };\n};\n";

suite("intents", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  const who: Record<string, { id: string; cookie: string }> = {};
  let token = "";
  let boxToken = "";

  beforeAll(async () => {
    name = `play_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    await initSessions(db);
    await seedSkills(db); // what the MCP teaches is the skills'
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0) });
    for (const n of ["ada", "bea", "cit"]) {
      const h = await createHuman(db, n);
      who[n] = { id: h.id, cookie: `play_session=${tokenFor(h.id)}` };
    }
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = ANY($1)`, [[who.ada.id, who.bea.id]]);
    await db.query(`UPDATE play.memberships SET level = 'citizen' WHERE human_id = $1`, [who.cit.id]);
    token = (await call("ada", "POST", "/api/tokens", { name: "agent" })).data.token;
    // avenBOX's token, the GitHub runs' (play/SPEC.md §4.12): what decides a code intent is recorded with it alone
    const box = (await call("ada", "POST", "/api/tokens", { name: "avenBOX" })).data;
    boxToken = box.token;
    await call("ada", "POST", `/api/tokens/${box.id}/avenbox`, { avenbox: true });
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
  let n = 0;
  const rpc = async (method: string, params?: unknown, bearer = token) => {
    const r = await api.fetch(
      new Request("http://play.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }),
      }),
    );
    return (await r.json()).result;
  };
  /** a tool called over MCP by ada's token: its result as JSON, or its error's text */
  const tool = async (name: string, args: Record<string, any>, bearer = token): Promise<any> => {
    // an asset's next version: its source edited on an intent variant and proposed (propose_doc_version)
    if (name === "propose_version") {
      // (the assets it is used on have no accepted version yet, so no card to carry their levels of detail on)
      const { asset, source, note, intent } = args;
      return tool("propose_doc_version", { doc: asset, note, edits: [{ op: "set", path: ["source"], value: source }, { op: "set", path: ["card"], value: { card: { lod: { levels: "derived" } } } }], ...(intent ? { intent } : {}) }, bearer);
    }
    const res = await rpc("tools/call", { name, arguments: args }, bearer);
    const text = res.content[0].text;
    return res.isError ? { error: text as string } : JSON.parse(text);
  };
  /** a tool called by avenBOX's token, as the GitHub runs call it */
  const box = (name: string, args: Record<string, unknown>) => tool(name, args, boxToken);

  /** an intent added, specified with three checks (two musts, one nice) and, where asked, approved */
  const SPEC = {
    goal: "A shade fern stands in the north beds.",
    nothing_to_reduce: "A test fixture: nothing to reduce.",
    scope: "A new plant asset (group plants). Nothing else changes.",
    checks: [
      { check: "The recipe builds in the asset box", how: "test", by: "render.mjs builds it", run: "cd play/site && bun scripts/render.mjs --group plants --label 'Shade fern'" },
      { check: "Its height is 0.4–0.6 m", how: "measure", by: "the asset box's measured size, y, 0.4–0.6 m", run: "cd play/site && bun scripts/measure.mjs --axis y --min 0.4 --max 0.6" },
      { check: "Its silhouette matches the reference sheet", how: "look", by: "the reference sheet, side by side at 1 m", must: false },
    ],
  };
  const intentAt = async (title: string, stage: "idea" | "specify" | "build") => {
    const i = await tool("add_intent", { title, kind: "improve" });
    if (stage === "idea") return i;
    await tool("specify_intent", { intent: i.id, ...SPEC });
    if (stage === "specify") return i;
    expect((await call("ada", "POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    return i;
  };
  /** no work without an intent (intent 706ed873): an intent at Proposal, every must check passed, ready to take work */
  const readyIntent = async (title: string) => {
    const i = await intentAt(title, "build");
    const all = [{ check: "c1", pass: true, evidence: "built" }, { check: "c2", pass: true, evidence: "0.5 m" }];
    expect((await tool("check_intent", { intent: i.id, results: all })).stage).toBe("proposal");
    return i.id as string;
  };

  test("only admins read the intents, and no one adds or edits one on the web", async () => {
    expect((await call(null, "GET", "/api/intents")).status).toBe(401);
    expect((await call("cit", "GET", "/api/intents")).status).toBe(403);
    expect((await call("ada", "GET", "/api/intents")).data).toEqual([]);
    // POST /api/intents proposes work (an asset's version): a title alone is no work, and makes no intent
    expect((await call("ada", "POST", "/api/intents", { title: "By hand" })).status).toBe(400);
    expect((await call("ada", "GET", "/api/intents")).data).toEqual([]);
    const i = await tool("add_intent", { title: "Something", note: "x" });
    expect(i).toMatchObject({ stage: "idea", kind: "idea", via: "mcp", author: "ada", spec: null, results: null, work: null });
    expect(i.id).toMatch(UUID);
    expect((await call("ada", "PATCH", `/api/intents/${i.id}`, { title: "Edited by hand" })).status).toBe(405);
    expect((await call("cit", "POST", `/api/intents/${i.id}/reject`)).status).toBe(403);
    expect((await call("ada", "POST", `/api/intents/${i.id}/reject`)).data.stage).toBe("archived");
    expect((await call("ada", "POST", `/api/intents/${i.id}/reopen`)).data.stage).toBe("idea");
    expect((await call("ada", "POST", `/api/intents/${i.id}/done`)).status).toBe(404);
  });

  test("a spec is a goal, a scope and checks, each one statement checked by a test, a measure or a look", async () => {
    const i = await tool("add_intent", { title: "To specify" });
    const bad = async (spec: object, says: string) => expect((await tool("specify_intent", { intent: i.id, ...SPEC, ...spec })).error).toContain(says);
    await bad({ goal: " " }, "goal");
    await bad({ scope: "" }, "scope");
    await bad({ checks: [] }, "1 to 12 checks");
    await bad({ checks: Array.from({ length: 13 }, () => SPEC.checks[0]) }, "1 to 12 checks");
    await bad({ checks: [{ check: "It is nice", how: "vibe", by: "x" }] }, "test (a command that passes), measure");
    await bad({ checks: [{ check: "It builds", how: "test", by: " " }] }, "the command or test that passes");
    await bad({ checks: [{ check: "Nice only", how: "look", by: "a photo", must: false }] }, "At least one of an intent's checks is a must");
    const s = await tool("specify_intent", { intent: i.id, ...SPEC, title: "A shade fern" });
    expect(s).toMatchObject({ stage: "specify", title: "A shade fern", specified_by: "ada", approved_at: null });
    expect(s.spec.checks.map((c: any) => [c.id, c.how, c.must])).toEqual([["c1", "test", true], ["c2", "measure", true], ["c3", "look", false]]);
    // specified again, its spec is replaced
    expect((await tool("specify_intent", { intent: i.id, ...SPEC, checks: SPEC.checks.slice(0, 2) })).spec.checks).toHaveLength(2);
  });

  test("a test or measure check carries its run, a command that runs as written in avenBOX: no placeholder in it", async () => {
    const i = await tool("add_intent", { title: "Runnable checks" });
    const spec = (run: string | undefined, how = "test") => tool("specify_intent", { intent: i.id, ...SPEC, checks: [{ check: "It holds", how, by: "the command passes", ...(run === undefined ? {} : { run }) }] });
    expect((await spec(undefined)).error).toContain("Check c1 (a test) needs its run");
    expect((await spec(" ", "measure")).error).toContain("Check c1 (a measure) needs its run");
    const second = await tool("specify_intent", { intent: i.id, ...SPEC, checks: [SPEC.checks[0], { check: "It is 1 m", how: "measure", by: "a ruler" }] });
    expect(second.error).toContain("Check c2 (a measure) needs its run");
    for (const run of [
      "TEST_DATABASE_URL=<a Postgres it may create databases on> bun test",
      "bun test test/<name>.test.ts",
      "cd play/api && bun test …",
      "cd play/api && bun test ...",
      "cd play/api && TEST_DATABASE_URL=postgres://x@127.0.0.1/y bun test",
    ])
      expect((await spec(run)).error).toContain("Check c1's run holds a placeholder");
    for (const run of [
      `grep -c '<div class="card">' play/site/build/index.html`,
      "bun test 2>&1 | tail -3",
      "cd play/api && bun test test/intents.test.ts",
      `grep -q "…" play/SPEC.md && sort < play/SPEC.md > /dev/null`,
      `psql "$TEST_DATABASE_URL" -tAc 'select 1'`,
    ]) {
      const ok = await spec(run);
      expect(ok.error).toBeUndefined();
      expect(ok.spec.checks[0].run).toBe(run);
    }
    // a look needs none; given one, it is kept (the command that makes what is looked at)
    const look = await tool("specify_intent", { intent: i.id, ...SPEC, checks: [SPEC.checks[0], { check: "It looks right", how: "look", by: "the sheet", must: false }] });
    expect(look.spec.checks[1].run).toBeUndefined();
    expect(placeholderIn("node shoot.mjs > out/<id>.png")).toBe("<id>");
    expect(placeholderIn("cat < in.txt > out.txt")).toBeNull();
    expect(placeholderIn("diff <(sort a) <(sort b)")).toBeNull();
  });

  test("a spec from before runs existed keeps its checks without one, and its intent still proposes", async () => {
    const i = await tool("add_intent", { title: "An old fern" });
    const old = { goal: "x", scope: "y", checks: [{ id: "c1", check: "It builds", how: "test", by: "bun run scripts/render.mjs --asset <its id>", must: true }] };
    await db.query(`UPDATE play.intents SET stage = 'build', spec = ($2::text)::jsonb, approved_by = $3, approved_at = now() WHERE id = $1`, [i.id, JSON.stringify(old), who.ada.id]);
    expect((await tool("get_intent", { intent: i.id })).spec.checks[0].run).toBeUndefined();
    await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "built" }] });
    const made = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Old fern", source: SOURCE, note: "x", intent: i.id });
    expect(made.error).toBeUndefined();
    expect((await tool("get_intent", { intent: i.id })).stage).toBe("proposal");
  });

  test("the gates: approved before it is built, every must check passed before it is proposed", async () => {
    const i = await intentAt("A shade fern for the north beds", "idea");
    const fern = (intent: string, label = "Shade fern") => tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label, source: SOURCE, note: "made for the intent", intent });
    const before = (await call("ada", "GET", "/api/intents")).data.length;
    expect((await fern(i.id)).error).toContain("specified (specify_intent) and its spec approved");
    expect((await fern(crypto.randomUUID())).error).toContain("no such intent");
    await tool("specify_intent", { intent: i.id, ...SPEC });
    expect((await fern(i.id)).error).toContain("approved by an admin");
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "built" }] })).error).toContain("being built");
    // the admin approves the spec: Specify → Build
    expect((await call("cit", "POST", `/api/intents/${i.id}/approve`)).status).toBe(403);
    const approved = (await call("ada", "POST", `/api/intents/${i.id}/approve`)).data;
    expect(approved).toMatchObject({ stage: "build", approved_by: "ada" });
    expect((await tool("specify_intent", { intent: i.id, ...SPEC })).error).toContain("step_back_intent sends it back");
    // no results yet: refused, each missing must named
    const none = (await fern(i.id)).error;
    expect(none).toContain("c1 (The recipe builds in the asset box): no result yet");
    expect(none).toContain("c2 (Its height is 0.4–0.6 m): no result yet");
    expect(none).not.toContain("c3 ("); // the nice check is not named (the bare "c3" can be in the intent's UUID)
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c9", pass: true, evidence: "x" }] })).error).toContain("not one of this intent's checks");
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: " " }] })).error).toContain("evidence");
    const partly = await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "render.mjs: built in 1.2 s" }, { check: "c2", pass: false, evidence: "measured 0.72 m" }] });
    expect(partly.stage).toBe("build");
    expect((await fern(i.id)).error).toContain("c2 (Its height is 0.4–0.6 m): failed");
    expect((await call("ada", "GET", "/api/intents")).data.length).toBe(before);
    // every must passes (the nice one need not): the intent moves to Proposal by itself, and the proposal is taken
    const checked = await tool("check_intent", { intent: i.id, results: [{ check: "c2", pass: true, evidence: "measured 0.52 m" }] });
    expect(checked.results).toMatchObject({ c1: { pass: true, by: "ada" }, c2: { pass: true, evidence: "measured 0.52 m" } });
    expect(checked.stage).toBe("proposal");
    const made = await fern(i.id);
    expect(made.error).toBeUndefined();
    expect(made.intent).toBe(i.id);
    expect(made.stage).toBe("proposal");
    // one record: the intent holds its work, and no other intent was made for it
    const at = await tool("get_intent", { intent: i.id });
    expect(at).toMatchObject({ stage: "proposal", work: { kind: "asset_version", status: "proposal", label: "Shade fern", asset_id: made.asset, version: made.version } });
    expect(at.review.builds).toHaveLength(1);
    expect((await call("ada", "GET", "/api/intents")).data.length).toBe(before);
    // a citizen sees no intent
    expect((await call("cit", "GET", `/api/intents/${i.id}`)).status).toBe(403);
    // accepted, its work is applied: the asset's head is the version
    expect((await call("ada", "POST", `/api/intents/${i.id}/accept`)).data).toMatchObject({ stage: "accepted", decision: { status: "accepted", number: 1 } });
    expect((await call("ada", "GET", `/api/assets/${made.asset}`)).data.head).toBe(made.version);
    expect((await fern(i.id)).error).toContain("accepted: it takes no more work");
  });

  test("archived at Proposal, an intent ends archived; its work replaced, the earlier work's intent variant is closed; brought back, to Specify", async () => {
    const i = await intentAt("A taller fern", "build");
    await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "built" }, { check: "c2", pass: true, evidence: "0.5 m" }] });
    const made = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Taller fern", source: SOURCE, note: "x", intent: i.id });
    expect((await tool("get_intent", { intent: i.id })).stage).toBe("proposal");
    // proposed again for the same intent: the new work replaces it, the earlier one's intent variant closed, kept in the history
    const again = await tool("propose_version", { asset: made.asset, source: SOURCE + "// taller\n", note: "taller still", intent: i.id });
    expect(again).toMatchObject({ intent: i.id, stage: "proposal" });
    const held = await tool("get_intent", { intent: i.id });
    expect(held.work).toMatchObject({ version: again.version, note: "taller still" });
    expect((await db.query<any>(`SELECT status, intent_id FROM play.doc_variants WHERE id = $1`, [made.variant])).rows[0]).toEqual({ status: "archived", intent_id: i.id });
    expect((await call("ada", "GET", "/api/intents")).data.filter((x: any) => x.title === i.title)).toHaveLength(1);
    // archived at Proposal: the intent is archived, its work's intent variant closed
    expect((await call("ada", "POST", `/api/intents/${i.id}/archive`)).data).toMatchObject({ stage: "archived", decision: { status: "archived" } });
    expect((await db.query<any>(`SELECT status FROM play.doc_variants WHERE id = $1`, [again.variant])).rows[0].status).toBe("archived");
    expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Taller fern", source: SOURCE, note: "again", intent: i.id })).error).toContain("archived: it takes no more work");
    // brought back, to Specify with its spec; approved, built and proposed anew
    expect((await call("ada", "POST", `/api/intents/${i.id}/reopen`)).data.stage).toBe("specify");
    expect((await call("ada", "POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Taller fern", source: SOURCE, note: "again", intent: i.id })).error).toContain("no result yet");
    // sent back to Specify, its approval and results go; rejected, it is archived
    expect(await tool("step_back_intent", { intent: i.id, reason: "its height is to change" })).toMatchObject({ stage: "specify", approved_at: null });
    expect((await call("ada", "POST", `/api/intents/${i.id}/reject`)).data.stage).toBe("archived");
  });

  test("code: an intent moves to Proposal on its checks and names its pull request; its Accept no longer waits for main's results", async () => {
    const i = await intentAt("Sources on play", "build");
    expect((await call("ada", "POST", `/api/intents/${i.id}/accept`)).data.error).toContain("moves to Proposal by itself");
    const sha = "0123456789abcdef0123456789abcdef01234567";
    // where a result ran: avenBOX by default, or main; a commit is a whole git hash; a pull request is its number
    expect((await box("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "x", where: "laptop" }] })).error).toContain("where is avenBOX or main");
    expect((await box("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "x", commit: "abc123" }] })).error).toContain("40-character git hash");
    expect((await box("check_intent", { intent: i.id, pr: "#12", results: [{ check: "c1", pass: true, evidence: "x" }] })).error).toContain("pr is the number");
    expect((await box("check_intent", { intent: i.id })).error).toContain("Give each check's result");
    // every must passes in avenBOX, its pull request named: to Proposal by itself
    const boxed = await box("check_intent", { intent: i.id, pr: 12, results: [{ check: "c1", pass: true, evidence: "intent.ts: exit 0", commit: sha }, { check: "c2", pass: true, evidence: "0.5", commit: sha }] });
    expect(boxed).toMatchObject({ stage: "proposal", pull_request: 12, ship: null });
    expect(boxed.results).toMatchObject({ c1: { pass: true, where: "avenBOX", commit: sha }, c2: { pass: true, where: "avenBOX", commit: sha } });
    // a newer pull request replaces it, named alone
    expect((await box("check_intent", { intent: i.id, pr: 13 })).pull_request).toBe(13);
    // with a pull request, Accept ships it, and this play holds no SHIP_TOKEN: refused, and it says why (src/ship.ts; test/ship.test.ts)
    const refused = await call("ada", "POST", `/api/intents/${i.id}/accept`);
    expect(refused.status).toBe(409);
    expect(refused.data.error).toContain("SHIP_TOKEN");
    expect((await call("ada", "GET", `/api/intents/${i.id}`)).data.stage).toBe("proposal");
    // with none (an intent that is a decision, or code merged before ships), Accept takes its checks, as they passed in avenBOX
    const j = await intentAt("No pull request", "build");
    await box("check_intent", { intent: j.id, results: [{ check: "c1", pass: true, evidence: "built" }, { check: "c2", pass: true, evidence: "0.5" }] });
    expect((await call("ada", "POST", `/api/intents/${j.id}/accept`)).data).toMatchObject({ stage: "accepted", decided_by: "ada" });
  });

  test("the stage Ship: between Proposal and Accepted, listed; main's results confirm in any stage and move nothing", async () => {
    const { rows } = await db.query<any>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'intents_stage_check'`);
    expect(rows[0].def).toContain("'proposal'::text, 'ship'::text, 'accepted'::text");
    const cols = (await db.query<any>(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'play' AND table_name = 'intents' AND column_name IN ('pull_request', 'ship') ORDER BY 1`)).rows;
    expect(cols).toEqual([{ column_name: "pull_request", data_type: "integer" }, { column_name: "ship", data_type: "jsonb" }]);
    // only code ships: an intent holding work of play's is never in Ship
    const i = await intentAt("In Ship", "build");
    const all = [{ check: "c1", pass: true, evidence: "built" }, { check: "c2", pass: true, evidence: "0.5" }];
    await box("check_intent", { intent: i.id, pr: 21, results: all });
    const ship = { pr: 21, head: "a".repeat(40), merge: "b".repeat(40), by: "ada", round: 1, started: new Date().toISOString(), steps: [{ key: "merged", name: "Merged into main", state: "green" }] };
    await db.query(`UPDATE play.intents SET stage = 'ship', ship = ($2::text)::jsonb WHERE id = $1`, [i.id, JSON.stringify(ship)]);
    const listed = (await call("ada", "GET", "/api/intents?stage=ship")).data;
    expect(listed.map((x: any) => x.id)).toEqual([i.id]);
    expect(listed[0]).toMatchObject({ stage: "ship", pull_request: 21, ship: { merge: "b".repeat(40), steps: [{ key: "merged", state: "green" }] } });
    expect((await tool("list_intents", {})).map((x: any) => x.id)).toContain(i.id);
    expect((await tool("list_intents", { stage: "ship" })).map((x: any) => x.id)).toEqual([i.id]);
    // in Ship: avenBOX's results and a pull request are not taken; main's are kept, a red one too, and it stays
    expect((await box("check_intent", { intent: i.id, results: all })).error).toContain("main's results (where main) in any stage");
    expect((await box("check_intent", { intent: i.id, pr: 22 })).error).toContain("ship stage");
    const merged = "c".repeat(40);
    const onMain = await box("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "main", where: "main", commit: merged }, { check: "c2", pass: false, evidence: "0.7 on main", where: "main", commit: merged }] });
    expect(onMain).toMatchObject({ stage: "ship", pull_request: 21, results: { c1: { where: "main", commit: merged }, c2: { pass: false, where: "main" } } });
    // Accepted, the same
    await db.query(`UPDATE play.intents SET stage = 'accepted' WHERE id = $1`, [i.id]);
    expect((await box("check_intent", { intent: i.id, results: [{ check: "c2", pass: true, evidence: "0.5 on main", where: "main" }] })).stage).toBe("accepted");
    // the database holds it: work of play's in Ship is refused
    const w = await intentAt("Work in Ship", "build");
    await box("check_intent", { intent: w.id, results: all });
    expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Never shipped", source: SOURCE, note: "x", intent: w.id })).error).toBeUndefined();
    await expect(db.query(`UPDATE play.intents SET stage = 'ship' WHERE id = $1`, [w.id])).rejects.toThrow();
    // not yet approved: main's results are not taken either
    const idea = await intentAt("Not approved", "specify");
    expect((await box("check_intent", { intent: idea.id, results: [{ check: "c1", pass: true, evidence: "main", where: "main" }] })).error).toContain("specify stage");
  });

  test("an intent moves to Proposal by itself once every must check passes, and is accepted there, never from Build", async () => {
    const i = await intentAt("Artifacts on play", "build");
    expect((await call("ada", "POST", `/api/intents/${i.id}/accept`)).data.error).toContain("moves to Proposal by itself");
    const half = await box("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "PR #1 merged, tests green", where: "main" }, { check: "c2", pass: false, evidence: "0.7", where: "main" }] });
    expect(half.stage).toBe("build");
    expect((await call("ada", "POST", `/api/intents/${i.id}/accept`)).status).toBe(409);
    // the last must passes: Proposal, by itself (the nice check has no result and need not)
    const ready = await box("check_intent", { intent: i.id, results: [{ check: "c2", pass: true, evidence: "0.5", where: "main" }] });
    expect(ready).toMatchObject({ stage: "proposal", work: null });
    // at Proposal, the one gate: an admin accepts it (a citizen may not)
    expect((await call("cit", "POST", `/api/intents/${i.id}/accept`)).status).toBe(403);
    expect((await call("ada", "POST", `/api/intents/${i.id}/accept`)).data).toMatchObject({ stage: "accepted", decided_by: "ada" });
    expect((await call("ada", "POST", `/api/intents/${i.id}/accept`)).status).toBe(409);
  });

  test("a must check without a run (a look, a spec from before) is accepted on its result wherever it ran", async () => {
    const i = await tool("add_intent", { title: "A look only" });
    await tool("specify_intent", { intent: i.id, ...SPEC, checks: [{ check: "It looks like the sheet", how: "look", by: "the sheet at 1 m" }] });
    await call("ada", "POST", `/api/intents/${i.id}/approve`);
    await box("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "side by side: the same" }] });
    expect((await call("ada", "POST", `/api/intents/${i.id}/accept`)).data.stage).toBe("accepted");
  });

  test("only the box's run is evidence: avenBOX's token records a code intent's test and measure results, any other token is refused for them and may record a look", async () => {
    const sha = "1".repeat(40);
    const SAYS = "the pull request's run records them";
    // the token is marked on the profile page by its owner, an admin; it is listed so
    const listed = (await call("ada", "GET", "/api/tokens")).data;
    expect(listed.find((t: any) => t.name === "avenBOX").avenbox).toBe(true);
    expect(listed.find((t: any) => t.name === "agent").avenbox).toBe(false);
    expect((await call("bea", "POST", `/api/tokens/${listed[0].id}/avenbox`, { avenbox: true })).status).toBe(404);
    expect((await call("cit", "POST", `/api/tokens/${listed[0].id}/avenbox`, { avenbox: true })).status).toBe(403);
    expect((await call("ada", "POST", `/api/tokens/${listed[0].id}/avenbox`, { avenbox: "yes" })).status).toBe(400);

    const i = await intentAt("Box only", "build");
    // any other admin's token: no pull request, no result on a commit or on main
    const look = { check: "c3", pass: true, evidence: "side by side at 1 m: it matches" };
    for (const args of [
      { pr: 30 },
      { results: [{ check: "c1", pass: true, evidence: "exit 0", commit: sha }] },
      { results: [{ check: "c2", pass: true, evidence: "0.5", where: "main" }] },
      { results: [look, { check: "c1", pass: true, evidence: "exit 0", commit: sha }] },
    ]) {
      const r = await tool("check_intent", { intent: i.id, ...args });
      expect(r.error).toContain(SAYS);
    }
    expect((await call("ada", "GET", `/api/intents/${i.id}`)).data.results).toBeNull();
    // a look it still records by hand
    expect((await tool("check_intent", { intent: i.id, results: [look] })).results.c3).toMatchObject({ pass: true, by: "ada" });
    // the box's run: a red must keeps it in Prototype, its pull request named; recorded with the run's link, marked the box's
    const link = "https://github.com/maia/city/actions/runs/9";
    const red = await box("check_intent", { intent: i.id, pr: 30, results: [{ check: "c1", pass: true, evidence: "exit 0", commit: sha, link }, { check: "c2", pass: false, evidence: "0.7", commit: sha, link }] });
    expect(red).toMatchObject({ stage: "build", pull_request: 30, results: { c1: { pass: true, box: true, link, commit: sha }, c2: { pass: false, box: true } } });
    expect(red.results.c3.box).toBeUndefined();
    expect((await box("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "x", link: "javascript:alert(1)" }] })).error).toContain("link is the https link");
    // once its pull request is named, no other token records a test or measure, even with no commit
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c2", pass: true, evidence: "0.5" }] })).error).toContain(SAYS);
    // all green from the box: to Proposal; a red must from it there: back to Prototype
    const green = await box("check_intent", { intent: i.id, results: [{ check: "c2", pass: true, evidence: "0.5", commit: sha, link }] });
    expect(green.stage).toBe("proposal");
    const sha2 = "2".repeat(40);
    const back = await box("check_intent", { intent: i.id, results: [{ check: "c1", pass: false, evidence: "exit 1", commit: sha2, link }, { check: "c2", pass: true, evidence: "0.5", commit: sha2, link }] });
    expect(back.stage).toBe("build");
    // work of play's own (no pull request, no commit): any admin's token records it, as before
    const w = await intentAt("Play's own work", "build");
    expect((await tool("check_intent", { intent: w.id, results: [{ check: "c1", pass: true, evidence: "built" }, { check: "c2", pass: true, evidence: "0.5" }] })).stage).toBe("proposal");
  });

  test("specify_intent and check_intent say only what they take, give back and refuse; the Intents skill teaches the rest", async () => {
    const tools = (await rpc("tools/list")).tools as { name: string; description: string; inputSchema: any }[];
    const of = (name: string) => tools.find((t) => t.name === name)!;
    const specify = of("specify_intent");
    const check = of("check_intent");
    // say only what they take: each at most 600 characters, pointing to the skill for the rest
    for (const t of [specify, check]) {
      expect(t.description.length).toBeLessThanOrEqual(600);
      for (const says of ["Gives back", "Refused", "Intents skill"]) expect(t.description).toContain(says);
    }
    for (const says of ["reduce", "nothing_to_reduce", "placeholder", "run"]) expect(specify.description).toContain(says);
    expect(specify.inputSchema.properties.checks.items.properties.run.description).toContain("avenBOX");
    expect(specify.inputSchema.properties.checks.items.properties.step.enum).toEqual(["reduce", "mvp"]);
    expect(specify.inputSchema.properties.nothing_to_reduce.type).toBe("string");
    expect(check.inputSchema.properties.results.items.properties.where.enum).toEqual(["avenBOX", "main"]);
    expect(check.inputSchema.properties.pr.type).toBe("integer");
    expect(check.inputSchema.properties.pr.description).toContain("Accept merges");
    expect(check.inputSchema.required).toEqual(["intent"]);
    // nothing they taught is lost: what to do at each stage is the Intents skill's (play/SPEC.md §4.14)
    for (const says of ["get_intent", "brief", "doc_at"]) expect(of("list_intents").description).toContain(says);
    const skill = (await tool("doc_at", { doc: SKILL.intents })).json;
    const taught = [skill.system, ...Object.values(skill.stages)].join("\n");
    for (const says of [
      "avenBOX", "play/avenbox/intent.ts", "--record", "--pr", "Intent: ", ".github/workflows/intents.yml", "never merge", "Ship",
      "ONE statement that passes or fails", "decidable by someone who reads only the intent and the result", "nothing in it left to fill in",
      "exits 0 only in its range", "a failure as a failure", "record a look by hand", "main runs them again", "an admin approves the spec",
    ])
      expect(taught).toContain(says);
    expect(of("list_intents").inputSchema.properties.stage.enum).toEqual(["idea", "specify", "build", "proposal", "ship", "accepted", "archived", "all"]);
    const { instructions } = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    for (const says of ["avenBOX", "play/avenbox/intent.ts", "Intent: ", "never merge", "Accept merges it", "Ship"]) expect(instructions).toContain(says);
  });

  const { nothing_to_reduce: _, ...MVP } = SPEC;
  const REDUCE = { check: "intents.ts is smaller", how: "measure", by: "wc -c, at most 30,000", run: "[ $(wc -c < play/api/src/intents.ts) -le 30000 ]", step: "reduce" };

  test("reduce first: a spec without its reduce step is refused; with a reduce check or nothing_to_reduce it is taken, each check its step", async () => {
    const i = await tool("add_intent", { title: "Reduce first" });
    expect((await tool("specify_intent", { intent: i.id, ...MVP })).error).toContain("Its reduce step comes first");
    expect((await tool("specify_intent", { intent: i.id, ...MVP, nothing_to_reduce: " " })).error).toContain("Its reduce step comes first");
    expect((await tool("get_intent", { intent: i.id })).stage).toBe("idea");
    expect((await tool("specify_intent", { intent: i.id, ...MVP, checks: [{ ...REDUCE, step: "less" }, ...MVP.checks] })).error).toContain("step is reduce");
    const reduced = await tool("specify_intent", { intent: i.id, ...MVP, checks: [REDUCE, ...MVP.checks] });
    expect(reduced.stage).toBe("specify");
    expect(reduced.spec.checks.map((c: any) => [c.id, c.step, c.must])).toEqual([["c1", "reduce", true], ["c2", "mvp", true], ["c3", "mvp", true], ["c4", "mvp", false]]);
    expect(reduced.spec.nothing_to_reduce).toBeUndefined();
    const none = await tool("specify_intent", { intent: i.id, ...MVP, nothing_to_reduce: "A new asset: nothing of play's is in its way." });
    expect(none.spec).toMatchObject({ nothing_to_reduce: "A new asset: nothing of play's is in its way." });
    expect(none.spec.checks.every((c: any) => c.step === "mvp")).toBe(true);
  });

  test("a reduction is a must: a reduce check marked nice is refused", async () => {
    const i = await tool("add_intent", { title: "A nice reduction" });
    const nice = await tool("specify_intent", { intent: i.id, ...MVP, checks: [{ ...REDUCE, must: false }, ...MVP.checks] });
    expect(nice.error).toContain("Check c1 is a reduction: every reduction is a must");
    expect((await tool("specify_intent", { intent: i.id, ...MVP, checks: [{ ...REDUCE, must: true }, ...MVP.checks] })).spec.checks[0].must).toBe(true);
  });

  test("approve refuses a spec without its reduce step (one from before); one already in Build still moves on its checks", async () => {
    const old = { goal: "x", scope: "y", checks: [{ id: "c1", check: "It builds", how: "test", by: "true", run: "true", must: true }] };
    const i = await tool("add_intent", { title: "Specified before" });
    await db.query(`UPDATE play.intents SET stage = 'specify', spec = ($2::text)::jsonb WHERE id = $1`, [i.id, JSON.stringify(old)]);
    const refused = await call("ada", "POST", `/api/intents/${i.id}/approve`);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.data)).toContain("Its reduce step comes first");
    expect((await tool("get_intent", { intent: i.id })).stage).toBe("specify");
    // specified again with its reduce step, it is approved
    await tool("specify_intent", { intent: i.id, ...MVP, checks: [REDUCE, ...MVP.checks] });
    expect((await call("ada", "POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    // in Build already with a spec from before: not held to the new step
    const p = await tool("add_intent", { title: "Built before" });
    await db.query(`UPDATE play.intents SET stage = 'build', spec = ($2::text)::jsonb, approved_by = $3, approved_at = now() WHERE id = $1`, [p.id, JSON.stringify(old), who.ada.id]);
    expect((await tool("check_intent", { intent: p.id, results: [{ check: "c1", pass: true, evidence: "true: exit 0" }] })).stage).toBe("proposal");
  });

  test("at Proposal: checked again, a failing must takes it back; it is rejected or stepped back to Specify there; a waiting proposal decides it", async () => {
    const i = await intentAt("A fern at Proposal", "build");
    const all = [{ check: "c1", pass: true, evidence: "built" }, { check: "c2", pass: true, evidence: "0.5 m" }];
    expect((await tool("check_intent", { intent: i.id, results: all })).stage).toBe("proposal");
    // checked again while none of its proposals waits: a must that fails takes it back to Build, and passing again to Proposal
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c2", pass: false, evidence: "0.8 m after the change" }] })).stage).toBe("build");
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c2", pass: true, evidence: "0.5 m again" }] })).stage).toBe("proposal");
    // sent back to Specify from Proposal, its approval and results go
    expect(await tool("step_back_intent", { intent: i.id, reason: "c2 is to be measured otherwise" })).toMatchObject({ stage: "specify", approved_at: null, results: null });
    expect((await call("ada", "POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    expect((await tool("check_intent", { intent: i.id, results: all })).stage).toBe("proposal");
    // with its work waiting, deciding it decides the work: it is neither sent back nor checked again
    const made = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Fern at Proposal", source: SOURCE, note: "x", intent: i.id });
    expect(made.error).toBeUndefined();
    expect((await tool("step_back_intent", { intent: i.id, reason: "x" })).error).toContain("waits for a decision");
    expect((await tool("check_intent", { intent: i.id, results: all })).error).toContain("no work of it waits there");
    // other work made on the same base goes in first: its work is archived by itself, and an intent with an approved
    // spec goes back to Build, its results cleared, to be built on the new head
    const first = await tool("propose_version", { asset: made.asset, source: SOURCE + "// first\n", note: "first in", intent: await readyIntent("First in") });
    expect((await call("ada", "POST", `/api/intents/${first.intent}/accept`)).data.stage).toBe("accepted");
    expect(await tool("get_intent", { intent: i.id })).toMatchObject({ stage: "build", results: null, decided_by: null, work: { status: "archived", version: made.version } });
    expect((await db.query<any>(`SELECT status FROM play.doc_variants WHERE id = $1`, [made.variant])).rows[0].status).toBe("archived");
    expect((await tool("check_intent", { intent: i.id, results: all })).stage).toBe("proposal");
    expect((await call("ada", "POST", `/api/intents/${i.id}/reject`)).data).toMatchObject({ stage: "archived", decided_by: "ada" });
  });

  test("migration 0028's rule (the stage named Build since 0033) moves an intent already in Build with every must check passed to Proposal", async () => {
    const m = MIGRATIONS.find((x) => x.id === "0028-intents-ready-propose")!;
    const sql = m.sql.replaceAll("'prototype'", "'build'");
    const at = async (title: string, results: Record<string, boolean>) => {
      const i = await intentAt(title, "build");
      const r = Object.fromEntries(Object.entries(results).map(([k, pass]) => [k, { pass, evidence: "x", by: "ada", at: new Date().toISOString() }]));
      await db.query(`UPDATE play.intents SET results = ($2::text)::jsonb, stage = 'build' WHERE id = $1`, [i.id, JSON.stringify(r)]);
      return i.id;
    };
    const ready = await at("Ready before 0028", { c1: true, c2: true });
    const failing = await at("A must failing before 0028", { c1: true, c2: false });
    const unchecked = await at("A must unchecked before 0028", { c1: true });
    await db.query(sql);
    const stage = async (id: string) => (await tool("get_intent", { intent: id })).stage;
    expect(await stage(ready)).toBe("proposal");
    expect(await stage(failing)).toBe("build");
    expect(await stage(unchecked)).toBe("build");
  });

  test("work proposed without an intent is refused, naming add_intent: nothing is written", async () => {
    const count = async () => (await db.query<any>(`SELECT (SELECT count(*) FROM play.intents) AS i, (SELECT count(*) FROM play.doc_variants) AS v, (SELECT count(*) FROM play.doc_edits) AS e, (SELECT count(*) FROM play.assets) AS a`)).rows[0];
    const before = await count();
    const plain = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Plain fern", source: SOURCE, note: "no intent named" });
    expect(plain.error).toContain("add_intent");
    const web = await call("ada", "POST", "/api/intents", { new: { group: "plants", slug: "plain-fern", label: "Plain fern" }, source: SOURCE, note: "on the page" });
    expect(web.status).toBe(400);
    expect(web.data.error).toContain("add_intent");
    expect(await count()).toEqual(before);
    // named, it is that intent's work, at Proposal with its spec
    const own = await readyIntent("A plain fern");
    const made = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Plain fern", source: SOURCE, note: "for its intent", intent: own });
    expect(made.error).toBeUndefined();
    expect(made.intent).toBe(own);
    const got = await tool("get_intent", { intent: own });
    expect(got).toMatchObject({ stage: "proposal", title: "A plain fern", work: { kind: "asset_version", grp: "plants", status: "proposal", author: "ada", via: "mcp" } });
    expect(got.spec).toMatchObject({ goal: SPEC.goal });
    expect((await call("ada", "POST", `/api/intents/${own}/accept`)).data.stage).toBe("accepted");
    // an agent archives its own at Proposal, made over MCP; not one proposed on the page
    const v2 = await tool("propose_version", { asset: made.asset, source: SOURCE + "// v2\n", note: "on v1", intent: await readyIntent("Plain fern v2") });
    expect(await tool("archive_intent", { intent: v2.intent })).toMatchObject({ intent: v2.intent, stage: "archived" });
    const page = await call("ada", "POST", "/api/intents", { asset: made.asset, source: SOURCE + "// by the page\n", note: "on the page", intent: await readyIntent("Plain fern by the page") });
    expect(page.status).toBe(201);
    expect((await tool("archive_intent", { intent: page.data.intent })).error).toContain("over MCP");
  });
  test("one stage back over MCP: to Specify from Build or Proposal, to Idea from Specify, always with a reason; refused elsewhere", async () => {
    const back = (intent: string, reason?: string) => tool("step_back_intent", { intent, ...(reason === undefined ? {} : { reason }) });
    // from Build: its spec kept, its approval and results cleared
    const b = await intentAt("A fern being built", "build");
    await tool("check_intent", { intent: b.id, results: [{ check: "c1", pass: true, evidence: "built" }] });
    expect((await back(b.id, "  ")).error).toContain("needs its reason");
    expect((await back(b.id, "x".repeat(601))).error).toContain("at most 600");
    const s = await back(b.id, "c2 cannot be measured in the asset box");
    expect(s).toMatchObject({ stage: "specify", approved_by: null, approved_at: null, results: null, spec: expect.objectContaining({ goal: SPEC.goal, scope: SPEC.scope }) });
    expect(s.steps).toEqual([expect.objectContaining({ from: "build", to: "specify", reason: "c2 cannot be measured in the asset box", by: "ada", human: who.ada.id, via: "mcp" })]);
    // from Proposal with no work waiting
    const p = await intentAt("A fern at Proposal, no work", "build");
    expect((await tool("check_intent", { intent: p.id, results: [{ check: "c1", pass: true, evidence: "built" }, { check: "c2", pass: true, evidence: "0.5 m" }] })).stage).toBe("proposal");
    expect(await back(p.id, "its scope is to grow")).toMatchObject({ stage: "specify", approved_at: null, results: null });
    // from Specify to Idea: its spec dropped, its whole text in the history; its id and note kept
    const d = await back(b.id, "the whole intent is to be thought again");
    expect(d).toMatchObject({ id: b.id, stage: "idea", spec: null, specified_at: null, specified_by: null, approved_at: null });
    expect(d.steps).toHaveLength(2);
    expect(d.steps[1]).toMatchObject({ from: "specify", to: "idea", reason: "the whole intent is to be thought again", spec: expect.objectContaining({ goal: SPEC.goal, scope: SPEC.scope }) });
    // refused at Idea, at Proposal with work waiting, in Ship, Accepted and Archived
    expect((await back(b.id, "again")).error).toContain("first stage already");
    const w = await intentAt("A fern with work", "build");
    await tool("check_intent", { intent: w.id, results: [{ check: "c1", pass: true, evidence: "built" }, { check: "c2", pass: true, evidence: "0.5 m" }] });
    expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Fern stepped", source: SOURCE, note: "x", intent: w.id })).error).toBeUndefined();
    expect((await back(w.id, "x")).error).toContain("waits for a decision");
    for (const stage of ["ship", "accepted", "archived"]) {
      const x = await intentAt(`A fern ${stage}`, "build");
      await db.query(`UPDATE play.intents SET stage = $2 WHERE id = $1`, [x.id, stage]);
      expect((await back(x.id, "x")).error).toContain(`at the ${stage} stage`);
    }
    // no admin's Back to Specify is left
    expect((await call("ada", "POST", `/api/intents/${p.id}/respecify`)).status).toBe(404);
  });

  test("only Approve spec moves it forward again: no check, no proposal until then; each step back kept in its history", async () => {
    const i = await intentAt("A fern stepped back", "build");
    await tool("step_back_intent", { intent: i.id, reason: "c1 is to name its asset" });
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "built" }] })).error).toContain("specify stage");
    expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Fern too soon", source: SOURCE, note: "x", intent: i.id })).error).toContain("its spec approved by an admin");
    // specified again, it still waits for Approve spec
    expect((await tool("specify_intent", { intent: i.id, ...SPEC, goal: "A shade fern stands in the north beds, named." })).stage).toBe("specify");
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "built" }] })).error).toContain("specify stage");
    expect((await call("ada", "POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "built" }] })).stage).toBe("build");
    // back to Idea: specified again with specify_intent, and then Approve spec
    await tool("step_back_intent", { intent: i.id, reason: "back once more" });
    await tool("step_back_intent", { intent: i.id, reason: "to Idea" });
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "built" }] })).error).toContain("idea stage");
    expect((await tool("specify_intent", { intent: i.id, ...SPEC })).stage).toBe("specify");
    expect((await call("ada", "POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    const h = await tool("get_intent", { intent: i.id });
    expect(h.steps.map((s: any) => [s.from, s.to, s.reason, s.by])).toEqual([
      ["build", "specify", "c1 is to name its asset", "ada"],
      ["build", "specify", "back once more", "ada"],
      ["specify", "idea", "to Idea", "ada"],
    ]);
    for (const s of h.steps) expect(Date.parse(s.at)).toBeGreaterThan(0);
  });

  test("accepted from its dialog: an intent at Proposal is decided whole by its one Accept, whatever its work; its Reject archives it and its work", async () => {
    const all = [{ check: "c1", pass: true, evidence: "built" }, { check: "c2", pass: true, evidence: "0.5 m" }];
    /** an intent at Proposal, every must check passed, ready to take work */
    const ready = async (title: string) => {
      const i = await intentAt(title, "build");
      expect((await tool("check_intent", { intent: i.id, results: all })).stage).toBe("proposal");
      return i.id as string;
    };
    const accept = async (id: string) => (await call("ada", "POST", `/api/intents/${id}/accept`)).data;
    // the documents, each at Main's first version
    const fern = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Dialog fern", source: SOURCE, note: "its first version", intent: await ready("A dialog fern") });
    expect((await accept(fern.intent)).stage).toBe("accepted");
    const film = await tool("propose_story", { title: "A dialog film", note: "its first version", intent: await ready("A dialog film"), body: { format: "9:16", fps: 30, tracks: [{ id: "voice", kind: "voice", clips: [{ id: "v1", at: 0, duration: 4, who: "MAIA", line: "One." }] }] } });
    expect((await accept(film.intent)).stage).toBe("accepted");
    const skill = crypto.randomUUID(), factory = crypto.randomUUID(), config = crypto.randomUUID();
    await seedDoc(db, "skill", { id: skill, json: { schema: "skill/1", label: "A dialog skill", group: "tests", system: "Say it once." }, note: "its first version" });
    const line = { product: { name: "a cog" }, demand: { perDay: 10 }, calendar: {}, stations: [{ id: "cut", name: "Cut", machine: "laser" }] };
    await seedDoc(db, "factory", { id: factory, json: { schema: "factory/1", label: "A dialog line", line, parts: [{ id: "plate", label: "Plate", qty: 1, ops: [{ at: "cut", s: 30 }] }] }, note: "its first version" });
    const levels = { schema: "levels/1", label: "Dialog levels", villager: { euros: 100, hearts: 10 }, minds: { heartsPerMind: 10, step: 1, heartsPerEuro: 4 }, levels: [{ id: "l1", villagers: 1, phase: "tents", investor: 0, unlocks: [] }] };
    await seedDoc(db, "game_config", { id: config, json: levels, note: "its first version" });
    await db.query(`INSERT INTO play.sandbox_configs (sandbox_id, name, data) VALUES ($1, 'dialog', '{"trees":[{"id":"fern","at":[0,0]}]}') ON CONFLICT (sandbox_id, name) DO UPDATE SET data = EXCLUDED.data`, [SANDBOX.two]);

    // one intent of each kind's work, each decided by its Accept alone: its work applied, the intent Accepted
    const KINDS: { kind: string; doc: string; edits: unknown[]; holds: () => Promise<void> }[] = [
      { kind: "asset", doc: fern.asset, edits: [{ op: "set", path: ["source"], value: SOURCE + "// from its dialog\n" }], holds: async () => expect((await tool("doc_at", { doc: fern.asset })).json.source).toContain("from its dialog") },
      { kind: "story", doc: film.story, edits: [{ op: "set_clip", track: "voice", clip: "v1", fields: { line: "One, from its dialog." } }], holds: async () => expect((await tool("get_story", { story: film.story })).tracks[0].clips[0].line).toBe("One, from its dialog.") },
      { kind: "skill", doc: skill, edits: [{ op: "set", path: ["note"], value: "from its dialog" }], holds: async () => expect((await tool("doc_at", { doc: skill })).json.note).toBe("from its dialog") },
      { kind: "factory", doc: factory, edits: [{ op: "set", path: ["line", "demand", "perDay"], value: 20 }], holds: async () => expect((await tool("doc_at", { doc: factory })).json.line.demand.perDay).toBe(20) },
      { kind: "game_config", doc: config, edits: [{ op: "set", path: ["villager", "euros"], value: 150 }], holds: async () => expect((await tool("doc_at", { doc: config })).json.villager.euros).toBe(150) },
      { kind: "sandbox", doc: SANDBOX.two, edits: [{ op: "set", config: "dialog", path: ["trees", 0, "at"], value: [4, 2] }], holds: async () => expect((await call("ada", "GET", `/api/sandboxes/${SANDBOX.two}/config`)).data.dialog.trees[0].at).toEqual([4, 2]) },
    ];
    for (const k of KINDS) {
      const id = await ready(`A ${k.kind} accepted from its dialog`);
      const was = (await tool("doc_at", { doc: k.doc })).number;
      const p = await tool("propose_doc_version", { doc: k.doc, note: `${k.kind} from its dialog`, edits: k.edits, intent: id });
      expect(p.error).toBeUndefined();
      expect(await tool("get_intent", { intent: id })).toMatchObject({ stage: "proposal", work: { status: "proposal" } });
      expect(await accept(id)).toMatchObject({ stage: "accepted", decided_by: "ada", decision: { status: "accepted" } });
      expect(await tool("get_intent", { intent: id })).toMatchObject({ stage: "accepted", work: { status: "accepted" } });
      expect((await tool("doc_at", { doc: k.doc })).number).toBe(was + 1);
      await k.holds();
    }

    // Reject on another: the intent archived and its work with it, Main as it was
    const id = await ready("A skill rejected from its dialog");
    const p = await tool("propose_doc_version", { doc: skill, note: "not this", edits: [{ op: "set", path: ["note"], value: "not this" }], intent: id });
    expect(p.error).toBeUndefined();
    expect((await call("ada", "POST", `/api/intents/${id}/reject`)).data).toMatchObject({ stage: "archived", decided_by: "ada" });
    expect(await tool("get_intent", { intent: id })).toMatchObject({ stage: "archived", work: { status: "archived" } });
    expect((await tool("doc_at", { doc: skill })).json.note).toBe("from its dialog");
    expect((await db.query<any>(`SELECT status FROM play.doc_variants WHERE id = $1`, [p.variant])).rows[0].status).toBe("archived");
  });
});
