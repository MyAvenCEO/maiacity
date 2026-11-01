#!/usr/bin/env node
// brain: theOS's memory, and the one door to it (AIP-3, brain protocol v1). Every verb is a plain function this module
// exports; the command line below calls the same functions. The reads are here; the writes are in door.mjs, re-exported.
// What holds is computed by ui/wiki.js, the same code the apps run, loaded here unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
import * as door from './door.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
export { add, edit, append, index, install, check, reflect, merge3, validate, versions, docsOf, DoorError } from './door.mjs';

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
  await W.ready();
  const def = await W.get(W.DEF);
  if (!def) throw new BrainError('bad_root', `no avenCEO's definition under ${root}; pass --root <the theOS folder>`);
  const { docs } = await W.crawl([W.DEF, ...(def?.indexes || [])]);
  // old names (D-12, decisions/D-12) after the migration: brain/renames.json maps each to its id
  let renames = {};
  try { renames = JSON.parse(await readFile(join(root, 'brain', 'renames.json'), 'utf8')).names || {}; } catch { /* none before the migration */ }
  Object.defineProperty(docs, 'renames', { value: renames });
  for (const [p, d] of docs) if (!d) docs.delete(p);
  Object.defineProperty(docs, 'W', { value: W });
  return docs;
}

const Wof = (docs) => docs.W || wiki(THEOS);
// Values made inside ui/wiki.js belong to its own JavaScript realm; answers are copied out as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const typesIn = (docs) => [...new Set([...docs.values()].map((d) => d.type))].sort();
// What people see (D-76): a doc as its id and its title, and every id inside text the same way (ui/wiki.js).
const titleOf = (docs, d) => Wof(docs).title(d);

function holdsOf(docs, path) { return Wof(docs).holds(docs, path); }

// brain holds <type>: the docs of a type that hold now, wholly or in part. Newest first (by at, then n), the rest by title.
export function holds(docs, type) {
  const types = typesIn(docs);
  if (!types.includes(type) || type === 'index') throw new BrainError('unknown_type', `a type is one of: ${types.filter((t) => t !== 'index').join(', ')}`);
  const xs = [...docs].filter(([, d]) => d.type === type)
    .map(([p, d]) => ({ id: p, name: Wof(docs).name(d, p), title: titleOf(docs, d), holds: holdsOf(docs, p), n: d.n, at: d.at || '', for: (d.intents || []).map((r) => Wof(docs).name(docs.get(r), r)) }))
    .filter((x) => x.holds !== 'superseded')
    .sort((a, b) => b.at.localeCompare(a.at) || (b.n ?? 0) - (a.n ?? 0) || a.title.localeCompare(b.title));
  return plain(xs.map(({ id, name, title, holds: h, for: f }) => ({ id, name, title, holds: h, ...(f.length ? { for: f } : {}) })));
}

