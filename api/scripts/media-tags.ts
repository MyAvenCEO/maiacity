// Where is each media file used? Tags derived from the journal and the site's code, for filtering the library:
//
//   "Day 18"       it belongs to that day's post: named by it, or kept in its folder
//   "cover", "in the post", "poster", "film", "author"   how a post uses it
//   "site"         the site's own code loads it directly (sounds, game covers, …)
//   "sounds", "sandbox-2", …   the folder it lives in, when that is not a post's
//   "voice"        a narration take from the studio (bun voice)
//   "unused"       nothing names it at all
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

type Post = { slug: string; day: string; refs: Map<string, string> };

async function posts(root: string): Promise<Post[]> {
  const out: Post[] = [];
  for (const d of await readdir(join(root, "blog"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const md = await readFile(join(root, "blog", d.name, "post.md"), "utf8").catch(() => "");
    if (!md) continue;
    const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? "";
    const field = (k: string) => new RegExp(`^${k}:\\s*['"]?(\\S+?)['"]?\\s*$`, "m").exec(fm)?.[1];
    const day = field("day");
    const refs = new Map<string, string>();
    const add = (path: string | undefined, how: string) => path?.startsWith("/") && !refs.has(path) && refs.set(path, how);
    add(field("cover"), "cover");
    add(field("poster"), "poster");
    add(field("videoLocal"), "film");
    add(field("authorImage"), "author");
    for (const m of md.matchAll(/!\[[^\]]*\]\((\/[^)\s]+)\)|src="(\/[^"]+)"/g)) add(m[1] ?? m[2], "in the post");
    out.push({ slug: d.name, day: day ? `Day ${day.padStart(2, "0")}` : d.name, refs });
  }
  return out;
}

async function code(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(ts|js|mjs|svelte|html|css)$/.test(e.name)) files.push(p);
    }
  };
  await walk(join(root, "src"));
  await walk(join(root, "game"));
  return (await Promise.all(files.map((f) => readFile(f, "utf8")))).join("\n");
}

/** CID → its tags, for every path the library knows. */
export async function deriveTags(root: string, paths: { path: string; cid: string }[]): Promise<Map<string, Set<string>>> {
  const all = await posts(root);
  const site = await code(root);
  const dayOfFolder = new Map(all.map((p) => [p.slug, p.day]));
  const tags = new Map<string, Set<string>>();
  for (const { path, cid } of paths) {
    const set = tags.get(cid) ?? new Set<string>();
    tags.set(cid, set);
    const folder = path.split("/").length > 2 ? path.split("/")[1]! : null;
    if (folder && dayOfFolder.has(folder)) set.add(dayOfFolder.get(folder)!);
    else if (folder) set.add(folder);
    let used = false;
    for (const p of all) {
      const how = p.refs.get(path);
      if (!how) continue;
      used = true;
      set.add(how);
      if (how !== "author") set.add(p.day); // a portrait on every post is not a day's picture
    }
    if (site.includes(path) || site.includes(path.slice(1))) (used = true), set.add("site");
    // the studio's own material — voice takes, music beds — is kept to be used, not left over
    if (path.startsWith("/studio/voice/")) (used = true), set.add("voice");
    if (path.startsWith("/music/")) used = true;
    if (!used) set.add("unused");
  }
  return tags;
}
