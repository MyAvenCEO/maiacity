// Intents depend on intents (src/intents.ts mayMove and heldBy, play/SPEC.md §4.12; intent
// 420ee348-132f-4b04-a67d-082ae8b72efc) against a real Postgres (TEST_DATABASE_URL) and a fake GitHub (./fixtures/github.ts).
// An intent may name the intents it depends on, each by its UUID; while any of them is not shipped (Accepted) it is held
// at every forward gate: approve, Proposal on its checks, work proposed for it, accept, Accept and ship, Ship's turn.
// Every forward gate is one function, mayMove: a stub of it refusing everything makes every forward path refuse.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import { gate } from "../src/intents";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { Rate } from "../src/limits";
import { watchShips, type Pull } from "../src/ship";
import { fakeGitHub, green, job, REPO, run, sha } from "./fixtures/github";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

const SOURCE = "module.exports.recipe = function (id, v) {\n  return { meta: { id, v } };\n};\n";
const SPEC = {
  goal: "Something of play's is made.",
  nothing_to_reduce: "A test fixture: nothing to reduce.",
  scope: "play/api/src: something small.",
  checks: [
    { check: "Its tests pass", how: "test", by: "bun test", run: "cd play/api && bun test" },
    { check: "It looks right", how: "look", by: "the board", must: false },
  ],
};

