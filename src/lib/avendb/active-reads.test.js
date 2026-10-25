// @ts-nocheck — Bun test fixture
import { test, expect } from 'bun:test';
import { activeRead, watchActiveReads } from './active-reads.js';
test('mounted read status does not retain old views after cancel or close', () => {
 let state; const stop = watchActiveReads(value => state = value);
 const a = activeRead(), b = activeRead();
 a.set('pending'); b.set('local');
 expect(state).toEqual({ total: 2, pending: 1, local: 1 });
 a.set('local'); expect(state.pending).toBe(0);
 a.clear(); b.clear(); expect(state).toEqual({ total: 0, pending: 0, local: 0 }); stop();
});
