// @ts-nocheck
import { expect, test } from 'bun:test';
import { localFileEntries } from './file-entries.js';
const a = 'a'.repeat(64), b = 'b'.repeat(64);
test('cross-vault file inventory uses canonical typed projections, never world', async () => {
 const calls = [];
 const rows = [{ entry: 'one', vault: a }, { entry: 'two', vault: b }];
 const device = { run: async op => {
  calls.push(op);
  if (op.op === 'world_summary') return { ok: { vaults: [{ id: a }, { id: b }, { id: a }], entriesComplete: false } };
  expect(op.op).toBe('entry_views'); expect(op.types).toEqual(['file']);
  return { ok: { rows: rows.filter(row => row.vault === op.vault) } };
 } };
 expect(await localFileEntries(device)).toEqual(rows);
 expect(calls.map(o => o.op)).toEqual(['world_summary', 'entry_views', 'entry_views']);
});
test('explicit media demand reads only requested vaults', async () => {
 const calls = [];
 const device = { run: async op => { calls.push(op); return { ok: { rows: [] } }; } };
 expect(await localFileEntries(device, { vaults: [a, a] })).toEqual([]);
 expect(calls).toEqual([{ op: 'entry_views', vault: a, types: ['file'] }]);
});
test('unavailable or incomplete file inventory is not confirmed empty', async () => {
 for (const result of [{ refused: 'denied' }, { ok: null }, { ok: { rows: [], entriesComplete: false } }]) {
  await expect(localFileEntries({ run: async () => result }, { vaults: [a] })).rejects.toThrow('unavailable');
 }
 await expect(localFileEntries({ run: async () => ({ ok: null }) })).rejects.toThrow('unavailable');
});
test('cancellation stops inventory before the next vault', async () => {
 const controller = new AbortController(), calls = [];
 const device = { run: async op => { calls.push(op); controller.abort(); return { ok: { rows: [] } }; } };
 await expect(localFileEntries(device, { vaults: [a,b], signal: controller.signal })).rejects.toThrow();
 expect(calls.length).toBe(1);
});
