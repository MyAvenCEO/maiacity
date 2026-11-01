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
  put(root, 'avenCEO/types/ty-0001', { id: 'ty-0001', ...open('decision', ['n', 'title', 'means', 'about', 'supersedes', 'relates', 'intents', 'at', 'by', 'session']), schema: { type: 'object', required: ['type', 'id', 'title', 'about'], properties: { type: {}, id: { type: 'string', pattern: '^d-[0-9a-f]{4,}$' }, n: {}, title: {}, means: {}, about: { type: 'array', items: { type: 'string' } }, supersedes: {}, relates: {}, intents: {}, at: {}, by: {}, session: {} } } });
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
