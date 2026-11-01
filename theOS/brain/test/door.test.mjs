// aip-836d checkpoint 2, the door for writes (c1, c4, c8, c9): add, edit, append, index, check and the merge driver,
// on a migrated copy of the fixtures with an author and two type docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrate } from '../migrate.mjs';
import { add, edit, append, index, check, merge3, install, DoorError } from '../door.mjs';
import { existsSync } from 'node:fs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const program = join(dirname(fileURLToPath(import.meta.url)), '..', 'brain.mjs');
const J = (root, f) => JSON.parse(readFileSync(join(root, `${f}.json`), 'utf8'));
const put = (root, f, d) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, `${f}.json`), JSON.stringify(d, null, 1)); };
const git = (root, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' });

function world() {
  const root = mkdtempSync(join(tmpdir(), 'door-'));
  cpSync(fixtures, root, { recursive: true });
  migrate(root, { seed: 'door' });
  put(root, 'brain/authors/a-0001', { type: 'author', id: 'a-0001', name: 'Samuel', kind: 'human', what: 'decides' });
  const open = (t, props) => ({ type: 'type', name: t, schema: { type: 'object', required: ['type', 'id'], properties: Object.fromEntries(['type', 'id', ...props].map((k) => [k, {}])) } });
  put(root, 'avenCEO/types/ty-0001', { id: 'ty-0001', ...open('decision', ['n', 'title', 'means', 'about', 'supersedes', 'relates', 'intents', 'at', 'by', 'session']), schema: { type: 'object', required: ['type', 'id', 'title', 'about'], properties: { type: {}, id: { type: 'string', pattern: '^d-[0-9a-f]{4,}$' }, n: {}, title: {}, means: {}, quote: {}, about: { type: 'array', items: { type: 'string' } }, supersedes: {}, relates: {}, intents: {}, at: {}, by: {}, session: {} } } });
  put(root, 'avenCEO/types/ty-0002', { id: 'ty-0002', ...open('metric', ['name', 'measurements']) });
  put(root, 'avenCEO/types/ty-0003', { id: 'ty-0003', ...open('intent', ['title', 'questions', 'tasks', 'events']) });
  put(root, 'avenCEO/types/ty-0004', { id: 'ty-0004', ...open('author', ['name', 'kind', 'what']) });
  put(root, 'brain/metrics/m-0001', { type: 'metric', id: 'm-0001', name: 'corrections', measurements: [] });
  index(root);
  const { names } = J(root, 'brain/renames');
  // each fixture decision gets its own topic word, as the real ones have
  const ids0 = J(root, 'brain/ids').ids;
  for (const n of [1, 2, 3, 4, 5]) { const f = ids0[names[`D-${n}`]]; put(root, f, { ...J(root, f), about: [`topic${n}`] }); }
  return { root, names, I: names['aip/AIP-1'] };
}
const fails = (fn, code) => assert.throws(fn, (e) => e instanceof DoorError && e.code === code);

test('add: an id minted, the schema checked, filed with its type, indexed, its event written; a twin is unchanged', () => {
  const { root, names, I } = world();
  const r = add(root, { type: 'decision', doc: { title: 'A new one', about: ['x'], supersedes: [{ doc: names['D-3'], part: 'all', what: 'replaced' }] }, intent: I, by: 'a-0001' });
  assert.equal(r.outcome, 'created');
  assert.match(r.id, /^d-[0-9a-f]{4,}$/);
  const { ids, index: ix } = J(root, 'brain/ids');
  assert.equal(ids[r.id], `brain/decisions/${r.id}`);
  assert.ok(J(root, ids[ix.decisions]).items.includes(r.id));
  const ev = J(root, ids[I]).events.at(-1);
  assert.equal(ev.what, 'add'); assert.equal(ev.by, 'a-0001'); assert.ok(ev.writes.includes(r.id));
  const twin = { title: 'A new one', about: ['x'], supersedes: [{ doc: names['D-3'], part: 'all', what: 'replaced' }] };
  assert.equal(add(root, { type: 'decision', doc: twin, intent: I, by: 'a-0001' }).outcome, 'unchanged');
  fails(() => add(root, { type: 'decision', doc: { title: 'A new one', about: ['y'] }, intent: I, by: 'a-0001' }), 'duplicate_title');
});

test('add refuses: no intent, no author, a bad schema, a supersede of what no longer holds, a metric outside Learn', () => {
  const { root, names, I } = world();
  fails(() => add(root, { type: 'decision', doc: { title: 't', about: [] }, intent: 'aip-nope', by: 'a-0001' }), 'no_intent');
  fails(() => add(root, { type: 'decision', doc: { title: 't', about: [] }, intent: I, by: 'Samuel' }), 'no_author');
  fails(() => add(root, { type: 'decision', doc: { title: 't' }, intent: I, by: 'a-0001' }), 'schema');
  fails(() => add(root, { type: 'decision', doc: { title: 't', about: [], supersedes: [{ doc: names['D-1'] }] }, intent: I, by: 'a-0001' }), 'not_held');
  fails(() => add(root, { type: 'metric', doc: { name: 'm' }, intent: I, by: 'a-0001' }), 'step');
  fails(() => add(root, { type: 'decision', doc: { title: 't', about: [], sesion: 's' }, intent: I, by: 'a-0001' }), 'schema');
  fails(() => add(root, { type: 'decision', doc: { title: 't', about: [], by: 'Samuel' }, intent: I, by: 'a-0001' }), 'schema');
  fails(() => add(root, { type: 'decision', doc: { title: 't', about: [], session: 'nope' }, intent: I, by: 'a-0001' }), 'schema');
  fails(() => edit(root, { id: names['D-4'], patch: { supersedes: [] }, intent: I, by: 'a-0001' }), 'not_editable');
  fails(() => append(root, { id: 'm-0001', list: 'measurements', entry: { value: 1 }, intent: I, by: 'a-0001' }), 'step');
});

test('add records the candidates the reflection left for the reviewer', () => {
  const { root, names, I } = world();
  const ids = J(root, 'brain/ids').ids;
  const d4 = J(root, ids[names['D-4']]); d4.about = ['links']; put(root, ids[names['D-4']], d4);
  const r = add(root, { type: 'decision', doc: { title: 'About links', about: ['links'] }, intent: I, by: 'a-0001' });
  assert.deepEqual(r.left, [names['D-4']]);
  assert.deepEqual(J(root, ids[I]).events.at(-1).left, [names['D-4']]);
});

test('edit and append, each with its event', () => {
  const { root, names, I } = world();
  assert.equal(edit(root, { id: names['D-4'], patch: { title: 'Fourth, retitled' }, intent: I, by: 'a-0001' }).outcome, 'changed');
  assert.equal(edit(root, { id: names['D-4'], patch: { title: 'Fourth, retitled' }, intent: I, by: 'a-0001' }).outcome, 'unchanged');
  assert.equal(append(root, { id: names['D-4'], list: 'relates', entry: names['D-3'], intent: I, by: 'a-0001' }).outcome, 'appended');
  const ev = J(root, J(root, 'brain/ids').ids[I]).events.slice(-2).map((e) => e.what);
  assert.deepEqual(ev, ['edit', 'append']);
});

test('check: a doc changed without an event fails; the same change through the door passes; history only grows', () => {
  const { root, names, I } = world();
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
  const ids = J(root, 'brain/ids').ids;
  const d4 = J(root, ids[names['D-4']]); d4.title = 'by hand'; put(root, ids[names['D-4']], d4);
  git(root, 'commit', '-qam', 'by hand');
  assert.match(check(root, { range: 'HEAD~1..HEAD' }).fails[0].fails[0], /changed without an event/);
  git(root, 'reset', '-q', '--hard', 'HEAD~1');
  edit(root, { id: names['D-4'], patch: { title: 'through the door' }, intent: I, by: 'a-0001' });
  git(root, 'commit', '-qam', 'door');
  assert.deepEqual(check(root, { range: 'HEAD~1..HEAD' }).fails, []);
  const intent = J(root, ids[I]); intent.events[0].text = 'rewritten'; put(root, ids[I], intent);
  git(root, 'commit', '-qam', 'rewrite');
  assert.match(check(root, { range: 'HEAD~1..HEAD' }).fails[0].fails.join(), /only grow/);
});

test('the merge driver keeps both sides\' new entries; a field changed both ways is a conflict', () => {
  const o = { events: [1], title: 'a' };
  assert.deepEqual(merge3(o, { events: [1, 2], title: 'a' }, { events: [1, 3], title: 'b' }), { events: [1, 2, 3], title: 'b' });
  assert.throws(() => merge3(o, { events: [1], title: 'x' }, { events: [1], title: 'y' }), /conflict/);
});

test('check: a type without a type doc, a hand-cut index and a hand edit inside a merge all fail', () => {
  const { root, names, I } = world();
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
  const ids = J(root, 'brain/ids').ids, ix = J(root, 'brain/ids').index.decisions;
  const x = J(root, ids[ix]); x.items = x.items.slice(1); put(root, ids[ix], x);
  assert.match(check(root, { range: 'HEAD..HEAD' }).fails.at(-1).fails.join(), /differs from what brain index writes/);
  git(root, 'checkout', '-q', '.');
  // a merge whose result was edited by hand
  git(root, 'checkout', '-qb', 'side');
  edit(root, { id: names['D-4'], patch: { title: 'side' }, intent: I, by: 'a-0001' }); git(root, 'commit', '-qam', 'side');
  git(root, 'checkout', '-q', '-'); edit(root, { id: names['D-3'], patch: { title: 'main' }, intent: I, by: 'a-0001' }); git(root, 'commit', '-qam', 'main');
  install(root, { program });
  git(root, 'merge', '-q', '--no-ff', '--no-commit', 'side');
  const d4 = J(root, ids[names['D-4']]); d4.means = 'slipped in'; put(root, ids[names['D-4']], d4);
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'merge');
  assert.match(check(root, { range: 'HEAD~1..HEAD' }).fails.map((f) => f.fails.join()).join(), /changed by the merge itself/);
});

