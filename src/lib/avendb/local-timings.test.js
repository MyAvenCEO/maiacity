// @ts-nocheck
import { expect, test } from 'bun:test';
import { createLocalTimings } from './local-timings.js';
test('pending latency is visible; completion and failures retain bounded samples', async () => {
 let time = 0, finish;
 const meter = createLocalTimings(() => time);
 const pending = meter.measure('read_file', () => new Promise(resolve => finish = resolve));
 time = 1200;
 expect(meter.snapshot()[0].waiting).toBe(1200);
 finish('bytes'); await pending;
 expect(meter.snapshot()[0].p95).toBe(1200);
 expect(meter.snapshot()[0].pending).toBe(0);
 await expect(meter.measure('world', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
 expect(meter.snapshot()[1].failed).toBe(1);
 for (let i = 0; i < 110; i++) await meter.measure('world', async () => ++time);
 expect(meter.snapshot()[1].count).toBe(100);
 await meter.measure('secret-entry-id', async () => 1);
 expect(meter.snapshot().length).toBe(2);
});
