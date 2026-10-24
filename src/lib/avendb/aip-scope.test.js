import { expect, test } from 'bun:test';
import { createAipScope } from './aip-scope.js';
import { createReactiveRead } from './reactive-read.js';
import { observedWindow } from './observed-window.js';
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };

test('mounted AIP consumers share a real discovery lease, released only by the last consumer', async () => {
	const calls=[], reads=[], answers=[];
	const owner={run:async op=>{calls.push(op);return {ok:{accepted:true}};}};
	let starts=0, stops=0;
	const scope=createAipScope({
		observe(query,take,failed) {
			starts++;
			const reader=createReactiveRead({read:observedWindow(async (_owner,op)=>{reads.push(op);return {ok:[]};}),take,failed,timing:()=>()=>{}});
			reader.update(query(),owner);
			return ()=>{stops++;reader.close();};
		}, query:()=>({op:'aips'}),take:out=>answers.push(out),failed:()=>{},reset:()=>{}
	});
	const first=scope.hold(), second=scope.hold(); await flush();
	expect(starts).toBe(1); expect(reads).toEqual([{op:'aips'}]); expect(answers).toEqual([{ok:[]}]);
	expect(calls[0].queries).toEqual([{types:['aip','review']}]);
	first(); first(); await flush(); expect(stops).toBe(0);
	second(); await flush(); expect(stops).toBe(1);
	expect(calls.at(-1).entries).toEqual([]); expect(calls.at(-1).queries).toBeUndefined();
});

test('closed generations cannot overwrite a replacement consumer', () => {
	const callbacks=[], seen=[]; let resets=0;
	const scope=createAipScope({observe:(_q,take)=>{callbacks.push(take);return ()=>{};},query:()=>({op:'aips'}),take:v=>seen.push(v),failed:()=>{},reset:()=>resets++});
	const first=scope.hold(); first(); const next=scope.hold();
	callbacks[0]('old'); callbacks[1]('current'); expect(seen).toEqual(['current']);
	next(); callbacks[1]('late'); expect(seen).toEqual(['current']); expect(resets).toBe(4);
});

test('HITL-only mounting reads AIPs and retains its lease after a proposals view leaves', async () => {
	let live=0, reads=0;
	const scope=createAipScope({observe:(_q,take)=>{live++;reads++;take({ok:[]});return ()=>live--;}, query:()=>({op:'aips'}), take:()=>{},failed:()=>{},reset:()=>{}});
	const hitl=scope.hold(); expect(reads).toBe(1); expect(live).toBe(1);
	const proposals=scope.hold(); proposals(); expect(live).toBe(1); expect(reads).toBe(1);
	hitl(); expect(live).toBe(0);
	// Guard the actual consumer wiring that previously omitted this lifetime.
	const source=await Bun.file(new URL('./Hitl.svelte',import.meta.url)).text();
	expect(source).toContain('onMount(() => held.hold())');
	expect(source).not.toContain('held.again()');
});
