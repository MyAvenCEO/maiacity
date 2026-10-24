// @ts-nocheck — plain JS
// The ops the chat sends and how it shows a room (./rooms.js): a room made and shared at Member on itself alone,
// messages and thread replies as rows, edits and deletes of a row's own fields, reactions as chips per emoji.
// Run: bun test src/lib/chat/rooms.test.js
import { expect, test } from 'bun:test';
import { directRoom, chips, deleting, deletingRoom, editing, grouped, making, mentionsIn, pathOf, posting, reacting, roomsOf, titleOf, unreacting } from './rooms.js';

test('a room is made, then shared at Member on that one room', () => {
	const ops = making({ vault: 'me', actor: 'me', look: 'group', name: 'Garden', members: ['bob', 'carol'] });
	expect(ops[0]).toEqual({ op: 'create', vault: 'me', type: 'room', tags: [], value: { kind: 'room', look: 'group', name: 'Garden', topic: '' }, as: 'me' });
	expect(ops.slice(1).map((o) => [o.who.vault, o.level, o.what])).toEqual([
		['bob', 'Member', { entry: ['$0'] }],
		['carol', 'Member', { entry: ['$0'] }]
	]);
});

test('a message is a row under messages, a reply a row in its thread', () => {
	const m = posting({ room: 'r', actor: 'me', text: 'hi', id: 7, at: 1 });
	expect([m.op, m.path, m.value]).toEqual(['insert', ['messages'], { id: 7, text: 'hi', at: 1, mentions: [] }]);
	const r = posting({ room: 'r', actor: 'me', text: 'yes', thread: 7, id: 8, at: 2 });
	expect(r.path).toEqual(['messages', { id: 7 }, 'thread']);
	expect(pathOf(8, 7)).toEqual(['messages', { id: 7 }, 'thread', { id: 8 }]);
});

test('edits, deletes and reactions touch only the row’s own fields', () => {
	const p = pathOf(7);
	expect(editing('r', 'me', p, 'new', 5).map((o) => o.path)).toEqual([[...p, 'text'], [...p, 'edited']]);
	expect(deleting('r', 'me', p).map((o) => [o.path.at(-1), o.value])).toEqual([['deleted', true], ['text', '']]);
	expect(reacting('r', 'me', p, '👍', 9).value).toEqual({ id: 9, key: '👍' });
	expect(unreacting('r', 'me', p, 9).path).toEqual([...p, 'reactions', { id: 9 }, 'deleted']);
});

test('reactions show as one chip per emoji, taken-back ones left out', () => {
	const m = { reactions: [
		{ id: 1, key: '👍', by: { vault: 'bob' } },
		{ id: 2, key: '👍', by: { vault: 'me' } },
		{ id: 3, key: '🎉', by: { vault: 'me' }, deleted: true }
	] };
	expect(chips(m, 'me')).toEqual([{ key: '👍', count: 2, who: ['bob', 'me'], mine: 2 }]);
});

test('a run of one person’s messages shows under one name, a new day under a divider', () => {
	const day = Date.UTC(2026, 9, 20, 10);
	const ms = [
		{ id: 1, at: day, by: { vault: 'a' } },
		{ id: 2, at: day + 60_000, by: { vault: 'a' } },
		{ id: 3, at: day + 120_000, by: { vault: 'b' } },
		{ id: 4, at: day + 86_400_000, by: { vault: 'b' } }
	];
	expect(grouped(ms).map((l) => [l.head, l.dayStart])).toEqual([[true, true], [false, false], [true, false], [true, true]]);
});

test('mentions are the people named with @, and a DM is named by the other person', () => {
	expect(mentionsIn('hi @Bob and @Carol', [{ id: 'b', name: 'Bob' }, { id: 'c', name: 'Carol' }, { id: 'd', name: 'Dave' }])).toEqual(['b', 'c']);
	const world = { mine: 'me', vaults: [{ id: 'me', name: 'Alice' }, { id: 'bob', name: 'Bob' }] };
	expect(titleOf({ vault: 'me', readers: ['me', 'bob'] }, { look: 'dm', name: '' }, world, (v) => v?.name)).toBe('Bob');
	expect(titleOf({ vault: 'me', readers: ['me'] }, { look: 'channel', name: 'general' }, world, (v) => v?.name)).toBe('# general');
});

test('a room tagged deleted is left out, and deleting one tags it so', () => {
	const world = { entries: [{ entry: 'a', type: 'room', tags: ['avendb:deleted'], created: 2 }, { entry: 'b', type: 'room', tags: [], created: 1 }] };
	expect(roomsOf(world).map((r) => r.entry)).toEqual(['b']);
	expect(deletingRoom('a', 'V')).toEqual({ op: 'tag', entry: 'a', add: ['avendb:deleted'], as: 'V' });
});

test('an unnamed room has an honest fallback before vault names arrive', () => {
 expect(titleOf({vault:'v',readers:['v','other']},{look:'dm'},null,v=>v?.name??'')).toBe('Direct message');
});


test('DM reuse searches beyond the displayed page and never treats refusal as absence', async () => {
 const ids=Array.from({length:51},(_,i)=>i.toString(16).padStart(64,'0'));
 const ops=[];
 const found=await directRoom(async op=>{
  ops.push(op);
  if(op.op==='query')return {ok:{rows:ids.slice(op.offset,op.offset+op.limit).map(entry=>({entry})),count:ids.length}};
  return {ok:{rows:op.entries.map(entry=>({entry,type:'room',readers:[entry===ids[50]?'target':'other'],record:{look:'dm'}}))}};
 },'target');
 expect(found).toBe(ids[50]);
 expect(ops.filter(op=>op.op==='query').map(op=>op.offset)).toEqual([0,50]);
 await expect(directRoom(async()=>({refused:'NoCap',why:'NoCap'}),'target')).rejects.toThrow();
 await expect(directRoom(async()=>null,'target')).rejects.toThrow();
 expect(await directRoom(async()=>({ok:{rows:[],count:0}}),'target')).toBe(null);
});


test('a DM whose metadata disappears during lookup does not establish absence', async () => {
 await expect(directRoom(async op=>op.op==='query'
  ? {ok:{rows:[{entry:'a'.repeat(64)}],count:1}}
  : {ok:{rows:[]}},'target')).rejects.toThrow('Room access changed');
});
