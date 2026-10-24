// @ts-nocheck
import { expect, test } from 'bun:test';
import { createWorldReader } from './world-reader.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}; };
function fixture(take) {
 const pending=[],shown=[];let active=0,max=0;
 const reader=createWorldReader({read:()=>{active++;max=Math.max(max,active);const d=deferred();pending.push(d);return d.promise.finally(()=>active--)},take:take??(x=>shown.push(x))});
 return {reader,pending,shown,max:()=>max};
}
test('explicit freshness waits for a new snapshot; intervening requests coalesce without overlap',async()=>{
 const f=fixture();const first=f.reader.request();let covered=false;
 const second=f.reader.request().then(()=>covered=true);const third=f.reader.request();
 expect(f.pending.length).toBe(1);f.pending[0].resolve('before mutation');await first;
 expect(covered).toBe(false);expect(f.pending.length).toBe(2);
 f.pending[1].resolve('after mutation');await Promise.all([second,third]);
 expect(f.shown).toEqual(['before mutation','after mutation']);expect(f.max()).toBe(1);
});
test('failed snapshot rejects only its captured waiters and later demand retries',async()=>{
 const f=fixture();const first=f.reader.request();const failure=first.catch(error=>error.message);
 const later=f.reader.request();f.pending[0].reject(Error('offline read'));expect(await failure).toBe('offline read');
 expect(f.pending.length).toBe(2);f.pending[1].resolve('recovered');await later;
 expect(f.shown).toEqual(['recovered']);expect(f.max()).toBe(1);
});
test('a request made during publication is not lost',async()=>{
 let again;const f=fixture(value=>{if(value==='first')again=f.reader.request()});
 const first=f.reader.request();f.pending[0].resolve('first');await first;
 expect(f.pending.length).toBe(2);f.pending[1].resolve('second');await again;expect(f.max()).toBe(1);
});
test('publication refusal rejects the barrier; a new request can recover',async()=>{
 let active=true;const f=fixture(()=>{if(!active)throw Error('owner changed')});
 const first=f.reader.request();const failed=first.catch(error=>error.message);active=false;f.pending[0].resolve('old');expect(await failed).toBe('owner changed');
 active=true;const next=f.reader.request();f.pending[1].resolve('new');await next;expect(f.max()).toBe(1);
});
test('idle later request starts immediately after successful completion',async()=>{
 const f=fixture();const first=f.reader.request();f.pending[0].resolve('one');await first;await tick();
 const next=f.reader.request();expect(f.pending.length).toBe(2);f.pending[1].resolve('two');await next;
});

test('cancel rejects active and pending barriers before an unresponsive read returns',async()=>{
 const f=fixture();const first=f.reader.request(),next=f.reader.request();
 const a=first.catch(error=>error.message),b=next.catch(error=>error.message);
 f.reader.cancel(Error('changed'));expect(await Promise.all([a,b])).toEqual(['changed','changed']);
 await expect(f.reader.request()).rejects.toThrow('changed');
 f.pending[0].resolve('late');await tick();expect(f.shown).toEqual([]);expect(f.pending.length).toBe(1);
});
test('background and explicit requests share one bounded next promise',async()=>{
 const f=fixture();const first=f.reader.request(),next=f.reader.request();
 for(let i=0;i<100;i++)expect(f.reader.request()).toBe(next);
 f.pending[0].resolve('first');await first;f.pending[1].resolve('next');await next;expect(f.max()).toBe(1);
});

test('retirement before the first request never starts underlying work',async()=>{
 const f=fixture();f.reader.cancel(Error('retired before read'));
 await expect(f.reader.request()).rejects.toThrow('retired before read');expect(f.pending).toEqual([]);
});
