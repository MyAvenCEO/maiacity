// The upload step, dry: a day's derivatives as Zernio's own requests (POST /v1/posts, docs.zernio.com/api-reference),
// checked against what Zernio and each platform take — nothing is sent. The day's `zernio.json` (next to its article)
// is exactly what the upload step will post, once it is wired.
//
//   bun api/scripts/zernio.ts blog/day-01-the-decision [--local]
//
// One request per moment: every derivative going out at the same minute (the launch) is one post with one entry per
// platform, its own text (customContent) and its own file (customMedia). The blog is ours: it is published by the
// publish step, not through Zernio.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { call, say } from "./media-client";
import { list, type Meta } from "../../scripts/film/vault.mjs";

const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!dir) throw new Error("usage: bun api/scripts/zernio.ts blog/day-NN-<slug> [--local]");
const day = JSON.parse(readFileSync(join(dir, "derivatives.json"), "utf8")) as {
  project: string; title: string;
  posts: { platform: string; format: string; title?: string; text: string; thread?: string[]; placement?: string; aspect?: string; codec?: string; scheduled_at: string; variant?: string }[];
};
const TZ = "Europe/Berlin";
const PLATFORM: Record<string, string> = { youtube: "youtube", x: "twitter", linkedin: "linkedin", instagram: "instagram" };

// the day's card on the board: its files (deliveries), to find each post's video and thumbnail
const days = await call<{ items: { project: string }[] }>("/api/content/days");
if (!days.items.some((i) => i.project === day.project)) throw new Error(`${day.project} is not on the board`);
// the day's files by hash: its film copies (derivatives.json), and its title cards (thumbnail.json)
type File = { hash: string; aspect: string; codec: string; kind?: string; format?: string };
const SHAPE: Record<string, string> = { "16x9": "16:9", "1x1": "1:1", "9x16": "9:16", "5x2": "5:2" };
const cards = existsSync(join(dir, "thumbnail.json")) ? (JSON.parse(readFileSync(join(dir, "thumbnail.json"), "utf8")).cards ?? {}) as Record<string, string> : {};
const files: File[] = [
  ...((JSON.parse(readFileSync(join(dir, "derivatives.json"), "utf8")).files ?? []) as File[]),
  ...Object.entries(cards).filter(([s, c]) => c && SHAPE[s]).map(([s, hash]) => ({ hash, aspect: SHAPE[s]!, codec: "jpeg", kind: "thumbnail" })),
];
const vault = new Map((await list()).map((m) => [m.hash, m]));
const docs = new Map<string, Meta>();
for (const f of files) {
  const d = vault.get(f.hash);
  if (!d) throw new Error(`the vault does not describe ${f.hash}`);
  docs.set(f.hash, d);
}
// a public address for a file: the vault's gateway when the file is public; else it is uploaded to Zernio first
const GATEWAY = "https://api.maia.city/vault/files";
const urlOf = (ref: string) => {
  const hash = ref.replace(/\.[a-z0-9]+$/, "");
  return docs.get(hash)?.public ? `${GATEWAY}/${hash}` : `upload:${hash}`;
};
const fileFor = (aspect?: string, codec?: string, kind = "video") => files.find((f) => (f.kind ?? "video") === kind && f.aspect === aspect && (kind === "thumbnail" || f.codec === codec));

