// Characters (intent 89f3ad37-af8e-4bae-9612-f796e09bd04b; play/SPEC.md "Asset library") against a real Postgres: set
// TEST_DATABASE_URL, as for ./api.test.ts.
//
// c2: `characters` is a group of its own: list_assets and propose_asset take it; an asset moved from `actors` to
// `characters` by its own document (an intent variant's edit of its card's group, proposed naming the intent and
// accepted with it) lists under characters and no longer under actors, never by a migration; an unknown group is
// still refused, by list_assets, by propose_asset and by a move.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { createHuman, initSessions, tokenFor } from "../src/auth";
import { folderStore } from "../src/blobs";
import { GROUPS } from "../src/groups";
import { Rate } from "../src/limits";
import { migrate } from "../src/migrations";
import { fromBunSql, type Db } from "../src/pg";

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

const SPEC = {
  goal: "A person moves to the characters.",
  nothing_to_reduce: "A test fixture: nothing to reduce.",
  scope: "One asset. Nothing else changes.",
  checks: [{ check: "It holds", how: "test", by: "true", run: "true" }],
};
const SOURCE = (line: string) => `module.exports.recipe = function (id, v, variant) {\n  // ${line}\n  return { meta: { id, v, variant }, build: () => null };\n};\n`;

suite("characters", () => {
  let admin: Bun.SQL, sql: Bun.SQL, db: Db, name: string;
  let api: ReturnType<typeof app>;
  let cookie = "";
  let token = "";
  let person = "";
  let goat = "";

  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await api.fetch(new Request(`http://play.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  let n = 0;
  /** a tool called over MCP by the admin's token: its result as JSON, or its error's text */
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
    const res = j.result;
    const text = res.content[0].text;
    return res.isError ? { error: text as string } : JSON.parse(text);
  };
  /** an intent in Build, its spec approved, its one must check passed: ready to take work */
  const readyIntent = async (title: string) => {
    const i = await tool("add_intent", { title });
    await tool("specify_intent", { intent: i.id, ...SPEC });
    expect((await call("POST", `/api/intents/${i.id}/approve`)).data.stage).toBe("build");
    expect((await tool("check_intent", { intent: i.id, results: [{ check: "c1", pass: true, evidence: "exit 0" }] })).stage).toBe("proposal");
    return i.id as string;
  };
  const accept = async (intent: string) => (await call("POST", `/api/intents/${intent}/accept`)).data;
  const ids = async (group: string) => ((await tool("list_assets", { group })) as any[]).map((a) => a.id);
  /** an asset's group as the asset library has it (play.assets) and as its head version's card names it */
  const groupOf = async (asset: string) =>
    (await db.query<any>(`SELECT a.grp, v.card->'card'->>'group' AS card FROM play.assets a JOIN play.asset_versions v ON v.id = a.head WHERE a.id = $1`, [asset])).rows[0];

  beforeAll(async () => {
    name = `play_characters_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = new Bun.SQL(URL_!);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!);
    u.pathname = `/${name}`;
    sql = new Bun.SQL(u.toString());
    db = fromBunSql(sql);
    await migrate(db);
    await initSessions(db);
    api = app({ db, store: folderStore(mkdtempSync(join(tmpdir(), "play-blobs-"))), rate: new Rate(0) });
    const h = await createHuman(db, "ada");
    await db.query(`UPDATE play.memberships SET level = 'admin' WHERE human_id = $1`, [h.id]);
    cookie = `play_session=${tokenFor(h.id)}`;
    token = (await call("POST", "/api/tokens", { name: "agent" })).data.token;

    // a person and a goat, both filed among the actors, as Stand-in and Elder woman were
    for (const [label, set] of [["A person", (id: string) => (person = id)], ["A goat", (id: string) => (goat = id)]] as const) {
      const made = await tool("propose_asset", { group: "actors", label, note: "its first version", source: SOURCE(label), intent: await readyIntent(label) });
      expect(made.error).toBeUndefined();
      expect((await accept(made.intent)).decision).toMatchObject({ status: "accepted", number: 1 });
      set(made.asset);
    }
  });
  afterAll(async () => {
    await sql?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.close();
  });

  test("characters is one of the API's groups, named in one list", async () => {
    expect(GROUPS).toContain("characters");
    expect(GROUPS).toContain("actors");
    const { result } = await (
      await api.fetch(new Request("http://play.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/list" }) }))
    ).json();
    const enumOf = (t: string) => result.tools.find((x: any) => x.name === t).inputSchema.properties.group.enum;
    expect(enumOf("list_assets")).toEqual([...GROUPS]);
    expect(enumOf("propose_asset")).toEqual([...GROUPS]);
  });

  test("a new asset can be proposed in characters and lists there", async () => {
    const made = await tool("propose_asset", { group: "characters", label: "A settler", note: "its first version", source: SOURCE("a settler"), intent: await readyIntent("A settler") });
    expect(made.error).toBeUndefined();
    expect((await accept(made.intent)).decision).toMatchObject({ status: "accepted", number: 1 });
    expect(await ids("characters")).toContain(made.asset);
    expect(await ids("actors")).not.toContain(made.asset);
    expect(await groupOf(made.asset)).toEqual({ grp: "characters", card: "characters" });
  });

  test("an asset moves from actors to characters by its own document, only once accepted", async () => {
    expect(await ids("actors")).toEqual(expect.arrayContaining([person, goat]));
    const intent = await readyIntent("The person among the characters");
    const e = await tool("doc_edit", { doc: person, intent, message: "a person, not an animal: to the characters", edits: [{ op: "set", path: ["card", "card", "group"], value: "characters" }] });
    expect(e.error).toBeUndefined();
    const p = await tool("propose_doc_version", { doc: person, intent, variant: e.variant, note: "The person moves to the characters." });
    expect(p.error).toBeUndefined();
    // proposed, not yet accepted: still among the actors
    expect(await ids("actors")).toContain(person);
    expect(await ids("characters")).not.toContain(person);
    expect((await accept(intent)).decision).toMatchObject({ status: "accepted", number: 2 });
    expect(await ids("characters")).toContain(person);
    expect(await ids("actors")).not.toContain(person);
    expect(await ids("actors")).toContain(goat);
    expect(await groupOf(person)).toEqual({ grp: "characters", card: "characters" });
    // its document says so too, and its id and earlier version stay as they were
    expect((await tool("doc_at", { doc: person })).json.card.card.group).toBe("characters");
    const a = await tool("get_asset", { asset: person });
    expect(a.versions.map((v: any) => v.number)).toEqual([2, 1]);
  });

  test("an edit that leaves the group alone moves nothing", async () => {
    const intent = await readyIntent("The goat's note");
    const e = await tool("doc_edit", { doc: goat, intent, message: "a note", edits: [{ op: "set", path: ["note"], value: "a goat, still an animal" }] });
    expect(e.error).toBeUndefined();
    expect((await tool("propose_doc_version", { doc: goat, intent, variant: e.variant, note: "A note." })).error).toBeUndefined();
    expect((await accept(intent)).decision).toMatchObject({ status: "accepted", number: 2 });
    expect(await groupOf(goat)).toEqual({ grp: "actors", card: "actors" });
  });

  test("an unknown group is still refused", async () => {
    expect((await tool("list_assets", { group: "monsters" })).error).toBeDefined();
    const made = await tool("propose_asset", { group: "monsters", label: "A monster", note: "no", source: SOURCE("a monster"), intent: await readyIntent("A monster") });
    expect(made.error).toBeDefined();
    const intent = await readyIntent("The goat among the monsters");
    const e = await tool("doc_edit", { doc: goat, intent, message: "to no group", edits: [{ op: "set", path: ["card", "card", "group"], value: "monsters" }] });
    const p = e.error ? e : await tool("propose_doc_version", { doc: goat, intent, variant: e.variant, note: "The goat to no group." });
    expect(p.error).toMatch(/monsters/);
    expect(await groupOf(goat)).toEqual({ grp: "actors", card: "actors" });
  });
});
