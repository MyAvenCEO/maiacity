// @ts-nocheck
import { expect, test } from 'bun:test';
import { createLatencyJournal, recordPeerTimings, measureLatency, policyObservations } from './latency-journal.js';
import { createLocalTimings } from './local-timings.js';
function fixture(initial = null) {
 let stored = initial, writes = 0, tick = 100;
 const scheduled = [];
 const storage = () => ({ getItem: () => stored, setItem: (_, value) => { stored = value; writes++; }, removeItem: () => { stored = null; } });
 return { journal: createLatencyJournal({ storage, now: () => ++tick, schedule: f => scheduled.push(f) }), storage, scheduled, raw: () => stored, writes: () => writes };
}
test('bounded evidence survives reload without recording arbitrary identifiers or payloads', () => {
 const f = fixture();
 for (let n = 0; n < 150; n++) f.journal.record('call.set', n);
 f.journal.record('secret-vault-identifier', 2);
 f.journal.record('call.set', Infinity);
 f.journal.record('call.set', -1);
 expect(f.scheduled.length).toBe(1);
 expect(f.writes()).toBe(0);
 f.scheduled[0]();
 const restored = createLatencyJournal({ storage: f.storage });
 expect(restored.snapshot().samples.length).toBe(120);
 expect(restored.snapshot().samples[0].ms).toBe(30);
 expect(f.raw()).not.toContain('secret-vault-identifier');
});
test('untrusted stored records are projected onto only allowed scalar fields', () => {
 const f = fixture(JSON.stringify({ version: 1, samples: [{ stage: 'call.query', ms: 7, at: 5, outcome: 'ok', payload: 'SECRET' }, { stage: 'private-id', ms: 1, at: 5, outcome: 'ok' }] }));
 expect(f.journal.snapshot().samples).toEqual([{ stage: 'call.query', ms: 7, at: 5, outcome: 'ok' }]);
 f.journal.flush(); expect(f.raw()).not.toContain('SECRET');
});
test('storage denial does not fail a local operation and reports durability unavailable', async () => {
 const journal = createLatencyJournal({ storage: () => { throw new Error('denied'); }, schedule: f => f() });
 let time = 10;
 const meter = createLocalTimings(() => time, (op, ms, state) => journal.record(`call.${op}`, ms, state));
 expect(await meter.measure('set', async () => { time = 28; return { ok: true }; })).toEqual({ ok: true });
 expect(journal.snapshot().storageAvailable).toBe(false);
 expect(journal.snapshot().samples[0]).toMatchObject({ stage: 'call.set', ms: 18, outcome: 'ok' });
});
test('write refusal and failure stay distinct and never retain error contents', async () => {
 const f = fixture(); const meter = createLocalTimings(() => 1, (op, ms, state) => f.journal.record(`call.${op}`, ms, state));
 await meter.measure('insert', async () => ({ refused: 'Denied', why: 'secret' }));
 await expect(meter.measure('create', async () => { throw new Error('private content'); })).rejects.toThrow();
 expect(f.journal.snapshot().samples.map(s => s.outcome)).toEqual(['refused', 'failed']);
 f.journal.flush(); expect(f.raw()).not.toContain('secret'); expect(f.raw()).not.toContain('private content');
});
test('peer sampling retains selected measured RTT only, never addresses or claims edit acknowledgement', () => {
 const f = fixture();
 expect(recordPeerTimings({ peers: [{ device: 'SECRET-ID', endpoint: 'SECRET-IP', paths: [{ selected: true, rtt_ms: 23, addr: 'SECRET' }, { selected: false, rtt_ms: 5 }, { selected: true, rtt_ms: 0 }] }] }, f.journal)).toBe(1);
 expect(f.journal.snapshot().samples[0].stage).toBe('peer.transport-rtt');
 f.journal.flush(); expect(f.raw()).not.toContain('SECRET');
});

test('unlock duration uses a monotonic clock and preserves results and failures', async () => {
 const f = fixture(); let tick = 10;
 expect(await measureLatency('unlock.total', async () => { tick = 35; return 'opened'; }, f.journal, () => tick)).toBe('opened');
 const failure = new Error('private account error');
 await expect(measureLatency('unlock.total', async () => { tick = 50; throw failure; }, f.journal, () => tick)).rejects.toBe(failure);
 expect(f.journal.snapshot().samples.map(s => [s.ms, s.outcome])).toEqual([[25, 'ok'], [15, 'failed']]);
 f.journal.flush(); expect(f.raw()).not.toContain('private account');
});

test('unlock outcome is durable before returning even without pagehide or timer execution', async () => {
 const f = fixture(); let time = 5;
 await measureLatency('unlock.total', async () => { time = 20; }, f.journal, () => time);
 expect(f.writes()).toBe(1);
 expect(createLatencyJournal({storage:f.storage}).snapshot().samples[0]).toMatchObject({stage:'unlock.total',ms:15,outcome:'ok'});
 await expect(measureLatency('unlock.total', async () => {time=30;throw Error('failed');},f.journal,()=>time)).rejects.toThrow();
 expect(f.writes()).toBe(2);
 expect(createLatencyJournal({storage:f.storage}).snapshot().samples.at(-1).outcome).toBe('failed');
});

test('policy observation export bounds and redacts engine records without inventing RTT', () => {
 expect(policyObservations({})).toBeNull();
 expect(policyObservations({ policy_observations: { stage: 'transport-rtt', samples: [] } })).toBeNull();
 const base = { stage: 'local-completion-to-peer-policy-observation' };
 const result = policyObservations({ policy_observations: { ...base, peer: 'secret', samples: [
  { ms: 123, outcome: 'standing', entry: 'secret', nonce: 'secret' },
  { ms: 456, outcome: 'not-standing' }, null,
  { ms: 1, outcome: 'unknown' }, { ms: 30000, outcome: 'standing' }, { ms: -1, outcome: 'standing' }
 ] }});
 expect(result).toEqual({ ...base, samples: [{ ms: 123, outcome: 'standing' }, { ms: 456, outcome: 'not-standing' }] });
 expect(JSON.stringify(result)).not.toContain('secret');
 expect(policyObservations({ policy_observations: { ...base, samples: Array.from({ length: 100 }, () => ({ ms: 1, outcome: 'standing' })) } }).samples).toHaveLength(64);
});

test('scoped first-result and useful-result timings survive restart', () => {
 const f=fixture();
 for (const stage of ['entry_views.first-result-emission','entry_views.first-nonempty-emission','entry_views.first-nonempty-emission.readonly','query.first-result-emission']) f.journal.record(stage,45);
 f.journal.flush();
 expect(createLatencyJournal({storage:f.storage}).snapshot().samples.map(s=>s.stage)).toEqual(['entry_views.first-result-emission','entry_views.first-nonempty-emission','entry_views.first-nonempty-emission.readonly','query.first-result-emission']);
});

test('busy catch-up cannot evict the latest unlock evidence before diagnostics export', () => {
 const f = fixture();
 f.journal.record('unlock.total', 12000);
 for (let n = 0; n < 300; n++) f.journal.record('call.status', n);
 f.journal.flush();
 const samples = createLatencyJournal({ storage: f.storage }).snapshot().samples;
 expect(samples).toHaveLength(120);
 expect(samples.filter(s => s.stage === 'unlock.total')).toEqual([
  {stage:'unlock.total', ms:12000, at:101, outcome:'ok'}
 ]);
 expect(samples.at(-1).ms).toBe(299);
 f.journal.clear();
 expect(f.journal.snapshot().samples).toEqual([]);
});
