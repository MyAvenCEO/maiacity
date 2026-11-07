// Auto-accept rules (play/SPEC.md §4.12 "Auto-accept rules"; intent de24f1c5, Samuel 2026-11-07) against a real
// Postgres: set TEST_DATABASE_URL, as for ./api.test.ts. The rule set is a document, rules:<RULES> of its own schema,
// changed only by a person's Accept; matchRule says which rule meets an intent at Approve spec or Accept, and
// autoMove takes the move a person would, through the one decision path (./intents.ts decided), the rule written as
// who decided. Each test is one check of the intent's spec (c1–c9), named as its run names it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import * as docs from "../src/docs";
import { RULE, RULES, SCHEMA } from "../src/ids";
import { autoMove, decisions } from "../src/intents";
import { Rate } from "../src/limits";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { FIRST_RULE, RULES_DOC, RULES_V1, matchRule, type Rule } from "../src/rules";
import { fakeGitHub, green, REPO, sha } from "./fixtures/github";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

const words = (k: number, w: string) => Array.from({ length: k }, () => w).join(" ");
const SUMMARY = `## What it is\n\n${words(200, "artifact")}\n\n## Key points\n\n${Array.from({ length: 20 }, () => `- ${words(10, "point")}`).join("\n")}\n\n## The topic\n\n${words(193, "topic")}`;
const ARTIFACT = (url: string, title = "A page kept with no tap", origin = "human") => ({ url, title, description: "A page Maia City keeps, added over MCP.", summary: SUMMARY, authors: [{ name: "Ann Author", kind: "person" }], kind: "page", origin });
const SPEC = {
  goal: "It is done.",
  nothing_to_reduce: "A test fixture: nothing to reduce.",
  scope: "A test.",
  checks: [{ check: "It holds", how: "test", by: "true", run: "true" }],
};
const BODY = { format: "9:16", fps: 30, tracks: [{ id: "voice", kind: "voice", clips: [{ id: "v1", at: 0, duration: 4, who: "MAIA", line: "One." }] }] };
const SOURCE = (line: string) => `module.exports.recipe = function (id, v) {\n  // ${line}\n  return { meta: { id, v }, build: () => null };\n};\n`;

