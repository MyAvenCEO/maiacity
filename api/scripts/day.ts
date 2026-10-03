// A day onto the stories board, from its folder: its brainstorm pad (idea.md), its journey (journey.json), its base
// article (the single source of truth: blog/day-NN-…/post.md) and every derivative written from it (derivatives.json)
// — the article on the journal, the film on YouTube, the posts, the X thread, the Reel — each with its time. Checked
// against each platform's limits first.
//
//   bun api/scripts/day.ts blog/day-00-test-story --idea [--local]            the brainstorm pad alone: an idea
//   bun api/scripts/day.ts blog/day-19-we-filmed-the-city [--local]            the article and its derivatives
//   bun api/scripts/day.ts blog/day-19-we-filmed-the-city --article [--local]  the article alone: writing
//   bun api/scripts/day.ts blog/day-19-we-filmed-the-city --hook [--local]     the hook alone: its title cards
//
// A story's steps: the idea (its pad), the hook — the title (thumbnail.json's words), set into the title cards in
// every shape — its journey, then the writing, the base article written from them; the movie; derivatives are only
// written from a locked base, and sending them locks it (the story moves on to "derivatives"). A locked article is
// refused until the story is back in Writing. Every push carries the pad, the journey, the hook and its title cards.
//
// derivatives.json: { project, title, scheduled_at?, posts: [{ platform, format, title?, text, thread?, placement?,
//   aspect?, codec?, variant? (the film's timeline variant it posts: G, H…), scheduled_at?, note? }] }
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { call, say } from "./media-client";
import { list } from "../../scripts/film/vault.mjs";

