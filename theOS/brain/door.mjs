// brain's door for writes (aip-836d, checkpoint 2): add, edit, append, index, install and check. Each is a plain
// function; brain.mjs re-exports them and its command line calls them. Every write names the intent it serves and its
// author, appends that intent's event (the trace) and leaves the commit to the agent; brain check fails a commit that
// changed a doc any other way (d-5bce, d-87d6). Writes go to files under the theOS folder `root`.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export class DoorError extends Error {
  constructor(code, fix) { super(`${code}: ${fix}`); this.code = code; this.fix = fix; }
}
const refuse = (code, fix) => { throw new DoorError(code, fix); };

export const PREFIX = { decision: 'd', intent: 'aip', reference: 'src', term: 't', session: 's', lesson: 'l', metric: 'm', author: 'a', review: 'rv', research: 'rs', type: 'ty', step: 'st', gate: 'g', checker: 'ck', definition: 'def', index: 'ix' };
export const ID = /^[a-z]+-[0-9a-f]{4,}$/;
const LEARN_ONLY = ['metric', 'lesson']; // written only at Learn (d-f960)
const GENERATED = ['brain/ids.json', 'brain/renames.json']; // written by brain itself

const now = () => new Date().toISOString().slice(0, 16) + 'Z';
const read = (root, file) => JSON.parse(readFileSync(join(root, `${file}.json`), 'utf8'));
const write = (root, file, doc) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, `${file}.json`), `${JSON.stringify(doc, null, 1)}\n`); };
const map = (root) => JSON.parse(readFileSync(join(root, 'brain', 'ids.json'), 'utf8'));
const saveMap = (root, m) => writeFileSync(join(root, 'brain', 'ids.json'), `${JSON.stringify(m, null, 1)}\n`);

// The step an intent stands at, computed from its events (the same rule as ui/wiki.js W.stepAt).
export function stepOf(events) {
  const back = events.map((x) => x.what).lastIndexOf('sent back');
  const has = (w) => events.slice(back + 1).some((x) => x.what === w);
  if (has('dropped')) return 5;
  return !has('understood') ? 1 : !has('gate-A') ? 2 : !has('gate-B') ? 3 : !has('measured') ? 4 : 5;
}

// A small JSON Schema: type, required, properties, items, enum, pattern. Returns the first failure, or null.
export function validate(v, s, at = '') {
  if (!s) return null;
  const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
  const want = [].concat(s.type || []);
  if (want.length && !want.includes(t) && !(t === 'number' && want.includes('integer') && Number.isInteger(v))) return `${at || 'the doc'}: expected ${want.join(' or ')}, got ${t}`;
  if (s.enum && !s.enum.includes(v)) return `${at}: expected one of ${s.enum.join(', ')}`;
  if (s.pattern && typeof v === 'string' && !new RegExp(s.pattern).test(v)) return `${at}: ${JSON.stringify(v)} does not match ${s.pattern}`;
  if (t === 'object') {
    for (const k of s.required || []) if (!(k in v)) return `${at ? `${at}.` : ''}${k}: missing`;
    for (const [k, ps] of Object.entries(s.properties || {})) if (k in v) { const f = validate(v[k], ps, at ? `${at}.${k}` : k); if (f) return f; }
  }
  if (t === 'array' && s.items) for (let i = 0; i < v.length; i++) { const f = validate(v[i], s.items, `${at}[${i}]`); if (f) return f; }
  return null;
}

// Every doc, by id: { file, doc }.
export function docsOf(root) {
  const m = map(root);
  return new Map(Object.entries(m.ids).map(([id, file]) => [id, { file, doc: read(root, file) }]));
}
const typeDoc = (all, type) => [...all.values()].find((x) => x.doc.type === 'type' && x.doc.name === type)?.doc;
const author = (all, by) => (all.get(by)?.doc.type === 'author' ? by : refuse('no_author', `--by must be an author doc's id: ${[...all].filter(([, x]) => x.doc.type === 'author').map(([i, x]) => `${i} (${x.doc.name})`).join(', ')}`));
const intentOf = (all, id) => (all.get(id)?.doc.type === 'intent' ? all.get(id) : refuse('no_intent', `--intent must be an intent's id: brain holds intent lists them`));

