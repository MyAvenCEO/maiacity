// Sub-states (src/substate.ts, play/SPEC.md §4.12 "Sub-states"; intent 2bf8af96-5708-42d2-8556-da35f3f805ba) against a
// real Postgres (TEST_DATABASE_URL) and a fake GitHub (./fixtures/github.ts). Every open intent is failed, waiting,
// working or idle, with its reason, said by one function, subStateOf; the board groups by it and only a waiting intent
// is approved or accepted. Ship's watcher reads the open intents' pull requests (pr_seen); the board asks GitHub nothing.
// Approve spec is never held: a held intent waits in Build, idle, its checks and proposals refused, its brief null.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSkills } from "../import/skills";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";
import { Rate } from "../src/limits";
import { watchTick, type Pull } from "../src/ship";
import { sub, subStateOf, type PrSeen } from "../src/substate";
import { fakeGitHub, green, REPO, sha } from "./fixtures/github";

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
const CHECKS = SPEC.checks.map((c, i) => ({ id: `c${i + 1}`, must: c.must !== false, ...c }));

describe("subStateOf", () => {
  const HEAD = sha(1);
  const now = Date.parse("2026-11-07T12:00:00Z");
  const seen = (more: Partial<PrSeen> = {}): PrSeen => ({
    pr: 7, head: HEAD, draft: false, mergeable: true, state: "open", merged: false, base: "main",
    checks: { "play / API and site": "success", "website / build": "success" }, at: new Date(now - 5_000).toISOString(), ...more,
  });
  const passed = { c1: { pass: true, at: "2026-11-07T11:00:00Z", commit: HEAD } };
  const row = (more: Record<string, unknown> = {}) => ({ stage: "proposal", spec: { checks: CHECKS, nothing_to_reduce: "x" }, results: passed, work: null, pull_request: 7, ship: null, held_by: [], pr_seen: seen(), ...more }) as any;
  const of = (r: any) => subStateOf(r, r.pr_seen, now);

  test("four sub-states: each stage, held or not, a failed must, a red ship, and code whose head moved, whose checks run, whose mergeable is null, false or true, or whose pr_seen is stale", () => {
    const dep = [{ id: "d", title: "The engine", stage: "build" }];
    const table: [string, any, string, string][] = [
      ["an idea", row({ stage: "idea", spec: null, results: null, pull_request: null, pr_seen: null }), "idle", "no agent"],
      ["specified", row({ stage: "specify", results: null, pull_request: null }), "waiting", "Approve spec"],
      ["specified, held", row({ stage: "specify", results: null, pull_request: null, held_by: dep }), "waiting", "Approve spec"],
      ["specified without its reduce step", row({ stage: "specify", spec: { checks: CHECKS }, results: null, pull_request: null }), "working", "reduce step"],
      ["in Build", row({ stage: "build", results: null, pull_request: null }), "working", "being built"],
      ["in Build, held", row({ stage: "build", results: null, pull_request: null, held_by: dep }), "idle", "held: waits for The engine"],
      ["in Build, a must failed", row({ stage: "build", results: { c1: { pass: false } } }), "failed", "c1 failed"],
      ["Ship red", row({ ship: { pr: 7, outcome: "red", report: { step: "main's checks", why: "main's checks are failure", at: "2026-11-07T11:30:00Z" } } }), "failed", "Ship red at main's checks"],
      ["work waiting", row({ work: { kind: "asset" }, pull_request: null, pr_seen: null }), "waiting", "Accept"],
      ["work, held", row({ work: { kind: "asset" }, pull_request: null, pr_seen: null, held_by: dep }), "idle", "held: waits for The engine"],
      ["code ready", row(), "waiting", "Accept and ship"],
      ["code, held", row({ held_by: dep }), "idle", "held: waits for The engine"],
      ["code, its head moved", row({ pr_seen: seen({ head: sha(2) }) }), "working", "moved past the checked commit"],
      ["code, its checks running", row({ pr_seen: seen({ checks: { "play / API and site": "running", "website / build": "success" } }) }), "working", "Waiting for #7's checks (play / API and site)"],
      ["code, mergeable null", row({ pr_seen: seen({ mergeable: null }) }), "working", "Waiting for GitHub to work out whether #7 merges"],
      ["code, mergeable false", row({ pr_seen: seen({ mergeable: false }) }), "failed", "conflicts with main"],
      ["code, a required check red", row({ pr_seen: seen({ checks: { "play / API and site": "failure", "website / build": "success" } }) }), "failed", "'play / API and site' is failure"],
      ["code, a draft", row({ pr_seen: seen({ draft: true }) }), "failed", "is a draft"],
      ["code, pr_seen stale", row({ pr_seen: seen({ at: new Date(now - 61_000).toISOString() }) }), "working", "reading #7 on GitHub"],
      ["code, not read yet", row({ pr_seen: null }), "working", "reading #7 on GitHub"],
      ["in Ship, queued", row({ stage: "ship", ship: { pending: { kind: "merge" }, steps: [{ key: "ready", note: "Queued · behind The engine" }] } }), "idle", "Queued · behind The engine"],
      ["in Ship, waiting for GitHub", row({ stage: "ship", ship: { pending: { kind: "merge" }, steps: [{ key: "ready", note: "Waiting for #7's checks (website / build)" }] } }), "working", "Waiting for #7's checks"],
      ["in Ship, on its way", row({ stage: "ship", ship: { pending: null, steps: [{ key: "ready", state: "green" }, { key: "merged", state: "green" }, { key: "main", name: "main's checks", state: "running" }] } }), "working", "main's checks"],
    ];
    for (const [what, r, state, why] of table) {
      const s = of(r);
      expect({ what, state: s?.state }).toEqual({ what, state: state as any });
      expect({ what, why: s?.why.includes(why) }).toEqual({ what, why: true });
    }
    expect(of(row({ stage: "accepted" }))).toBeNull();
    expect(of(row({ stage: "archived" }))).toBeNull();
    // a red ship before its merge stands until the checks are recorded again; one after its merge is shipped again
    const red = { pr: 7, outcome: "red", report: { step: "Ready to merge", why: "x", at: "2026-11-07T11:30:00Z" } };
    expect(of(row({ ship: red, results: { c1: { pass: true, at: "2026-11-07T11:45:00Z", commit: HEAD } } }))?.state).toBe("waiting");
    expect(of(row({ ship: { ...red, merge: sha(3) }, results: { c1: { pass: true, at: "2026-11-07T11:45:00Z", commit: HEAD } } }))?.why).toContain("Accept ships it again");
    // every sub-state has a short tag, the dialog's chip
    for (const [what, r] of table) {
      const t = of(r)!.tag;
      expect({ what, short: t.length > 0 && t.length <= 32 }).toEqual({ what, short: true });
    }
  });

  // intent 2052a88c-0b9d-4bcd-bd4a-12a2ab609994: the reason names checks by id, grouped by what they lack, never a statement
  test("reasons name checks by id", () => {
    const OLD = sha(9), NEW = sha(2);
    const checks = ["c1", "c2", "c3", "c4", "c5"].map((id) => ({ id, check: `The statement of ${id}, long and whole`, must: true, run: "true" }));
    const results = { c1: { pass: true, commit: OLD }, c2: { pass: true, commit: OLD }, c3: { pass: true, commit: OLD }, c5: { pass: true, commit: NEW } };
    const stale = row({ spec: { checks, nothing_to_reduce: "x" }, results, pr_seen: seen({ head: NEW, main_merged: { from: OLD, main: sha(5), at: "2026-11-07T11:50:00Z", to: NEW } }) });
    const s = of(stale)!;
    expect(s).toMatchObject({ state: "working", tag: "main merged in" });
    expect(s.why).toBe(`main merged in: its checks run on ${NEW.slice(0, 7)} (c1, c2, c3 passed on ${OLD.slice(0, 7)}, not yet on the head ${NEW.slice(0, 7)}; c4 no result yet)`);
    expect(s.why).not.toContain("statement");
    const moved = of(row({ spec: { checks, nothing_to_reduce: "x" }, results, pr_seen: seen({ head: NEW }) }))!;
    expect(moved).toMatchObject({ state: "working", tag: "head moved" });
    expect(moved.why).toContain(`c1, c2, c3 passed on ${OLD.slice(0, 7)}, not yet on the head ${NEW.slice(0, 7)}; c4 no result yet`);
    expect(moved.why).not.toContain("statement");
    const failed = of(row({ stage: "build", spec: { checks, nothing_to_reduce: "x" }, results: { c2: { pass: false } } }))!;
    expect(failed).toEqual({ state: "failed", tag: "c2 failed", why: "c2 failed" });
    const conflict = of(row({ stage: "build", pr_seen: seen({ mergeable: false, conflicts: { head: HEAD, main: sha(5), files: ["a.ts"] } }) }))!;
    expect(conflict).toEqual({ state: "failed", tag: "conflicts with main", why: "conflicts with main: a.ts" });
  });
});

