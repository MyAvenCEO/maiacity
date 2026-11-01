// AIP-3 checkpoint 2's migration (c12): run on a copy of the fixtures; every doc renamed and moved, every reference
// rewritten, nothing old or dangling left, what holds unchanged, old names still found, a second run refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, audit } from '../migrate.mjs';
import { load, prime, holds, get } from '../brain.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const copy = () => { const d = mkdtempSync(join(tmpdir(), 'brain-')); cpSync(fixtures, d, { recursive: true }); return d; };

test('the migration renames, moves and rewrites everything, and what holds is unchanged', async () => {
  const root = copy();
  // a review prompt stays verbatim; OLD-AIP stays; text names are rewritten
  writeFileSync(join(root, 'aip', 'AIP-1-r1.json'), JSON.stringify({ type: 'review', id: 'aip/AIP-1-r1', intent: 'aip/AIP-1', prompt: 'Read aip/AIP-1 and D-2.', findings: [{ text: 'D-2 and OLD-AIP-7, see theOS/decisions/D-3.json' }] }));
  // a title that names other docs: shown by the same names after the migration
  const d4 = join(root, 'decisions', 'D-4.json');
  writeFileSync(d4, JSON.stringify({ ...JSON.parse(readFileSync(d4, 'utf8')), title: 'AIP-1: builds on D-2' }));
  const before = prime(await load(root));
  assert.equal(before.holds.decision.find((x) => x.id === 'decisions/D-4').title, 'AIP-1: builds on D-2');
  const r = migrate(root, { seed: 'test' });
  assert.equal(r.docs, 13);
  assert.deepEqual(audit(root), { old: [], dangling: [] });
  const { names } = JSON.parse(readFileSync(join(root, 'brain', 'renames.json'), 'utf8'));
  const { ids } = JSON.parse(readFileSync(join(root, 'brain', 'ids.json'), 'utf8'));
  assert.ok(ids[names['decisions/D-2']].startsWith('brain/decisions/d-'));
  assert.ok(ids[names['avenCEO/terms/new-word']].startsWith('brain/terms/t-'));
  assert.ok(ids[names['aip/AIP-1']].startsWith('aip/aip-'));
  assert.equal(names['D-2'], names['decisions/D-2']);
  assert.ok(!existsSync(join(root, 'decisions')));
  const rv = JSON.parse(readFileSync(join(root, ids[names['aip/AIP-1-r1']] + '.json'), 'utf8'));
  assert.equal(rv.prompt, 'Read aip/AIP-1 and D-2.');
  assert.equal(rv.findings[0].text, `${names['D-2']} and OLD-AIP-7, see ${names['decisions/D-3']}`);
  const docs = await load(root), after = prime(docs);
  const id = (o) => names[o];
  // stored as ids, shown as id and title (D-76): the same docs and titles as before, under their new ids, and no D-n or
  // AIP-n left in what is shown
  assert.deepEqual(after.holds.decision.map((x) => x.id), before.holds.decision.map((x) => id(x.id)));
  for (const x of after.holds.decision) assert.ok(x.name.startsWith(`${x.id} · `), x.name);
  const a4 = after.holds.decision.find((x) => x.id === names['D-4']);
  assert.equal(a4.title, `${names['aip/AIP-1']} · A fixture intent: builds on ${names['D-2']} · Second, superseded in part`);
  assert.doesNotMatch(JSON.stringify(after.holds) + JSON.stringify(after.waits), /\b(D|AIP)-\d+\b/);
  assert.deepEqual(after.waits.tasks.map((t) => t.id), before.waits.tasks.map((t) => t.id));
  assert.deepEqual(after.waits.questions.length, before.waits.questions.length);
  assert.equal(get(docs, 'D-2').id, names['decisions/D-2']);
  assert.equal(get(docs, 'decisions/D-2').holds, 'holds in part');
  assert.deepEqual(holds(docs, 'term').map((x) => x.id), [names['avenCEO/terms/new-word']]);
});

test('a second run is refused', () => {
  const root = copy();
  migrate(root, { seed: 'test' });
  assert.throws(() => migrate(root), /already migrated/);
});