// What holds: a doc holds until a newer doc supersedes it, wholly (part all, whole or left out) or in part.
const target = (s) => s.doc || s.decision || s.term;
const whole = (s) => !s.part || s.part === 'all' || s.part === 'whole';
export function holdsIn(all, id) {
  const by = [...all.values()].flatMap((x) => (x.doc.supersedes || []).filter((s) => target(s) === id));
  return by.some(whole) ? 'superseded' : by.length ? 'holds in part' : 'holds';
}

// brain reflect: the docs of the same type that hold and share a topic word (about) with the draft.
export function reflect(all, type, draft) {
  const about = new Set(draft.about || []);
  return [...all].filter(([id, x]) => x.doc.type === type && id !== draft.id && holdsIn(all, id) !== 'superseded' && (x.doc.about || []).some((a) => about.has(a))).map(([id]) => id);
}

function event(root, all, intent, by, what, text, writes, extra = {}) {
  const I = intentOf(all, intent);
  const ev = { at: now(), by, what, text, how: `brain ${what}`, writes, reads: [], ...extra };
  I.doc.events = [...(I.doc.events || []), ev];
  write(root, I.file, I.doc);
  return ev;
}

function mint(m, type) {
  const prefix = PREFIX[type] || type.slice(0, 3);
  const h = randomBytes(8).toString('hex');
  for (let n = 4; n <= 16; n++) { const id = `${prefix}-${h.slice(0, n)}`; if (!m.ids[id]) return id; }
  return mint(m, type);
}

// brain add <type> <file>: a new doc, its id minted, checked, filed in its type's folder, its event written.
export function add(root, { type, doc, intent, by, task }) {
  const all = docsOf(root), m = map(root);
  author(all, by);
  const I = intentOf(all, intent);
  const T = typeDoc(all, type) || refuse('unknown_type', `a type is one of: ${[...all.values()].filter((x) => x.doc.type === 'type').map((x) => x.doc.name).join(', ')}`);
  const at = stepOf(I.doc.events || []);
  if (LEARN_ONLY.includes(type) && at !== 4) refuse('step', `a ${type} is written at Learn; ${intent} stands at step ${at}`);
  const same = [...all].find(([, x]) => x.doc.type === type && x.doc.title && x.doc.title === doc.title && holdsIn(all, x.doc.id) !== 'superseded');
  if (same) return { outcome: 'unchanged', id: same[0] };
  for (const s of doc.supersedes || []) {
    const t = target(s);
    if (!all.has(t)) refuse('not_found', `supersedes ${t}, which is no doc`);
    if (holdsIn(all, t) === 'superseded') refuse('not_held', `${t} no longer holds; supersede what replaced it`);
  }
  const id = mint(m, type);
  const folder = dirname(Object.values(m.ids).find((f) => all.get(f.split('/').pop())?.doc.type === type) || refuse('no_folder', `no ${type} exists yet to show where it is filed`));
  const full = { type, id, ...doc, ...(type === 'decision' && !doc.at ? { at: now() } : {}) };
  full.type = type; full.id = id;
  const bad = validate(full, T.schema);
  if (bad) refuse('schema', bad);
  const left = reflect(all, type, full).filter((c) => !(doc.supersedes || []).some((s) => target(s) === c));
  write(root, `${folder}/${id}`, full);
  m.ids[id] = `${folder}/${id}`;
  saveMap(root, m);
  const written = [id, ...index(root).changed];
  event(root, docsOf(root), intent, by, 'add', `${type} ${id}${full.title ? ` · ${full.title}` : ''}`, written, { ...(task ? { task } : {}), ...(left.length ? { left } : {}) });
  return { outcome: 'created', id, supersedes: (doc.supersedes || []).map(target), left };
}

// brain edit <id> <file>: a correction that keeps the meaning; the fields given replace the doc's.
export function edit(root, { id, patch, intent, by, task }) {
  const all = docsOf(root);
  author(all, by); intentOf(all, intent);
  const x = all.get(id) || refuse('not_found', `no doc ${id}`);
  const next = { ...x.doc, ...patch, id, type: x.doc.type };
  if (JSON.stringify(next) === JSON.stringify(x.doc)) return { outcome: 'unchanged', id };
  const bad = validate(next, typeDoc(all, x.doc.type)?.schema);
  if (bad) refuse('schema', bad);
  write(root, x.file, next);
  event(root, docsOf(root), intent, by, 'edit', `${id}: ${Object.keys(patch).join(', ')}`, [id], task ? { task } : {});
  return { outcome: 'changed', id };
}