// What waits for Samuel: the open questions of every intent that is not closed, and his tasks not done at or before
// the step the intent stands at (a Gate B task waits only once the intent is at Build). Index docs are copies, not links.
function waits(docs) {
  const W = Wof(docs), questions = [], tasks = [];
  const samuel = docs.renames?.[SAMUEL] ?? SAMUEL;
  for (const [p, I] of docs) {
    if (I.type !== 'intent') continue;
    const ev = I.events || [];
    const at = W.stepAt(ev, ev.length);
    if (at === 5) continue;
    for (const q of I.questions || []) if (!q.answered && !q.replaced_by) questions.push({ intent: p, name: W.name(I, p), q: W.named(q.q), options: q.options.map((o) => W.named(o)) });
    for (const t of I.tasks || []) {
      const done = ev.some((x) => x.task === t.id && x.what === 'done');
      if (t.who === samuel && !done && t.step <= at) tasks.push({ intent: p, name: W.name(I, p), id: t.id, what: W.named(t.what) });
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
  let path = docs.has(ref) ? ref : docs.renames?.[ref] && docs.has(docs.renames[ref]) ? docs.renames[ref] : null;
  if (!path) {
    const hits = [...docs].filter(([p, d]) => d.type !== 'index' && (d.id === ref || p.split('/').pop() === ref)).map(([p]) => p);
    if (hits.length > 1) throw new BrainError('ambiguous', `${ref} names ${hits.join(', ')}; pass the path`);
    path = hits[0];
  }
  const doc = path && docs.get(path);
  if (!doc) throw new BrainError('not_found', `no doc ${ref}; list the docs with: brain holds <type>`);
  const W = Wof(docs);
  const supersededBy = W.supersededBy(docs, path).map((s) => ({ by: s.p, part: s.part || 'whole', what: s.what || s.how || '' }));
  // links by type: a link's type is the field it sits in (supersedes, relates, intents, writes …); c10
  const byField = (d, keep) => {
    const out = {};
    for (const [k, v] of Object.entries(d)) { const xs = [...W.paths(v)].filter(keep).sort(); if (xs.length) out[k] = xs; }
    return out;
  };
  const links = byField(doc, (q) => q !== path);
  const backlinks = {};
  for (const [p, d] of docs) if (p !== path && d.type !== 'index') for (const [k, xs] of Object.entries(byField(d, (q) => q === path))) (backlinks[k] ??= []).push(p);
  for (const k of Object.keys(backlinks)) backlinks[k].sort();
  // a doc that holds and rests on one that no longer does: a warning for the maintenance pass
  const citesSuperseded = holdsOf(docs, path) === 'superseded' ? [] : [...new Set(Object.entries(links).filter(([k]) => k !== 'supersedes').flatMap(([, xs]) => xs))].filter((q) => docs.has(q) && holdsOf(docs, q) === 'superseded');
  return plain({ id: path, name: W.name(doc, path), doc, holds: holdsOf(docs, path), supersededBy, links, backlinks, citesSuperseded });
}

// The command line: brain <verb> [args] [--json] [--root <theOS folder>].
function text(verb, out) {
  const line = (x) => `- ${x.name}${x.holds === 'holds in part' ? ' (holds in part)' : ''}${x.for ? ` [for ${x.for.join('; ')}]` : ''}`;
  if (verb === 'prime') {
    const w = out.waits;
    return [
      "brain prime: what holds now in theOS's memory. Act on these, not on superseded docs; brain get <id> shows one doc.",
      ...Object.entries(out.holds).flatMap(([t, xs]) => [`\n${t}s that hold (${xs.length}):`, ...xs.map(line)]),
      `\nWaits for Samuel (${w.questions.length} questions, ${w.tasks.length} tasks):`,
      ...w.questions.map((q) => `- ${q.name}: ${q.q}`),
      ...w.tasks.map((t) => `- ${t.name} ${t.id}: ${t.what}`),
    ].join('\n');
  }
  if (verb === 'holds') return out.map(line).join('\n');
  if (verb === 'get') return JSON.stringify(out, null, 1);
}

// The verbs of brain protocol v1, as the skill teaches them (brain index writes the skill from this list).
export const VERBS = [
  ['prime', 'the decisions and terms that hold now, and what waits for Samuel'],
  ['holds <type>', 'the docs of a type that hold now'],
  ['get <id>', 'one doc, whether it holds, what supersedes it, its links and backlinks'],
  ['reflect <type> <draft.json>', 'the docs a draft may supersede: same type, holding, a shared topic word'],
  ['add <type> <doc.json> --intent <aip id> --by <author id> [--task <id>]', 'a new doc: id minted, schema checked, filed, its event written'],
  ['edit <id> <patch.json> --intent <aip id> --by <author id>', 'a correction that keeps the meaning; a change of meaning is a new doc that supersedes it'],
  ['append <id> <list> <entry.json> --intent <aip id> --by <author id>', 'an entry at the end of a list that only grows'],
  ['index', 'the index docs and brain/ids.json written again from the folders'],
  ['install', "this clone's pre-push hook (brain check) and the merge driver for lists that only grow"],
  ['versions', 'every link whose target changed after it was cited, into brain/versions.json for the apps (c5)'],
  ['mcp', 'the same verbs as an MCP server on stdio, for other sessions and tools (theOS/.mcp.json)'],
  ['check [--range a..b]', 'every commit in the range against its parent: events cover every changed doc, schemas, history only grows'],
];

// The skill Claude Code loads (theOS/.claude/skills/brain/SKILL.md), written from VERBS by brain index.
export function skill() {
  return `---
name: brain
description: theOS's memory (brain) and the one door to it. Use before acting on any decision, term, source, lesson, metric or intent in theOS, and for every write to them.
---

# brain

brain is theOS's memory: one JSON doc per thing, each named by a flat hash id (d-… a decision, aip-… an intent) and
shown as its id and title. A doc holds until a newer doc supersedes it; superseded in part, the rest still holds. What
holds is computed, never stored. Every read and every write goes through these verbs; never edit a doc's file by hand:
brain check fails a commit that changed a doc without the event a verb writes. Run them from theOS/ as
\`node brain/brain.mjs <verb>\`.

${VERBS.map(([v, w]) => `- \`brain ${v}\`: ${w}.`).join('\n')}

A write names the intent it serves (--intent) and its author (--by, an author doc's id) and appends that intent's event;
commit the files it wrote with your work. To replace or drop a doc, add a newer one whose supersedes names it
(\`{ "doc": "<id>", "part": "all" or the part, "what": "…" }\`); brain refuses a supersede of a doc that no longer
holds, and records the candidates you left for the reviewer. Add \`--json\` for data. A refusal prints a fixed code and
its fix; follow the fix.

This file is written by \`brain index\` from brain's verb list; do not edit it by hand.
`;
}

async function main(argv) {
  const json = argv.includes('--json');
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const r = argv.indexOf('--root');
  if (r >= 0 && !argv[r + 1]) { process.stderr.write('brain: missing_arg: --root <the theOS folder>\n'); process.exitCode = 1; return; }
  const root = r >= 0 ? resolve(argv[r + 1]) : THEOS;
  const valued = ['--root', '--intent', '--by', '--task', '--range'];
  const args = argv.filter((a, i) => a !== '--json' && !valued.includes(a) && !valued.includes(argv[i - 1]));
  const [verb, arg, arg2, arg3] = args;
  const file = (f) => { if (!f) throw new BrainError('missing_arg', `brain ${verb}: a JSON file is missing`); return JSON.parse(readFileSync(resolve(f), 'utf8')); };
  const who = { intent: opt('intent'), by: opt('by'), task: opt('task') };
  try {
    if (verb === 'mcp') { (await import('./mcp.mjs')).serve(root, await import('./brain.mjs')); return; } // brain's MCP server on stdio (c11)
    if (verb === 'merge') { // the git merge driver: brain merge %O %A %B, writes the result into %A
      const [o, a, b] = [arg, arg2, arg3].map((f) => JSON.parse(readFileSync(f, 'utf8')));
      writeFileSync(arg2, `${JSON.stringify(door.merge3(o, a, b), null, 1)}\n`);
      return;
    }
    const writes = {
      add: () => door.add(root, { type: arg, doc: file(arg2), ...who }),
      edit: () => door.edit(root, { id: arg, patch: file(arg2), ...who }),
      append: () => door.append(root, { id: arg, list: arg2, entry: file(arg3), ...who }),
      index: () => { const r = door.index(root); writeFileSync(join(root, '.claude', 'skills', 'brain', 'SKILL.md'), skill()); return r; },
      install: () => door.install(root),
      check: () => door.check(root, { range: opt('range') }),
      reflect: () => { const all = door.docsOf(root); return door.reflect(all, arg, file(arg2)); },
      versions: () => { const v = door.versions(root); writeFileSync(join(root, 'brain', 'versions.json'), `${JSON.stringify(v, null, 1)}\n`); return { flagged: Object.keys(v).length }; },
    };
    if (writes[verb]) {
      if (['add', 'edit', 'append'].includes(verb) && (!who.intent || !who.by)) throw new BrainError(!who.intent ? 'no_intent' : 'no_author', `brain ${verb} needs --intent <aip id> and --by <author id>`);
      const out = writes[verb]();
      process.stdout.write(`${JSON.stringify(out, null, json ? 0 : 1)}\n`);
      if (verb === 'check' && out.fails.length) process.exitCode = 1;
      return;
    }
    const docs = await load(root);
    const verbs = { prime: () => prime(docs), holds: () => holds(docs, arg), get: () => get(docs, arg) };
    if (!verbs[verb]) throw new BrainError('unknown_verb', `the verbs are: ${VERBS.map(([v]) => v.split(' ')[0]).join(', ')}`);
    if (verb !== 'prime' && !arg) throw new BrainError('missing_arg', verb === 'holds' ? 'brain holds <type>, e.g. brain holds decision' : 'brain get <id>');
    const out = verbs[verb]();
    if (verb === 'get') try { out.changedSince = door.versions(root, [out.id])[out.id] || []; } catch { /* no git here */ }
    process.stdout.write(`${json ? JSON.stringify(out) : text(verb, out)}\n`);
  } catch (e) {
    if (!(e instanceof BrainError) && !(e instanceof door.DoorError)) throw e;
    process.stdout.write(json ? `${JSON.stringify({ error: e.code, fix: e.fix })}\n` : '');
    process.stderr.write(`brain: ${e.code}: ${e.fix}\n`);
    process.exitCode = 1;
  }
}

// not awaited at the top: the MCP server imports this module, which must finish loading first
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.stack}\n`); process.exitCode = 1; });