suite("intents depend on intents", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  let gh: ReturnType<typeof fakeGitHub>;
  const who: Record<string, { id: string; cookie: string }> = {};
  const tokens: Record<string, string> = {};

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
    gh = fakeGitHub();
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0), github: gh.gh });
    for (const n of ["ada", "bea"]) {
      const h = await createHuman(db, n);
      who[n] = { id: h.id, cookie: `play_session=${tokenFor(h.id)}` };
    }
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = ANY($1)`, [[who.ada.id, who.bea.id]]);
    for (const n of ["ada", "bea"]) {
      const made = (await call(n, "POST", "/api/tokens", { name: "agent" })).data;
      tokens[n] = made.token;
      // avenBOX's tokens (play/SPEC.md §4.12): a code intent's results on a commit, and its pull request, are taken from them alone
      await call(n, "POST", `/api/tokens/${made.id}/avenbox`, { avenbox: true });
    }
  });

  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie: who[as].cookie };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await api.fetch(new Request(`http://play.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  let n = 0;
  const tool = async (name: string, args: Record<string, unknown>, as = "ada"): Promise<any> => {
    const r = await api.fetch(
      new Request("http://play.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens[as]}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }),
      }),
    );
    if (r.status !== 200) return { error: `${r.status}` };
    const j = await r.json();
    if (j.error) return { error: j.error.message as string };
    const text = j.result.content[0].text;
    return j.result.isError ? { error: text as string } : JSON.parse(text);
  };
  const intent = async (id: string) => (await call("ada", "GET", `/api/intents/${id}`)).data;
  const decide = (id: string, verdict: string) => call("ada", "POST", `/api/intents/${id}/${verdict}`);
  const depend = (id: string, on: string, drop?: boolean) => tool("depend_intent", { intent: id, on, ...(drop ? { drop } : {}) });
  /** the refusal mayMove gives an intent held by `deps` */
  const heldText = (id: string, deps: { id: string; title: string; stage: string }[]) =>
    `Intent ${id} is held: it depends on intents not shipped yet: ${deps.map((d) => `${d.id} (${d.title}, at ${d.stage})`).join("; ")}.`;

  let k = 0;
  const add = async (title = `Intent ${++k}`) => (await tool("add_intent", { title: `${title} ${k++}`, kind: "improve" })) as { id: string; title: string };
  const specified = async (title?: string) => {
    const i = await add(title);
    expect((await tool("specify_intent", { intent: i.id, ...SPEC })).stage).toBe("specify");
    return i;
  };
  const built = async () => {
    const i = await specified();
    expect((await decide(i.id, "approve")).data.stage).toBe("build");
    return i;
  };
  const passed = (id: string, more: Record<string, unknown> = {}) => tool("check_intent", { intent: id, results: [{ check: "c1", pass: true, evidence: "bun test: 0 fail", ...more }] });
  const atProposal = async () => {
    const i = await built();
    expect((await passed(i.id)).stage).toBe("proposal");
    return i;
  };
  let prs = 500;
  let commits = 5000;
  /** an intent of code at Proposal, its pull request open, mergeable, its checks green on its head */
  const codeAtProposal = async (more: Partial<Pull> = {}) => {
    const i = await built();
    const pr = ++prs;
    const head = sha(++commits);
    expect((await tool("check_intent", { intent: i.id, pr, results: [{ check: "c1", pass: true, evidence: "0 fail", commit: head }] })).stage).toBe("proposal");
    gh.pulls.set(pr, {
      number: pr, state: "open", merged: false, merge_commit_sha: null, mergeable: true, base: { ref: "main" }, head: { sha: head, ref: `claude/${pr}` },
      html_url: `https://github.test/${REPO}/pull/${pr}`, title: i.title, ...more,
    });
    gh.checks.set(head, [green("play / API and site"), green("website / build")]);
    gh.merges.set(pr, sha(++commits));
    return { ...i, pr, head, merge: gh.merges.get(pr)! };
  };
  const allGreen = (merge: string, base: number) => {
    gh.runs["main.yml"].push(run(base + 1, merge, { status: "completed", conclusion: "success" }));
    gh.runs["release.yml"].push(run(base + 2, merge, { display_title: `release ${merge}`, event: "workflow_run", status: "completed", conclusion: "success" }));
    gh.runs["production.yml"].push(run(base + 3, merge, { event: "workflow_dispatch", status: "completed", conclusion: "success" }));
    gh.jobs.set(base + 3, [
      job(base + 31, "Main is green", "completed", "success"),
      job(base + 32, "The image", "completed", "success"),
      job(base + 33, "The server", "completed", "success", [{ name: "Back up play", status: "completed", conclusion: "success" }]),
      job(base + 34, "The website", "completed", "success"),
    ]);
  };
  const clearShips = () => db.query(`UPDATE play.intents SET stage = 'archived' WHERE stage = 'ship'`);
  /** the pull requests play merged, since call `from` */
  const merged = (from = 0) => gh.calls.slice(from).filter((c) => c.method === "PUT").map((c) => c.path);
  const setStage = (id: string, stage: string) =>
    db.query(`UPDATE play.intents SET stage = $2, approved_at = CASE WHEN $2 IN ('idea', 'specify') THEN approved_at ELSE now() END WHERE id = $1`, [id, stage]);

  /**
   * One intent placed at each forward gate, then made to depend on `dep` (an edge is taken at any stage), and every gate
   * tried: approve, Proposal on its checks, a propose tool's intent, accept, Accept and ship. Gives each one's answer:
   * its refusal's text, or null where it went through.
   */
  const everyGate = async (dep: string) => {
    const atSpecify = await specified();
    const inBuild = await built();
    const forWork = await built();
    expect((await passed(forWork.id)).stage).toBe("proposal");
    const toAccept = await atProposal();
    const toShip = await codeAtProposal();
    for (const i of [atSpecify, inBuild, forWork, toAccept, toShip]) expect((await depend(i.id, dep)).error).toBeUndefined();
    const refusal = (r: { status: number; data: any }) => (r.status === 200 ? null : r.data.error);
    const approve = refusal(await decide(atSpecify.id, "approve"));
    const checked = await passed(inBuild.id);
    const proposal = checked.stage === "proposal" ? null : checked.error;
    const work = await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: `Fern ${++k}`, source: SOURCE, note: "x", intent: forWork.id });
    const accept = refusal(await decide(toAccept.id, "accept"));
    const ship = refusal(await decide(toShip.id, "accept"));
    await clearShips();
    return { ids: { approve: atSpecify.id, proposal: inBuild.id, work: forWork.id, accept: toAccept.id, ship: toShip.id }, approve, proposal, work: work.error ?? null, accept, ship };
  };

  test("one forward gate: every forward path asks mayMove, a held intent refused with its text, a stub refusing everything refusing every path", async () => {
    const from = gh.calls.length;
    const dep = await add("A dependency");
    const g = await everyGate(dep.id);
    for (const at of ["proposal", "work", "accept", "ship"] as const)
      expect(g[at]).toBe(heldText((g.ids as any)[at], [{ id: dep.id, title: dep.title, stage: "idea" }]));
    expect(g.approve).toBeNull();
    // nothing moved: each held where it was, its results kept
    expect((await intent(g.ids.approve)).stage).toBe("build");
    expect(await intent(g.ids.proposal)).toMatchObject({ stage: "build", results: null });
    expect((await intent(g.ids.work)).work).toBeNull();
    expect((await intent(g.ids.accept)).stage).toBe("proposal");
    expect((await intent(g.ids.ship)).stage).toBe("proposal");
    expect(merged(from)).toEqual([]);

    // a stub of mayMove refusing everything: every forward path refuses, none testing the stage on its own
    const atSpecify = await specified();
    const inBuild = await built();
    const forWork = await atProposal();
    const toAccept = await atProposal();
    const toShip = await codeAtProposal();
    const withWork = await atProposal();
    expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: `Fern ${++k}`, source: SOURCE, note: "x", intent: withWork.id })).error).toBeUndefined();
    // in Ship, waiting its turn behind another (only a waiting intent is accepted, intent 2bf8af96): its turn is the gate too
    const ahead = await codeAtProposal();
    const pending = { pr: ahead.pr, head: ahead.head, merge: "", by: "ada", round: 1, started: new Date().toISOString(), steps: [{ key: "ready", name: "Ready to merge", state: "running" }], pending: { kind: "merge", head: ahead.head } };
    await db.query(`UPDATE play.intents SET stage = 'ship', decided_at = now() - interval '1 minute', ship = ($2::text)::jsonb WHERE id = $1`, [ahead.id, JSON.stringify(pending)]);
    const waiting = await codeAtProposal();
    expect((await decide(waiting.id, "accept")).data.stage).toBe("ship");
    const real = gate.mayMove;
    const asked: string[] = [];
    gate.mayMove = async (_db, _i, to) => (asked.push(to), { why: "The stub refuses every move." });
    try {
      gh.pulls.get(waiting.pr)!.mergeable = true;
      expect(await decide(atSpecify.id, "approve")).toMatchObject({ status: 409, data: { error: "The stub refuses every move." } });
      expect(await passed(inBuild.id)).toMatchObject({ stage: "build", refused: "The stub refuses every move." });
      expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: `Fern ${++k}`, source: SOURCE, note: "x", intent: forWork.id })).error).toBe("The stub refuses every move.");
      expect(await decide(toAccept.id, "accept")).toMatchObject({ status: 409, data: { error: "The stub refuses every move." } });
      expect(await decide(toShip.id, "accept")).toMatchObject({ status: 409, data: { error: "The stub refuses every move." } });
      expect(await decide(withWork.id, "accept")).toMatchObject({ status: 409, data: { error: "The stub refuses every move." } });
      await watchShips(db, gh.gh);
      expect(await intent(waiting.id)).toMatchObject({ stage: "proposal", ship: { report: { why: "The stub refuses every move." } } });
      // going back asks it nothing
      const before = asked.length;
      expect((await tool("step_back_intent", { intent: inBuild.id, reason: "its spec is unbuildable as written" })).stage).toBe("specify");
      expect((await decide(toAccept.id, "reject")).data.stage).toBe("archived");
      expect((await decide(toAccept.id, "reopen")).data.stage).toBe("specify");
      expect(asked.length).toBe(before);
      expect(new Set(asked)).toEqual(new Set(["build", "proposal", "work", "accept", "ship", "accept_work", "merge"]));
    } finally {
      gate.mayMove = real;
    }
    expect(merged(from)).toEqual([]);
    await clearShips();
  });

  test("no cycle: edges added and dropped; one to itself or one closing a cycle refused, nothing written; a diamond taken", async () => {
    const [a, b, c, d] = [await add("A"), await add("B"), await add("C"), await add("D")];
    const edges = async () => Number((await db.query<any>(`SELECT count(*) AS n FROM play.intent_depends`)).rows[0].n);
    expect((await depend(a.id, b.id)).depends_on).toEqual([{ id: b.id, title: b.title, stage: "idea" }]);
    expect((await depend(b.id, c.id)).error).toBeUndefined();
    const was = await edges();
    expect((await depend(c.id, a.id)).error).toContain("nothing waits on itself");
    expect((await depend(c.id, b.id)).error).toContain("nothing waits on itself");
    expect((await depend(a.id, a.id)).error).toContain("cannot depend on itself");
    expect((await depend(a.id, "00000000-0000-4000-8000-000000000000")).error).toContain("no intent");
    expect((await depend(a.id, "not-a-uuid")).error).toContain("UUID");
    expect(await edges()).toBe(was);
    // dropped, the chain is open the other way
    expect((await depend(b.id, c.id, true)).depends_on).toEqual([]);
    expect((await depend(c.id, a.id)).error).toBeUndefined();
    expect((await depend(c.id, a.id, true)).error).toBeUndefined();
    // a diamond: A on B and C, both on D
    expect((await depend(b.id, d.id)).error).toBeUndefined();
    expect((await depend(a.id, c.id)).error).toBeUndefined();
    expect((await depend(c.id, d.id)).error).toBeUndefined();
    expect((await intent(a.id)).depends_on.map((x: any) => x.id).sort()).toEqual([b.id, c.id].sort());
    expect((await intent(d.id)).needed_by.map((x: any) => x.id).sort()).toEqual([b.id, c.id].sort());
    // and D on A would close it
    expect((await depend(d.id, a.id)).error).toContain("nothing waits on itself");
    // the same edge twice is one
    expect((await depend(a.id, b.id)).depends_on).toHaveLength(2);
  });

  test("held until shipped: at any stage but accepted (Ship and archived too) every gate refuses, naming it; accepted, they go through; reopened, held again", async () => {
    for (const stage of ["specify", "build", "proposal", "ship", "archived"]) {
      const dep = await specified(`Dep at ${stage}`);
      await setStage(dep.id, stage);
      const g = await everyGate(dep.id);
      const deps = [{ id: dep.id, title: dep.title, stage }];
      for (const at of ["proposal", "work", "accept"] as const) expect(g[at]).toBe(heldText((g.ids as any)[at], deps));
      expect(g.approve).toBeNull();
      // Accept and ship: a dependency in Ship is waited for there, so only one not in Ship refuses
      if (stage === "ship") expect(g.ship).toBeNull();
      else expect(g.ship).toBe(heldText(g.ids.ship, deps));
    }
    // accepted: every gate goes through
    const dep = await specified("Dep accepted");
    await setStage(dep.id, "accepted");
    const g = await everyGate(dep.id);
    expect([g.approve, g.proposal, g.work, g.accept, g.ship]).toEqual([null, null, null, null, null]);
    expect((await intent(g.ids.approve)).held_by).toEqual([]);
    // reopened (to Specify): held again at once
    expect((await decide(dep.id, "reopen")).data.stage).toBe("specify");
    const later = await built();
    expect((await depend(later.id, dep.id)).held_by).toEqual([{ id: dep.id, title: dep.title, stage: "specify" }]);
    expect(await passed(later.id)).toEqual({ error: heldText(later.id, [{ id: dep.id, title: dep.title, stage: "specify" }]) });
    expect((await intent(later.id)).results).toBeNull();
    // shipped again: free, it moves on its checks
    await setStage(dep.id, "accepted");
    expect((await passed(later.id)).stage).toBe("proposal");
  });

  test("going back is never held, and specifying is not", async () => {
    const dep = await add("Never shipped");
    // specified while held, and again
    const s = await add();
    expect((await depend(s.id, dep.id)).error).toBeUndefined();
    expect((await tool("specify_intent", { intent: s.id, ...SPEC })).stage).toBe("specify");
    expect((await tool("specify_intent", { intent: s.id, ...SPEC })).stage).toBe("specify");
    expect(await decide(s.id, "approve")).toMatchObject({ status: 200, data: { stage: "build" } });
    // sent back to Specify, from Build and from Proposal
    const p = await built();
    await depend(p.id, dep.id);
    expect((await tool("step_back_intent", { intent: p.id, reason: "its spec is unbuildable as written" })).stage).toBe("specify");
    const q = await atProposal();
    await depend(q.id, dep.id);
    expect((await tool("step_back_intent", { intent: q.id, reason: "its spec is unbuildable as written" })).stage).toBe("specify");
    // rejected, and reopened
    const r = await built();
    await depend(r.id, dep.id);
    expect((await decide(r.id, "reject")).data.stage).toBe("archived");
    expect((await decide(r.id, "reopen")).data.stage).toBe("specify");
    // archived over MCP: its own, at Proposal
    const a = await atProposal();
    await depend(a.id, dep.id);
    expect(await tool("archive_intent", { intent: a.id })).toMatchObject({ intent: a.id, stage: "archived" });
    // its work at Proposal, archived
    const w = await atProposal();
    expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: `Fern ${++k}`, source: SOURCE, note: "x", intent: w.id })).error).toBeUndefined();
    await depend(w.id, dep.id);
    expect((await decide(w.id, "archive")).data.stage).toBe("archived");
    // a code intent at Proposal, rejected
    const c = await codeAtProposal();
    await depend(c.id, dep.id);
    expect((await decide(c.id, "reject")).data.stage).toBe("archived");
  });

  test("ship waits for its dependency: behind it in Ship until it is Accepted; taken back with it; refused with it not in Ship", async () => {
    await clearShips();
    const from = gh.calls.length;
    const b = await codeAtProposal();
    const a = await codeAtProposal();
    expect((await depend(a.id, b.id)).error).toBeUndefined();
    // B not in Ship: Accept refuses, nothing merged
    expect(await decide(a.id, "accept")).toMatchObject({ status: 409, data: { error: heldText(a.id, [{ id: b.id, title: b.title, stage: "proposal" }]) } });
    expect(merged(from)).toEqual([]);
    // B accepted: merged, shipping; A accepted after it waits, its reason naming B
    expect((await decide(b.id, "accept")).data).toMatchObject({ stage: "ship", ship: { pending: null } });
    expect((await decide(a.id, "accept")).data.stage).toBe("ship");
    const ready = async (id: string) => (await intent(id)).ship.steps[0];
    expect(await ready(a.id)).toMatchObject({ state: "running", note: `Waits for ${b.id} (${b.title}, at ship) to ship first` });
    await watchShips(db, gh.gh);
    expect(merged(from)).toEqual([`/pulls/${b.pr}/merge`]);
    // B all green: Accepted, and in that same look A merges
    allGreen(b.merge, 9000);
    await watchShips(db, gh.gh, Date.now(), b.merge);
    expect((await intent(b.id)).stage).toBe("accepted");
    expect(merged(from)).toEqual([`/pulls/${b.pr}/merge`, `/pulls/${a.pr}/merge`]);
    expect((await intent(a.id)).ship).toMatchObject({ merge: a.merge, pending: null });
    await clearShips();

    // B2 goes red on main: back to Proposal, and A2, waiting on it, back with it, its report naming B2
    const b2 = await codeAtProposal();
    const a2 = await codeAtProposal();
    await depend(a2.id, b2.id);
    await decide(b2.id, "accept");
    expect((await decide(a2.id, "accept")).data.stage).toBe("ship");
    gh.runs["main.yml"].push(run(9101, b2.merge, { status: "completed", conclusion: "failure" }));
    await watchShips(db, gh.gh);
    expect((await intent(b2.id)).stage).toBe("proposal");
    const back = await intent(a2.id);
    expect(back.stage).toBe("proposal");
    expect(back.ship.report.why).toBe(heldText(a2.id, [{ id: b2.id, title: b2.title, stage: "proposal" }]));
    expect(merged(from)).not.toContain(`/pulls/${a2.pr}/merge`);
  });

  test("over MCP: add_intent and specify_intent take depends_on; list_intents and get_intent give depends_on, held_by and needed_by; depend_intent is an admin's agent's", async () => {
    const b = await add("Engine");
    const c = await specified("Trailer");
    const a = await tool("add_intent", { title: "Film", depends_on: [b.id, c.id] });
    expect(a.depends_on.map((x: any) => x.id).sort()).toEqual([b.id, c.id].sort());
    expect(a.held_by).toHaveLength(2);
    expect((await tool("add_intent", { title: "Bad", depends_on: ["nope"] })).error).toContain("UUID");
    expect((await tool("add_intent", { title: "Missing", depends_on: ["00000000-0000-4000-8000-000000000001"] })).error).toContain("no intent");
    // get_intent: each with its stage; the one depended on knows who needs it
    await setStage(c.id, "accepted");
    const got = await tool("get_intent", { intent: a.id });
    expect(got.depends_on).toContainEqual({ id: c.id, title: c.title, stage: "accepted" });
    expect(got.held_by).toEqual([{ id: b.id, title: b.title, stage: "idea" }]);
    expect((await tool("get_intent", { intent: b.id })).needed_by).toEqual([{ id: a.id, title: "Film", stage: "idea" }]);
    const listed = (await tool("list_intents", { stage: "all" })).find((x: any) => x.id === a.id);
    expect(listed).toMatchObject({ held_by: [{ id: b.id }], needed_by: [] });
    expect(listed.depends_on).toHaveLength(2);
    // specify_intent's depends_on replaces them; left out, they stay
    expect((await tool("specify_intent", { intent: a.id, ...SPEC, depends_on: [c.id] })).depends_on).toEqual([{ id: c.id, title: c.title, stage: "accepted" }]);
    expect((await tool("specify_intent", { intent: a.id, ...SPEC })).depends_on).toHaveLength(1);
    expect((await tool("specify_intent", { intent: a.id, ...SPEC, depends_on: [a.id] })).error).toContain("itself");
    // the tools' schemas say it
    const r = await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokens.ada}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    const tools = (await r.json()).result.tools as any[];
    for (const t of ["add_intent", "specify_intent"]) expect(tools.find((x) => x.name === t).inputSchema.properties.depends_on.type).toBe("array");
    expect(tools.find((x) => x.name === "depend_intent").inputSchema.required).toEqual(["intent", "on"]);
    // an admin's agent's only: a token whose owner is no admin opens nothing; no route adds one by hand
    await db.query(`UPDATE play.memberships SET level = 'citizen' WHERE human_id = $1`, [who.bea.id]);
    expect((await tool("depend_intent", { intent: a.id, on: b.id }, "bea")).error).toBe("401");
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [who.bea.id]);
    expect((await call("ada", "POST", `/api/intents/${a.id}/depend`, { on: b.id })).status).toBe(404);
    expect((await intent(a.id)).depends_on).toHaveLength(1);
  });
});