// brain append <id> <list> <entry>: an entry at the end of a list that only grows.
export function append(root, { id, list, entry, intent, by, task }) {
  const all = docsOf(root);
  author(all, by); intentOf(all, intent);
  const x = all.get(id) || refuse('not_found', `no doc ${id}`);
  if (list === 'events') refuse('use_event', 'an intent\'s events are written by the verb that does the work');
  if (x.doc[list] !== undefined && !Array.isArray(x.doc[list])) refuse('not_a_list', `${id}.${list} is not a list`);
  if (LEARN_ONLY.includes(x.doc.type) && stepOf(all.get(intent).doc.events || []) !== 4) refuse('step', `a ${x.doc.type} is written at Learn`);
  x.doc[list] = [...(x.doc[list] || []), entry];
  write(root, x.file, x.doc);
  event(root, docsOf(root), intent, by, 'append', `${id}.${list}`, [id], task ? { task } : {});
  return { outcome: 'appended', id };
}

// brain index: every index doc and brain/ids.json written from the folders. Run by add; never edited by hand.
export function index(root) {
  const m = map(root), changed = [];
  const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) { if (!['out', 'node_modules', 'test', 'checks'].includes(n)) walk(p, out); } else if (ID.test(n.replace(/\.json$/, '')) && n.endsWith('.json')) out.push(p); } return out; };
  const ids = {};
  for (const f of ['aip', 'avenCEO', 'brain'].flatMap((d) => (existsSync(join(root, d)) ? walk(join(root, d)) : []))) {
    const file = relative(root, f).replace(/\.json$/, ''), id = file.split('/').pop();
    if (ids[id]) refuse('duplicate_id', `${id} is both ${ids[id]} and ${file}`);
    ids[id] = file;
  }
  if (JSON.stringify(ids) !== JSON.stringify(m.ids)) { m.ids = ids; saveMap(root, m); }
  for (const [folder, ix] of Object.entries(m.index)) {
    const file = ids[ix]; if (!file) continue;
    const doc = read(root, file), dir = dirname(file);
    // an index lists the docs of its folder of the type it already lists (aip/ holds reviews too; its index lists intents)
    const kind = doc.items.length ? read(root, ids[doc.items[0]] || file).type : null;
    const here = Object.entries(ids).filter(([i, f]) => i !== ix && dirname(f) === dir && (kind ? read(root, f).type === kind : read(root, f).type !== 'index')).map(([i]) => i);
    const items = [...doc.items.filter((i) => here.includes(i)), ...here.filter((i) => !doc.items.includes(i))];
    if (JSON.stringify(items) !== JSON.stringify(doc.items)) { doc.items = items; write(root, file, doc); changed.push(ix); }
  }
  return { changed };
}

// brain install: this clone's pre-push hook (runs brain check) and the merge driver for lists that only grow.
export function install(root) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const top = git('rev-parse', '--show-toplevel'), hooks = join(top, git('rev-parse', '--git-path', 'hooks'));
  const rel = relative(top, join(root, 'brain', 'brain.mjs'));
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, 'pre-push');
  const line = `node "${rel}" check || exit 1  # brain (aip-836d)`;
  const old = existsSync(hook) ? readFileSync(hook, 'utf8') : '#!/bin/sh\n';
  if (!old.includes('# brain (aip-836d)')) writeFileSync(hook, `${old.trimEnd()}\n${line}\n`);
  chmodSync(hook, 0o755);
  git('config', 'merge.brain-lists.name', 'brain: keep both sides\' new entries of lists that only grow');
  git('config', 'merge.brain-lists.driver', `node "${rel}" merge %O %A %B`);
  return { hook, driver: 'brain-lists' };
}

