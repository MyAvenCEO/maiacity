// brain's door for writes (aip-836d, checkpoint 2): add, edit, append, index, install and check. Each is a plain
// function; brain.mjs re-exports them and its command line calls them. Every write names the intent it serves and its
// author, appends that intent's event (the trace) and leaves the commit to the agent; brain check fails a commit that
// changed a doc any other way (d-5bce, d-87d6). Writes go to files under the theOS folder `root`.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, chmodSync, renameSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
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
// c1: a doc matches its type doc's schema (no field the schema does not name), and by, session and intent name an
// author, a session and an intent. Returns the first failure, or null. lookup(id) gives a doc by id.
export function checkDoc(doc, typeOf, lookup) {
  if (doc.type === 'index') return null; // written by brain index; c8 checks it equals its folder
  const T = typeOf(doc.type);
  if (!T) return `${doc.id}: type ${doc.type} has no type doc`;
  const s = T.schema;
  const f = validate(doc, s); if (f) return `${doc.id}: ${f}`;
  const extra = s?.properties ? Object.keys(doc).filter((k) => !(k in s.properties)) : [];
  if (extra.length) return `${doc.id}: ${extra.join(', ')}: not a field of ${doc.type} (its type doc names its fields)`;
  for (const [k, t] of [['by', 'author'], ['session', 'session'], ['intent', 'intent']]) if (typeof doc[k] === 'string' && lookup(doc[k])?.type !== t) return `${doc.id}: ${k} ${doc[k]} is not ${t === 'author' ? 'an' : 'a'} ${t} doc`;
  return null;
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
  if (same) {
    const { id: _i, type: _t, at: _a, ...a } = same[1].doc, { id: _j, type: _u, at: _b, ...b } = doc;
    if (JSON.stringify(a) === JSON.stringify(b)) return { outcome: 'unchanged', id: same[0] };
    refuse('duplicate_title', `${same[0]} holds with the same title; supersede it, or give this one its own title`);
  }
  for (const s of doc.supersedes || []) {
    const t = target(s);
    if (!all.has(t)) refuse('not_found', `supersedes ${t}, which is no doc`);
    if (holdsIn(all, t) === 'superseded') refuse('not_held', `${t} no longer holds; supersede what replaced it`);
  }
  const id = mint(m, type);
  const folder = dirname(Object.values(m.ids).find((f) => all.get(f.split('/').pop())?.doc.type === type) || refuse('no_folder', `no ${type} exists yet to show where it is filed`));
  const full = { type, id, ...doc, ...(type === 'decision' && !doc.at ? { at: now() } : {}) };
  full.type = type; full.id = id;
  const bad = checkDoc(full, (t) => typeDoc(all, t), (i) => all.get(i)?.doc);
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
  const locked = Object.keys(patch).filter((k) => ['id', 'type', 'supersedes', 'events'].includes(k));
  if (locked.length) refuse('not_editable', `${locked.join(', ')}: a change of meaning is a new doc that supersedes this one; events are written by the verbs`);
  const next = { ...x.doc, ...patch, id, type: x.doc.type };
  if (JSON.stringify(next) === JSON.stringify(x.doc)) return { outcome: 'unchanged', id };
  const bad = checkDoc(next, (t) => typeDoc(all, t), (i) => all.get(i)?.doc);
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

// brain index: brain/ids.json, every index doc, the definition's lists and a session's decisions and intents, written
// from the docs themselves (c8). Run by add; never edited by hand. With dry, nothing is written: it returns what differs.
export function index(root, { dry = false } = {}) {
  const m = map(root), changed = [];
  const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) { if (!['out', 'node_modules', 'test', 'checks'].includes(n)) walk(p, out); } else if (n.endsWith('.json') && ID.test(n.slice(0, -5))) out.push(p); } return out; };
  const ids = {};
  for (const f of ['aip', 'avenCEO', 'brain'].flatMap((d) => (existsSync(join(root, d)) ? walk(join(root, d)) : []))) {
    const file = relative(root, f).replace(/\.json$/, ''), id = file.split('/').pop();
    if (ids[id]) refuse('duplicate_id', `${id} is both ${ids[id]} and ${file}`);
    ids[id] = file;
  }
  if (JSON.stringify(Object.entries(ids).sort()) !== JSON.stringify(Object.entries(m.ids).sort())) { changed.push('brain/ids.json'); if (!dry) { m.ids = ids; saveMap(root, m); } }
  const docs = Object.fromEntries(Object.entries(ids).map(([i, f]) => [i, read(root, f)]));
  const ofType = (t) => Object.keys(docs).filter((i) => docs[i].type === t);
  // keep the order a list has, drop what is gone, add what is new at the end
  const sync = (id, key, want) => {
    const doc = docs[id], have = doc[key] || [];
    const next = [...have.filter((x) => want.includes(x)), ...want.filter((x) => !have.includes(x))];
    if (JSON.stringify(next) !== JSON.stringify(have)) { changed.push(`${id}.${key}`); if (!dry) { doc[key] = next; write(root, ids[id], doc); } }
  };
  for (const ix of Object.values(m.index)) {
    if (!docs[ix]) continue;
    const dir = dirname(ids[ix]), kind = docs[ix].items?.length ? docs[docs[ix].items[0]]?.type : null;
    sync(ix, 'items', Object.keys(docs).filter((i) => i !== ix && dirname(ids[i]) === dir && (kind ? docs[i].type === kind : docs[i].type !== 'index')));
  }
  const def = m.root && docs[m.root];
  if (def) for (const [key, t] of [['steps', 'step'], ['gates', 'gate'], ['types', 'type'], ['checkers', 'checker'], ['terms', 'term'], ['indexes', 'index']]) if (Array.isArray(def[key])) sync(m.root, key, ofType(t));
  for (const sid of ofType('session')) {
    const ds = ofType('decision').filter((d) => docs[d].session === sid);
    sync(sid, 'decisions', ds);
    sync(sid, 'intents', [...new Set(ds.flatMap((d) => docs[d].intents || []))].filter((i) => docs[i]?.type === 'intent'));
  }
  return { changed };
}

