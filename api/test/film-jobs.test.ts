// The worker's jobs: renders and hero frames on one queue, against real Postgres semantics (PGlite). Proxies and the
// viewer's LUTs are not jobs any more: the Mac app makes them.
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { claimRender, listJobs, queueFrame, queueRender, queueStillOfFile, queueStillsOf, reportRender } from "../src/renders";

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

test("a file's graded still: queued when its look changes, one waiting per file, never for a cut alone", async () => {
  while (await claimRender()); // an empty queue
  const [a, b] = [hash("a1"), hash("b2")];
  const clip = (id: string, h: string, more: object = {}) => ({ id, track: "V1", start: 0, in: 0, dur: 2, vol: 1, hash: h, ...more });
  const before = { clips: [clip("c1", a), clip("c2", b)], grade: null, color: null };
  const { rows } = await pg.query<{ id: string }>(`INSERT INTO timelines (name, clips) VALUES ('Day 22', $1::jsonb) RETURNING id`, [JSON.stringify(before.clips)]);
  const id = rows[0]!.id;
  // a cut moved, nothing graded: no still
  expect(await queueStillsOf("admin", before, { id, ...before, clips: [clip("c1", a, { start: 1 }), clip("c2", b)] })).toEqual([]);
  // c1 graded: a's still, of c1
  const graded = { id, clips: [clip("c1", a, { stacks: { clip: { tools: [{ tool: "cdl", sat: 1.2 }] } } }), clip("c2", b)], grade: null, color: null };
  const [j] = await queueStillsOf("admin", before, graded);
  expect([j!.kind, j!.media_hash, j!.params]).toEqual(["frame", a, { clip: "c1", still: true }]);
  // graded again before the Mac took it: the same job, not a second
  const again = { ...graded, clips: [clip("c1", a, { stacks: { clip: { tools: [{ tool: "cdl", sat: 1.4 }] } } }), clip("c2", b)] };
  expect((await queueStillsOf("admin", graded, again)).map((x) => x.id)).toEqual([j!.id]);
  // the film's look: every file's still
  expect((await queueStillsOf("admin", again, { ...again, grade: { timeline: { tools: [{ tool: "hue", sat: 0.9 }] } } })).map((x) => x.media_hash).sort()).toEqual([a, b].sort());
  // a new grading still of a file: through the clip of the timeline that last graded it
  await pg.query("UPDATE timelines SET clips = $2::jsonb WHERE id = $1", [id, JSON.stringify(again.clips)]);
  expect((await queueStillOfFile("admin", a))!.params).toEqual({ clip: "c1", still: true });
  expect(await queueStillOfFile("admin", hash("ff"))).toBeNull();
  while (await claimRender());
});
