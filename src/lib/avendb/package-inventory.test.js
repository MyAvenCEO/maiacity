// @ts-nocheck
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { compile } from 'svelte/compiler';
import { packageQuery, missingPackageLabel } from './package-inventory.js';
import { createReactiveRead } from './reactive-read.js';
import { observedWindow } from './observed-window.js';
import { summaryView, needsWorldEntries } from './startup-summary.js';
import { readCompleteness } from './read-completeness.js';
// an Interest op seen as the one list of entries and selectors it wants (tiers aside)
const flat = (op) => op?.op !== 'interest' ? op : { ...op, entries: (op.wants ?? []).flatMap((w) => w.entries ?? []), queries: op.wants?.length ? op.wants.flatMap((w) => w.queries ?? []) : undefined };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('package inventories read local authorized files while peer demand remains unanswered', async () => {
 const vault = 'a'.repeat(64), actor = 'b'.repeat(64), calls = [], reads = [], answers = [];
 let finish; const pending = new Promise(resolve => { finish = resolve; });
 const owner = { run: op => { calls.push(flat(op)); return pending; } };
 const reader = createReactiveRead({ read: observedWindow(async (_d, op) => {
  reads.push(op); return { ok: { rows: [], totalEntries: 0, readableEntries: 0 } };
 }), take: out => answers.push(out), timing: () => () => {} });
 try {
  for (const route of ['models', 'code']) {
   assert.equal(summaryView('/app/', `#${route}/selected`), true);
   assert.equal(needsWorldEntries({ entriesComplete: false }, route), false);
  }
  reader.update(packageQuery(vault, actor), owner); await flush();
  assert.deepEqual(reads, [{ op: 'entry_views', vault, as: actor, types: ['file'] }]);
  assert.deepEqual(calls[0].queries, [{ types: ['file'], vault }]);
  assert.equal(JSON.stringify(calls).includes(actor), false);
  assert.equal(answers.length, 1);
  assert.equal(readCompleteness(answers[0]).authoritativeEmpty, false);
  reader.close(); await flush(); assert.equal(calls.at(-1).queries, undefined);
 } finally { reader.close(); finish({ ok: { accepted: true } }); await flush(); }
});

test('package inventory distinguishes loading, failed and incomplete absence', () => {
 assert.notEqual(missingPackageLabel('loading'), missingPackageLabel('ready'));
 assert.notEqual(missingPackageLabel('error'), missingPackageLabel('ready'));
 assert.match(missingPackageLabel('ready'), /local entries/);
});

test('Models and Code compile with scoped inventory and preserve incomplete world', async () => {
 for (const name of ['Models', 'Code']) {
  const source = await readFile(new URL(`./${name}.svelte`, import.meta.url), 'utf8');
  compile(source, { filename: `${name}.svelte`, generate: 'client' });
  assert.ok(source.includes('entryCollection(() => api, () => packageQuery(vault, actor))'));
  assert.ok(!source.includes('world.entries'));
  assert.ok(!source.includes('The missing files go in as one AIP'));
 }
});
