// The media library against real Postgres semantics (PGlite): files are kept by their IPFS CID, the same
// bytes once however many paths name them, and read back whole or by byte range, across chunk borders.
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { CHUNK, cidOf, finishUpload, have, listMedia, manifest, markDistributed, mediaBytes, namePath, publicManifest, putMedia, putPart, readMedia, retag, startUpload, undistributed } from "../src/media";

const pg = new PGlite();
beforeAll(async () => {
  for (const m of MIGRATIONS) await pg.exec(m.sql);
  const wrap = (q: { query: PGlite["query"] }) => ({
    query: async (text: string, params: unknown[] = []) => {
      const r = await q.query<any>(text, params as any[]);
      return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
    },
  });
  const db: Db = { ...wrap(pg), exec: async (t) => void (await pg.exec(t)), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as any))) };
  useDb(db);
  await pg.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin')");
});

const read = async (s: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(s).arrayBuffer());

test("the CID is the one `ipfs add --cid-version 1` gives", async () => {
  expect(await cidOf(new TextEncoder().encode("hello world\n"))).toBe("bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei4");
});

test("a file is kept once by its CID, and every path that names it points there", async () => {
  const bytes = new Uint8Array(CHUNK * 2 + 1234).map((_, i) => (i * 7) % 256);
  const a = await putMedia(bytes, "/day-01/cover.jpg");
  const b = await putMedia(bytes, "/day-02/same-cover.jpg");
  expect(a.stored).toBe(true);
  expect(b.stored).toBe(false);
  expect(b.cid).toBe(a.cid);
  const [row] = await listMedia({ kind: "image" });
  expect(row!.paths).toEqual(["/day-01/cover.jpg", "/day-02/same-cover.jpg"]);
  expect(row!.size).toBe(bytes.length);
  expect(await mediaBytes(a.cid)).toEqual(bytes);
  // a range across both chunk borders
  const from = CHUNK - 10, to = CHUNK * 2 + 10;
  expect(await read(readMedia(a.cid, from, to))).toEqual(bytes.subarray(from, to + 1));
});

test("undistributed until its public copy is made; then the manifest names the CDN address", async () => {
  const { cid } = await putMedia(new TextEncoder().encode("a song"), "/sounds/song.mp3");
  expect((await undistributed()).map((u) => u.cid)).toContain(cid);
  await markDistributed(cid, { cdn_path: `media/${cid}.mp3` });
  expect((await undistributed()).map((u) => u.cid)).not.toContain(cid);
  const m = await manifest();
  expect(m["/sounds/song.mp3"]).toEqual({ cid, url: `/media/${cid}.mp3` });
  expect(m["/day-01/cover.jpg"]!.url).toBeNull();
});

test("a path given new bytes now names the new CID", async () => {
  const first = await putMedia(new TextEncoder().encode("v1"), "/notes/plan.pdf");
  const second = await putMedia(new TextEncoder().encode("v2"), "/notes/plan.pdf");
  expect(second.cid).not.toBe(first.cid);
  expect((await manifest())["/notes/plan.pdf"]!.cid).toBe(second.cid);
});

test("an upload arrives in parts, can resume, and becomes media only if its CID is the promised one", async () => {
  const bytes = new Uint8Array(CHUNK * 2 + 99).map((_, i) => (i * 13) % 251);
  const cid = await cidOf(bytes);
  const a = await startUpload("admin", { path: "/day-19/film.mp4", size: bytes.length, cid });
  expect(a.parts).toBe(3);
  await putPart("admin", a.id, 0, bytes.subarray(0, CHUNK));
  // interrupted: starting again resumes the same upload, part 0 already there
  const b = await startUpload("admin", { path: "/day-19/film.mp4", size: bytes.length, cid });
  expect(b.id).toBe(a.id);
  expect(b.received).toEqual([0]);
  await expect(putPart("admin", a.id, 1, bytes.subarray(0, 10))).rejects.toThrow(/should be/);
  await expect(finishUpload("admin", a.id)).rejects.toThrow(/missing/);
  await putPart("admin", a.id, 1, bytes.subarray(CHUNK, CHUNK * 2));
  await putPart("admin", a.id, 2, bytes.subarray(CHUNK * 2));
  expect(await finishUpload("admin", a.id)).toEqual({ cid, stored: true });
  expect(await mediaBytes(cid)).toEqual(bytes);
  expect((await listMedia({ q: "film" }))[0]!.kind).toBe("video");
  expect(await have([cid, "bafkreinope"])).toEqual([cid]);
});

test("bytes that do not match the promised CID are dropped", async () => {
  const bytes = new TextEncoder().encode("the real bytes");
  const up = await startUpload("admin", { path: "/x.jpg", size: bytes.length, cid: await cidOf(new TextEncoder().encode("other bytes...")) });
  await putPart("admin", up.id, 0, bytes);
  await expect(finishUpload("admin", up.id)).rejects.toThrow(/arrived as/);
  expect(await have([await cidOf(bytes)])).toEqual([]);
});

test("a known CID needs no upload: its path is named; tags are replaced whole; the public manifest lists only CDN copies", async () => {
  const bytes = new TextEncoder().encode("shared bytes");
  const { cid } = await putMedia(bytes, "/a/one.jpg");
  await namePath("/b/two.jpg", cid);
  await expect(namePath("/c/three.jpg", "bafkreiunknown")).rejects.toThrow(/does not hold/);
  expect((await listMedia({ q: "two.jpg" }))[0]!.paths).toEqual(["/a/one.jpg", "/b/two.jpg"]);
  await retag(new Map([[cid, new Set(["Day 19", "cover"])]]));
  await retag(new Map([[cid, new Set(["unused"])]]));
  expect((await listMedia({ q: "one.jpg" }))[0]!.tags).toEqual(["unused"]);
  expect((await publicManifest())["/a/one.jpg"]).toBeUndefined();
  await markDistributed(cid, { cdn_path: `media/${cid}.jpg` });
  expect((await publicManifest())["/b/two.jpg"]).toEqual({ cid, url: `/media/${cid}.jpg` });
});

test("a timeline is an edit over the library: created, saved, listed, deleted", async () => {
  const { createTimeline, deleteTimeline, listTimelines, saveTimeline } = await import("../src/timelines");
  const cid = await cidOf(new TextEncoder().encode("a take"));
  const t = await createTimeline("admin", { name: "Day 19 · George", tags: ["Day 19"], clips: [{ id: "a", cid, track: "A1", start: 0.5, in: 0, dur: 7.7, vol: 1 }] });
  expect(t.aspect).toBe("1:1");
  expect(t.clips[0]!.dur).toBe(7.7);
  const saved = await saveTimeline(t.id, { clips: [{ id: "a", cid, track: "A1", start: 1, in: 0.2, dur: 6, vol: 0.8 }], aspect: "16:9" });
  expect(saved.clips[0]!.start).toBe(1);
  expect(saved.aspect).toBe("16:9");
  expect(saved.name).toBe("Day 19 · George");
  await expect(saveTimeline(t.id, { clips: [{ cid: "nope" }] })).rejects.toThrow(/names a CID/);
  expect((await listTimelines()).map((x) => x.id)).toContain(t.id);
  await deleteTimeline(t.id);
  expect((await listTimelines()).map((x) => x.id)).not.toContain(t.id);
});
