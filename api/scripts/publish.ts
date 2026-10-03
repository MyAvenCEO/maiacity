// The publish step: every scheduled day whose time has come goes out — its blog post (the article's `draft: true`
// becomes `draft: false`) and, with it, its card on the board moves on to "published". The site is static: the post
// is public once this is committed and pushed (CI deploys it). The derivatives go out at their own times through the
// upload step (Zernio, later).
//
//   bun api/scripts/publish.ts [--local] [--dry]           the days that are due now
//   bun api/scripts/publish.ts --story "The 1 million decision" [--local] [--dry]   one story, now, whatever its date
//   (--day 1 still names the story an old day became: src/lib/stories/names.js)
import { readFileSync, writeFileSync } from "node:fs";
import { call, say } from "./media-client";
import { nameOfDay } from "../../src/lib/stories/names.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const one = args.includes("--story") ? args[args.indexOf("--story") + 1]! : args.includes("--day") ? nameOfDay(Number(args[args.indexOf("--day") + 1])) : null;
type Item = { project: string | null; status: string; scheduled_at: string | null; source: string | null; title: string };
const { items } = await call<{ items: Item[] }>("/api/content/days");
const due = items.filter((i) => i.project && i.source && (one ? i.project === one : i.status === "scheduled" && i.scheduled_at && new Date(i.scheduled_at) <= new Date()));
if (!due.length) {
  say(one ? `no ${one} with an article on the board` : "nothing is due");
  process.exit(0);
}
for (const i of due) {
  const md = readFileSync(i.source!, "utf8");
  const out = md.replace(/^draft:\s*true\s*$/m, "draft: false");
  say(`${dry ? "would publish" : "publishing"} ${i.project} — ${i.title} (${i.source})`);
  if (dry) continue;
  writeFileSync(i.source!, out);
  await call(`/api/content/days/${encodeURIComponent(i.project!)}`, { method: "PUT", body: JSON.stringify({ status: "published" }) });
}
if (!dry) say("commit and push to put the posts on the site (CI deploys; never a local deploy alongside)");
