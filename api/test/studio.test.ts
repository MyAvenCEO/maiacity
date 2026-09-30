// The studio's timelines, render queue and a film's item on the board, against real Postgres semantics (PGlite).
// Every file is named by its BLAKE3 hash (64 hex), as the vault knows it; the API never holds the bytes.
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";

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

/** a made-up file hash: these hex digits, repeated to 64 */
const hash = (s: string) => s.repeat(64).slice(0, 64);

test("a timeline is an edit over the vault's files: created, saved, listed, deleted", async () => {
  const { createTimeline, deleteTimeline, listTimelines, saveTimeline } = await import("../src/timelines");
  const take = hash("a1");
  const t = await createTimeline("admin", { name: "Day 19 · George", tags: ["Day 19"], clips: [{ id: "a", hash: take, track: "A1", start: 0.5, in: 0, dur: 7.7, vol: 1 }] });
  expect(t.aspect).toBe("16:9"); // the default frame
  expect(t.clips[0]!.dur).toBe(7.7);
  expect(t.clips[0]!.hash).toBe(take);
  const saved = await saveTimeline(t.id, { clips: [{ id: "a", hash: take, track: "A1", start: 1, in: 0.2, dur: 6, vol: 0.8 }], aspect: "16:9" });
  expect(saved.clips[0]!.start).toBe(1);
  expect(saved.aspect).toBe("16:9");
  expect(saved.name).toBe("Day 19 · George");
  await expect(saveTimeline(t.id, { clips: [{ hash: "nope" }] })).rejects.toThrow(/names its file by hash/);
  await expect(saveTimeline(t.id, { clips: [{ hash: take.toUpperCase() }] })).rejects.toThrow(/by hash/);
  // a clip still naming a CID is not a clip any more
  await expect(saveTimeline(t.id, { clips: [{ id: "a", cid: "bafkreigetwdcbas777qekxb5kogpulriyurk4km6xxxwz2fiuxhkbinpea", track: "A1", start: 0, in: 0, dur: 1, vol: 1 }] })).rejects.toThrow(/by hash/);
  expect((await listTimelines()).map((x) => x.id)).toContain(t.id);
  await deleteTimeline(t.id);
  expect((await listTimelines()).map((x) => x.id)).not.toContain(t.id);
});

test("timelines are variants of a project: A, B… listed together", async () => {
  const { createTimeline, listTimelines, saveTimeline } = await import("../src/timelines");
  const b = await createTimeline("admin", { name: "Spuds, 13 shots", project: "Day 19", variant: "B", clips: [{ id: "x", hash: hash("b2"), track: "A1", start: 0, in: 0, dur: 1, vol: 1 }] });
  const a = await createTimeline("admin", { name: "Brian, 10 shots", project: "Day 19", variant: "A" });
  const loose = await createTimeline("admin", { name: "Loose edit" });
  const order = (await listTimelines()).map((t) => t.id);
  expect(order.indexOf(a.id)).toBeLessThan(order.indexOf(b.id));
  expect(order.indexOf(b.id)).toBeLessThan(order.indexOf(loose.id));
  expect((await saveTimeline(loose.id, { project: "Day 19", variant: "C" })).variant).toBe("C");
  expect((await saveTimeline(loose.id, { name: "Renamed" })).project).toBe("Day 19");
});

test("a render is queued once per timeline, claimed by one worker, reported done with the film's hash", async () => {
  const { createTimeline } = await import("../src/timelines");
  const { claimRender, queueRender, rendersOf, reportRender } = await import("../src/renders");
  const t = await createTimeline("admin", { name: "To export", project: "Day 19", variant: "Z" });
  const a = await queueRender("admin", t.id);
  expect((await queueRender("admin", t.id)).id).toBe(a.id); // pressing twice does not queue twice
  const job = await claimRender();
  expect(job!.id).toBe(a.id);
  expect(await claimRender()).toBeNull();
  await reportRender(a.id, { progress: 0.5, note: "picture" });
  await expect(reportRender(a.id, { status: "done", output_hash: "bafybeiexample" })).rejects.toThrow(/hash/);
  const done = await reportRender(a.id, { status: "done", progress: 1, output_hash: hash("f1") });
  expect(done.status).toBe("done");
  expect((await rendersOf(t.id))[0]!.output_hash).toBe(hash("f1"));
});

