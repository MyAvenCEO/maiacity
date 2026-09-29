// The worker's jobs (migration 0024): renders, proxies and preview LUTs on one queue, against real Postgres
// semantics (PGlite). Every new picture is queued for its proxy; a colour set by hand queues it again.
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { cidOf, describe, finishUpload, putMedia, putPart, startUpload, wantsProxy } from "../src/media";
import { claimRender, listJobs, previewLuts, queueLuts, queueProxy, queueRender, reportRender } from "../src/renders";

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

async function uploadFile(bytes: Uint8Array, mime: string, about: Record<string, unknown> = {}) {
  const cid = await cidOf(bytes);
  const up = await startUpload("admin", { cid, size: bytes.length, mime, ...about });
  await putPart("admin", up.id, 0, bytes);
  return finishUpload("admin", up.id);
}

const proxyJobs = async (cid: string) => (await listJobs({ kind: "proxy", cid })).length;

test("which files get a proxy: pictures and EXR sequences, never the worker's own", () => {
  expect(wantsProxy("video/quicktime")).toBe(true);
  expect(wantsProxy("image/png")).toBe(true);
  expect(wantsProxy("image/x-exr")).toBe(true);
  expect(wantsProxy("application/x-tar", [], { sequence: "exr" })).toBe(true);
  expect(wantsProxy("application/x-tar")).toBe(false);
  expect(wantsProxy("audio/mpeg")).toBe(false);
  expect(wantsProxy("video/mp4", ["role:proxy"])).toBe(false);
  expect(wantsProxy("video/mp4", ["role:render"])).toBe(false);
  expect(wantsProxy("video/mp4", [], { proxyOf: "bafy…" })).toBe(false);
});

test("a new video upload is queued for its proxy; its own proxy and a sound are not", async () => {
  const video = await uploadFile(new Uint8Array([1, 2, 3, 4]), "video/mp4", { title: "clip" });
  expect(await proxyJobs(video.cid)).toBe(1);
  const again = await queueProxy(video.cid);
  expect((await listJobs({ kind: "proxy", cid: video.cid }))[0]!.id).toBe(again.id); // one waiting job is enough
  const proxy = await uploadFile(new Uint8Array([5, 6, 7]), "video/mp4", { tags: ["role:proxy"], meta: { proxyOf: video.cid } });
  expect(await proxyJobs(proxy.cid)).toBe(0);
  const sound = await uploadFile(new Uint8Array([8, 9]), "audio/mpeg");
  expect(await proxyJobs(sound.cid)).toBe(0);
});

test("the claim hands the worker the job's kind and file; a proxy job reports without touching the calendar", async () => {
  await pg.query("UPDATE render_jobs SET status = 'done'");
  const { cid } = await putMedia(new Uint8Array([42]), "video/mp4", {});
  const queued = await queueProxy(cid, "admin");
  const job = await claimRender();
  expect(job!.id).toBe(queued.id);
  expect(job!.kind).toBe("proxy");
  expect(job!.media_cid).toBe(cid);
  expect(job!.timeline_id).toBeNull();
  const done = await reportRender(job!.id, { status: "done", progress: 1, output_cid: "bafyproxy", report: { color: { profile: "rec709" } }, deliveries: [] });
  expect(done.status).toBe("done");
  expect(done.report).toEqual({ color: { profile: "rec709" } });
  expect(await claimRender()).toBeNull();
});

test("describing a file without colour queues it once; setting its colour by hand queues it again", async () => {
  const { cid } = await putMedia(new Uint8Array([7, 7, 7]), "video/quicktime", { title: "iPhone" });
  expect(await proxyJobs(cid)).toBe(0); // seeded straight into the database: no job yet
  await describe(cid, { title: "iPhone take" });
  expect(await proxyJobs(cid)).toBe(1);
  await pg.query("UPDATE render_jobs SET status = 'done' WHERE media_cid = $1", [cid]);
  await describe(cid, { title: "iPhone take 2" });
  expect(await proxyJobs(cid)).toBe(1); // it had its job: not again
  // the worker writes what it found: no new job
  await describe(cid, { meta: { color: { profile: "unknown", detectedFrom: "nothing to tell it by" } } });
  expect(await proxyJobs(cid)).toBe(1);
  // the studio sets it by hand: a new proxy in the new colour
  await describe(cid, { meta: { color: { profile: "unknown", override: "apple-log" } } });
  expect(await proxyJobs(cid)).toBe(2);
  await describe(cid, { meta: { color: { profile: "unknown", override: "apple-log" }, proxy: "bafyp" } });
  expect(await proxyJobs(cid)).toBe(2);
});

test("render jobs still work as before, and the LUT job and preview LUT listing", async () => {
  await pg.query("UPDATE render_jobs SET status = 'done'");
  const { rows } = await pg.query<{ id: string }>("INSERT INTO timelines (name, clips) VALUES ('Day 19', '[]') RETURNING id");
  const r = await queueRender("admin", rows[0]!.id);
  expect(r.kind).toBe("render");
  expect((await queueRender("admin", rows[0]!.id)).id).toBe(r.id);
  const l = await queueLuts("admin");
  expect((await queueLuts()).id).toBe(l.id);
  expect((await claimRender())!.kind).toBe("render");
  expect((await claimRender())!.kind).toBe("lut");
  await putMedia(new Uint8Array([1, 1]), "application/octet-stream", { tags: ["role:lut"], meta: { transform: "odt-rec709", hash: "aaaa", size: 65, format: "mlut1" } });
  await putMedia(new Uint8Array([2, 2]), "application/octet-stream", { tags: ["role:lut"], meta: { transform: "idt-rec709", hash: "bbbb", size: 65, format: "mlut1" } });
  const luts = await previewLuts();
  expect(Object.keys(luts).sort()).toEqual(["idt-rec709", "odt-rec709"]);
  expect(luts["odt-rec709"]!.hash).toBe("aaaa");
  expect(luts["odt-rec709"]!.size).toBe(65);
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('proxy')")).rejects.toThrow();
  await expect(pg.query("INSERT INTO render_jobs (kind) VALUES ('render')")).rejects.toThrow();
});