test('install: the hook in this clone\'s hooks folder, an older hook kept and run first; two branches that each add a decision merge cleanly (c9)', () => {
  const { root, I } = world();
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
  writeFileSync(join(root, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nexit 0\n');
  install(root, { program }); install(root, { program });
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'attributes');
  assert.match(readFileSync(join(root, '.git', 'hooks', 'pre-push'), 'utf8'), /pre-push.local/);
  assert.ok(existsSync(join(root, '.git', 'hooks', 'pre-push.local')));
  git(root, 'checkout', '-qb', 'a'); add(root, { type: 'decision', doc: { title: 'from a', about: ['a'] }, intent: I, by: 'a-0001' }); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'a');
  git(root, 'checkout', '-q', '-'); add(root, { type: 'decision', doc: { title: 'from b', about: ['b'] }, intent: I, by: 'a-0001' }); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'b');
  git(root, 'merge', '-q', '--no-ff', '-m', 'merge a', 'a');
  assert.deepEqual(check(root, { range: 'HEAD~1..HEAD' }).fails, []);
  assert.equal(J(root, J(root, 'brain/ids').ids[I]).events.filter((e) => e.what === 'add').length, 2);
});

test('checkpoint 3: check fails a supersede of what no longer held (c3), a path or a dangling id as a link (c10), a rewritten measurement (c2), a renamed word coming back (c6)', () => {
  const { root, names, I } = world();
  const ids = () => J(root, 'brain/ids').ids;
  // the term that renamed "old-word" says where it must not come back
  const nw = ids()[names['avenCEO/terms/new-word']];
  put(root, nw, { ...J(root, nw), renames: { old: 'oldword', in: ['brain'] } });
  put(root, 'avenCEO/types/ty-0005', { type: 'type', id: 'ty-0005', name: 'term', schema: { type: 'object', properties: Object.fromEntries(['type', 'id', 'word', 'means', 'about', 'supersedes', 'renames'].map((k) => [k, {}])) } });
  index(root);
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
  const run = () => check(root, { range: 'HEAD~1..HEAD' }).fails.flatMap((f) => f.fails).join(' | ');
  // c10 and c6, through the door
  edit(root, { id: names['D-4'], patch: { relates: ['decisions/D-3', 'd-ffff'], means: 'see oldword' }, intent: I, by: 'a-0001' });
  git(root, 'commit', '-qam', 'links');
  const r = run();
  assert.match(r, /decisions\/D-3 is a path; link by id/);
  assert.match(r, /d-ffff names no doc/);
  assert.match(r, /"oldword" is New word now/);
  // c3: a new doc, written by hand with its event, supersedes a doc that no longer held
  git(root, 'reset', '-q', '--hard', 'HEAD~1');
  put(root, 'brain/decisions/d-abcd', { type: 'decision', id: 'd-abcd', title: 'late', about: ['x'], supersedes: [{ doc: names['D-1'] }] });
  const intent = J(root, ids()[I]); intent.events.push({ at: 'x', by: 'a-0001', what: 'add', writes: ['d-abcd'] }); put(root, ids()[I], intent);
  index(root); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'late');
  assert.match(run(), /supersedes .* which no longer held/);
  // c2: a measurement rewritten
  git(root, 'reset', '-q', '--hard', 'HEAD~1');
  const m = J(root, 'brain/metrics/m-0001'); m.measurements = [{ value: 1 }]; put(root, 'brain/metrics/m-0001', m);
  const i2 = J(root, ids()[I]); i2.events.push({ at: 'x', by: 'a-0001', what: 'measured', writes: [] }); i2.events.push({ at: 'x', by: 'a-0001', what: 'x', writes: ['m-0001'] }); put(root, ids()[I], i2);
  git(root, 'commit', '-qam', 'm1');
  const m2 = J(root, 'brain/metrics/m-0001'); m2.measurements = [{ value: 2 }]; put(root, 'brain/metrics/m-0001', m2);
  const i3 = J(root, ids()[I]); i3.events.push({ at: 'x', by: 'a-0001', what: 'x', writes: ['m-0001'] }); put(root, ids()[I], i3);
  git(root, 'commit', '-qam', 'm2');
  assert.match(run(), /earlier measurements changed/);
});