// ── X Article: Markdown → X's content blocks (headings, paragraphs, quotes, lists, images, links, bold) ──
function articleBlocks(md: string) {
  const blocks: { type: string; text: string; inline_style_ranges?: unknown[]; entity_ranges?: unknown[] }[] = [];
  const entities: { key: string; value: { type: string; mutability: string; data: Record<string, string> } }[] = [];
  const inline = (raw: string) => {
    let text = "", styles: { offset: number; length: number; style: string }[] = [], ranges: { key: number; offset: number; length: number }[] = [];
    const re = /\*\*(.+?)\*\*|\[(.+?)\]\((\S+?)\)|\\\*/g;
    let at = 0, m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      text += raw.slice(at, m.index);
      if (m[1]) (styles.push({ offset: text.length, length: m[1].length, style: "bold" }), (text += m[1]));
      else if (m[2]) {
        const key = entities.length;
        entities.push({ key: String(key), value: { type: "link", mutability: "mutable", data: { url: m[3]!.startsWith("/") ? `https://maia.city${m[3]}` : m[3]! } } });
        ranges.push({ key, offset: text.length, length: m[2].length });
        text += m[2];
      } else text += "*";
      at = m.index + m[0].length;
    }
    text += raw.slice(at);
    return { text, ...(styles.length ? { inline_style_ranges: styles } : {}), ...(ranges.length ? { entity_ranges: ranges } : {}) };
  };
  for (const para of md.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    const img = /^!\[([^\]]*)\]\((\S+?)\)$/.exec(para);
    if (img) {
      const key = entities.length;
      entities.push({ key: String(key), value: { type: "image", mutability: "immutable", data: { url: urlOf(img[2]!), caption: img[1]! } } });
      blocks.push({ type: "atomic", text: " ", entity_ranges: [{ key, offset: 0, length: 1 }] });
    } else if (/^#{1,2}\s/.test(para)) blocks.push({ type: para.startsWith("## ") ? "header-two" : "header-one", ...inline(para.replace(/^#+\s+/, "")) });
    else if (para.startsWith(">")) blocks.push({ type: "blockquote", ...inline(para.replace(/^>\s?/gm, "")) });
    else if (/^[-*]\s/.test(para)) for (const li of para.split("\n")) blocks.push({ type: "unordered-list-item", ...inline(li.replace(/^[-*]\s+/, "")) });
    else if (/^\d+\.\s/.test(para)) for (const li of para.split("\n")) blocks.push({ type: "ordered-list-item", ...inline(li.replace(/^\d+\.\s+/, "")) });
    else if (para === "---") continue;
    else blocks.push({ type: "unstyled", ...inline(para.replace(/\n/g, " ")) });
  }
  return { blocks, entities };
}

// ── the checks: what Zernio and the platforms refuse, or quietly change ──
const problems: string[] = [], notes: string[] = [];
const secondsOf = (hash?: string) => Number(hash ? docs.get(hash)?.meta?.duration_s ?? 0 : 0);

