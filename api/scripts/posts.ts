// A film's posts, one per platform, onto its calendar item — checked against each platform's limits first.
//
//   bun api/scripts/posts.ts scripts/film/day-19-d.posts.json --project "Day 19" --variant G [--local]
//
// The posts are written where the film is made (in the repo, next to its shot list), then shown in the calendar as
// previews and later handed to the upload step (Zernio). Limits: docs.zernio.com/platforms/<platform>.
import { readFileSync } from "node:fs";
import { call, say } from "./media-client";

const args = process.argv.slice(2);
const arg = (k: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : undefined);
const file = args.find((a) => a.endsWith(".json"));
if (!file) throw new Error("usage: bun api/scripts/posts.ts <posts.json> --project <project> --variant <letter> [--local]");
const { title, posts } = JSON.parse(readFileSync(file, "utf8")) as { title?: string; posts: { platform: string; title?: string; text: string }[] };

// what each platform takes, in characters. No hashtags: no platform's reach favours them any more — the words
// carry the keywords (captions are searched)
const LIMITS: Record<string, { title?: number; text: number }> = {
  youtube: { title: 100, text: 5000 },
  x: { text: 280 },
  linkedin: { text: 3000 },
  instagram: { text: 2200 },
};
const full = (p: { text: string }) => p.text;
const wrong: string[] = [];
for (const p of posts) {
  const l = LIMITS[p.platform];
  if (!l) wrong.push(`${p.platform}: not a platform we post to`);
  else {
    if (l.title && (p.title ?? "").length > l.title) wrong.push(`${p.platform}: title ${p.title!.length}/${l.title}`);
    if (full(p).length > l.text) wrong.push(`${p.platform}: text ${full(p).length}/${l.text}`);
  }
}
if (wrong.length) throw new Error(`over the limit:\n  ${wrong.join("\n  ")}`);

const timelines = await call<{ id: string; project: string | null; variant: string | null }[]>("/api/timelines");
const t = timelines.find((x) => x.project === arg("project") && x.variant === arg("variant"));
if (!t) throw new Error(`no timeline ${arg("project")} · ${arg("variant")}`);
const item = await call<{ id: string; posts: unknown[] }>(`/api/timelines/${t.id}/posts`, { method: "PUT", body: JSON.stringify({ title, posts }) });
say(`${item.posts.length} posts on the calendar (${posts.map((p) => `${p.platform} ${full(p).length}${p.title ? `/${p.title.length}` : ""}`).join(", ")})`);