suite("sub-states on the board", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  let gh: ReturnType<typeof fakeGitHub>;
  const who: Record<string, { id: string; cookie: string }> = {};
  let token = "";

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
    await seedSkills(db); // the Intents skill: an intent's brief
    gh = fakeGitHub();
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0), github: gh.gh });
    const h = await createHuman(db, "ada");
    who.ada = { id: h.id, cookie: `play_session=${tokenFor(h.id)}` };
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [h.id]);
    const made = (await call("POST", "/api/tokens", { name: "agent" })).data;
    token = made.token;
    // avenBOX's token (play/SPEC.md §4.12): a code intent's results on a commit, and its pull request, are taken from it alone
    await call("POST", `/api/tokens/${made.id}/avenbox`, { avenbox: true });
  });

  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie: who.ada.cookie };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await api.fetch(new Request(`http://play.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  let n = 0;
  const tool = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const r = await api.fetch(
      new Request("http://play.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }),
      }),
    );
    const j = await r.json();
    if (j.error) return { error: j.error.message as string };
    const text = j.result.content[0].text;
    return j.result.isError ? { error: text as string } : JSON.parse(text);
  };
  const intent = async (id: string) => (await call("GET", `/api/intents/${id}`)).data;
  const decide = (id: string, verdict: string) => call("POST", `/api/intents/${id}/${verdict}`);
  const clearShips = () => db.query(`UPDATE play.intents SET stage = 'archived' WHERE stage = 'ship'`);
  let k = 0;
  const add = async (title = "Intent") => (await tool("add_intent", { title: `${title} ${++k}`, kind: "improve" })) as { id: string; title: string };
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
  const passed = (id: string) => tool("check_intent", { intent: id, results: [{ check: "c1", pass: true, evidence: "bun test: 0 fail" }] });
  let prs = 900;
  let commits = 9000;
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
    return { ...i, pr, head };
  };
  const heldText = (id: string, deps: { id: string; title: string; stage: string }[]) =>
    `Intent ${id} is held: it depends on intents not shipped yet: ${deps.map((d) => `${d.id} (${d.title}, at ${d.stage})`).join("; ")}.`;

  test("one rule: a stub of subStateOf saying working refuses approve, accept, a work's accept and Accept and ship with its reason, and GET /api/intents reports it", async () => {
    await clearShips();
    const atSpecify = await specified();
    const toAccept = await built();
    expect((await passed(toAccept.id)).stage).toBe("proposal");
    const withWork = await built();
    expect((await passed(withWork.id)).stage).toBe("proposal");
    expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: `Fern ${++k}`, source: SOURCE, note: "x", intent: withWork.id })).error).toBeUndefined();
    const toShip = await codeAtProposal();
    const STUB = { state: "working" as const, tag: "stub", why: "The stub says it is working" };
    const real = sub.of;
    sub.of = () => STUB;
    try {
      for (const [id, verdict] of [[atSpecify.id, "approve"], [toAccept.id, "accept"], [withWork.id, "accept"], [toShip.id, "accept"]]) {
        const r = await decide(id, verdict);
        expect({ id, status: r.status }).toEqual({ id, status: 409 });
        expect(r.data.error).toContain(STUB.why);
      }
      const listed = (await call("GET", "/api/intents")).data as any[];
      expect(listed.length).toBeGreaterThan(3);
      for (const i of listed) expect(i.sub).toEqual(STUB);
    } finally {
      sub.of = real;
    }
    // nothing moved, nothing merged
    expect((await intent(atSpecify.id)).stage).toBe("specify");
    for (const i of [toAccept, withWork, toShip]) expect((await intent(i.id)).stage).toBe("proposal");
    expect(gh.calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  test("only a waiting intent is accepted: its head moved, its checks running, mergeable null or false, each refused with its reason at Proposal; waiting, the same Accept puts it in Ship", async () => {
    await clearShips();
    const c = await codeAtProposal();
    const pr = gh.pulls.get(c.pr)!;
    const refused = async (says: string) => {
      const r = await decide(c.id, "accept");
      expect(r.status).toBe(409);
      expect(r.data.error).toContain(says);
      const now = await intent(c.id);
      expect(now.stage).toBe("proposal");
      expect(now.sub.why).toContain(says);
    };
    pr.head.sha = sha(++commits);
    gh.checks.set(pr.head.sha, [green("play / API and site"), green("website / build")]);
    await refused("moved past the checked commit");
    pr.head.sha = c.head;
    gh.checks.set(c.head, [green("play / API and site"), { ...green("website / build"), status: "in_progress", conclusion: null }]);
    await refused(`Waiting for #${c.pr}'s checks (website / build)`);
    expect((await intent(c.id)).sub.state).toBe("working");
    gh.checks.set(c.head, [green("play / API and site"), green("website / build")]);
    pr.mergeable = null;
    await refused(`Waiting for GitHub to work out whether #${c.pr} merges`);
    pr.mergeable = false;
    await refused("conflicts with main");
    expect((await intent(c.id)).sub.state).toBe("failed");
    expect(gh.calls.filter((x) => x.method !== "GET")).toEqual([]);
    pr.mergeable = true;
    await watchTick(db, gh.gh, Date.now(), null);
    expect((await intent(c.id)).sub).toEqual({ state: "waiting", tag: "Accept and ship", why: "Accept and ship" });
    expect((await decide(c.id, "accept")).data).toMatchObject({ stage: "ship", ship: { pending: null } });
    await clearShips();
  });

  test("the watcher reads GitHub, the board doesn't: a tick keeps each open intent's pull request in pr_seen; GET /api/intents then makes no GitHub call", async () => {
    await clearShips();
    const c = await codeAtProposal({ mergeable: null });
    gh.checks.set(c.head, [green("play / API and site"), { ...green("website / build"), status: "queued", conclusion: null }]);
    expect((await intent(c.id)).sub).toEqual({ state: "working", tag: "reading GitHub", why: `reading #${c.pr} on GitHub` });
    const before = Date.now();
    await watchTick(db, gh.gh, Date.now(), null);
    const { rows: [r] } = await db.query<any>(`SELECT pr_seen FROM play.intents WHERE id = $1`, [c.id]);
    expect(r.pr_seen).toMatchObject({ pr: c.pr, head: c.head, draft: false, mergeable: null, state: "open", checks: { "play / API and site": "success", "website / build": "queued" } });
    expect(Date.parse(r.pr_seen.at)).toBeGreaterThanOrEqual(before - 1000);
    expect((await intent(c.id)).sub).toEqual({ state: "working", tag: "checks running", why: `Waiting for #${c.pr}'s checks (website / build)` });
    const from = gh.calls.length;
    await call("GET", "/api/intents");
    await call("GET", `/api/intents/${c.id}`);
    await tool("list_intents", {});
    await tool("get_intent", { intent: c.id });
    expect(gh.calls.length).toBe(from);
  });

  test("read everywhere: list_intents, get_intent, GET /api/intents and /api/intents/<uuid> give sub { state, tag, why }, null for an Accepted one", async () => {
    const open = await specified();
    const done = await specified();
    await db.query(`UPDATE play.intents SET stage = 'accepted' WHERE id = $1`, [done.id]);
    const want = { state: "waiting", tag: "Approve spec", why: "Approve spec" };
    expect((await intent(open.id)).sub).toEqual(want);
    expect((await call("GET", "/api/intents")).data.find((x: any) => x.id === open.id).sub).toEqual(want);
    expect((await tool("get_intent", { intent: open.id })).sub).toEqual(want);
    expect((await tool("list_intents", {})).find((x: any) => x.id === open.id).sub).toEqual(want);
    expect((await intent(done.id)).sub).toBeNull();
    expect((await tool("get_intent", { intent: done.id })).sub).toBeNull();
    expect((await tool("list_intents", { stage: "all" })).find((x: any) => x.id === done.id).sub).toBeNull();
  });

  test("approve is never held: approved into Build, idle, held, its brief null; check_intent and a propose naming it refused, nothing recorded; the dependency Accepted, it is working and its checks taken", async () => {
    const dep = await add("The engine");
    const s = await add();
    expect((await tool("depend_intent", { intent: s.id, on: dep.id })).error).toBeUndefined();
    expect((await tool("specify_intent", { intent: s.id, ...SPEC })).sub).toEqual({ state: "waiting", tag: "Approve spec", why: "Approve spec" });
    expect((await decide(s.id, "approve")).data).toMatchObject({ stage: "build", sub: { state: "idle", tag: "held", why: `held: waits for ${dep.title}` } });
    expect((await tool("get_intent", { intent: s.id })).brief).toBeNull();
    const held = heldText(s.id, [{ id: dep.id, title: dep.title, stage: "idea" }]);
    expect(await passed(s.id)).toEqual({ error: held });
    expect((await tool("propose_asset", { lod: { levels: "derived" }, group: "plants", label: `Fern ${++k}`, source: SOURCE, note: "x", intent: s.id })).error).toBe(held);
    expect(await intent(s.id)).toMatchObject({ stage: "build", results: null, work: null });
    // main's confirmations after a merge are still taken
    expect((await tool("check_intent", { intent: s.id, results: [{ check: "c1", pass: true, evidence: "on main", where: "main" }] })).stage).toBe("build");
    await db.query(`UPDATE play.intents SET results = NULL WHERE id = $1`, [s.id]);
    // its dependency Accepted: working, its brief back, its checks taken
    await db.query(`UPDATE play.intents SET stage = 'accepted' WHERE id = $1`, [dep.id]);
    expect((await intent(s.id)).sub.state).toBe("working");
    const free = await built();
    const brief = (await tool("get_intent", { intent: s.id })).brief;
    expect(brief).toContain(s.id);
    expect((await tool("get_intent", { intent: free.id })).brief).toContain(free.id);
    expect((await passed(s.id)).stage).toBe("proposal");
  });
});