type Entry = { platform: string; accountId: string; customContent?: string; customMedia?: unknown[]; platformSpecificData?: Record<string, unknown> };
const moments = new Map<string, { entries: Entry[]; keys: string[] }>();
const seen = new Map<string, number>();
for (const p of day.posts) {
  if (p.platform === "journal") continue; // ours: the publish step
  const platform = PLATFORM[p.platform];
  if (!platform) (problems.push(`${p.platform}: not a platform Zernio posts to for us`), void 0);
  const k = `${p.platform}:${p.format}`;
  const n = seen.get(k) ?? 0;
  seen.set(k, n + 1);
  const key = `${day.project}:${k}:${n}`;
  const video = ["video", "short", "reel"].includes(p.format) ? fileFor(p.aspect, p.codec) : undefined;
  const thumb = fileFor(p.aspect, p.codec, "thumbnail");
  if (["video", "short", "reel"].includes(p.format) && !video) problems.push(`${key}: no ${p.aspect} ${p.codec} video in the day's files`);
  const secs = secondsOf(video?.hash);
  const entry: Entry = { platform: platform ?? p.platform, accountId: `<${p.platform} account>` };
  const data: Record<string, unknown> = {};

  if (p.platform === "youtube") {
    data.title = p.title;
    data.visibility = "public";
    data.madeForKids = false;
    if ((p.title ?? "").length > 100) problems.push(`${key}: YouTube title ${p.title!.length}/100`);
    // YouTube decides by the file: square or vertical AND 3 min or less is a Short; landscape is always a video
    const upright = p.aspect === "1:1" || p.aspect === "9:16" || p.aspect === "4:5";
    if (secs && secs <= 180 && upright && p.format === "video") problems.push(`${key}: a ${p.aspect} film of ${Math.round(secs)} s becomes a Short on YouTube — post it as a short (or letterbox it into 16:9 for a normal video)`);
    if (p.format === "short" && !upright) problems.push(`${key}: a ${p.aspect} (landscape) film is always a normal video on YouTube, never a Short`);
    if (p.format === "short" && secs >= 180) problems.push(`${key}: a Short is under 3 min (this runs ${Math.round(secs)} s)`);
  }
  if (p.platform === "x") {
    if (p.format === "article") {
      const cover = fileFor("5:2", undefined, "thumbnail") ?? fileFor("16:9", undefined, "thumbnail");
      data.article = { title: p.title, mode: "publish", ...(cover ? { cover: { url: urlOf(cover.hash) } } : {}), content_state: articleBlocks(p.text) };
      if (!cover) notes.push(`${key}: no cover image (an X Article shows it as its card; 5:2 is the shape)`);
      notes.push(`${key}: X Articles need X Premium+ and cost about $0.02 each through the API`);
    } else if (p.format === "thread") {
      data.threadItems = (p.thread ?? [p.text]).map((t) => ({ content: t }));
      for (const [i, t] of (p.thread ?? []).entries()) if ([...t].length > 280) problems.push(`${key}: tweet ${i + 1} ${[...t].length}/280`);
    } else if ([...p.text].length > 280) problems.push(`${key}: ${[...p.text].length}/280`);
    if (video && /hevc/.test(video.codec)) problems.push(`${key}: X takes H.264 only`);
  }
  if (p.platform === "linkedin" && [...p.text].length > 3000) problems.push(`${key}: ${[...p.text].length}/3000`);
  // X videos and YouTube Shorts take no custom thumbnail: their cover is a frame of the film, so the hook has to be in
  // it — the social copies carry it over their first seconds (the render worker's hook layer)
  const shownFirst = (p.platform === "x" && p.format === "video") || (p.platform === "youtube" && p.format === "short");
  if (shownFirst && video && !/hook/.test((video as { format?: string }).format ?? "")) notes.push(`${key}: ${p.platform === "x" ? "X" : "a Short"} takes no cover image — use a copy with the hook over its opening`);
  if (p.platform === "instagram") {
    if (video) data.shareToFeed = true; // a video on Instagram is a Reel; shown on the profile feed too
    if (secs > 90) notes.push(`${key}: ${Math.round(secs)} s — longer than Zernio's 90 s for Reels: check with POST /v1/validate/validate-media before it goes out`);
    if ([...p.text].length > 2200) problems.push(`${key}: ${[...p.text].length}/2200`);
  }
  if (p.format !== "article" && p.format !== "thread") entry.customContent = p.text;
  if (video) {
    const media: Record<string, unknown> = { type: "video", url: urlOf(video.hash) };
    // the title card as its own image where the platform takes one: a YouTube video (not a Short), LinkedIn, a Reel
    if (thumb && (p.platform === "linkedin" || (p.platform === "youtube" && p.format === "video"))) media.thumbnail = urlOf(thumb.hash);
    if (thumb && p.platform === "instagram") media.instagramThumbnail = urlOf(thumb.hash);
    entry.customMedia = [media];
  }
  if (Object.keys(data).length) entry.platformSpecificData = data;
  const at = p.scheduled_at;
  const m = moments.get(at) ?? { entries: [], keys: [] };
  // one platform once per moment (Zernio's content check refuses the same account twice in a request)
  if (m.entries.some((e) => e.platform === entry.platform)) problems.push(`${key}: two ${p.platform} posts at ${at} — move one`);
  m.entries.push(entry);
  m.keys.push(key);
  moments.set(at, m);
}
// the same film twice on one account within 24 h is refused (Zernio's content dedup)
const films = new Map<string, string>();
for (const [at, m] of moments) for (const e of m.entries) for (const media of (e.customMedia ?? []) as { url: string }[]) {
  const id = `${e.platform}:${media.url}`;
  if (films.has(id)) problems.push(`${e.platform}: the same film at ${films.get(id)} and ${at} — Zernio refuses the second within 24 h`);
  films.set(id, at);
}

const requests = [...moments].sort(([a], [b]) => a.localeCompare(b)).map(([at, m]) => ({
  headers: { "Idempotency-Key": m.keys.join("+") },
  body: { title: `${day.project} · ${m.keys.map((k) => k.split(":").slice(1, 3).join(" ")).join(", ")}`, scheduledFor: at, timezone: TZ, platforms: m.entries, metadata: { project: day.project, derivatives: m.keys } },
}));
writeFileSync(join(dir, "zernio.json"), JSON.stringify({ endpoint: "POST https://zernio.com/api/v1/posts", checked: new Date().toISOString(), problems, notes, requests }, null, 2) + "\n");
say(`${day.project}: ${requests.length} Zernio requests (${requests.map((r) => `${r.body.scheduledFor.slice(11, 16)} ${r.body.platforms.map((p) => p.platform).join("+")}`).join(" · ")}) → ${join(dir, "zernio.json")}`);
for (const p of problems) say(`  ✗ ${p}`);
for (const n of notes) say(`  · ${n}`);
if (problems.length) process.exitCode = 1;