// brain install: this clone's pre-push hook (runs brain check when theOS/ changed; an older hook moves to
// pre-push.local and runs first) and the merge driver for lists that only grow, named in theOS/.gitattributes.
export function install(root, { program } = {}) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const top = git('rev-parse', '--show-toplevel'), hooks = resolve(root, git('rev-parse', '--git-path', 'hooks'));
  const rel = relative(top, join(root, 'brain', 'brain.mjs')), dir = relative(top, root);
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, 'pre-push'), local = join(hooks, 'pre-push.local');
  const MARK = '# brain (aip-836d)';
  if (existsSync(hook) && !readFileSync(hook, 'utf8').includes(MARK)) renameSync(hook, local);
  writeFileSync(hook, `#!/bin/sh\n${MARK}: an older hook runs first, then brain check when ${dir}/ changed\nif [ -x "$(dirname "$0")/pre-push.local" ]; then "$(dirname "$0")/pre-push.local" "$@" || exit 1; fi\ncd "$(git rev-parse --show-toplevel)" || exit 1\nif ! git diff --quiet "@{push}" -- "${dir}" 2>/dev/null || ! git rev-parse -q --verify "@{push}" >/dev/null; then node "${rel}" check || exit 1; fi\n`);
  chmodSync(hook, 0o755);
  const attrs = join(root, '.gitattributes'), want = ['aip/*.json merge=brain-lists', 'avenCEO/**/*.json merge=brain-lists', 'brain/**/*.json merge=brain-lists'];
  const have = existsSync(attrs) ? readFileSync(attrs, 'utf8') : '';
  const missing = want.filter((l) => !have.split('\n').includes(l));
  if (missing.length) writeFileSync(attrs, `${have.trimEnd()}${have ? '\n' : ''}# brain's docs merge with the driver brain install sets up (aip-836d)\n${missing.join('\n')}\n`);
  git('config', 'merge.brain-lists.name', "brain: keep both sides' new entries of lists that only grow");
  git('config', 'merge.brain-lists.driver', `node "${program || rel}" merge %O %A %B`);
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

const GROW = { metric: ['measurements'], session: ['asks'] }; // an intent's events are checked with the trace
const PATH = /^(aip|decisions|sessions|sources|metrics|lessons|authors|avenCEO)\/[A-Za-z][\w@-]*(\/[\w@-]+)*$/;
const IDS = /(?<![\w/-])[a-z]+-[0-9a-f]{4,}(?![\w-])/g;
const PREFIXES = new RegExp(`^(${Object.values(PREFIX).join('|')})-`);
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function strings(v, out = []) { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!(k === 'prompt' && v.type === 'review')) strings(x, out); return out; }
// every doc in a commit, by id, as { file, doc }: one git cat-file run
function allAt(git, sha, prefix, cwd) {
  const files = git('ls-tree', '-r', '--name-only', sha, '--', prefix).split('\n').filter((f) => f.endsWith('.json') && ID.test(f.split('/').pop().slice(0, -5)));
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd, input: files.map((f) => `${sha}:${f}`).join('\n'), maxBuffer: 1 << 28 });
  const all = new Map(); let i = 0;
  for (const f of files) {
    const nl = out.indexOf(10, i), size = +out.subarray(i, nl).toString().split(' ')[2];
    const body = out.subarray(nl + 1, nl + 1 + size).toString('utf8');
    i = nl + 1 + size + 1;
    try { const d = JSON.parse(body); all.set(d.id, { file: f, doc: d }); } catch { /* not JSON */ }
  }
  return all;
}

