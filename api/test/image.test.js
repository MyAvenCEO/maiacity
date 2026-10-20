// The API's image holds api/, game/ and code/ and what api/Dockerfile copies beside them, and nothing else of the repo
// (2026-10-17: #853's game code imported @noble/hashes and src/lib/sandbox/engines.json, the image held neither, and the
// server crash-looped at start). Every module of game/ and code/ the API may load must find what it imports there: a
// package from the API's own dependencies, a file inside game/ or code/ or one the Dockerfile copies, and what it
// copies must be in the build context .dockerignore lets through.
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const deps = Object.keys(JSON.parse(readFileSync(join(ROOT, "api/package.json"), "utf8")).dependencies ?? {});
/** what the Dockerfile copies from the repo beside api/: the sources of each COPY (all but its last word) outside api/ */
const copied = [...readFileSync(join(ROOT, "api/Dockerfile"), "utf8").matchAll(/^COPY\s+(.+?)\s*$/gm)]
  .flatMap((m) => m[1].split(/\s+/).filter((w) => !w.startsWith("--")).slice(0, -1))
  .map((src) => src.replace(/\/$/, ""))
  .filter((src) => !src.startsWith("api/"));
/** what .dockerignore lets into the build context: it leaves everything out (`*`) but the paths it names with `!` */
const sent = readFileSync(join(ROOT, ".dockerignore"), "utf8").split("\n").filter((l) => l.startsWith("!")).map((l) => l.slice(1).trim());
const under = (path, dir) => path === dir || path.startsWith(`${dir}/`);
const inImage = (path) => copied.some((src) => under(path, src));
/** whether game/ and code/ resolve the API's packages: node_modules looks from /app/game upward, never into /app/api */
const linked = /^RUN ln -s \/app\/api\/node_modules \/app\/node_modules\s*$/m.test(readFileSync(join(ROOT, "api/Dockerfile"), "utf8"));

function* modules(dir) {
  for (const d of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${d.name}`;
    if (d.isDirectory() && d.name !== "node_modules") yield* modules(path);
    else if (/\.(js|mjs)$/.test(d.name) && !/\.test\.js$/.test(d.name)) yield path;
  }
}

test("game/ and code/ are in the image, and everything their modules import is too", () => {
  expect(copied).toEqual(expect.arrayContaining(["game", "code"]));
  // a COPY of a path the build context leaves out fails the build (#860's first run)
  expect(copied.filter((src) => !sent.some((dir) => under(src, dir)))).toEqual([]);
  const scan = new Bun.Transpiler({ loader: "js" });
  const missing = [];
  for (const file of [...modules("game"), ...modules("code")]) {
    for (const { path: spec } of scan.scanImports(readFileSync(join(ROOT, file), "utf8"))) {
      if (spec.startsWith("node:") || spec.startsWith("bun:") || builtinModules.includes(spec)) continue;
      if (spec.startsWith(".")) {
        const to = relative(ROOT, resolve(ROOT, dirname(file), spec));
        if (!inImage(to)) missing.push(`${file}: ${spec} (${to} is not copied into the image)`);
        continue;
      }
      const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!deps.includes(pkg)) missing.push(`${file}: ${spec} (${pkg} is not a dependency in api/package.json)`);
      else if (!linked) missing.push(`${file}: ${spec} (the API's node_modules are not linked at /app)`);
    }
  }
  expect(missing).toEqual([]);
});