const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!dir) throw new Error("usage: bun api/scripts/day.ts blog/day-NN-<slug> [--idea | --hook | --article] [--local]");
const ideaOnly = process.argv.includes("--idea");
const there = (f: string) => existsSync(join(dir, f));
const article = there("post.md") ? readFileSync(join(dir, "post.md"), "utf8") : "";
if (!article && !ideaOnly) throw new Error(`${dir} has no post.md yet: put its idea on the board with --idea`);
// the brainstorm pad and the journey travel with every push
const pad = there("idea.md") ? readFileSync(join(dir, "idea.md"), "utf8") : undefined;
const journey = there("journey.json") ? JSON.parse(readFileSync(join(dir, "journey.json"), "utf8")) : undefined;
if (ideaOnly && pad === undefined) throw new Error(`${dir} has no idea.md`);
const hookOnly = process.argv.includes("--hook");
const only = ideaOnly || hookOnly || process.argv.includes("--article") || !there("derivatives.json");
// the title: the article's, else the pad's heading ("Day 0 — the test story"); the day: the article's, else the folder's
const title = (/^title:\s*(.+)$/m.exec(article)?.[1] ?? /^#\s+(.+)$/m.exec(pad ?? "")?.[1]?.replace(/^Day \d+\s*[—·-]\s*/, "") ?? "").trim();
const dayNo = /^day:\s*(\d+)/m.exec(article)?.[1] ?? /day-(\d+)/.exec(dir)?.[1];
if (dayNo === undefined) throw new Error(`which day is ${dir}? (a day: line in post.md, or a day-NN- folder)`);
const day = (only
  ? { project: `Day ${Number(dayNo)}`, title: `Day ${Number(dayNo)} · ${title}`, posts: [] }
  : JSON.parse(readFileSync(join(dir, "derivatives.json"), "utf8"))) as {
  project: string; title: string; scheduled_at?: string;
  posts: { platform: string; format: string; title?: string; text: string; thread?: string[]; variant?: string; timeline?: string }[];
};

// what each platform takes, in characters (no hashtags anywhere: the words carry the keywords)
const LIMITS: Record<string, { title?: number; text: number }> = { journal: { text: 200000 }, youtube: { title: 100, text: 5000 }, x: { text: 280 }, linkedin: { text: 3000 }, instagram: { text: 2200 } };
// an X Article is long form: a title and up to ~100 000 characters
const X_ARTICLE = { title: 100, text: 100000 };
const wrong: string[] = [];
for (const p of day.posts) {
  const l = p.platform === "x" && p.format === "article" ? X_ARTICLE : LIMITS[p.platform];
  if (!l) wrong.push(`${p.platform}: not a platform we post to`);
  else {
    if (l.title && (p.title ?? "").length > l.title) wrong.push(`${p.platform}: title ${p.title!.length}/${l.title}`);
    for (const [i, t] of (p.thread ?? [p.text]).entries()) if (t.length > l.text) wrong.push(`${p.platform} ${p.format}${p.thread ? ` #${i + 1}` : ""}: ${t.length}/${l.text}`);
  }
}
if (wrong.length) throw new Error(`over the limit:\n  ${wrong.join("\n  ")}`);

// a derivative that posts a film names its cut by variant: the timeline it came from
const timelines = day.posts.some((p) => p.variant) ? await call<{ id: string; project: string | null; variant: string | null }[]>("/api/timelines") : [];
for (const p of day.posts) {
  if (!p.variant) continue;
  const t = timelines.find((x) => x.project === day.project && x.variant === p.variant);
  if (!t) throw new Error(`no timeline ${day.project} · ${p.variant}`);
  p.timeline = t.id;
  delete p.variant;
}

// the hook: thumbnail.json's words, the line every title card carries ("The 1 million lives decision — I almost…")
type File = { hash: string; channels: string[]; aspect: string; codec: string; kind?: "video" | "thumbnail"; format?: string; note?: string };
const cards = existsSync(join(dir, "thumbnail.json"))
  ? (JSON.parse(readFileSync(join(dir, "thumbnail.json"), "utf8")) as { cards?: Record<string, string>; title: Record<string, unknown> })
  : null;
const hook = cards
  ? ["kicker", "big", "line", "after", "old", "new"].map((k) => { const v = cards.title[k] as unknown; return v && typeof v === "object" ? Object.values(v).join(" ") : (v as string) ?? ""; }).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
  : undefined;
// its title cards, by hash (thumbnail.json's "cards", written when they are rendered), and where each shape goes
const SHAPES: Record<string, { aspect: string; channels: string[]; format: string }> = {
  "16x9": { aspect: "16:9", channels: ["journal", "youtube", "linkedin"], format: "title card · 1920×1080" },
  "1x1": { aspect: "1:1", channels: ["youtube", "x", "linkedin", "instagram"], format: "title card · 1080×1080" },
  "9x16": { aspect: "9:16", channels: ["instagram"], format: "Reel cover · 1080×1920" },
  "5x2": { aspect: "5:2", channels: ["x"], format: "X Article cover · 1500×600" },
};
const titleCards: File[] = Object.entries(cards?.cards ?? {})
  .filter(([tag, hash]) => hash && SHAPES[tag])
  .map(([tag, hash]) => ({ hash, codec: "jpeg", kind: "thumbnail", ...SHAPES[tag]! }));
// the day's own files (a film the post carries, its copies), by hash: as deliveries
const listed = (day as { files?: File[] }).files ?? (existsSync(join(dir, "derivatives.json")) ? JSON.parse(readFileSync(join(dir, "derivatives.json"), "utf8")).files : undefined) ?? [];
const files = [...listed, ...titleCards.filter((c) => !listed.some((f: File) => f.hash === c.hash))] as File[];
let deliveries: unknown[] | undefined;
if (files.length && !ideaOnly) {
  // what the vault knows about each (its size, its length): the Mac app's catalog
  const vault = new Map((await list()).map((m) => [m.hash, m]));
  deliveries = files.map((f) => {
    const m = vault.get(f.hash);
    if (!m) throw new Error(`the vault does not describe ${f.hash}`);
    return { channels: f.channels, hash: m.hash, mime: m.mime, format: f.format ?? `${f.codec} · ${f.aspect}`, aspect: f.aspect, width: 0, height: 0, codec: f.codec, bytes: m.size, seconds: Number(m.meta?.duration_s ?? 0), kind: f.kind ?? "video", ...(f.note ? { note: f.note } : {}) };
  });
}

const item = await call<{ id: string; posts: unknown[]; status: string }>(`/api/content/days/${encodeURIComponent(day.project)}`, {
  method: "PUT",
  body: JSON.stringify(ideaOnly
    ? { title: day.title, idea: pad, ...(journey ? { journey } : {}) }
    : {
        title: day.title, source: join(dir, "post.md"), ...(hook ? { hook } : {}), ...(deliveries ? { deliveries } : {}),
        ...(pad !== undefined ? { idea: pad } : {}), ...(journey ? { journey } : {}),
        ...(hookOnly ? {} : { body: article, scheduled_at: day.scheduled_at }), ...(only ? {} : { posts: day.posts }),
      }),
});
if (hookOnly && !hook) throw new Error(`no hook yet: write ${join(dir, "thumbnail.json")} first`);
say(ideaOnly
  ? `${day.project}: the idea on the board (${item.status}) — its pad, ${pad!.split("\n").length} lines`
  : hookOnly
  ? `${day.project}: the hook on the board (${item.status}) — "${hook}", ${titleCards.length} title cards`
  : only
  ? `${day.project}: the base article on the board (${item.status})${hook ? ` — hook "${hook}"` : ""}`
  : `${day.project}: the base article and ${item.posts.length} derivatives on the board (${item.status}) — ${day.posts.map((p) => `${p.platform} ${p.format}`).join(", ")}`);