// brain check: every commit in the range (default: the commits since main) against its parent, from brain/door.json's
// "since" on; then the tree as it is (c8: ids.json, the index docs and the copied lists equal what brain index writes).
// A merge commit is checked where its result differs from every parent: there it must be what the merge driver gives.
export function check(root, { range } = {}) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const top = git('rev-parse', '--show-toplevel'), prefix = relative(top, root) || '.';
  const door = existsSync(join(root, 'brain', 'door.json')) ? JSON.parse(readFileSync(join(root, 'brain', 'door.json'), 'utf8')).since : null;
  let r = range, shas;
  if (!r) { try { git('rev-parse', '--verify', 'origin/main'); r = 'origin/main..HEAD'; } catch { r = 'HEAD~1..HEAD'; } }
  try { shas = git('rev-list', '--reverse', r).split('\n').filter(Boolean); } catch { return { range: r, commits: 0, fails: [{ commit: '-', fails: [`the range ${r} does not resolve here (a shallow clone?); pass --range`] }] }; }
  const fails = [];
  const at = (sha, file) => { if (!file) return null; try { return JSON.parse(git('show', `${sha}:${prefix === '.' ? '' : `${prefix}/`}${file}.json`)); } catch { return null; } };
  for (const sha of shas) {
    if (door && (sha === door || !isAncestor(git, door, sha))) continue;
    const parents = git('rev-list', '--parents', '-n', '1', sha).split(' ').slice(1);
    const m = at(sha, 'brain/ids'); const ids = m?.ids || {};
    const bad = [];
    const changedFrom = (p) => git('diff', '--name-only', p, sha, '--', prefix).split('\n').filter((f) => f.endsWith('.json')).map((f) => relative(prefix, f).replace(/\.json$/, '')).filter((f) => ID.test(f.split('/').pop()));
    if (parents.length > 1) {
      // only what differs from every parent was made by the merge itself
      const sets = parents.map((p) => new Set(changedFrom(p)));
      const own = [...sets[0]].filter((f) => sets.every((x) => x.has(f)));
      let base = null; try { base = git('merge-base', ...parents); } catch { /* unrelated histories */ }
      for (const f of own) {
        let want; try { want = merge3(base && at(base, f), at(parents[0], f), at(parents[1], f)); } catch { want = undefined; }
        if (JSON.stringify(want) !== JSON.stringify(at(sha, f))) bad.push(`${f}: changed by the merge itself, not as the merge driver keeps both sides`);
      }
      if (bad.length) fails.push({ commit: sha.slice(0, 9), fails: bad });
      continue;
    }
    const docs = changedFrom(parents[0]);
    if (!docs.length) continue;
    let renames; const renamesAt = () => renames ??= Object.entries(ids).filter(([i]) => i.startsWith('t-')).map(([i, f]) => [i, at(sha, f)]).filter(([, t]) => t?.renames).map(([i, t]) => ({ term: i, word: t.word, old: t.renames.old, in: t.renames.in }));
    const covered = new Set();
    const isA = (id, t) => at(sha, ids[id])?.type === t;
    for (const f of docs) {
      const now_ = at(sha, f), before = at(parents[0], f);
      if (now_?.type !== 'intent') continue;
      const old = before?.events || [], neu = now_.events || [];
      if (JSON.stringify(neu.slice(0, old.length)) !== JSON.stringify(old)) bad.push(`${f}: earlier events changed (they only grow)`);
      const added = neu.slice(old.length);
      if (added.length) covered.add(f.split('/').pop());
      added.forEach((e, k) => {
        if (!isA(e.by, 'author')) bad.push(`${f}: event by ${e.by}, not an author doc`);
        for (const w of e.writes || []) covered.add(w.split('.')[0]);
        if (e.what === 'correction' && !e.cause) bad.push(`${f}: a correction names its cause`);
        for (const w of e.writes || []) { const wd = at(sha, ids[w]); if (wd && LEARN_ONLY.includes(wd.type) && stepOf(neu.slice(0, old.length + k)) !== 4) bad.push(`${w}: a ${wd.type} written outside Learn`); }
      });
    }
    const types = {}; for (const [id, file] of Object.entries(ids)) if (id.startsWith('ty-')) { const t = at(sha, file); if (t) types[t.name] = t; }
    for (const f of docs) {
      const d = at(sha, f); if (!d) continue;
      const id = f.split('/').pop();
      if (!covered.has(id) && d.type !== 'index') bad.push(`${f}: changed without an event of this commit`);
      const c = checkDoc(d, (t) => types[t], (i) => at(sha, ids[i])); if (c) bad.push(c);
    }
    // c3: a new doc supersedes only docs that exist and held at the parent
    const fresh = docs.filter((f) => !at(parents[0], f) && at(sha, f)?.supersedes?.length);
    if (fresh.length) {
      const before = allAt(git, parents[0], prefix, root);
      for (const f of fresh) for (const sp of at(sha, f).supersedes) {
        const t = target(sp);
        if (!ids[t]) bad.push(`${f}: supersedes ${t}, which is no doc`);
        else if (before.has(t) && holdsIn(before, t) === 'superseded') bad.push(`${f}: supersedes ${t}, which no longer held`);
      }
    }
    for (const f of docs) {
      const d = at(sha, f), b = at(parents[0], f); if (!d) continue;
      // c10: every id inside a new text resolves, and no path is used as a link
      const had = new Set(strings(b || {}));
      for (const v of strings(d).filter((x) => !had.has(x))) {
        if (PATH.test(v)) bad.push(`${f}: ${v} is a path; link by id`);
        for (const r of v.match(IDS) || []) if (!ids[r] && PREFIXES.test(r)) bad.push(`${f}: ${r} names no doc`);
      }
      // c2: lists that only grow, beyond an intent's events (checked above)
      for (const k of GROW[d.type] || []) if (b && JSON.stringify((d[k] || []).slice(0, (b[k] || []).length)) !== JSON.stringify(b[k] || [])) bad.push(`${f}: earlier ${k} changed (they only grow)`);
      // c6: a renamed word does not come back where its rename applies
      for (const R of renamesAt(sha)) if (R.in.some((dir) => f.startsWith(`${dir}/`))) {
        const n = (x) => (JSON.stringify(x || '').match(new RegExp(`(?<![A-Za-z/._-])${esc(R.old)}(?![A-Za-z/._-])`, 'g')) || []).length;
        if (n(d) > n(b)) bad.push(`${f}: "${R.old}" is ${R.word} now (${R.term})`);
      }
    }
    if (bad.length) fails.push({ commit: sha.slice(0, 9), fails: bad });
  }
  // the tree as it is: what brain index would write must already be there
  try { const { changed } = index(root, { dry: true }); if (changed.length) fails.push({ commit: 'tree', fails: changed.map((c) => `${c}: differs from what brain index writes (run: node brain/brain.mjs index)`) }); } catch (e) { fails.push({ commit: 'tree', fails: [e.message] }); }
  return { range: r, commits: shas.length, fails };
}
function isAncestor(git, a, b) { try { git('merge-base', '--is-ancestor', a, b); return true; } catch { return false; } }

