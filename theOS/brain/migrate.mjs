#!/usr/bin/env node
// AIP-3 checkpoint 2, the one migration (c12, D-49, D-53, D-65, D-69). Run once on the theOS folder:
//   node brain/migrate.mjs <theOS folder> [--seed <hex>]
// It gives every doc a flat hash id (a type prefix and 4 random hex characters) and files it as <id>.json: the docs brain
// keeps move into brain/<type folder>/, intents stay in aip/, avenCEO's docs stay in avenCEO/<folder>/. Every
// reference, paths and old names in text alike, is rewritten as the id; review docs' prompts stay verbatim and
// OLD-AIP-n is legacy and kept. It writes brain/ids.json (id to file, the definition's id, each folder's index) and
// brain/renames.json (each old name and path to its id; the migration commit's SHA is added after committing), moves
// the Sources app to brain/ and points the dashboard at it.
// Every doc is shown by its id and its title (D-76): ui/wiki.js does that for the apps and brain. Only JSON docs and those two app files are touched.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DOC_FOLDERS = ['aip', 'decisions', 'sessions', 'sources', 'metrics', 'lessons', 'authors', 'avenCEO'];
// where a doc's file goes, from the folder it sits in now
const BRAIN = { decisions: 'brain/decisions', sessions: 'brain/sessions', sources: 'brain/sources', metrics: 'brain/metrics', lessons: 'brain/lessons', authors: 'brain/authors', 'avenCEO/terms': 'brain/terms' };
const PREFIX = { decision: 'd', intent: 'aip', reference: 'src', term: 't', session: 's', lesson: 'l', metric: 'm', author: 'a', review: 'rv', research: 'rs', type: 'ty', step: 'st', gate: 'g', checker: 'ck', definition: 'def', index: 'ix' };

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    // generated output (a check's report in out/) is not a doc
    if (statSync(p).isDirectory()) { if (n !== 'out' && n !== 'node_modules') walk(p, out); }
    else if (n.endsWith('.json')) out.push(p);
  }
  return out;
}

// A deterministic stream of random bytes when seeded (for tests), else crypto's.
function hexer(seed) {
  let i = 0;
  return () => (seed ? createHash('sha256').update(`${seed}:${i++}`).digest('hex') : randomBytes(16).toString('hex'));
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function migrate(root, { seed } = {}) {
  root = resolve(root);
  const files = DOC_FOLDERS.filter((f) => existsSync(join(root, f))).flatMap((f) => walk(join(root, f)));
  const docs = files.map((f) => ({ file: f, path: relative(root, f).replace(/\.json$/, ''), doc: JSON.parse(readFileSync(f, 'utf8')) }));
  if (docs.some((x) => /^[a-z]+-[0-9a-f]{4,}$/.test(x.path.split('/').pop()))) throw new Error('already migrated: a doc is already named by a hash id');

  // 1. ids
  // an id never takes a string that already looks like one somewhere in the docs (an example in a text, say)
  const next = hexer(seed), taken = new Set(docs.flatMap((x) => JSON.stringify(x.doc).match(/(?<![\w/-])[a-z]+-[0-9a-f]{4,}(?![\w-])/g) || []));
  for (const x of docs) {
    const prefix = PREFIX[x.doc.type] || String(x.doc.type || 'doc').slice(0, 3).toLowerCase();
    let id, h = next(), len = 4;
    do { id = `${prefix}-${h.slice(0, len++)}`; } while (taken.has(id));
    taken.add(id);
    x.id = id;
  }

  // 2. old names: every path, and every doc's own numbered id (D-12, AIP-3) when it names one doc only. Other own ids
  // (slugs such as "corrections") are words too, so they are not rewritten in text.
  const names = {};
  for (const x of docs) names[x.path] = x.id;
  const own = {};
  for (const x of docs) if (typeof x.doc.id === 'string' && /^[A-Z][A-Za-z]*-\d+$/.test(x.doc.id)) (own[x.doc.id] ??= []).push(x.id);
  for (const [n, ids] of Object.entries(own)) if (ids.length === 1 && !names[n]) names[n] = ids[0];

  // 3. the rewrite: a whole-string reference, a path inside text (with theOS/ and .json around it), a short name in text
  const pathNames = Object.keys(names).filter((n) => n.includes('/')).sort((a, b) => b.length - a.length);
  const shortNames = Object.keys(names).filter((n) => !n.includes('/')).sort((a, b) => b.length - a.length);
  const inText = new RegExp(`(?<![\\w/-])(?:theOS/)?(${pathNames.map(esc).join('|')})(?:\\.json)?(?![\\w-])`, 'g');
  const shortText = shortNames.length ? new RegExp(`(?<![\\w/-])(?<!OLD-)(${shortNames.map(esc).join('|')})(?![\\w-])`, 'g') : null;
  const rewrite = (v, key) => {
    if (typeof v === 'string') {
      if (names[v]) return names[v];
      let t = v.replace(inText, (m, p) => names[p]);
      if (shortText) t = t.replace(shortText, (m, n) => names[n]);
      return t;
    }
    if (Array.isArray(v)) return v.map((y) => rewrite(y));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, y]) => [k, k === 'prompt' && v.type === 'review' ? y : rewrite(y, k)]));
    return v;
  };

  // 4. write each doc under its new name, remove the old file
  const ids = {}, index = {};
  let rootId = null;
  for (const x of docs) {
    const folder = dirname(x.path);
    const top = x.path.split('/')[0];
    const dest = BRAIN[folder] || BRAIN[top] || (top === 'aip' ? 'aip' : folder);
    // a decision's title loses a leading "AIP-n: " when that intent is in its intents; the apps show the intents beside
    // it, so the title stays short (D-37)
    const m = x.doc.type === 'decision' && /^AIP-(\d+):?\s+/.exec(x.doc.title || '');
    if (m && (x.doc.intents || []).includes(`aip/AIP-${m[1]}`)) x.doc.title = x.doc.title.slice(m[0].length);
    const doc = rewrite(x.doc);
    doc.id = x.id;
    ids[x.id] = `${dest}/${x.id}`;
    if (x.doc.type === 'index') index[folder] = x.id;
    if (x.path === 'avenCEO/avenCEO') rootId = x.id;
    rmSync(x.file);
    mkdirSync(join(root, dest), { recursive: true });
    writeFileSync(join(root, dest, `${x.id}.json`), `${JSON.stringify(doc, null, 1)}\n`);
  }
  if (!rootId) throw new Error('no avenCEO/avenCEO.json: is this the theOS folder?');
  // remove the folders the move emptied
  const prune = (dir) => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
    for (const n of readdirSync(dir)) prune(join(dir, n));
    if (!readdirSync(dir).length) rmSync(dir, { recursive: true });
  };
  for (const f of DOC_FOLDERS) prune(join(root, f));

  // 5. the maps brain and the apps read
  mkdirSync(join(root, 'brain'), { recursive: true });
  writeFileSync(join(root, 'brain', 'ids.json'), `${JSON.stringify({ root: rootId, index, ids }, null, 1)}\n`);
  writeFileSync(join(root, 'brain', 'renames.json'), `${JSON.stringify({ what: 'Every old name and path of a doc, and the hash id it was renamed to (the brain migration, c12). commit is the migration commit: the one commit allowed to rewrite history (c2).', commit: null, names }, null, 1)}\n`);

  // 6. the Sources app becomes brain's app; the dashboard points at it and reads the indexes through ids.json
  for (const f of ['index.html', 'app.js']) if (existsSync(join(root, 'sources', f))) renameSync(join(root, 'sources', f), join(root, 'brain', f));
  prune(join(root, 'sources'));
  const dash = join(root, 'index.html');
  if (existsSync(dash)) {
    let h = readFileSync(dash, 'utf8');
    h = h.replace('href="sources/index.html"><span class="k">Sources</span>', 'href="brain/index.html"><span class="k">brain</span>');
    writeFileSync(dash, h);
  }
  return { docs: docs.length, names: Object.keys(names).length, rootId };
}

