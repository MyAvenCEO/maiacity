// Where the three parts of the film pipeline meet (migration 0027): every world shot version is queued for its HD
// proxy, a hero frame is a job of its own, and a finished render of a locked cut moves the timeline to "rendered".
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { createShot, saveShot } from "../src/shots";
import { createTimeline, getTimeline, saveTimeline } from "../src/timelines";
import { claimRender, listJobs, queueFrame, queueRender, queueShotProxy, reportRender } from "../src/renders";

const pg = new PGlite();
beforeAll(async () => {
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  const wrap = (q: { query: PGlite["query"] }) => ({
    query: async (text: string, params: unknown[] = []) => {
      const r = await q.query<any>(text, params as any[]);
      return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
    },
  });
  useDb({ ...wrap(pg), exec: async (t) => void (await pg.exec(t)), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as any))) } as Db);
  await pg.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin')");
});

const spec = (over: Record<string, unknown> = {}) => ({
  world: { stand: [150, 20], clock: 12 },
  seconds: 4,
  camera: { kind: "move", from: [78, 26, -30], to: [90, 27, -30], aimFrom: [400, 24, -34], aimTo: [400, 25, -34] },
  lens: { fov: 52 },
  time: { hour: 5.05, hourTo: 5.4 },
  ...over,
});

test("a world shot version is queued for its HD proxy once — a new version gets its own", async () => {
  const s = await createShot("admin", { name: "the sun rises", project: "Day 19", spec: spec() });
  const a = await queueShotProxy(s.id, s.version, "admin");
  expect(a.kind).toBe("proxy");
  expect(a.shot_id).toBe(s.id);
  expect(a.shot_version).toBe(1);
  expect(a.media_hash).toBeNull();
  expect((await queueShotProxy(s.id, 1, "admin")).id).toBe(a.id); // one per version
  const v2 = await saveShot(s.id, "admin", { spec: spec({ time: { hour: 6 } }) });
  expect(v2.version).toBe(2);
  const b = await queueShotProxy(s.id, v2.version, "admin");
  expect(b.id).not.toBe(a.id);
  expect((await listJobs({ kind: "proxy", shot: s.id })).map((j) => j.shot_version).sort()).toEqual([1, 2]);
});

test("the worker claims a shot's proxy job with the shot and its version", async () => {
  await pg.query("UPDATE render_jobs SET status = 'done'");
  const s = await createShot("admin", { name: "glass", spec: spec() });
  const q = await queueShotProxy(s.id, 1);
  const job = await claimRender();
  expect(job!.id).toBe(q.id);
  expect(job!.shot_id).toBe(s.id);
  expect(job!.shot_version).toBe(1);
});

test("a proxy job names a file or a shot version — never nothing", async () => {
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('proxy')")).rejects.toThrow();
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('frame')")).rejects.toThrow();
});

test("a hero frame is a job of its own: a time and a shape of a timeline", async () => {
  const t = await createTimeline("admin", { name: "Day 19 · W", aspect: "16:9", clips: [] });
  const f = await queueFrame("admin", t.id, { t: 12.3456, shape: "9:16" });
  expect(f.kind).toBe("frame");
  expect(f.timeline_id).toBe(t.id);
  expect(f.params).toEqual({ t: 12.346, shape: "9:16" });
  await expect(queueFrame("admin", t.id, { t: -1 })).rejects.toThrow("time");
  await expect(queueFrame("admin", t.id, { t: 1, shape: "3:2" })).rejects.toThrow("shapes");
  await expect(queueFrame("admin", "00000000-0000-0000-0000-000000000000", { t: 1 })).rejects.toThrow("timeline");
  expect((await listJobs({ kind: "frame", timeline: t.id })).map((j) => j.id)).toEqual([f.id]);
});

test("a finished render of a locked cut moves the timeline to rendered; an unlocked one stays in edit", async () => {
  await pg.query("UPDATE render_jobs SET status = 'done'");
  const locked = await createTimeline("admin", { name: "locked", aspect: "16:9", clips: [] });
  await saveTimeline(locked.id, { stage: "locked" });
  const r1 = await queueRender("admin", locked.id);
  await claimRender();
  await reportRender(r1.id, { status: "done", progress: 1 });
  expect((await getTimeline(locked.id)).stage).toBe("rendered");

  const open = await createTimeline("admin", { name: "open", aspect: "16:9", clips: [] });
  const r2 = await queueRender("admin", open.id);
  await claimRender();
  await reportRender(r2.id, { status: "done", progress: 1 });
  expect((await getTimeline(open.id)).stage).toBe("edit");
});
