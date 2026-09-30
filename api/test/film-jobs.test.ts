// The worker's jobs: renders, world shot proxies, hero frames and preview LUTs on one queue, against real Postgres
// semantics (PGlite). A file's own proxy is not a job any more: the Mac app makes it (meta.proxy on the original).
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { claimRender, listJobs, previewLuts, queueLuts, queueRender, reportRender } from "../src/renders";

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

/** a file in the vault's mirror, as the vault server writes it */
const vaultFile = (h: string, tags: string[], meta: Record<string, unknown>, added: string) =>
  pg.query("INSERT INTO vault_files (hash, size, mime, kind, tags, meta, added) VALUES ($1, 2, 'application/octet-stream', 'other', $2, $3, $4)", [h, tags, meta, added]);

test("render jobs, the LUT job, and the preview LUTs from the vault's mirror", async () => {
  const { rows } = await pg.query<{ id: string }>("INSERT INTO timelines (name, clips) VALUES ('Day 19', '[]') RETURNING id");
  const r = await queueRender("admin", rows[0]!.id);
  expect(r.kind).toBe("render");
  expect(r.media_hash).toBeNull();
  expect((await queueRender("admin", rows[0]!.id)).id).toBe(r.id);
  const l = await queueLuts("admin");
  expect((await queueLuts()).id).toBe(l.id);
  expect((await claimRender())!.kind).toBe("render");
  const lut = await claimRender();
  expect(lut!.kind).toBe("lut");
  const done = await reportRender(lut!.id, { status: "done", progress: 1, report: { luts: {} } });
  expect(done.report).toEqual({ luts: {} });

  await vaultFile(hash("a0"), ["role:lut"], { transform: "odt-rec709", hash: "old", size: 65 }, "2026-09-01T00:00:00Z");
  await vaultFile(hash("a1"), ["role:lut"], { transform: "odt-rec709", hash: "aaaa", size: 65, format: "mlut1" }, "2026-09-02T00:00:00Z");
  await vaultFile(hash("b1"), ["role:lut", "transform:idt-rec709"], { transform: "idt-rec709", hash: "bbbb", size: 33 }, "2026-09-02T00:00:00Z");
  await vaultFile(hash("c1"), ["role:proxy"], { transform: "idt-rec709", hash: "cccc", size: 65 }, "2026-09-03T00:00:00Z"); // not a LUT
  const luts = await previewLuts();
  expect(Object.keys(luts).sort()).toEqual(["idt-rec709", "odt-rec709"]);
  expect(luts["odt-rec709"]).toEqual({ file: hash("a1"), hash: "aaaa", size: 65 }); // the newest of a transform
  expect(luts["idt-rec709"]).toEqual({ file: hash("b1"), hash: "bbbb", size: 33 });
});

test("a job's output is named by its hash; the queue is filtered by kind", async () => {
  await queueLuts("admin");
  const job = (await claimRender())!;
  await expect(reportRender(job.id, { status: "done", output_hash: "bafkreiproxy" })).rejects.toThrow(/hash/);
  const done = await reportRender(job.id, { status: "done", progress: 1, output_hash: hash("d1") });
  expect(done.output_hash).toBe(hash("d1"));
  expect((await listJobs({ kind: "lut" })).map((j) => j.id)).toContain(job.id);
  expect(await listJobs({ kind: "frame" })).toEqual([]);
});

test("every job is for something: a proxy for a shot version, a render or a frame for a timeline", async () => {
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('proxy')")).rejects.toThrow();
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('render')")).rejects.toThrow();
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('frame')")).rejects.toThrow();
});
