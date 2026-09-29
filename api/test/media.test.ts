// The media library against real Postgres semantics (PGlite): files are kept by their IPFS CID, the same
// bytes once however many paths name them, and read back whole or by byte range, across chunk borders.
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { CHUNK, cidOf, describe, finishUpload, have, listMedia, manifest, markDistributed, mediaBytes, publicManifest, putMedia, putPart, readMedia, retag, startUpload, undistributed } from "../src/media";

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

test("a file is kept once by its CID, and described — no paths", async () => {
  const bytes = new Uint8Array(CHUNK * 2 + 1234).map((_, i) => (i * 7) % 256);
  const a = await putMedia(bytes, "image/jpeg", { title: "Cover", tags: ["Day 01", "role:cover"] });
  const b = await putMedia(bytes, "image/jpeg", { title: "The same cover" });
  expect(a.stored).toBe(true);
  expect(b.stored).toBe(false);
  expect(b.cid).toBe(a.cid);
  const [row] = await listMedia({ kind: "image" });
  expect(row!.title).toBe("The same cover");
  expect(row!.tags).toEqual(["Day 01", "role:cover"]); // tags not given are left as they were
  expect(row!.size).toBe(bytes.length);
  expect(await mediaBytes(a.cid)).toEqual(bytes);
  // a range across both chunk borders
  const from = CHUNK - 10, to = CHUNK * 2 + 10;
  expect(await read(readMedia(a.cid, from, to))).toEqual(bytes.subarray(from, to + 1));
});

test("only a public file waits for a copy on the CDN; the manifest lists public files by CID", async () => {
  const song = await putMedia(new TextEncoder().encode("a song"), "audio/mpeg", { title: "Song", tags: ["sound:song"], public: true });
  const take = await putMedia(new TextEncoder().encode("a raw take"), "video/mp4", { title: "Take" });
  const waiting = (await undistributed()).map((u) => u.cid);
  expect(waiting).toContain(song.cid);
  expect(waiting).not.toContain(take.cid); // private: never copied out
  expect((await manifest())[song.cid]).toMatchObject({ url: null, title: "Song", tags: ["sound:song"] });
  expect((await manifest())[take.cid]).toBeUndefined();
  await markDistributed(song.cid, { cdn_path: `media/${song.cid}.mp3` });
  expect((await undistributed()).map((u) => u.cid)).not.toContain(song.cid);
  expect((await publicManifest())[song.cid]!.url).toBe(`/media/${song.cid}.mp3`);
});

test("an upload arrives in parts, can resume, and becomes media only if its CID is the promised one", async () => {
  const bytes = new Uint8Array(CHUNK * 2 + 99).map((_, i) => (i * 13) % 251);
  const cid = await cidOf(bytes);
  const a = await startUpload("admin", { size: bytes.length, cid, mime: "video/mp4", title: "Day 19 film", tags: ["Day 19"] });
  expect(a.parts).toBe(3);
  await putPart("admin", a.id, 0, bytes.subarray(0, CHUNK));
  // interrupted: starting again resumes the same upload, part 0 already there
  const b = await startUpload("admin", { size: bytes.length, cid, mime: "video/mp4", title: "Day 19 film", tags: ["Day 19"] });
  expect(b.id).toBe(a.id);
  expect(b.received).toEqual([0]);
  await expect(putPart("admin", a.id, 1, bytes.subarray(0, 10))).rejects.toThrow(/should be/);
  await expect(finishUpload("admin", a.id)).rejects.toThrow(/missing/);
  await putPart("admin", a.id, 1, bytes.subarray(CHUNK, CHUNK * 2));
  await putPart("admin", a.id, 2, bytes.subarray(CHUNK * 2));
  expect(await finishUpload("admin", a.id)).toEqual({ cid, stored: true });
  expect(await mediaBytes(cid)).toEqual(bytes);
  const [got] = await listMedia({ q: "film" });
  expect(got!.kind).toBe("video");
  expect(got!.tags).toEqual(["Day 19"]);
  expect(await have([cid, "bafkreinope"])).toEqual([cid]);
});

test("bytes that do not match the promised CID are dropped", async () => {
  const bytes = new TextEncoder().encode("the real bytes");
  const up = await startUpload("admin", { size: bytes.length, mime: "image/jpeg", cid: await cidOf(new TextEncoder().encode("other bytes...")) });
  await putPart("admin", up.id, 0, bytes);
  await expect(finishUpload("admin", up.id)).rejects.toThrow(/arrived as/);
  expect(await have([await cidOf(bytes)])).toEqual([]);
});