// After the migration: every old name or path still used as a reference or in text (renames.json and review prompts
// excepted), and every id-shaped string that names no doc. Both lists must be empty.
export function audit(root) {
  root = resolve(root);
  const { ids } = JSON.parse(readFileSync(join(root, 'brain', 'ids.json'), 'utf8'));
  const { names } = JSON.parse(readFileSync(join(root, 'brain', 'renames.json'), 'utf8'));
  const olds = Object.keys(names).sort((a, b) => b.length - a.length);
  const oldRe = new RegExp(`(?<![\\w/-])(?<!OLD-)(${olds.map(esc).join('|')})(?![\\w-])`);
  const old = [], dangling = [];
  for (const [id, file] of Object.entries(ids)) {
    const doc = JSON.parse(readFileSync(join(root, `${file}.json`), 'utf8'));
    if (doc.id !== id) dangling.push(`${file}: id ${doc.id}`);
    const seen = (v, at) => {
      if (typeof v === 'string') {
        const m = v.match(oldRe);
        if (m) old.push(`${id} ${at}: ${m[1]}`);
        for (const r of v.match(/(?<![\w/-])[a-z]+-[0-9a-f]{4,}(?![\w-])/g) || []) if (!ids[r] && /^(d|aip|src|t|s|l|m|a|rv|rs|ty|st|g|ck|def|ix)-/.test(r)) dangling.push(`${id} ${at}: ${r}`);
      } else if (Array.isArray(v)) v.forEach((y, i) => seen(y, `${at}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, y] of Object.entries(v)) if (!(k === 'prompt' && v.type === 'review')) seen(y, `${at}.${k}`);
    };
    seen(doc, '');
  }
  return { old, dangling };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), s = argv.indexOf('--seed');
  if (!argv[0]) { process.stderr.write('usage: node brain/migrate.mjs <theOS folder> [--seed <hex>]\n'); process.exit(1); }
  console.log(migrate(argv[0], { seed: s >= 0 ? argv[s + 1] : undefined }));
  const a = audit(argv[0]);
  console.log({ old: a.old.length, dangling: a.dangling.length });
  for (const x of [...a.old, ...a.dangling].slice(0, 20)) console.log(' ', x);
}
