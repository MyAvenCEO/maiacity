// Migration 0029 against real Postgres semantics (PGlite): a database as it was, naming its files by IPFS CID, comes out
// naming each by its BLAKE3 hash — timelines, shots and their versions, the board and the render queue — and what it
// comes out as is what the API itself accepts. The old library tables are left as they were.
import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { CID_MAP } from "../src/cid-map";
import { getShot, saveShot } from "../src/shots";
import { getTimeline, saveTimeline } from "../src/timelines";
import { listContent } from "../src/content";
import { listJobs } from "../src/renders";

const at = MIGRATIONS.findIndex((m) => m.id === "0029-hashes-not-cids");
const [[C1, H1], [C2, H2], [C3, H3], [C4, H4]] = CID_MAP.slice(0, 4) as [string, string][];

const dbOf = (pg: PGlite): Db => {
  const wrap = (q: { query: PGlite["query"] }) => ({
    query: async (text: string, params: unknown[] = []) => {
      const r = await q.query<any>(text, params as any[]);
      return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
    },
  });
  return { ...wrap(pg), exec: async (t) => void (await pg.exec(t)), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as any))) };
};

const before = async () => {
  const pg = new PGlite();
  for (const m of MIGRATIONS.slice(0, at)) await pg.exec(m.sql);
  await pg.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin')");
  return pg;
};

const spec = {
  world: { sandbox: "sandbox-4", build: { commit: "abcdef1", hash: "abcdefgh", cid: C4 }, seed: 1, stand: [150, 20], clock: 12 },
  seconds: 4, fps: 30, aspect: "1:1",
  camera: { kind: "move", from: [78, 26, -30], to: [90, 27, -30], aimFrom: [400, 24, -34], aimTo: [400, 25, -34] },
  lens: { fov: 52 }, time: { hour: 5.05, hourTo: 5.4 },
  cues: [{ at: 0, kind: "sound", cid: C3, level: 0.5 }, { at: 1, kind: "event", name: "door-opens" }],
  meta: { note: `cut from ${C1}` },
};