test("a film is one item on the board: every cut delivers onto it, each replacing only its own files and posts", async () => {
  const { createTimeline } = await import("../src/timelines");
  const { claimRender, queueRender, reportRender } = await import("../src/renders");
  const { listContent, saveContent, savePosts } = await import("../src/content");
  const full = await createTimeline("admin", { name: "Full shots", project: "Day 99", variant: "G" });
  const reel = await createTimeline("admin", { name: "Reel 90s", project: "Day 99", variant: "H", aspect: "9:16" });
  const file = (channels: string[], h: string, aspect: string) => ({ channels, hash: h, format: aspect, aspect, width: 1, height: 1, codec: "h264", bytes: 1, seconds: 169 });
  const done = async (t: { id: string }, deliveries: unknown[]) => {
    const j = await queueRender("admin", t.id);
    await claimRender();
    await reportRender(j.id, { status: "done", progress: 1, output_hash: hash("f2"), deliveries });
  };
  const [master, copy, cut, again] = [hash("4d"), hash("1080"), hash("916"), hash("0a")];
  await savePosts("admin", full.id, [{ platform: "youtube", title: "T", text: "words", aspect: "16:9", codec: "hevc" }], "Day 99 · A film");
  let item = (await listContent()).find((i) => i.project === "Day 99")!;
  expect(item.status).toBe("draft");
  await done(full, [file(["youtube"], master, "16:9"), file(["x", "linkedin"], copy, "16:9")]);
  await done(reel, [file(["instagram"], cut, "9:16")]);
  const items = (await listContent()).filter((i) => i.project === "Day 99");
  expect(items).toHaveLength(1); // one film, one item
  item = items[0]!;
  expect(item.title).toBe("Day 99 · A film");
  expect(item.status).toBe("draft"); // a render never locks the base article
  expect(item.channels.sort()).toEqual(["instagram", "linkedin", "x", "youtube"]);
  expect(item.deliveries.map((d) => d.hash)).toEqual([master, copy, cut]);
  expect(item.hashes.sort()).toEqual([master, copy, cut].sort()); // the files it carries
  expect(item.deliveries[2]!.cut).toBe("Reel 90s");
  // the full film rendered again: its files replaced, the Reel's kept; the date and status stay
  await saveContent(item.id, { status: "scheduled", scheduled_at: "2026-10-01T09:00:00Z" });
  await done(full, [file(["x"], again, "16:9")]);
  item = (await listContent()).find((i) => i.project === "Day 99")!;
  expect(item.deliveries.map((d) => d.hash)).toEqual([cut, again]);
  expect(item.status).toBe("scheduled");
  // a cut's films taken off again (a test render): the other cut's stay, and so does the rest of the card
  const { dropDeliveries } = await import("../src/content");
  item = await dropDeliveries(item.id, reel.id);
  expect(item.deliveries.map((d) => d.hash)).toEqual([again]);
  expect(item.hashes).not.toContain(cut); // its own files leave the card
  expect(item.hashes).toContain(again);
  expect(item.status).toBe("scheduled");
  expect(item.posts).toHaveLength(1);
  await expect(savePosts("admin", reel.id, [{ platform: "tiktok", text: "x", aspect: "9:16", codec: "h264" }])).rejects.toThrow();
});

test("a day starts with its hook — the title set into its cards — and the article follows from it", async () => {
  const { saveDay } = await import("../src/content");
  const hook = "The 1 million lives decision — I almost didn't dare to take";
  const card = { channels: ["x"], hash: hash("c4"), format: "X Article cover", aspect: "5:2", width: 0, height: 0, codec: "jpeg", bytes: 1, seconds: 0, kind: "thumbnail" as const };
  let item = await saveDay("admin", "Day 96", { title: "Day 96 · The decision", hook, deliveries: [card] });
  expect(item.status).toBe("hook"); // the hook alone, no article yet
  expect(item.hook).toBe(hook);
  expect(item.body).toBe("");
  expect(item.deliveries.map((d) => d.hash)).toEqual([hash("c4")]);
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
