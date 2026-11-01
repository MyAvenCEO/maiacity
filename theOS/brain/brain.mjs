#!/usr/bin/env node
// brain: theOS's memory, and the one door to it (AIP-3, brain protocol v1). Every verb is a plain function this module
// exports; the command line below calls the same functions. Checkpoint 1 has the reads: prime, holds and get.
// What holds is computed by ui/wiki.js, the same code the apps run, loaded here unchanged.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const THEOS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMUEL = 'authors/samuel-andert';

// A refusal: a fixed code and the fix, so an agent can recover by itself.
export class BrainError extends Error {
  constructor(code, fix) { super(`${code}: ${fix}`); this.code = code; this.fix = fix; }
}

// ui/wiki.js, run as the apps run it, with fetch reading files under root.
function wiki(root) {
  const fetch = async (url) => {
    try { const text = await readFile(url, 'utf8'); return { ok: true, json: async () => JSON.parse(text) }; }
    catch { return { ok: false, json: async () => null }; }
  };
  const ctx = vm.createContext({ fetch });
  vm.runInContext(`${readFileSync(join(THEOS, 'ui', 'wiki.js'), 'utf8')}\nthis.W = W;`, ctx);
  ctx.W.root = root.endsWith('/') ? root : `${root}/`;
  ctx.W.cache = new Map();
  return ctx.W;
}

// Every doc reachable from avenCEO's definition and its indexes: a Map of path to doc. The functions below take it.
export async function load(root = THEOS) {
  const W = wiki(root);
  const def = await W.get('avenCEO/avenCEO');
  if (!def) throw new BrainError('bad_root', `no avenCEO/avenCEO.json under ${root}; pass --root <the theOS folder>`);
  const { docs } = await W.crawl(['avenCEO/avenCEO', ...(def?.indexes || [])]);
  for (const [p, d] of docs) if (!d) docs.delete(p);
  Object.defineProperty(docs, 'W', { value: W });
  return docs;
}

const Wof = (docs) => docs.W || wiki(THEOS);
// Values made inside ui/wiki.js belong to its own JavaScript realm; answers are copied out as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const typesIn = (docs) => [...new Set([...docs.values()].map((d) => d.type))].sort();
const titleOf = (d) => d.title || d.word || d.name || d.id;

function holdsOf(docs, path) { return Wof(docs).holds(docs, path); }

// brain holds <type>: the docs of a type that hold now, wholly or in part. Decisions newest first, the rest by title.
export function holds(docs, type) {
  const types = typesIn(docs);
  if (!types.includes(type) || type === 'index') throw new BrainError('unknown_type', `a type is one of: ${types.filter((t) => t !== 'index').join(', ')}`);
  const xs = [...docs].filter(([, d]) => d.type === type)
    .map(([p, d]) => ({ id: p, title: titleOf(d), holds: holdsOf(docs, p), n: d.n }))
    .filter((x) => x.holds !== 'superseded')
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.title.localeCompare(b.title));
  return plain(xs.map(({ id, title, holds: h }) => ({ id, title, holds: h })));
}

// What waits for Samuel: the open questions of every intent that is not closed, and his tasks not done at or before
// the step the intent stands at (a Gate B task waits only once the intent is at Build). Index docs are copies, not links.
function waits(docs) {
  const W = Wof(docs), questions = [], tasks = [];
  for (const [p, I] of docs) {
    if (I.type !== 'intent') continue;
    const ev = I.events || [];
    const at = W.stepAt(ev, ev.length);
    if (at === 5) continue;
    for (const q of I.questions || []) if (!q.answered && !q.replaced_by) questions.push({ intent: p, q: q.q, options: q.options });
    for (const t of I.tasks || []) {
      const done = ev.some((x) => x.task === t.id && x.what === 'done');
      if (t.who === SAMUEL && !done && t.step <= at) tasks.push({ intent: p, id: t.id, what: t.what });
    }
  }
  return { questions, tasks };
}