suite("auto-accept rules", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  let gh: ReturnType<typeof fakeGitHub>;
  const who: Record<string, { id: string; cookie: string }> = {};
  let token = "";
  let n = 0;

  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie: who[as].cookie };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await api.fetch(new Request(`http://play.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r.status, data: await r.json().catch(() => null) };
  };
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
  const intent = async (id: string) => (await call("ada", "GET", `/api/intents/${id}`)).data;
  const stageOf = async (id: string) => (await intent(id)).stage as string;
  /** an intent specified (declaring `work_kind` where given), approved by ada where it waits at Specify, its check passed */
  const readyIntent = async (title: string, o: { work_kind?: string[]; kind?: string; depends_on?: string[] } = {}) => {
    const i = await tool("add_intent", { title, ...o });
    await tool("specify_intent", { intent: i.id, ...SPEC });
    if ((await stageOf(i.id)) === "specify") expect((await call("ada", "POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] });
    return i.id as string;
  };
  /** the rule set's Main replaced by `rules`, as every change of it is: an intent of a person's, accepted by ada */
  const setRules = async (rules: Rule[]) => {
    const i = await readyIntent("The rules for a test", { work_kind: [SCHEMA.rules] });
    const p = await tool("propose_doc_version", { doc: RULES, whole: { ...RULES_V1, rules }, note: "the rules for a test", intent: i });
    expect(p.error).toBeUndefined();
    expect(await stageOf(i)).toBe("proposal");
    expect((await call("ada", "POST", `/api/intents/${i}/accept`)).data.stage).toBe("accepted");
    expect((await docs.readDoc(db, RULES_DOC)).json.rules).toEqual(rules);
  };
  const mainHash = async () => (await docs.versionsOf(db, RULES_DOC)).at(-1)!.contentHash;
  const rule = (label: string, gates: Rule["gates"], match: Rule["match"]): Rule => ({ id: crypto.randomUUID(), label, gates, match, reason: `a test: ${label}` });

  let prs = 500;
  let commits = 5000;
  /** a pull request open into main, mergeable, its checks green on its head (more: a draft, a conflict …) */
  const openPull = (title: string, more: Record<string, unknown> = {}, checks = [green("play / API and site"), green("website / build")]) => {
    const pr = ++prs;
    const head = sha(++commits);
    gh.pulls.set(pr, { number: pr, state: "open", merged: false, merge_commit_sha: null, mergeable: true, base: { ref: "main" }, head: { sha: head, ref: `claude/${pr}` }, html_url: `https://github.test/${REPO}/pull/${pr}`, title, ...more } as any);
    gh.checks.set(head, checks);
    gh.merges.set(pr, sha(++commits));
    return { pr, head };
  };
  /** an intent of code: specified, approved, its checks recorded by the box on `head` with its pull request named */
  const codeIntent = async (title: string, pull: { pr: number; head: string }, checked = pull.head) => {
    const i = await tool("add_intent", { title, kind: "improve", work_kind: ["code"] });
    await tool("specify_intent", { intent: i.id, ...SPEC });
    if ((await stageOf(i.id)) === "specify") await call("ada", "POST", `/api/intents/${i.id}/approve`);
    const r = await tool("check_intent", { intent: i.id, pr: pull.pr, results: [{ check: "c1", pass: true, evidence: "exit 0", commit: checked }] });
    return { id: i.id as string, r };
  };
  const clearShips = () => db.query(`UPDATE play.intents SET stage = 'archived' WHERE stage = 'ship'`);

  beforeAll(async () => {
    name = `play_rules_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    await initSessions(db);
    gh = fakeGitHub();
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0), github: gh.gh });
    const made = await createHuman(db, "ada");
    who.ada = { id: made.id, cookie: `play_session=${tokenFor(made.id)}` };
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [who.ada.id]);
    const t = (await call("ada", "POST", "/api/tokens", { name: "agent" })).data;
    token = t.token;
    // the box's token: what decides a code intent is recorded with it alone
    await call("ada", "POST", `/api/tokens/${t.id}/avenbox`, { avenbox: true });
  });
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  // ---- c1

  test("one decision path: approve, accept, accept work and Accept into Ship, by a person and by a rule, each through decided", async () => {
    const seen: string[] = [];
    const real = decisions.decided;
    decisions.decided = async (q, id, move, by, o) => {
      seen.push(`${move} by ${typeof by === "string" ? "a person" : "a rule"}`);
      return real(q, id, move, by, o);
    };
    try {
      // a person: a spec approved; an intent accepted; its work accepted; Accept into Ship
      const plain = await readyIntent("Accepted by a person");
      expect((await call("ada", "POST", `/api/intents/${plain}/accept`)).data.stage).toBe("accepted");
      const work = await readyIntent("Its work accepted by a person");
      expect((await tool("add_artifact", { ...ARTIFACT("https://rules.example/c1-person"), intent: work })).stage).toBe("proposal");
      expect((await call("ada", "POST", `/api/intents/${work}/accept`)).data.decision.status).toBe("accepted");
      const pull = openPull("Shipped by a person");
      const code = await codeIntent("Shipped by a person", pull);
      expect(code.r.stage).toBe("proposal");
      expect((await call("ada", "POST", `/api/intents/${code.id}/accept`)).data.stage).toBe("ship");
      await clearShips();
      // a rule: a spec approved and its work accepted (the first rule, an artifact with no intent named)
      const own = await tool("add_artifact", ARTIFACT("https://rules.example/c1-rule"));
      expect(own.stage).toBe("accepted");
      // a rule: an intent accepted, and Accept into Ship
      await setRules([rule("Fixes pass", ["accept"], { kind: ["fix"], code: false }), rule("Code passes", ["accept"], { code: true })]);
      const fix = await readyIntent("A fix a rule accepts", { kind: "fix" });
      expect(await stageOf(fix)).toBe("accepted");
      const shipped = await codeIntent("Shipped by a rule", openPull("Shipped by a rule"));
      expect(await stageOf(shipped.id)).toBe("ship");
      await clearShips();
    } finally {
      decisions.decided = real;
    }
    await setRules([FIRST_RULE]);
    for (const move of ["approve", "accept", "accept_work", "ship"])
      for (const by of ["a person", "a rule"]) expect([move, by, seen.includes(`${move} by ${by}`)]).toEqual([move, by, true]);
  });

  // ---- c2

  test("the rule set is a document: v1 the first rule, changed only on an intent variant, reaching Main only by an admin's Accept, held to its schema", async () => {
    // after migrate: the schema and the rule set, v1 holding exactly the first rule
    const schema = await docs.readDoc(db, `schema:${SCHEMA.rules}`);
    expect(schema.json).toMatchObject({ type: "rules", name: "rules/1" });
    const v1 = (await docs.versionsOf(db, RULES_DOC))[0];
    expect(v1.number).toBe(1);
    expect((await tool("doc_at", { doc: RULES, version: 1 })).json.rules).toEqual([{ id: RULE.artifacts, label: "Artifacts need no tap", gates: ["approve", "accept"], match: { via: ["mcp"], work_kind: [SCHEMA.artifact], schemas: [SCHEMA.artifact] }, reason: FIRST_RULE.reason }]);
    expect((await tool("list_docs", { kind: "rules" })).map((d: any) => d.id)).toEqual([RULES]);
    const before = (await docs.readDoc(db, RULES_DOC)).json;
    // no edit without an intent
    const none = await tool("doc_edit", { doc: RULES, message: "no intent", edits: [{ op: "set", path: ["note"], value: "x" }] });
    expect(none.error).toContain("intent");
    // on an intent variant: Main as it was until an admin's Accept
    const i = await readyIntent("A rule more", { work_kind: [SCHEMA.rules] });
    const more = rule("Stories by ada", ["approve"], { author: [who.ada.id], work_kind: [SCHEMA.story] });
    const e = await tool("doc_edit", { doc: RULES, intent: i, message: "a rule more", edits: [{ op: "set", path: ["rules"], value: [FIRST_RULE, more] }] });
    expect(e.error).toBeUndefined();
    // held to the schema: an unknown gate, a match field the schema lacks, an author that is no UUID
    for (const bad of [
      { ...more, gates: ["merge"] },
      { ...more, match: { colour: ["red"] } },
      { ...more, match: { author: ["ada"] } },
    ]) {
      const r = await tool("doc_edit", { doc: RULES, intent: i, message: "a bad rule", edits: [{ op: "set", path: ["rules"], value: [FIRST_RULE, bad] }] });
      expect([JSON.stringify(bad), r.error]).toEqual([JSON.stringify(bad), expect.stringMatching(/rules\[1\]/)]);
    }
    const p = await tool("propose_doc_version", { doc: RULES, variant: e.variant, note: "a rule more", intent: i });
    expect(p.error).toBeUndefined();
    expect(await stageOf(i)).toBe("proposal");
    expect((await docs.readDoc(db, RULES_DOC)).json).toEqual(before);
    expect((await call("ada", "POST", `/api/intents/${i}/accept`)).data.decision.status).toBe("accepted");
    expect((await docs.readDoc(db, RULES_DOC)).json.rules).toEqual([FIRST_RULE, more]);
    // its history, as every document's
    expect((await tool("doc_history", { doc: RULES })).versions.map((v: any) => v.number).slice(0, 1)).toEqual([1]);
    await setRules([FIRST_RULE]);
  });

  // ---- c3

  test("other kinds still need a person: with v1 in force, anything but only artifacts over MCP is approved and accepted only by an admin", async () => {
    expect((await docs.readDoc(db, RULES_DOC)).json.rules).toEqual([FIRST_RULE]);
    for (const declared of [[SCHEMA.artifact, SCHEMA.story], [SCHEMA.story], ["code"], undefined]) {
      const i = await tool("add_intent", { title: `Declares ${declared ?? "nothing"}`, ...(declared ? { work_kind: declared } : {}) });
      expect((await tool("specify_intent", { intent: i.id, ...SPEC })).stage).toBe("specify");
      expect((await intent(i.id)).auto).toEqual({});
    }
    // an intent of the web (not over MCP), declaring only artifacts: waits at Specify too
    const web = await tool("add_intent", { title: "Of the web", work_kind: [SCHEMA.artifact] });
    await db.query(`UPDATE play.intents SET via = 'web' WHERE id = $1`, [web.id]);
    expect((await tool("specify_intent", { intent: web.id, ...SPEC })).stage).toBe("specify");
    expect((await call("ada", "POST", `/api/intents/${web.id}/approve`)).data).toMatchObject({ stage: "build", approved_by: "ada", auto: {} });
    // at Proposal, a story's version waits for a person, and is accepted by ada
    const s = await readyIntent("A story waits", { work_kind: [SCHEMA.story] });
    const st = await tool("propose_story", { title: "A film that waits", body: BODY, note: "v1", intent: s });
    expect(st.stage).toBe("proposal");
    expect(await stageOf(s)).toBe("proposal");
    const d = (await call("ada", "POST", `/api/intents/${s}/accept`)).data;
    expect(d).toMatchObject({ stage: "accepted", decided_by: "ada", auto: {} });
  });

  // ---- c4

  test("no tap for an artifact: add_artifact and update_artifact without an intent make their own, which the first rule approves and accepts", async () => {
    const waiting = async () => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM play.intents WHERE stage IN ('specify', 'build', 'proposal') AND title LIKE '%no tap%'`)).rows[0].n);
    for (const origin of ["human", "agent"]) {
      const url = `https://rules.example/no-tap-${origin}`;
      const r = await tool("add_artifact", ARTIFACT(url, `A page with no tap, ${origin}`, origin));
      expect(r).toMatchObject({ stage: "accepted", url, origin, kept: false, waiting: false });
      const i = await intent(r.intent);
      expect(i).toMatchObject({ stage: "accepted", via: "mcp", kind: "idea", title: `Keep A page with no tap, ${origin}`, work_kind: [SCHEMA.artifact], approved_by: null, decided_by: null, author: "ada" });
      const hash = await mainHash();
      expect(i.auto.approve).toMatchObject({ rule: RULE.artifacts, label: "Artifacts need no tap", rules: hash, reason: FIRST_RULE.reason });
      expect(i.auto.accept).toMatchObject({ rule: RULE.artifacts, rules: hash });
      expect(i.spec.checks).toEqual([expect.objectContaining({ id: "c1", how: "look", must: true })]);
      expect(i.results.c1.pass).toBe(true);
      expect(i.work).toMatchObject({ kind: "artifact_version", doc: r.id });
      // kept and listed
      expect(await tool("get_artifact", { artifact: r.id })).toMatchObject({ url, title: `A page with no tap, ${origin}`, intent: null });
      expect((await tool("list_artifacts", { q: "no tap", limit: 50 })).artifacts.map((a: any) => a.id)).toContain(r.id);
      // corrected the same way: its v2
      if (origin === "human") {
        const c = await tool("update_artifact", { artifact: r.id, title: "A page with no tap, corrected" });
        expect(c).toMatchObject({ stage: "accepted", title: "A page with no tap, corrected", waiting: false });
        expect(await intent(c.intent)).toMatchObject({ kind: "improve", title: `Correct A page with no tap, ${origin}`, approved_by: null, decided_by: null, auto: { accept: { rule: RULE.artifacts } } });
        expect((await tool("doc_history", { doc: r.id })).versions.map((v: any) => v.number)).toEqual([1, 2]);
      }
    }
    // nothing waits on the board
    expect(await waiting()).toBe(0);
    // named with an intent, held to that intent's gate as before
    const idea = await tool("add_intent", { title: "Named, at Idea" });
    expect((await tool("add_artifact", { ...ARTIFACT("https://rules.example/named"), intent: idea.id })).error).toMatch(/idea stage/);
  });

  // ---- c5

  test("declared work: only the declared kinds are taken; one declaring only artifacts is approved by the first rule", async () => {
    // approved by the first rule: one declaring only the artifact schema; not one declaring nothing, or also a story or code
    const only = await tool("add_intent", { title: "Declares an artifact", work_kind: [SCHEMA.artifact] });
    expect((await tool("specify_intent", { intent: only.id, ...SPEC })).stage).toBe("build");
    expect((await intent(only.id)).auto.approve).toMatchObject({ rule: RULE.artifacts });
    for (const declared of [undefined, [SCHEMA.artifact, SCHEMA.story], [SCHEMA.artifact, "code"]]) {
      const i = await tool("add_intent", { title: "Declares more", ...(declared ? { work_kind: declared } : {}) });
      expect([declared, (await tool("specify_intent", { intent: i.id, ...SPEC })).stage]).toEqual([declared, "specify"]);
    }
    // a kind no schema is: refused
    expect((await tool("add_intent", { title: "Declares a colour", work_kind: ["red"] })).error).toMatch(/schema's UUID or code/);
    // its checks passed: at Proposal, no work yet (no rule accepts it: its work is no artifact yet)
    await tool("check_intent", { intent: only.id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] });
    expect(await stageOf(only.id)).toBe("proposal");
    const count = async () => {
      const out: Record<string, number> = {};
      for (const t of ["intent_variants", "doc_variants", "story_versions", "asset_versions", "doc_edits"]) out[t] = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM play.${t}`)).rows[0].n);
      return out;
    };
    const before = await count();
    // any other kind: refused naming the declared kinds, nothing written
    const story = await tool("propose_story", { title: "Not an artifact", body: BODY, note: "v1", intent: only.id });
    expect(story.error).toContain(`declares its work as ${SCHEMA.artifact}`);
    const asset = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: "Not an artifact", source: SOURCE("no"), note: "v1", intent: only.id });
    expect(asset.error).toContain(`declares its work as ${SCHEMA.artifact}`);
    const pr = await tool("check_intent", { intent: only.id, pr: 4242, results: [{ check: "c1", pass: true, evidence: "exit 0", commit: sha(4242) }] });
    expect(pr.error).toContain(`declares its work as ${SCHEMA.artifact}`);
    expect(await count()).toEqual(before);
    expect((await intent(only.id)).pull_request).toBeNull();
    // its own kind: taken, and accepted by the first rule
    const ok = await tool("add_artifact", { ...ARTIFACT("https://rules.example/declared"), intent: only.id });
    expect(ok.error).toBeUndefined();
    expect(await intent(only.id)).toMatchObject({ stage: "accepted", decided_by: null, auto: { accept: { rule: RULE.artifacts } } });
    // its declaration changes only while it holds no work
    const held = await readyIntent("Holds work", { work_kind: [SCHEMA.story] });
    await tool("propose_story", { title: "A film it holds", body: BODY, note: "v1", intent: held });
    expect((await tool("step_back_intent", { intent: held, reason: "a test" })).error).toBeString();
  });

  // ---- c6

  test("the rules are always a person's: with rules matching everything, an intent changing the rules or their schema waits for an admin", async () => {
    await setRules([rule("Everything", ["approve", "accept"], {})]);
    // anything else passes both gates
    const any = await readyIntent("Passes everything");
    expect(await intent(any)).toMatchObject({ stage: "accepted", approved_by: null, decided_by: null, auto: { approve: { label: "Everything" }, accept: { label: "Everything" } } });
    // declaring the rules, or a schema: waits at Specify until ada approves it
    const back = await tool("add_intent", { title: "The first rule back", work_kind: [SCHEMA.rules] });
    expect((await tool("specify_intent", { intent: back.id, ...SPEC })).stage).toBe("specify");
    const schema = await tool("add_intent", { title: "The rules' schema's note", work_kind: [SCHEMA.meta] });
    expect((await tool("specify_intent", { intent: schema.id, ...SPEC })).stage).toBe("specify");
    for (const id of [back.id, schema.id]) {
      expect(await intent(id)).toMatchObject({ stage: "specify", auto: {} });
      expect((await call("ada", "POST", `/api/intents/${id}/approve`)).data.stage).toBe("build");
      await tool("check_intent", { intent: id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] });
      expect(await stageOf(id)).toBe("proposal");
    }
    // their work waits at Proposal until ada accepts it
    expect((await tool("doc_edit", { doc: SCHEMA.rules, intent: schema.id, message: "a note", edits: [{ op: "set", path: ["note"], value: "The auto-accept rules." }] })).error).toBeUndefined();
    const sv = (await tool("doc_history", { doc: SCHEMA.rules })).variants.find((x: any) => x.intent?.id === schema.id).id;
    expect((await tool("propose_doc_version", { doc: SCHEMA.rules, variant: sv, note: "a note", intent: schema.id })).error).toBeUndefined();
    expect((await tool("propose_doc_version", { doc: RULES, whole: { ...RULES_V1, rules: [FIRST_RULE] }, note: "the first rule back", intent: back.id })).error).toBeUndefined();
    for (const id of [back.id, schema.id]) {
      expect(await intent(id)).toMatchObject({ stage: "proposal", decided_by: null });
      expect((await intent(id)).auto.accept).toBeUndefined();
      expect(await autoMove({ db }, id)).toBeNull();
    }
    expect((await call("ada", "POST", `/api/intents/${schema.id}/accept`)).data.decision.status).toBe("accepted");
    expect((await call("ada", "POST", `/api/intents/${back.id}/accept`)).data).toMatchObject({ stage: "accepted", decided_by: "ada" });
    // one declaring nothing whose work is the rules, under a rule that names the rules' own schema at accept: its spec
    // passes by the rule (nothing says yet what it changes), its work waits for ada
    await setRules([rule("Every spec", ["approve"], {}), rule("The rules pass", ["accept"], { schemas: [SCHEMA.rules, SCHEMA.meta] })]);
    const sly = await readyIntent("Declares nothing, changes the rules");
    expect(await intent(sly)).toMatchObject({ stage: "proposal", approved_by: null, auto: { approve: { label: "Every spec" } } });
    expect((await tool("propose_doc_version", { doc: RULES, whole: { ...RULES_V1, rules: [] }, note: "no rules at all", intent: sly })).error).toBeUndefined();
    expect(await intent(sly)).toMatchObject({ stage: "proposal", decided_by: null });
    expect((await intent(sly)).auto.accept).toBeUndefined();
    expect(await autoMove({ db }, sly)).toBeNull();
    expect((await call("ada", "POST", `/api/intents/${sly}/archive`)).data.decision.status).toBe("archived");
    const back2 = await readyIntent("The first rule back again", { work_kind: [SCHEMA.rules] });
    expect((await tool("propose_doc_version", { doc: RULES, whole: { ...RULES_V1, rules: [FIRST_RULE] }, note: "the first rule back", intent: back2 })).error).toBeUndefined();
    expect(await stageOf(back2)).toBe("proposal");
    expect((await call("ada", "POST", `/api/intents/${back2}/accept`)).data).toMatchObject({ stage: "accepted", decided_by: "ada" });
    expect((await docs.readDoc(db, RULES_DOC)).json.rules).toEqual([FIRST_RULE]);
    // and in matchRule itself, whatever the rules
    const everything = { rules: [rule("Everything", ["approve", "accept"], {})] };
    const facts = { kind: "idea", via: "mcp", author: null, work_kind: null, proposed_by: null, proposed_via: "mcp", code: false, docs: [RULES_DOC], schemas: [SCHEMA.rules], new_only: false, edits: 1 };
    expect(matchRule(facts, "accept", everything)).toBeNull();
    expect(matchRule({ ...facts, docs: [`schema:${SCHEMA.rules}`], schemas: [SCHEMA.meta] }, "accept", everything)).toBeNull();
    expect(matchRule({ ...facts, docs: ["artifact:x"], schemas: [SCHEMA.artifact] }, "accept", everything)?.label).toBe("Everything");
  });

  // ---- c7

  test("held is held: a matching intent held by a dependency is moved only once that one is Accepted; failing must checks move nothing", async () => {
    // the dependency, in Build
    const dep = (await tool("add_intent", { title: "The dependency" })).id;
    await tool("specify_intent", { intent: dep, ...SPEC });
    await call("ada", "POST", `/api/intents/${dep}/approve`);
    // with no rules in force, an artifact's intent at Proposal with its work, then made to depend on it, then the first rule back
    await setRules([]);
    const held = await readyIntent("Held, then kept", { work_kind: [SCHEMA.artifact] });
    expect((await tool("add_artifact", { ...ARTIFACT("https://rules.example/held"), intent: held })).stage).toBe("proposal");
    expect((await tool("depend_intent", { intent: held, on: dep })).held_by.map((d: any) => d.id)).toEqual([dep]);
    await setRules([FIRST_RULE]);
    // the rule matches it, but it is held: not moved
    expect(await autoMove({ db }, held)).toBeNull();
    expect(await intent(held)).toMatchObject({ stage: "proposal", sub: { state: "idle" }, auto: {} });
    // the dependency Accepted (by ada): the rule moves it then
    await tool("check_intent", { intent: dep, results: [{ check: "c1", pass: true, evidence: "exit 0" }] });
    expect((await call("ada", "POST", `/api/intents/${dep}/accept`)).data.stage).toBe("accepted");
    expect(await intent(held)).toMatchObject({ stage: "accepted", decided_by: null, auto: { accept: { rule: RULE.artifacts } } });
    // failing must checks: in Build, not moved
    const failing = (await tool("add_intent", { title: "Its must fails", work_kind: [SCHEMA.artifact] })).id;
    await tool("specify_intent", { intent: failing, ...SPEC });
    expect(await stageOf(failing)).toBe("build");
    await tool("check_intent", { intent: failing, results: [{ check: "c1", pass: false, evidence: "exit 1" }] });
    expect(await stageOf(failing)).toBe("build");
    expect(await autoMove({ db }, failing)).toBeNull();
  });

  // ---- c8

  test("code only goes to Ship: an intent of code a rule accepts is in Ship by Ship's steps; one Accept refuses stays at Proposal saying why", async () => {
    await clearShips();
    // a person's Accept, for its steps
    const mine = await codeIntent("Shipped by ada", openPull("Shipped by ada"));
    expect((await call("ada", "POST", `/api/intents/${mine.id}/accept`)).data.stage).toBe("ship");
    const steps = (await intent(mine.id)).ship.steps.map((s: any) => s.key);
    await clearShips();
    await setRules([rule("Code passes", ["accept"], { code: true, work_kind: ["code"] })]);
    // a rule's Accept: in Ship, Ship's own steps, 'Intent accepted' posted on the head and the pull request merged by Ship
    const from = gh.calls.length;
    const pull = openPull("Shipped by a rule");
    const ruled = await codeIntent("Shipped by a rule", pull);
    const i = await intent(ruled.id);
    expect(i).toMatchObject({ stage: "ship", decided_by: null, auto: { accept: { label: "Code passes" } }, ship: { pr: pull.pr, head: pull.head, by: "rule Code passes" } });
    expect(i.ship.steps.map((s: any) => s.key)).toEqual(steps);
    const writes = gh.calls.slice(from).filter((c) => c.method !== "GET").map((c) => c.path);
    expect(writes).toEqual([`/statuses/${pull.head}`, `/pulls/${pull.pr}/merge`]);
    await clearShips();
    // refused by Accept: a draft, a red required check, a conflict, a head not the one checked: at Proposal, saying why
    const cases: [string, ReturnType<typeof openPull>, string | undefined, RegExp][] = [
      ["a draft", openPull("A draft", { draft: true }), undefined, /draft/],
      ["red", openPull("Red", {}, [green("play / API and site"), { ...green("website / build"), conclusion: "failure" }]), undefined, /failure/],
      ["a conflict", openPull("A conflict", { mergeable: false }), undefined, /conflicts with main/],
      ["not the head checked", openPull("Moved"), sha(99), /head moved past the checked commit/],
    ];
    for (const [what, p, checked, why] of cases) {
      const c = await codeIntent(`Refused: ${what}`, p, checked);
      expect([what, c.r.stage, c.r.auto_refused]).toEqual([what, "proposal", expect.stringMatching(why)]);
      expect([what, await intent(c.id)]).toEqual([what, expect.objectContaining({ stage: "proposal", decided_by: null, auto: {} })]);
    }
    expect(gh.calls.filter((c) => c.method !== "GET" && cases.some(([, p]) => c.path.includes(`${p.pr}`) || c.path.includes(p.head))).length).toBe(0);
    await setRules([FIRST_RULE]);
  });

  // ---- c9

  test("an admin still decides after a rule: stepped back or rejected as any, its auto.approve cleared; accepted work applied", async () => {
    const declare = async (title: string) => {
      const i = (await tool("add_intent", { title, work_kind: [SCHEMA.artifact] })).id;
      await tool("specify_intent", { intent: i, ...SPEC });
      expect(await intent(i)).toMatchObject({ stage: "build", approved_by: null, auto: { approve: { rule: RULE.artifacts } } });
      return i as string;
    };
    // stepped back, by its agent
    const back = await declare("Stepped back after a rule");
    const s = await tool("step_back_intent", { intent: back, reason: "its spec is wrong" });
    expect(s).toMatchObject({ stage: "specify", approved_at: null, auto: {} });
    // rejected, by ada
    const no = await declare("Rejected after a rule");
    expect((await call("ada", "POST", `/api/intents/${no}/reject`)).data).toMatchObject({ stage: "archived", auto: {} });
    // accepted by the rule: what a person's Accept leaves, its work applied
    const kept = await tool("add_artifact", ARTIFACT("https://rules.example/after"));
    expect(kept.stage).toBe("accepted");
    expect((await tool("get_artifact", { artifact: kept.id })).url).toBe("https://rules.example/after");
    const reopen = await call("ada", "POST", `/api/intents/${kept.intent}/reopen`);
    expect(reopen.data.error).toMatch(/Its work is in/);
  });
});