test('brain versions flags a link whose target changed after it was cited (c5)', async () => {
  const { versions } = await import('../door.mjs');
  const { root, names, I } = world();
  const at = (d) => ({ cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  const commit = (m, d) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', m], at(d));
  git(root, 'init', '-q'); git(root, 'add', '-A'); commit('base', '2026-01-01T00:00:00Z');
  const d4 = names['D-4'], d3 = names['D-3'];
  assert.deepEqual(versions(root, [d4])[d4], undefined);
  // D-4 relates D-3 from now on; later D-3 changes
  edit(root, { id: d4, patch: { relates: [d3] }, intent: I, by: 'a-0001' }); commit('cite', '2026-02-01T00:00:00Z');
  assert.deepEqual(versions(root, [d4])[d4], undefined);
  edit(root, { id: d3, patch: { title: 'Third, changed later' }, intent: I, by: 'a-0001' }); commit('change', '2026-03-01T00:00:00Z');
  assert.deepEqual(versions(root, [d4])[d4].map((x) => x.target), [d3]);
});

test('check works with theOS as a subfolder of the repository, as it is (not only flat)', () => {
  const { root: inner, names, I } = world();
  const top = mkdtempSync(join(tmpdir(), 'top-'));
  cpSync(inner, join(top, 'theOS'), { recursive: true });
  const root = join(top, 'theOS');
  git(top, 'init', '-q'); git(top, 'add', '-A'); git(top, 'commit', '-qm', 'base');
  const ids = J(root, 'brain/ids').ids;
  const d4 = J(root, ids[names['D-4']]); d4.means = 'by hand'; put(root, ids[names['D-4']], d4);
  git(top, 'commit', '-qam', 'by hand');
  assert.match(check(root, { range: 'HEAD~1..HEAD' }).fails.map((f) => f.fails.join()).join(), /changed without an event/);
  git(top, 'reset', '-q', '--hard', 'HEAD~1');
  edit(root, { id: names['D-4'], patch: { relates: [`brain/decisions/${names['D-3']}`] }, intent: I, by: 'a-0001' });
  git(top, 'commit', '-qam', 'path');
  assert.match(check(root, { range: 'HEAD~1..HEAD' }).fails.map((f) => f.fails.join()).join(), /is a path; link by id/);
});

test('c6 stays quiet where the old word is right: a quote, the word in quotes, the rename itself; it fails on use', () => {
  const { root, names, I } = world();
  const ids = () => J(root, 'brain/ids').ids;
  put(root, 'avenCEO/types/ty-0005', { type: 'type', id: 'ty-0005', name: 'term', schema: { type: 'object', properties: Object.fromEntries(['type', 'id', 'word', 'means', 'about', 'supersedes', 'renames'].map((k) => [k, {}])) } });
  index(root);
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
  const nw = ids()[names['avenCEO/terms/new-word']];
  edit(root, { id: names['avenCEO/terms/new-word'], patch: { renames: { old: 'oldword', in: ['brain'] } }, intent: I, by: 'a-0001' });
  edit(root, { id: names['D-4'], patch: { means: "renamed from 'oldword'", quote: 'Samuel said oldword' }, intent: I, by: 'a-0001' });
  git(root, 'commit', '-qam', 'quiet');
  assert.deepEqual(check(root, { range: 'HEAD~1..HEAD' }).fails, []);
  edit(root, { id: names['D-3'], patch: { means: 'the oldword is used' }, intent: I, by: 'a-0001' });
  git(root, 'commit', '-qam', 'use');
  assert.match(check(root, { range: 'HEAD~1..HEAD' }).fails.map((f) => f.fails.join()).join(), /"oldword" is New word now/);
  assert.ok(nw);
});

test('check warns when a doc that holds cites one that no longer holds (c10)', () => {
  const { root, names } = world();
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
  // D-4 relates D-1 in the fixtures; D-1 is superseded by D-2
  assert.ok(check(root, { range: 'HEAD..HEAD' }).warnings.includes(`${names['D-4']} cites ${names['D-1']}, which no longer holds`));
});