describe("0029: every CID becomes its hash", () => {
  const pg = new PGlite();
  let timeline = "", shot = "";

  beforeAll(async () => {
    for (const m of MIGRATIONS.slice(0, at)) await pg.exec(m.sql);
    await pg.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin')");
    // the old library, which the migration must not touch
    await pg.query("INSERT INTO media (cid, mime, kind, size) VALUES ($1, 'image/jpeg', 'image', 3)", [C1]);
    await pg.query("INSERT INTO media_tags (cid, tag) VALUES ($1, 'Day 01')", [C1]);
    shot = (await pg.query<{ id: string }>("INSERT INTO shots (name, spec, version) VALUES ('flight', $1, 2) RETURNING id", [JSON.stringify(spec)])).rows[0]!.id;
    await pg.query("INSERT INTO shot_versions (shot_id, version, spec) VALUES ($1, 1, $2), ($1, 2, $2)", [shot, JSON.stringify(spec)]);
    const clips = [
      { id: "a", cid: C1, track: "V1", start: 0, in: 0, dur: 2, vol: 0, grade: { slope: [1.1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 1 } },
      { id: "w", kind: "world", shot, shotVersion: 2, track: "V1", start: 2, in: 0, dur: 3, vol: 0 },
      { id: "b", cid: C2, track: "A1", start: 0, in: 0.5, dur: 3, vol: 0.8 },
    ];
    timeline = (await pg.query<{ id: string }>("INSERT INTO timelines (name, clips, stage) VALUES ('Day 19', $1, 'locked') RETURNING id", [JSON.stringify(clips)])).rows[0]!.id;
    await pg.query(
      `INSERT INTO content_items (title, kind, cids, body, link, deliveries, posts, project) VALUES ('Day 19', 'film', $1, $2, $3, $4, $5, 'Day 19')`,
      [[C1, C2], `![the forest](${C1}.jpg)\n\nand ${C2}, and ${C2} again; not ours: bafkreinotacidatall`, `https://maia.city/media/${C3}.jpg`,
       JSON.stringify([{ channels: ["youtube"], cid: C1, format: "16:9", aspect: "16:9", codec: "h264", timeline }]),
       JSON.stringify([{ platform: "x", text: `the film: ${C2}`, cover: { cid: C3 }, aspect: "16:9", codec: "h264" }])],
    );
    await pg.query("INSERT INTO render_jobs (kind, media_cid, status) VALUES ('proxy', $1, 'queued'), ('proxy', $2, 'done')", [C1, C2]);
    await pg.query(
      "INSERT INTO render_jobs (kind, timeline_id, status, output_cid, report) VALUES ('render', $1, 'done', $2, $3), ('lut', NULL, 'done', NULL, $4)",
      [timeline, C4, JSON.stringify({ conformed: [{ clip: "a", proxy: C1, original: C2 }], deliveries: [{ cid: C4, aspect: "16:9" }], warnings: [`${C2}: colour unknown`] }),
       JSON.stringify({ luts: { "odt-rec709": { cid: C3, hash: "aaaa", size: 65 } } })],
    );
    await pg.exec(MIGRATIONS[at]!.sql);
    await pg.exec(MIGRATIONS.slice(at + 1).map((m) => m.sql).join(";\n"));
    useDb(dbOf(pg));
  });

  test("timeline clips name their file by hash; world clips are left as they were", async () => {
    const t = await getTimeline(timeline);
    expect(t.clips.map((c) => [c.id, c.hash ?? null])).toEqual([["a", H1], ["w", null], ["b", H2]]);
    expect(JSON.stringify(t.clips)).not.toMatch(/cid|baf/);
    expect(t.clips[0]!.grade!.slope).toEqual([1.1, 1, 1]);
    // the API takes the migrated cut back as it is — locked, so the cut must compare equal
    const back = (await saveTimeline(timeline, { clips: t.clips })).clips;
    const cut = (cs: any[]) => cs.map(({ grade: _g, stacks: _s, ...rest }) => rest);
    expect(cut(back)).toEqual(cut(t.clips));
    // (its grade from before is the stacks migration's: scripts/film/migrate-grade-stacks.mjs)
  });

  test("a shot's sound cues name a hash, its build a file; both the shot and every version", async () => {
    const s = await getShot(shot);
    expect(s.spec.cues[0]).toEqual({ at: 0, kind: "sound", hash: H3, level: 0.5 });
    expect(s.spec.world.build).toEqual({ commit: "abcdef1", hash: "abcdefgh", file: H4 });
    expect(s.spec.meta.note).toBe(`cut from ${H1}`);
    expect((await getShot(shot, 1)).spec.world.build.file).toBe(H4);
    // the spec as the migration left it is a valid spec, and the same one: saving it makes no new version
    expect((await saveShot(shot, "admin", { spec: s.spec })).version).toBe(2);
  });

  test("the board's item: its hashes, its text, its deliveries and posts", async () => {
    const [item] = (await listContent()).filter((i) => i.project === "Day 19");
    expect(item!.hashes).toEqual([H1, H2]);
    expect(item!.body).toBe(`![the forest](${H1}.jpg)\n\nand ${H2}, and ${H2} again; not ours: bafkreinotacidatall`);
    expect(item!.link).toBe(`https://maia.city/media/${H3}.jpg`);
    expect(item!.deliveries[0]).toMatchObject({ hash: H1, channels: ["youtube"], timeline });
    expect(item!.deliveries[0]).not.toHaveProperty("cid");
    expect(item!.posts[0]).toMatchObject({ text: `the film: ${H2}`, cover: { hash: H3 } });
  });

  test("render jobs: their columns, reports and LUTs; a media proxy still waiting is closed", async () => {
    const jobs = await listJobs({});
    const proxy = jobs.find((j) => j.media_hash === H1)!;
    expect(proxy.status).toBe("failed");
    expect(proxy.note).toMatch(/Mac app/);
    expect(jobs.find((j) => j.media_hash === H2)!.status).toBe("done"); // history stays as it was
    const render = jobs.find((j) => j.kind === "render")!;
    expect(render.output_hash).toBe(H4);
    expect(render.report).toEqual({ conformed: [{ clip: "a", proxy: H1, original: H2 }], deliveries: [{ hash: H4, aspect: "16:9" }], warnings: [`${H2}: colour unknown`] });
    // beside a hash of its own, a "cid" becomes "file"
    expect(jobs.find((j) => j.kind === "lut")!.report).toEqual({ luts: { "odt-rec709": { file: H3, hash: "aaaa", size: 65 } } });
    const { rows } = await pg.query<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'render_jobs_target'");
    expect(rows[0]!.def).toContain("media_hash");
  });

  test("the old library is gone after 0030 (media bytes out of Postgres, 26b)", async () => {
    const { rows } = await pg.query<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relname IN ('media', 'media_chunks', 'media_tags', 'media_paths', 'uploads', 'upload_chunks')",
    );
    expect(rows).toEqual([]);
  });

  test("nothing of the migration's own is left behind", async () => {
    expect((await pg.query("SELECT 1 FROM pg_class WHERE relname = 'cid_map'")).rows).toHaveLength(0);
    expect((await pg.query("SELECT 1 FROM pg_proc WHERE proname IN ('hashed', 'rekeyed', 'rehashed')")).rows).toHaveLength(0);
  });
});

test("0029 stops at a timeline naming a CID the map does not know", async () => {
  const pg = await before();
  const unknown = "bafkrei" + "a".repeat(52);
  await pg.query("INSERT INTO timelines (name, clips) VALUES ('odd', $1)", [JSON.stringify([{ id: "a", cid: unknown, track: "V1", start: 0, in: 0, dur: 1, vol: 0 }])]);
  await expect(pg.exec(MIGRATIONS[at]!.sql)).rejects.toThrow(unknown);
});
