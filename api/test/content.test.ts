// The publishing calendar against real Postgres semantics (PGlite).
import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { useDb, type Db } from "../src/pg";
import { MIGRATIONS } from "../src/migrations-list";
import { createContent, deleteContent, listContent, saveContent } from "../src/content";

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

test("an idea goes to the backlog; given a date it is scheduled; moved, it keeps what it carries", async () => {
  const idea = await createContent("admin", { title: "Day 19 film", kind: "film", channels: ["youtube", "instagram"], tags: ["Day 19"] });
  expect(idea.status).toBe("idea");
  expect(idea.scheduled_at).toBeNull();
  const when = "2026-10-01T16:00:00.000Z";
  const s = await saveContent(idea.id, { scheduled_at: when, status: "scheduled", hashes: ["dad53831fb215f1d6c5fc29c111aba8a2d7b472b43ab076da7537787c2895b8a"] });
  expect(new Date(s.scheduled_at!).toISOString()).toBe(when);
  expect(s.channels).toEqual(["youtube", "instagram"]);
  const moved = await saveContent(idea.id, { scheduled_at: "2026-10-03T16:00:00.000Z" });
  expect(moved.hashes.length).toBe(1);
  expect(moved.tags).toEqual(["Day 19"]);
  const october = await listContent("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
  expect(october.map((i) => i.id)).toContain(idea.id);
  expect((await listContent("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).map((i) => i.id)).not.toContain(idea.id);
  const back = await saveContent(idea.id, { scheduled_at: null });
  expect(back.scheduled_at).toBeNull();
  await expect(createContent("admin", { title: "x", kind: "hologram" })).rejects.toThrow(/kind is one of/);
  await expect(saveContent(idea.id, { hashes: ["bafybeieyz3wtzq4m35upckldkjtf2clzsxqnix6g63pvtun7nuhhfqr5de"] })).rejects.toThrow(/by their hash/);
  await expect(saveContent(idea.id, { channels: ["myspace"] })).rejects.toThrow(/One of/);
  await deleteContent(idea.id);
  expect((await listContent()).length).toBe(0);
});

test("a story moves through nine steps, and keeps its pad, its hook, its description, its journey and its thumbnail", async () => {
  const { STATUSES, saveContent: save } = await import("../src/content");
  expect(STATUSES).toEqual(["idea", "journey", "hook", "thumbnail", "writing", "movie", "derivatives", "scheduled", "published"]);
  const s = await createContent("admin", { title: "Day 0 · the test story", idea: "- links\n- a 10 s trailer" });
  expect(s.status).toBe("idea");
  expect(s.idea).toContain("10 s trailer");
  expect(s.body).toBe(""); // the pad is not the article
  expect(s.story).toBeNull();
  let x = await save(s.id, { status: "hook", hook: "It starts here", description: "The river first.", project: "Day 0" });
  expect([x.status, x.hook, x.description, x.project]).toEqual(["hook", "It starts here", "The river first.", "Day 0"]);
  x = await save(s.id, {
    status: "journey",
    journey: {
      from: "a city is a dream", to: "a city is being built", question: "Will it work?",
      beats: [
        { title: "The river at dawn", type: "hook", tension: 0.4, feel: "curiosity" },
        { title: "The first piece fails", type: "obstacle", link: "but", tension: 1.7, text: "x".repeat(5000) },
      ],
    },
  });
  expect(x.journey.question).toBe("Will it work?");
  expect(x.journey.beats!.map((b) => [b.id, b.type, b.link ?? null, b.tension])).toEqual([["b1", "hook", null, 0.4], ["b2", "obstacle", "but", 1]]);
  expect(x.journey.beats![1]!.text.length).toBe(4000);
  expect(x.journey.beats![0]!.feel).toBe("curiosity");
  // the hook is picked from the variants tried, each with its parts named
  x = await save(s.id, {
    hooks: [
      { text: "94% loaded. The last 6% is you.", subject: "you", action: "complete the load", end: "the bar fills", contrast: "a number ↔ a person", anchor: "curiosity", promise: "On Sunday the bar fills.", objection: "Not a trailer.", dial: 3 },
      { text: "A valley is loading.", dial: 9, note: "runner-up" },
    ],
    hook: "94% loaded. The last 6% is you.",
  });
  expect(x.hooks.map((h) => [h.id, h.dial ?? null, h.subject ?? null])).toEqual([["h1", 3, "you"], ["h2", 4, null]]);
  expect(x.hooks[0]!.objection).toBe("Not a trailer.");
  expect(x.hook).toBe(x.hooks[0]!.text);
  await expect(save(s.id, { hooks: [{ dial: 2 }] })).rejects.toThrow(/needs its line/);
  await expect(save(s.id, { hooks: "none" })).rejects.toThrow(/list/);
  expect((await save(s.id, { description: "still" })).hooks.length).toBe(2); // untouched by other patches
  // the intro: the first seconds of the film, kept apart from the hook and the description
  const withIntro = await save(s.id, { intro: "The moment I woke up today, I knew." });
  expect([withIntro.intro, withIntro.hook, withIntro.description]).toEqual(["The moment I woke up today, I knew.", "94% loaded. The last 6% is you.", "still"]);
  // the title card, designed in layers: kinds checked, numbers kept, a hash checked, the rest untouched by other patches
  const designed = await save(s.id, { thumbnail: { layers: [
    { kind: "image", hash: "a".repeat(64), fit: "cover" }, { id: "face", kind: "cutout", hash: "b".repeat(64), x: 2, y: 8.123, w: 44 },
    { kind: "text", text: "", x: 48, y: 20, w: 48, size: 7.5, color: "gold", rot: -6.5 }, { kind: "badge", text: "DAY 1", on: false, rot: 400 },
  ], card: "c".repeat(64) } });
  expect(designed.thumbnail.layers!.map((l) => [l.id, l.kind, l.on, l.y ?? null])).toEqual([["l1", "image", true, null], ["face", "cutout", true, 8.12], ["l3", "text", true, 20], ["l4", "badge", false, null]]);
  expect(designed.thumbnail.layers!.map((l) => l.rot ?? null)).toEqual([null, null, -6.5, 180]);
  expect(designed.thumbnail.card).toBe("c".repeat(64));
  expect(designed.status).toBe("journey");
  await expect(save(s.id, { thumbnail: { layers: [{ kind: "sticker" }] } })).rejects.toThrow(/one of/);
  await expect(save(s.id, { thumbnail: { layers: [{ kind: "image", hash: "nope" }] } })).rejects.toThrow(/hash/);
  expect((await save(s.id, { status: "thumbnail" })).thumbnail.layers!.length).toBe(4);
  // the image title: the hook's catchwords for the card, on the item and on a variant
  const titled = await save(s.id, { image_title: ["a '1' million lives", " decision ", ""], hooks: [{ text: "A 1 million lives decision", image_title: ["1 million lives", "decision"] }] });
  expect(titled.image_title).toEqual(["a '1' million lives", "decision"]);
  expect(titled.hooks[0]!.image_title).toEqual(["1 million lives", "decision"]);
  await expect(save(s.id, { image_title: "one line" })).rejects.toThrow(/list/);
  expect((await save(s.id, { description: "again" })).image_title).toEqual(["a '1' million lives", "decision"]);
  await expect(save(s.id, { journey: { beats: [{ title: "?", type: "montage" }] } })).rejects.toThrow(/beat is one of/);
  await expect(save(s.id, { journey: { beats: [{ type: "hook" }] } })).rejects.toThrow(/title/);
  await expect(save(s.id, { status: "draft" })).rejects.toThrow(/status is one of/);
  // a day names one story
  const other = await createContent("admin", { title: "Another" });
  await expect(save(other.id, { project: "Day 0" })).rejects.toThrow(/already has that day/);
  // the Mac app files the story in the vault once it is past the idea
  const { unfiledStories, fileStory } = await import("../src/content");
  expect((await unfiledStories()).map((u) => u.id)).toEqual([s.id]); // the other is still an idea
  const vault = "ab".repeat(32);
  expect((await fileStory(s.id, vault)).story).toBe(vault);
  expect(await unfiledStories()).toEqual([]);
  await expect(fileStory(s.id, "not-a-namespace")).rejects.toThrow(/vault id/);
  await deleteContent(s.id);
  await deleteContent(other.id);
});

test("the stories migration: a draft is being written, an idea's text becomes its pad", async () => {
  const fresh = new PGlite();
  const until = MIGRATIONS.findIndex((m) => m.id === "0031-stories");
  for (const m of MIGRATIONS.slice(0, until)) await fresh.exec(m.sql);
  await fresh.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin')");
  await fresh.query("INSERT INTO content_items (title, kind, status, body, founder_id) VALUES ('An idea', 'post', 'idea', 'the idea itself', 'admin')");
  await fresh.query("INSERT INTO content_items (title, kind, status, body, source, project, founder_id) VALUES ('Day 7', 'post', 'draft', '# Day 7', 'blog/day-07/post.md', 'Day 7', 'admin')");
  await fresh.exec(MIGRATIONS[until]!.sql);
  const { rows } = await fresh.query<{ title: string; status: string; body: string; idea: string; journey: object; story: string | null }>(
    "SELECT title, status, body, idea, journey, story FROM content_items ORDER BY title",
  );
  expect(rows).toEqual([
    { title: "An idea", status: "idea", body: "", idea: "the idea itself", journey: {}, story: null },
    { title: "Day 7", status: "writing", body: "# Day 7", idea: "", journey: {}, story: null },
  ]);
  await expect(fresh.query("UPDATE content_items SET status = 'draft'")).rejects.toThrow();
});

test("stories, not days: every old day takes its name, the days that are no story are ideas again, no title starts with its day", async () => {
  const fresh = new PGlite();
  const until = MIGRATIONS.findIndex((m) => m.id === "0032-stories-not-days");
  for (const m of MIGRATIONS.slice(0, until)) await fresh.exec(m.sql);
  await fresh.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin')");
  const item = (title: string, status: string, project: string | null) =>
    fresh.query("INSERT INTO content_items (title, kind, status, body, project, founder_id) VALUES ($1, 'post', $2, '# draft', $3, 'admin')", [title, status, project]);
  await item("Day 19 · We filmed one whole day inside the city", "derivatives", "Day 19");
  await item("Day 6 · The last level builds nothing", "writing", "Day 6");
  await item("Day 1 — The 1 million lives decision", "hook", "day-01");
  await item("A day like any other", "idea", null);
  await item("Day 42 · Not on the list", "writing", "Day 42");
  await fresh.query("INSERT INTO timelines (name, project, founder_id) VALUES ('Full', 'Day 19', 'admin'), ('Loose', NULL, 'admin')");
  await fresh.exec(MIGRATIONS[until]!.sql);
  const { rows } = await fresh.query<{ title: string; status: string; project: string | null; body: string }>(
    "SELECT title, status, project, body FROM content_items ORDER BY title",
  );
  expect(rows).toEqual([
    { title: "A day like any other", status: "idea", project: null, body: "# draft" },
    { title: "Not on the list", status: "writing", project: "Day 42", body: "# draft" },
    { title: "The 1 million lives decision", status: "hook", project: "The 1 million decision", body: "# draft" },
    { title: "The last level builds nothing", status: "idea", project: "The food forest", body: "# draft" },
    { title: "We filmed one whole day inside the city", status: "derivatives", project: "233 settlers, how it starts", body: "# draft" },
  ]);
  const { rows: t } = await fresh.query<{ name: string; project: string | null }>("SELECT name, project FROM timelines ORDER BY name");
  expect(t).toEqual([{ name: "Full", project: "233 settlers, how it starts" }, { name: "Loose", project: null }]);
});

test("stories, not days: a name another item already has is not taken twice", async () => {
  const fresh = new PGlite();
  const until = MIGRATIONS.findIndex((m) => m.id === "0032-stories-not-days");
  for (const m of MIGRATIONS.slice(0, until)) await fresh.exec(m.sql);
  await fresh.query("INSERT INTO founders (id, name, role) VALUES ('admin', 'Admin', 'admin')");
  const item = (title: string, project: string | null) =>
    fresh.query("INSERT INTO content_items (title, kind, status, body, project, founder_id) VALUES ($1, 'post', 'writing', '', $2, 'admin')", [title, project]);
  await item("The 1 million decision", "The 1 million decision");
  await item("Day 1 · The old card", "Day 1");
  await item("Day 2 · First", "Day 2");
  await item("Day 2 · Second", "day-02");
  await fresh.exec(MIGRATIONS[until]!.sql);
  const { rows } = await fresh.query<{ title: string; project: string | null }>("SELECT title, project FROM content_items ORDER BY title");
  expect(rows).toEqual([
    { title: "First", project: "Thinking outside the box" },
    { title: "Second", project: null },
    { title: "The 1 million decision", project: "The 1 million decision" },
    { title: "The old card", project: null },
  ]);
});
