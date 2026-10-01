// The worker's jobs: renders and hero frames on one queue, against real Postgres semantics (PGlite). Proxies and the
// viewer's LUTs are not jobs any more: the Mac app makes them.
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { claimRender, listJobs, queueFrame, queueRender, reportRender } from "../src/renders";

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

const hash = (s: string) => s.repeat(64).slice(0, 64);

test("render jobs: one at a time per timeline, claimed oldest first", async () => {
  const { rows } = await pg.query<{ id: string }>("INSERT INTO timelines (name, clips) VALUES ('Day 19', '[]') RETURNING id");
  const r = await queueRender("admin", rows[0]!.id);
  expect(r.kind).toBe("render");
  expect(r.media_hash).toBeNull();
  expect((await queueRender("admin", rows[0]!.id)).id).toBe(r.id);
  expect(r.params).toBeNull(); // every delivery
  const f = await queueFrame("admin", rows[0]!.id, { t: 1.5, shape: "9:16" });
  expect(f.kind).toBe("frame");
  expect(f.params).toEqual({ t: 1.5, shape: "9:16" });
  expect((await claimRender())!.id).toBe(r.id);
  expect((await claimRender())!.id).toBe(f.id);
  expect(await claimRender()).toBeNull();
});

test("a render for one delivery: YouTube's 4K master, named in its params; nothing else", async () => {
  const { rows } = await pg.query<{ id: string }>("INSERT INTO timelines (name, clips) VALUES ('Day 21', '[]') RETURNING id");
  await expect(queueRender("admin", rows[0]!.id, { delivery: "vimeo" })).rejects.toThrow("youtube-4k");
  const r = await queueRender("admin", rows[0]!.id, { delivery: "youtube-4k" });
  expect(r.params).toEqual({ delivery: "youtube-4k" });
  expect((await claimRender())!.params).toEqual({ delivery: "youtube-4k" }); // the Mac reads it from the job
});

test("a job's output is named by its hash; the queue is filtered by kind", async () => {
  const { rows } = await pg.query<{ id: string }>("INSERT INTO timelines (name, clips) VALUES ('Day 20', '[]') RETURNING id");
  const queued = await queueFrame("admin", rows[0]!.id, { t: 0, shape: "16:9" });
  const job = (await claimRender())!;
  expect(job.id).toBe(queued.id);
  await expect(reportRender(job.id, { status: "done", output_hash: "bafkreiproxy" })).rejects.toThrow(/hash/);
  const done = await reportRender(job.id, { status: "done", progress: 1, output_hash: hash("d1") });
  expect(done.output_hash).toBe(hash("d1"));
  expect((await listJobs({ kind: "frame" })).map((j) => j.id)).toContain(job.id);
  expect((await listJobs({ kind: "render" })).map((j) => j.id)).not.toContain(job.id);
  expect(await listJobs({ kind: "proxy" })).toEqual([]);
});

test("every job is for something: a proxy for a shot version, a render or a frame for a timeline", async () => {
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('proxy')")).rejects.toThrow();
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('render')")).rejects.toThrow();
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('frame')")).rejects.toThrow();
});
