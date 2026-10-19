// A film's item on the board and a day's, against real Postgres semantics (PGlite). Every file is named by its BLAKE3
// hash (64 hex), as the vault knows it; the API never holds the bytes.
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

test("a film is one item on the board: each of its legacy cuts' posts go onto it, replacing only that cut's own", async () => {
  const { dropDeliveries, listContent, saveContent, savePosts } = await import("../src/content");
  const cut = async (name: string, variant: string) =>
    (await pg.query<{ id: string }>("INSERT INTO timelines (name, project, variant, founder_id) VALUES ($1, 'Day 99', $2, 'admin') RETURNING id", [name, variant])).rows[0]!.id;
  const [full, reel] = [await cut("Full shots", "G"), await cut("Reel 90s", "H")];
  await savePosts("admin", full, [{ platform: "youtube", title: "T", text: "words", aspect: "16:9", codec: "hevc" }], "Day 99 · A film");
  let item = (await listContent()).find((i) => i.project === "Day 99")!;
  expect(item.status).toBe("movie"); // a film before its day had a story: it starts at the movie
  await savePosts("admin", reel, [{ platform: "instagram", text: "the Reel", aspect: "9:16", codec: "h264" }]);
  const items = (await listContent()).filter((i) => i.project === "Day 99");
  expect(items).toHaveLength(1); // one film, one item
  item = items[0]!;
  expect(item.title).toBe("Day 99 · A film");
  expect(item.posts.map((p) => p.platform)).toEqual(["youtube", "instagram"]);
  // the full film's posts written again: its own replaced, the Reel's kept; the date and status stay
  await saveContent(item.id, { status: "scheduled", scheduled_at: "2026-10-01T09:00:00Z" });
  await savePosts("admin", full, [{ platform: "x", text: "again", aspect: "16:9", codec: "h264" }]);
  item = (await listContent()).find((i) => i.project === "Day 99")!;
  expect(item.posts.map((p) => p.platform)).toEqual(["instagram", "x"]);
  expect(item.channels.sort()).toEqual(["instagram", "x", "youtube"]);
  expect(item.status).toBe("scheduled");
  // a cut's films taken off again (a test render): the other cut's stay, and so does the rest of the card
  const [master, copy] = [hash("4d"), hash("916")];
  const file = (h: string, timeline: string) => ({ channels: ["youtube"], hash: h, format: "16:9", aspect: "16:9", width: 1, height: 1, codec: "h264", bytes: 1, seconds: 169, timeline });
  await pg.query("UPDATE content_items SET deliveries = $2, hashes = $3 WHERE id = $1", [item.id, JSON.stringify([file(master, full), file(copy, reel)]), [master, copy]]);
  item = await dropDeliveries(item.id, reel);
  expect(item.deliveries.map((d) => d.hash)).toEqual([master]);
  expect(item.hashes).not.toContain(copy); // its own files leave the card
  expect(item.hashes).toContain(master);
  expect(item.status).toBe("scheduled");
  expect(item.posts).toHaveLength(2);
  await expect(savePosts("admin", reel, [{ platform: "tiktok", text: "x", aspect: "9:16", codec: "h264" }])).rejects.toThrow();
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
  expect(item.status).toBe("writing");
  expect(item.hook).toBe(hook); // kept
  item = await saveDay("admin", "Day 96", { title: "Day 96 · The decision", hook: "A sharper hook" }); // a hook later never moves it back
  expect(item.status).toBe("writing");
  expect(item.hook).toBe("A sharper hook");
  expect(item.body).toBe("# The decision");
});

test("a day is its base article first — writing — and only a locked base gets derivatives, each at its own time", async () => {
  const { saveContent, saveDay } = await import("../src/content");
  const article = { title: "Day 98 · We filmed the city", body: "# We filmed the city\n\nThe base article.", source: "blog/day-98-we-filmed-the-city/post.md", scheduled_at: "2026-10-02T07:00:00Z" };
  const posts = [
    { platform: "journal", format: "article", title: "We filmed the city", text: "The base article.", scheduled_at: "2026-10-02T07:00:00Z" },
    { platform: "x", format: "thread", text: "1/", thread: ["1/", "2/"], scheduled_at: "2026-10-02T11:00:00Z" },
  ];
  let item = await saveDay("admin", "Day 98", article);
  expect(item.status).toBe("writing"); // the base article alone
  expect(item.posts).toHaveLength(0);
  item = await saveDay("admin", "Day 98", { ...article, body: "# Rewritten" }); // while it is written it can still change
  expect(item.body).toBe("# Rewritten");
  item = await saveDay("admin", "Day 98", { posts }); // deriving locks the base
  expect(item.status).toBe("derivatives");
  expect(item.posts.map((p) => p.format)).toEqual(["article", "thread"]);
  expect(item.channels.sort()).toEqual(["journal", "x"]);
  await expect(saveDay("admin", "Day 98", { ...article, body: "# Changed after the lock" })).rejects.toThrow(/locked/);
  await expect(saveContent(item.id, { body: "# Changed on the board" })).rejects.toThrow(/locked/); // the board too
  await saveContent(item.id, { status: "writing" }); // back to Writing: open again
  item = await saveDay("admin", "Day 98", { ...article, body: "# Changed while writing" });
  expect(item.body).toBe("# Changed while writing");
  await expect(saveDay("admin", "Day 97", { posts })).rejects.toThrow(/no base article/);
  await expect(saveDay("admin", "Day 98", { posts: [{ platform: "tiktok", text: "x" } as never] })).rejects.toThrow();
});
