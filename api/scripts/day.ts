// A day onto the board: its base article (the single source of truth: blog/day-NN-…/post.md) and every derivative
// written from it (derivatives.json, next to the article) — the article on the journal, the film on YouTube, the
// posts, the X thread, the Reel — each with its time. Checked against each platform's limits first.
//
//   bun api/scripts/day.ts blog/day-19-we-filmed-the-city [--local]            the article and its derivatives
//   bun api/scripts/day.ts blog/day-19-we-filmed-the-city --article [--local]  the article alone: the draft
//   bun api/scripts/day.ts blog/day-19-we-filmed-the-city --hook [--local]     the hook alone: its title cards
//
// The board's stages: first the hook — the title (thumbnail.json's words), set into the title cards in every shape —
// then the draft, the base article written from it; derivatives are only written from a locked base, and sending
// them locks it (the card moves on to "derivatives"). A locked article is refused until the card is back in Draft.
// Every push carries the hook and its title cards along.
//
// derivatives.json: { project, title, scheduled_at?, posts: [{ platform, format, title?, text, thread?, placement?,
//   aspect?, codec?, variant? (the film's timeline variant it posts: G, H…), scheduled_at?, note? }] }
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { call, say } from "./media-client";
import { get } from "./library";

const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!dir) throw new Error("usage: bun api/scripts/day.ts blog/day-NN-<slug> [--local]");
const article = readFileSync(join(dir, "post.md"), "utf8");
const hookOnly = process.argv.includes("--hook");
const only = hookOnly || process.argv.includes("--article") || !existsSync(join(dir, "derivatives.json"));
const title = (/^title:\s*(.+)$/m.exec(article)?.[1] ?? "").trim();
const dayNo = /^day:\s*(\d+)/m.exec(article)?.[1];
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
const timelines = await call<{ id: string; project: string | null; variant: string | null }[]>("/api/timelines");
for (const p of day.posts) {
  if (!p.variant) continue;
  const t = timelines.find((x) => x.project === day.project && x.variant === p.variant);
  if (!t) throw new Error(`no timeline ${day.project} · ${p.variant}`);
  p.timeline = t.id;
  delete p.variant;
}

// the hook: thumbnail.json's words, the line every title card carries ("The 1 million lives decision — I almost…")
type File = { cid: string; channels: string[]; aspect: string; codec: string; kind?: "video" | "thumbnail"; format?: string; note?: string };
const cards = existsSync(join(dir, "thumbnail.json"))
  ? (JSON.parse(readFileSync(join(dir, "thumbnail.json"), "utf8")) as { cards?: Record<string, string>; title: Record<string, unknown> })
  : null;
const hook = cards
  ? ["kicker", "big", "line", "after", "old", "new"].map((k) => { const v = cards.title[k] as unknown; return v && typeof v === "object" ? Object.values(v).join(" ") : (v as string) ?? ""; }).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
  : undefined;
// its title cards, by CID (thumbnail.json's "cards", written when they are rendered), and where each shape goes
const SHAPES: Record<string, { aspect: string; channels: string[]; format: string }> = {
  "16x9": { aspect: "16:9", channels: ["journal", "youtube", "linkedin"], format: "title card · 1920×1080" },
  "1x1": { aspect: "1:1", channels: ["youtube", "x", "linkedin", "instagram"], format: "title card · 1080×1080" },
  "9x16": { aspect: "9:16", channels: ["instagram"], format: "Reel cover · 1080×1920" },
  "5x2": { aspect: "5:2", channels: ["x"], format: "X Article cover · 1500×600" },
};
const titleCards: File[] = Object.entries(cards?.cards ?? {})
  .filter(([tag, cid]) => cid && SHAPES[tag])
  .map(([tag, cid]) => ({ cid, codec: "jpeg", kind: "thumbnail", ...SHAPES[tag]! }));
// the day's own files (a film the post carries, its copies), by CID: as deliveries
const listed = (day as { files?: File[] }).files ?? (existsSync(join(dir, "derivatives.json")) ? JSON.parse(readFileSync(join(dir, "derivatives.json"), "utf8")).files : undefined) ?? [];
const files = [...listed, ...titleCards.filter((c) => !listed.some((f: File) => f.cid === c.cid))] as File[];
let deliveries: unknown[] | undefined;
if (files.length) {
  deliveries = await Promise.all(files.map(async (f) => {
    const m = await get(f.cid);
    if (!m) throw new Error(`library/ does not hold ${f.cid}`);
    return { channels: f.channels, cid: m.cid, format: f.format ?? `${f.codec} · ${f.aspect}`, aspect: f.aspect, width: 0, height: 0, codec: f.codec, bytes: m.size, seconds: Number(m.meta?.duration_s ?? 0), kind: f.kind ?? "video", ...(f.note ? { note: f.note } : {}) };
  }));
}

const item = await call<{ id: string; posts: unknown[]; status: string }>(`/api/content/days/${encodeURIComponent(day.project)}`, {
  method: "PUT",
  body: JSON.stringify({
    title: day.title, source: join(dir, "post.md"), ...(hook ? { hook } : {}), ...(deliveries ? { deliveries } : {}),
    ...(hookOnly ? {} : { body: article, scheduled_at: day.scheduled_at }), ...(only ? {} : { posts: day.posts }),
  }),
});
if (hookOnly && !hook) throw new Error(`no hook yet: write ${join(dir, "thumbnail.json")} first`);
say(hookOnly
  ? `${day.project}: the hook on the board (${item.status}) — "${hook}", ${titleCards.length} title cards`
  : only
  ? `${day.project}: the base article on the board (${item.status})${hook ? ` — hook "${hook}"` : ""}`
  : `${day.project}: the base article and ${item.posts.length} derivatives on the board (${item.status}) — ${day.posts.map((p) => `${p.platform} ${p.format}`).join(", ")}`);