// brain versions (c5): a link's version is the commit that added the citing line (git blame, skipping the migration
// commit); a link is flagged when its target changed after that. Intents, reviews, indexes and the definition change
// all the time, so links to them are not flagged. Returns { citing id: [{ target, cited, changed }] }.
const STEADY = ['decision', 'term', 'reference', 'lesson', 'metric', 'type', 'step', 'gate', 'checker', 'author', 'research'];
export function versions(root, only) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const m = map(root), all = docsOf(root);
  let skip = null; try { skip = JSON.parse(readFileSync(join(root, 'brain', 'renames.json'), 'utf8')).commit; } catch { /* none */ }
  const old = (() => { try { return Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(root, 'brain', 'renames.json'), 'utf8')).names).filter(([k]) => k.includes('/')).map(([k, v]) => [v, k])); } catch { return {}; } })();
  const changedAt = new Map();
  const lastChange = (id) => {
    if (changedAt.has(id)) return changedAt.get(id);
    let t = 0;
    for (const line of git('log', '--format=%H %at', '--', `${m.ids[id]}.json`).split('\n').filter(Boolean)) { const [h, ct] = line.split(' '); if (h !== skip) { t = +ct; break; } }
    if (!t && old[id] && skip) { const x = git('log', '-1', '--format=%at', `${skip}^`, '--', `${old[id]}.json`); t = +x || 0; }
    changedAt.set(id, t); return t;
  };
  const out = {};
  for (const id of only || Object.keys(m.ids)) {
    if (!m.ids[id]) continue;
    let blame; try { blame = git('blame', '--line-porcelain', ...(skip ? ['--ignore-rev', skip] : []), '--', `${m.ids[id]}.json`); } catch { continue; }
    let time = 0;
    for (const line of blame.split('\n')) {
      if (line.startsWith('author-time ')) time = +line.slice(12);
      else if (line.startsWith('\t')) for (const r of line.match(IDS) || []) {
        const t = all.get(r);
        if (!t || r === id || !STEADY.includes(t.doc.type)) continue;
        const c = lastChange(r);
        if (c > time) (out[id] ??= []).push({ target: r, cited: new Date(time * 1000).toISOString().slice(0, 16) + 'Z', changed: new Date(c * 1000).toISOString().slice(0, 16) + 'Z' });
      }
    }
    if (out[id]) out[id] = [...new Map(out[id].map((x) => [x.target, x])).values()];
  }
  return out;
}
