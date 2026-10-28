// @ts-nocheck
import { expect, test } from 'bun:test';
import { createLocalFileReads } from './local-file-read.js';
const tick = async () => { for(let n=0;n<8;n++) await Promise.resolve(); };
function fixture() {
 let allocations = 0, next = 0;
 const timers = new Map(), calls = [];
 const read = createLocalFileReads({ window: 2, allocate: n => { allocations++; return new Uint8Array(n); }, setTimer: f => { const id=++next;timers.set(id,f);return id; }, clearTimer: id => timers.delete(id) });
 const device = { run: op => new Promise((resolve,reject) => calls.push({ op, resolve,reject })) };
 return { read, device, calls, timers, allocations: () => allocations, timeout: id => timers.get(id)() };
}
const file = { root: 'verified-root', size: 5, len: 4 };
test('timed-out whole read stops and repeated retries cannot allocate behind its held chunk', async () => {
 const f=fixture();const first=f.read(f.device,file,10);await tick();
 expect(f.allocations()).toBe(1);expect(f.calls.length).toBe(1);
 f.timeout(1);expect(await first).toBeNull();
 for(let n=0;n<20;n++) expect(await f.read(f.device,file,10)).toBeNull();
 expect(f.allocations()).toBe(1);
 f.calls[0].resolve({bytes:new Uint8Array([1,2])});await tick();
 expect(f.calls.length).toBe(1);
 const retry=f.read(f.device,file,10);await tick();expect(f.allocations()).toBe(2);
 f.calls[1].resolve({bytes:new Uint8Array([1,2])});await tick();f.calls[2].resolve({bytes:new Uint8Array([3,4])});
 expect(await retry).toEqual(new Uint8Array([1,2,3,4]));
});
test('one caller deadline does not cancel another subscriber or duplicate buffers', async () => {
 const f=fixture();const a=f.read(f.device,file,10),b=f.read(f.device,file,20);await tick();
 f.timeout(1);expect(await a).toBeNull();expect(f.allocations()).toBe(1);
 f.calls[0].resolve({bytes:new Uint8Array([1,2])});await tick();f.calls[1].resolve({bytes:new Uint8Array([3,4])});
 expect(await b).toEqual(new Uint8Array([1,2,3,4]));expect(f.timers.size).toBe(0);
 expect(f.calls.map(c=>c.op)).toEqual([{op:'read_file',root:file.root,size:5,from:0,to:2,local:true},{op:'read_file',root:file.root,size:5,from:2,to:4,local:true}]);
});
test('device identity isolates flights and malformed or refused ranges never publish', async () => {
 const f=fixture();const a=f.read(f.device,file,10);const other={run:async()=>({refused:'Unread'})};
 expect(await f.read(other,file,10)).toBeNull();await tick();
 f.calls[0].resolve({bytes:new Uint8Array([1,2,3])});expect(await a).toBeNull();
 expect(await f.read(f.device,{...file,len:-1},10)).toBeNull();
 expect(await f.read(f.device,{...file,size:Infinity},10)).toBeNull();
});
test('failed worker read releases flight and contains rejection', async () => {
 const f=fixture();const a=f.read(f.device,file,10);await tick();f.calls[0].reject(Error('worker gone'));
 expect(await a).toBeNull();await tick();
 const b=f.read(f.device,file,10);await tick();expect(f.allocations()).toBe(2);f.timeout(2);expect(await b).toBeNull();f.calls[1].resolve({bytes:new Uint8Array([1,2])});await tick();
});

test('a consumer immediate reread cannot join an already-settled flight', async () => {
 const f=fixture();const small={...file,len:2};
 const first=f.read(f.device,small,10);
 const again=first.then(() => f.read(f.device,small,10));
 await tick();f.calls[0].resolve({bytes:new Uint8Array([1,2])});await tick();
 expect(f.calls.length).toBe(2);expect(f.allocations()).toBe(2);
 f.calls[1].resolve({bytes:new Uint8Array([3,4])});expect(await again).toEqual(new Uint8Array([3,4]));
});