test("a known CID needs no upload, only its description; tags are replaced whole", async () => {
  const { cid } = await putMedia(new TextEncoder().encode("shared bytes"), "image/jpeg", { title: "One" });
  await describe(cid, { title: "Two", description: "the shared picture", tags: ["Day 19", "cover"], public: true });
  await expect(describe("bafkreiunknown", { title: "x" })).rejects.toThrow(/does not hold/);
  expect((await listMedia({ q: "shared picture" }))[0]!.title).toBe("Two");
  await retag(new Map([[cid, new Set(["role:cover"])]]));
  expect((await listMedia({ q: "Two" }))[0]!.tags).toEqual(["role:cover"]);
  expect((await listMedia({ q: "role:cov" }))[0]!.cid).toBe(cid); // found by a tag
});

test("a timeline is an edit over the library: created, saved, listed, deleted", async () => {
  const { createTimeline, deleteTimeline, listTimelines, saveTimeline } = await import("../src/timelines");
  const cid = await cidOf(new TextEncoder().encode("a take"));
  const t = await createTimeline("admin", { name: "Day 19 · George", tags: ["Day 19"], clips: [{ id: "a", cid, track: "A1", start: 0.5, in: 0, dur: 7.7, vol: 1 }] });
  expect(t.aspect).toBe("16:9"); // the default frame
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

test("timelines are variants of a project: A, B… listed together", async () => {
  const { createTimeline, listTimelines, saveTimeline } = await import("../src/timelines");
  const cid = await cidOf(new TextEncoder().encode("variant take"));
  const b = await createTimeline("admin", { name: "Spuds, 13 shots", project: "Day 19", variant: "B", clips: [{ id: "x", cid, track: "A1", start: 0, in: 0, dur: 1, vol: 1 }] });
  const a = await createTimeline("admin", { name: "Brian, 10 shots", project: "Day 19", variant: "A" });
  const loose = await createTimeline("admin", { name: "Loose edit" });
  const order = (await listTimelines()).map((t) => t.id);
  expect(order.indexOf(a.id)).toBeLessThan(order.indexOf(b.id));
  expect(order.indexOf(b.id)).toBeLessThan(order.indexOf(loose.id));
  expect((await saveTimeline(loose.id, { project: "Day 19", variant: "C" })).variant).toBe("C");
  expect((await saveTimeline(loose.id, { name: "Renamed" })).project).toBe("Day 19");
});

test("a render is queued once per timeline, claimed by one worker, reported done with the film's CID", async () => {
  const { createTimeline } = await import("../src/timelines");
  const { claimRender, queueRender, rendersOf, reportRender } = await import("../src/renders");
  const t = await createTimeline("admin", { name: "To export", project: "Day 19", variant: "Z" });
  const a = await queueRender("admin", t.id);
  expect((await queueRender("admin", t.id)).id).toBe(a.id); // pressing twice does not queue twice
  // the files uploaded above queued their proxies first (migration 0024): the worker takes those too
  let job = await claimRender();
  while (job && job.kind !== "render") job = await claimRender();
  expect(job!.id).toBe(a.id);
  expect(await claimRender()).toBeNull();
  await reportRender(a.id, { progress: 0.5, note: "picture" });
  const done = await reportRender(a.id, { status: "done", progress: 1, output_cid: "bafybeiexample" });
  expect(done.status).toBe("done");
  expect((await rendersOf(t.id))[0]!.output_cid).toBe("bafybeiexample");
});

test("a film is one item on the board: every cut delivers onto it, each replacing only its own files and posts", async () => {
  const { createTimeline } = await import("../src/timelines");
  const { claimRender, queueRender, reportRender } = await import("../src/renders");
  const { listContent, saveContent, savePosts } = await import("../src/content");
  const full = await createTimeline("admin", { name: "Full shots", project: "Day 99", variant: "G" });
  const reel = await createTimeline("admin", { name: "Reel 90s", project: "Day 99", variant: "H", aspect: "9:16" });
  const file = (channels: string[], cid: string, aspect: string) => ({ channels, cid, path: `/studio/renders/${cid}.mp4`, format: aspect, aspect, width: 1, height: 1, codec: "h264", bytes: 1, seconds: 169 });
  const done = async (t: { id: string }, deliveries: unknown[]) => {
    const j = await queueRender("admin", t.id);
    await claimRender();
    await reportRender(j.id, { status: "done", progress: 1, output_cid: "bafybeiexample", deliveries });
  };
  await savePosts("admin", full.id, [{ platform: "youtube", title: "T", text: "words", aspect: "16:9", codec: "hevc" }], "Day 99 · A film");
  let item = (await listContent()).find((i) => i.project === "Day 99")!;
  expect(item.status).toBe("draft");
  await done(full, [file(["youtube"], "bafybeimaster4k", "16:9"), file(["x", "linkedin"], "bafybeicopy1080", "16:9")]);
  await done(reel, [file(["instagram"], "bafybeireelcut", "9:16")]);
  const items = (await listContent()).filter((i) => i.project === "Day 99");
  expect(items).toHaveLength(1); // one film, one item
  item = items[0]!;
  expect(item.title).toBe("Day 99 · A film");
  expect(item.status).toBe("draft"); // a render never locks the base article
  expect(item.channels.sort()).toEqual(["instagram", "linkedin", "x", "youtube"]);
  expect(item.deliveries.map((d) => d.cid)).toEqual(["bafybeimaster4k", "bafybeicopy1080", "bafybeireelcut"]);
  expect(item.deliveries[2]!.cut).toBe("Reel 90s");
  // the full film rendered again: its files replaced, the Reel's kept; the date and status stay
  await saveContent(item.id, { status: "scheduled", scheduled_at: "2026-10-01T09:00:00Z" });
  await done(full, [file(["x"], "bafybeinewcopy", "16:9")]);
  item = (await listContent()).find((i) => i.project === "Day 99")!;
  expect(item.deliveries.map((d) => d.cid)).toEqual(["bafybeireelcut", "bafybeinewcopy"]);
  expect(item.status).toBe("scheduled");
  expect(item.posts).toHaveLength(1);
  await expect(savePosts("admin", reel.id, [{ platform: "tiktok", text: "x", aspect: "9:16", codec: "h264" }])).rejects.toThrow();
});

test("a day starts with its hook — the title set into its cards — and the article follows from it", async () => {
  const { saveDay } = await import("../src/content");
  const hook = "The 1 million lives decision — I almost didn't dare to take";
  const card = { channels: ["x"], cid: "bafkreihookcard", path: "/day-96/thumbnail-5x2.jpg", format: "X Article cover", aspect: "5:2", width: 0, height: 0, codec: "jpeg", bytes: 1, seconds: 0, kind: "thumbnail" as const };
  let item = await saveDay("admin", "Day 96", { title: "Day 96 · The decision", hook, deliveries: [card] });
  expect(item.status).toBe("hook"); // the hook alone, no article yet
  expect(item.hook).toBe(hook);
  expect(item.body).toBe("");
  expect(item.deliveries.map((d) => d.cid)).toEqual(["bafkreihookcard"]);
  item = await saveDay("admin", "Day 96", { title: "Day 96 · The decision", body: "# The decision" }); // the article written from it
  expect(item.status).toBe("draft");
  expect(item.hook).toBe(hook); // kept
  item = await saveDay("admin", "Day 96", { title: "Day 96 · The decision", hook: "A sharper hook" }); // a hook later never moves it back
  expect(item.status).toBe("draft");
  expect(item.hook).toBe("A sharper hook");
  expect(item.body).toBe("# The decision");
});

test("a day is its base article first — a draft — and only a locked base gets derivatives, each at its own time", async () => {
  const { saveContent, saveDay } = await import("../src/content");
  const article = { title: "Day 98 · We filmed the city", body: "# We filmed the city\n\nThe base article.", source: "blog/day-98-we-filmed-the-city/post.md", scheduled_at: "2026-10-02T07:00:00Z" };
  const posts = [
    { platform: "journal", format: "article", title: "We filmed the city", text: "The base article.", scheduled_at: "2026-10-02T07:00:00Z" },
    { platform: "x", format: "thread", text: "1/", thread: ["1/", "2/"], scheduled_at: "2026-10-02T11:00:00Z" },
  ];
  let item = await saveDay("admin", "Day 98", article);
  expect(item.status).toBe("draft"); // the base article alone
  expect(item.posts).toHaveLength(0);
  item = await saveDay("admin", "Day 98", { ...article, body: "# Rewritten" }); // a draft can still change
  expect(item.body).toBe("# Rewritten");
  item = await saveDay("admin", "Day 98", { posts }); // deriving locks the base
  expect(item.status).toBe("derivatives");
  expect(item.posts.map((p) => p.format)).toEqual(["article", "thread"]);
  expect(item.channels.sort()).toEqual(["journal", "x"]);
  await expect(saveDay("admin", "Day 98", { ...article, body: "# Changed after the lock" })).rejects.toThrow(/locked/);
  await saveContent(item.id, { status: "draft" }); // back to Draft: open again
  item = await saveDay("admin", "Day 98", { ...article, body: "# Changed in draft" });
  expect(item.body).toBe("# Changed in draft");
  await expect(saveDay("admin", "Day 97", { posts })).rejects.toThrow(/no base article/);
  await expect(saveDay("admin", "Day 98", { posts: [{ platform: "tiktok", text: "x" } as never] })).rejects.toThrow();
});
