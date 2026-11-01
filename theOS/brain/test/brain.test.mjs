// brain protocol v1, checkpoint 1 (AIP-3, c7): the read verbs on fixed docs, as exported functions and through the
// command line, and the session-start hook and theOS/CLAUDE.md naming brain prime. Run: node --test theOS/brain/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { load, prime, holds, get } from '../brain.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const theOS = join(here, '..', '..');
const cli = (...args) => JSON.parse(execFileSync(process.execPath, [join(theOS, 'brain', 'brain.mjs'), ...args, '--json', '--root', fixtures], { encoding: 'utf8' }));
const docs = await load(fixtures);

test('holds: a doc holds unless a doc that holds supersedes it; in part, it holds in part', () => {
  assert.deepEqual(holds(docs, 'decision'), [
    { id: 'decisions/D-5', title: 'Fifth, superseded in a named part', holds: 'holds in part' },
    { id: 'decisions/D-4', title: 'Fourth, holds, with a free-text part', holds: 'holds' },
    { id: 'decisions/D-3', title: 'Third, holds', holds: 'holds' },
    { id: 'decisions/D-2', title: 'Second, superseded in part', holds: 'holds in part' },
  ]);
  // a chain old -> mid -> new: only the newest holds; the oldest does not come back
  assert.deepEqual(holds(docs, 'term').map((x) => x.id), ['avenCEO/terms/new-word']);
});

test('holds: unknown type is a fixed error with its fix', () => {
  assert.throws(() => holds(docs, 'nonsense'), (e) => e.code === 'unknown_type' && /decision/.test(e.fix));
});

test('prime: what holds for decisions and terms, and what waits for Samuel', () => {
  const p = prime(docs);
  assert.deepEqual(p.holds.decision.map((x) => x.id), ['decisions/D-5', 'decisions/D-4', 'decisions/D-3', 'decisions/D-2']);
  assert.deepEqual(p.holds.term.map((x) => x.id), ['avenCEO/terms/new-word']);
  assert.deepEqual(p.waits.questions, [{ intent: 'aip/AIP-1', q: 'Open question?', options: ['Yes (recommended)', 'No'] }]);
  // a task of an earlier step still waits; one of a later step does not yet; a done one does not
  assert.deepEqual(p.waits.tasks, [
    { intent: 'aip/AIP-1', id: 't0', what: 'Your answer: an earlier question (overdue)' },
    { intent: 'aip/AIP-1', id: 't1', what: 'Gate A: approve' },
  ]);
});

test('get: the doc, what supersedes it, its links and backlinks', () => {
  const g = get(docs, 'decisions/D-2');
  assert.equal(g.doc.title, 'Second, superseded in part');
  assert.equal(g.holds, 'holds in part');
  assert.deepEqual(g.supersededBy, [{ by: 'decisions/D-3', part: 'part', what: 'its wording' }]);
  assert.deepEqual(g.links, ['decisions/D-1']);
  assert.deepEqual(g.backlinks, ['decisions/D-3']);
});

test('get: a missing doc is a fixed error with its fix', () => {
  assert.throws(() => get(docs, 'decisions/D-99'), (e) => e.code === 'not_found' && /brain holds/.test(e.fix));
});

test('the command line answers the same as the functions', () => {
  assert.deepEqual(cli('prime'), prime(docs));
  assert.deepEqual(cli('holds', 'decision'), holds(docs, 'decision'));
  assert.deepEqual(cli('get', 'decisions/D-2'), get(docs, 'decisions/D-2'));
  let err;
  try { cli('get', 'decisions/D-99'); } catch (e) { err = JSON.parse(e.stdout); }
  assert.equal(err.error, 'not_found');
  try { cli('get'); } catch (e) { err = JSON.parse(e.stdout); }
  assert.equal(err.error, 'missing_arg');
  try { execFileSync(process.execPath, [join(theOS, 'brain', 'brain.mjs'), 'prime', '--json', '--root', here], { encoding: 'utf8' }); } catch (e) { err = JSON.parse(e.stdout); }
  assert.equal(err.error, 'bad_root');
});

test('the skill teaches the verbs and names brain prime', () => {
  const skill = readFileSync(join(theOS, '.claude', 'skills', 'brain', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: brain\ndescription: .+\n---/);
  for (const v of ['brain prime', 'brain holds', 'brain get']) assert.ok(skill.includes(v), v);
});

test('the session-start hook runs brain prime, and theOS/CLAUDE.md names it first', () => {
  const s = JSON.parse(readFileSync(join(theOS, '.claude', 'settings.json'), 'utf8'));
  const cmds = s.hooks.SessionStart.flatMap((m) => m.hooks.map((h) => h.command));
  assert.ok(cmds.some((c) => /brain\.mjs.* prime/.test(c)));
  const first = readFileSync(join(theOS, 'CLAUDE.md'), 'utf8').split('\n').find((l) => l.trim());
  assert.match(first, /brain prime/);
});