// brain prime: what an agent reads first. The decisions and terms that hold now, and what waits for Samuel.
export function prime(docs) {
  const has = typesIn(docs);
  const h = Object.fromEntries(['decision', 'term'].filter((t) => has.includes(t)).map((t) => [t, holds(docs, t)]));
  return plain({ holds: h, waits: waits(docs) });
}

// brain get <path>: one doc, whether it holds, what supersedes it, its links and backlinks (index docs left out).
export function get(docs, ref) {
  // a path (decisions/D-12), or the id prime and holds print (D-12, avensandbox-3)
  let path = docs.has(ref) ? ref : null;
  if (!path) {
    const hits = [...docs].filter(([p, d]) => d.type !== 'index' && (d.id === ref || p.split('/').pop() === ref)).map(([p]) => p);
    if (hits.length > 1) throw new BrainError('ambiguous', `${ref} names ${hits.join(', ')}; pass the path`);
    path = hits[0];
  }
  const doc = path && docs.get(path);
  if (!doc) throw new BrainError('not_found', `no doc ${ref}; list the docs with: brain holds <type>`);
  const W = Wof(docs);
  const supersededBy = W.supersededBy(docs, path).map((s) => ({ by: s.p, part: s.part || 'whole', what: s.what || s.how || '' }));
  const links = [...W.paths(doc)].filter((q) => q !== path).sort();
  const backlinks = [...docs].filter(([p, d]) => p !== path && d.type !== 'index' && W.paths(d).has(path)).map(([p]) => p).sort();
  return plain({ id: path, doc, holds: holdsOf(docs, path), supersededBy, links, backlinks });
}

// The command line: brain <verb> [args] [--json] [--root <theOS folder>].
function text(verb, out) {
  const line = (x) => `- ${x.id.split('/').pop()} · ${x.title}${x.holds === 'holds in part' ? ' (holds in part)' : ''}`;
  if (verb === 'prime') {
    const w = out.waits;
    return [
      "brain prime: what holds now in theOS's memory. Act on these, not on superseded docs; brain get <path> shows one doc.",
      ...Object.entries(out.holds).flatMap(([t, xs]) => [`\n${t}s that hold (${xs.length}):`, ...xs.map(line)]),
      `\nWaits for Samuel (${w.questions.length} questions, ${w.tasks.length} tasks):`,
      ...w.questions.map((q) => `- ${q.intent}: ${q.q}`),
      ...w.tasks.map((t) => `- ${t.intent} ${t.id}: ${t.what}`),
    ].join('\n');
  }
  if (verb === 'holds') return out.map(line).join('\n');
  if (verb === 'get') return JSON.stringify(out, null, 1);
}

async function main(argv) {
  const json = argv.includes('--json');
  const r = argv.indexOf('--root');
  if (r >= 0 && !argv[r + 1]) { process.stderr.write('brain: missing_arg: --root <the theOS folder>\n'); process.exitCode = 1; return; }
  const root = r >= 0 ? resolve(argv[r + 1]) : THEOS;
  const args = argv.filter((a, i) => a !== '--json' && (r < 0 || (i !== r && i !== r + 1)));
  const [verb, arg] = args;
  try {
    const docs = await load(root);
    const verbs = { prime: () => prime(docs), holds: () => holds(docs, arg), get: () => get(docs, arg) };
    if (!verbs[verb]) throw new BrainError('unknown_verb', 'the verbs are: prime, holds <type>, get <id or path>');
    if (verb !== 'prime' && !arg) throw new BrainError('missing_arg', verb === 'holds' ? 'brain holds <type>, e.g. brain holds decision' : 'brain get <id or path>, e.g. brain get D-1');
    const out = verbs[verb]();
    process.stdout.write(`${json ? JSON.stringify(out) : text(verb, out)}\n`);
  } catch (e) {
    if (!(e instanceof BrainError)) throw e;
    process.stdout.write(json ? `${JSON.stringify({ error: e.code, fix: e.fix })}\n` : '');
    process.stderr.write(`brain: ${e.code}: ${e.fix}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
