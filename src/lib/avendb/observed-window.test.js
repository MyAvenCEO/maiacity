// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { observedWindow } from './observed-window.js';
import { queryEntries } from './query-window.js';
// an Interest op seen as the one list of entries and selectors it wants (tiers aside)
const flat = (op) => op?.op !== 'interest' ? op : { ...op, entries: (op.wants ?? []).flatMap((w) => w.entries ?? []), queries: op.wants?.length ? op.wants.flatMap((w) => w.queries ?? []) : undefined };
const id = n => n.toString(16).padStart(64,'0');
const flush = async () => { for(let i=0;i<12;i++)await Promise.resolve(); };
test('explicit selected IDs demand history before an empty local result, with bounded hints', () => {
 expect(queryEntries({entries:[id(1),id(2),id(1),'bad']})).toEqual([id(1),id(2)]);
 expect(queryEntries({entries:Array.from({length:600},(_,i)=>id(i))})).toHaveLength(512);
});
test('observed revisions reuse a lease; abort clears it and suppresses late data', async () => {
 const calls=[], owner={run:async op=>{calls.push(flat(op));return {ok:{accepted:true}};}};
 let resolve;
 const read=observedWindow(async()=>new Promise(r=>resolve=r));
 const scope=new AbortController();
 const first=read(owner,{op:'entry_views',entries:[id(1)]},scope.signal);
 await flush(); expect(calls[0].entries).toEqual([id(1)]);
 resolve({ok:{rows:[]}});await first;
 const second=read(owner,{op:'note',entry:id(1)},scope.signal);
 await flush();expect(new Set(calls.map(c=>c.scope)).size).toBe(1);
 scope.abort();resolve({ok:{entry:id(1)}});
 expect(await second).toBeNull();await flush();expect(calls.at(-1).entries).toEqual([]);
 const replacement=new AbortController();
 const next=read(owner,{op:'note',entry:id(2)},replacement.signal);
 await flush();expect(calls.at(-1).scope).not.toBe(calls[0].scope);
 resolve({ok:null});await next;replacement.abort();
});