// The merge driver: a three-way merge of two JSON docs that keeps both sides' new entries of a list that only grows
// (the first parent's first). Anything else changed on both sides differently is a conflict (exit 1).
export function merge3(o, a, b) {
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (eq(a, b) || eq(o, b)) return a;
  if (eq(o, a)) return b;
  if (Array.isArray(o) && Array.isArray(a) && Array.isArray(b) && eq(a.slice(0, o.length), o) && eq(b.slice(0, o.length), o)) return [...a, ...b.slice(o.length).filter((x) => !a.some((y) => eq(x, y)))];
  if ([o, a, b].every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const out = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = merge3(o[k], a[k], b[k]);
    return out;
  }
  throw new DoorError('conflict', 'both sides changed the same field differently; resolve by hand');
}

// brain check: every commit in the range (default: the commits since main), each against its parent.
export function check(root, { range } = {}) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const top = git('rev-parse', '--show-toplevel'), prefix = relative(top, root) || '.';
  const door = existsSync(join(root, 'brain', 'door.json')) ? JSON.parse(readFileSync(join(root, 'brain', 'door.json'), 'utf8')).since : null;
  let r = range;
  if (!r) { try { git('rev-parse', '--verify', 'origin/main'); r = 'origin/main..HEAD'; } catch { r = 'HEAD~1..HEAD'; } }
  const shas = git('rev-list', '--reverse', r).split('\n').filter(Boolean);
  const fails = [];
  const at = (sha, file) => { if (!file) return null; try { return JSON.parse(git('show', `${sha}:${prefix === '.' ? '' : `${prefix}/`}${file}.json`)); } catch { return null; } };
  for (const sha of shas) {
    if (door && (sha === door || !isAncestor(git, door, sha))) continue;
    const parents = git('rev-list', '--parents', '-n', '1', sha).split(' ').slice(1);
    if (parents.length !== 1) continue; // a merge: its sides were checked as they were made
    const changed = git('diff', '--name-only', parents[0], sha, '--', prefix).split('\n').filter((f) => f.endsWith('.json')).map((f) => relative(prefix, f).replace(/\.json$/, ''));
    const docs = changed.filter((f) => ID.test(f.split('/').pop()) && !GENERATED.includes(`${f}`));
    if (!docs.length) continue;
    const covered = new Set(), bad = [];
    const authors = new Set();
    for (const f of docs) {
      const d = at(sha, f); if (!d) continue;
      if (d.type === 'author') authors.add(d.id);
    }
    const m = at(sha, 'brain/ids'); for (const [id, file] of Object.entries(m?.ids || {})) if (id.startsWith('a-')) authors.add(id);
    for (const f of docs) {
      const now_ = at(sha, f), before = at(parents[0], f);
      if (now_?.type !== 'intent') continue;
      const old = before?.events || [], neu = now_.events || [];
      if (JSON.stringify(neu.slice(0, old.length)) !== JSON.stringify(old)) bad.push(`${f}: earlier events changed (they only grow)`);
      const added = neu.slice(old.length);
      if (added.length) covered.add(f.split('/').pop());
      added.forEach((e, k) => {
        if (!authors.has(e.by)) bad.push(`${f}: event by ${e.by}, not an author doc`);
        for (const w of e.writes || []) covered.add(w);
        if (e.what === 'correction' && !e.cause) bad.push(`${f}: a correction names its cause`);
        for (const w of e.writes || []) { const wd = at(sha, m?.ids?.[w] || ''); if (wd && LEARN_ONLY.includes(wd.type) && stepOf(neu.slice(0, old.length + k)) !== 4) bad.push(`${w}: a ${wd.type} written outside Learn`); }
      });
    }
    for (const f of docs) { const id = f.split('/').pop(); if (!covered.has(id) && at(sha, f)?.type !== 'index') bad.push(`${f}: changed without an event of this commit`); }
    for (const f of docs) {
      const d = at(sha, f); if (!d) continue;
      const T = Object.values(m?.ids || {}).map((x) => at(sha, x)).find((t) => t?.type === 'type' && t.name === d.type);
      const v = validate(d, T?.schema); if (v) bad.push(`${f}: schema: ${v}`);
    }
    if (bad.length) fails.push({ commit: sha.slice(0, 9), fails: bad });
  }
  return { range: r, commits: shas.length, fails };
}
function isAncestor(git, a, b) { try { git('merge-base', '--is-ancestor', a, b); return true; } catch { return false; } }
