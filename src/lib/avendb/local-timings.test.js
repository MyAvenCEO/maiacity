// @ts-nocheck
import { expect, test } from 'bun:test';
import { createLocalTimings, failureClass } from './local-timings.js';
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
test('hidden overlap is separate from wall latency and error contents stay private',async()=>{
 let now=0,hidden=0,done;const recorded=[];
 const tracker=createLocalTimings(()=>now,(...args)=>recorded.push(args),()=>({document:2,elapsedMs:now,hiddenTotalMs:hidden}));
 const pending=tracker.measure('read_file',()=>new Promise(resolve=>done=resolve));
 now=177000;hidden=126889;done({ok:{}});await pending;
 expect(recorded[0][1]).toBe(177000);
 expect(recorded[0][4]).toEqual({document:2,startMs:0,endMs:177000,hiddenMs:126889,visibleMs:50111});
});

test('file and worker errors classify fixed source contexts without copying details',()=>{
 expect(failureClass(new Error('no file this device opens: private entry id'))).toBe('file-not-open');
 expect(failureClass(new Error('incomplete local file index'))).toBe('file-index-incomplete');
 expect(failureClass(Object.assign(new Error('private worker detail'),{worker:true}))).toBe('worker-ended');
 expect(failureClass(new Error('something private unknown'))).toBe('failed');
});
