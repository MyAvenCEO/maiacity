// @ts-nocheck — plain JS
import { completeQuery } from '../../../game/code/sources/query-continuation.js';
import { answer } from '../avendb/ops.js';
/**
 * Chat rooms on avenDB (avendb/docs/ARCHITECTURE.md §8, "Rooms"; plan /mnt/project-files/chat-rooms/plan.md): a room
 * is an entry of type `room` (Room, v1), a channel, a group, a DM or a note to self; its messages are rows, each with
 * its thread of replies and its reactions. Who may read it is its shares, never a stored list: its members hold
 * Member on that one entry, and the room's header names every vault that reads it, the aven and its server among
 * them where they do (Samuel 2026-10-19: "show readers"). Who wrote a row is read off the room's signed history by the
 * device (the `room` read's `by`), never typed into the row. This file holds no rule: every change is one op the
 * device runs and judges, as every reader will.
 */

/** How the app shows a room, by its `look`. */
export const LOOKS = {
	channel: 'Channel',
	group: 'Group',
	dm: 'Direct message',
	self: 'Note to self'
};

/** The tag a deleted room carries among the entry's own tags (avenDB's deleted tag: taking it out brings it back). */
export const GONE = 'avendb:deleted';

/** The op that deletes room `room`, acting for `actor`: gone from every reader's list, its signed history kept. */
export const deletingRoom = (room, actor) => ({ op: 'tag', entry: room, add: [GONE], as: actor });

/** The longest message, as Room, v1 holds it. */
export const MAX_TEXT = 8000;

/** A new row's id: random, 53 bits, so two people posting at once never share one. */
export const rowId = () => 1 + Math.floor(Math.random() * (Number.MAX_SAFE_INTEGER - 1));

/**
 * The rooms of world `world` the person reads: each entry of type room, newest first.
 * @param {import('$lib/avendb/vaults.js').WorldView} world
 */
export function roomsOf(world) {
	return (world?.entries ?? []).filter((e) => e.type === 'room' && !e.deleted && !(e.tags ?? []).includes(GONE)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

/**
 * The vault the person acts as in vault `vault`, as the device says: the vault itself where theirs owns it, else the
 * vault of theirs holding the share over it.
 * @param {import('$lib/avendb/vaults.js').WorldView} world @param {string} vault
 */
export const actorIn = (world, vault) => world?.vaults.find((v) => v.id === vault)?.acting?.as ?? world?.mine;

/** The people the person may start a DM or a group with: every human vault and aven the device knows but theirs. */
export function people(world) {
	return (world?.vaults ?? []).filter((v) => v.id !== world.mine && (v.kind === 'human' || v.kind === 'aven'));
}

/** The vaults the person may make a channel in: those they act for, their own human vault aside (a DM's place). */
export function channelVaults(world) {
	return (world?.vaults ?? []).filter((v) => v.id !== world.mine && v.acting?.as === v.id && v.kind === 'coop');
}

/**
 * The ops that make a room in vault `vault`, acting for `actor`, shown as `look`, named `name`, about `topic`, and
 * share it with each of `members` at Member, that one room alone (`"$0"`, the room the first op made).
 * @param {{ vault: string, actor: string, look: keyof LOOKS, name?: string, topic?: string, members?: string[] }} o
 */
export function making({ vault, actor, look, name = '', topic = '', members = [] }) {
	const value = { kind: 'room', look, name, topic };
	return [
		{ op: 'create', vault, type: 'room', tags: [], value, as: actor },
		...members.map((who) => ({ op: 'share', over: vault, who: { vault: who }, level: 'Member', what: { entry: ['$0'] }, as: actor }))
	];
}

/** The op that adds `who` to room `room` of vault `vault` as a member. */
export const adding = (vault, room, who, actor) => ({
	op: 'share',
	over: vault,
	who: { vault: who },
	level: 'Member',
	what: { entry: [room] },
	as: actor
});

/** The vaults mentioned in `text` (`@Name`), of the people `known` ({id, name}). */
export function mentionsIn(text, known) {
	const out = [];
	for (const p of known) if (p.name && text.includes(`@${p.name}`) && !out.includes(p.id)) out.push(p.id);
	return out;
}

/**
 * The op that posts `text` in room `room`, acting for `actor`: a new message, or a reply in the thread of message
 * `thread`, mentioning `mentions`.
 * @param {{ room: string, actor: string, text: string, thread?: number | null, reply?: number | null, mentions?: string[], at?: number, id?: number }} o
 */
export function posting({ room, actor, text, thread = null, reply = null, mentions = [], at = Date.now(), id = rowId() }) {
	const path = thread == null ? ['messages'] : ['messages', { id: thread }, 'thread'];
	const value = { id, text: text.slice(0, MAX_TEXT), at, mentions };
	if (reply != null) value.reply = reply;
	return { op: 'insert', entry: room, path, value, as: actor };
}

/** The path of message `id`, or of reply `id` in the thread of message `thread`. */
export const pathOf = (id, thread = null) => (thread == null ? ['messages', { id }] : ['messages', { id: thread }, 'thread', { id }]);

/** The ops that change the text of the message at `path` to `text`. */
export const editing = (room, actor, path, text, at = Date.now()) => [
	{ op: 'set', entry: room, path: [...path, 'text'], value: text.slice(0, MAX_TEXT), as: actor },
	{ op: 'set', entry: room, path: [...path, 'edited'], value: at, as: actor }
];

/** The ops that delete the message at `path`: it says it was deleted, its text gone, its thread kept. */
export const deleting = (room, actor, path) => [
	{ op: 'set', entry: room, path: [...path, 'deleted'], value: true, as: actor },
	{ op: 'set', entry: room, path: [...path, 'text'], value: '', as: actor }
];

/** The op that reacts with `key` to the message at `path`. */
export const reacting = (room, actor, path, key, id = rowId()) => ({
	op: 'insert',
	entry: room,
	path: [...path, 'reactions'],
	value: { id, key },
	as: actor
});

/** The op that takes back reaction `id` of the message at `path`. */
export const unreacting = (room, actor, path, id) => ({
	op: 'set',
	entry: room,
	path: [...path, 'reactions', { id }, 'deleted'],
	value: true,
	as: actor
});

/**
 * The reactions of message `m` as the app shows them: one chip per emoji, with how many and who, and the person's own
 * reaction of that emoji, if any (to take it back).
 * @param {any} m @param {string} me the person's vault
 */
export function chips(m, me) {
	/** @type {Map<string, { key: string, count: number, who: string[], mine: number | null }>} */
	const by = new Map();
	for (const r of m?.reactions ?? []) {
		if (r.deleted) continue;
		const chip = by.get(r.key) ?? { key: r.key, count: 0, who: [], mine: null };
		chip.count++;
		const v = r.by?.vault;
		if (v && !chip.who.includes(v)) chip.who.push(v);
		if (v === me) chip.mine = r.id;
		by.set(r.key, chip);
	}
	return [...by.values()];
}

/**
 * Messages `ms` grouped as Slack groups them: a day divider where the day changes, and a run of messages by one person
 * within five minutes shown under one name.
 * @param {any[]} ms
 */
export function grouped(ms) {
	const out = [];
	let last = null;
	for (const m of ms) {
		const day = m.at ? new Date(m.at).toDateString() : last?.day ?? '';
		const who = m.by?.vault ?? null;
		const near = last && last.who === who && last.day === day && m.at && last.at && m.at - last.at < 5 * 60 * 1000;
		out.push({ m, day, dayStart: !last || last.day !== day, head: !near });
		last = { who, day, at: m.at };
	}
	return out;
}

/** The room's name as the person reads it: its name, a DM's other person's, or what it is. */
export function titleOf(room, record, world, nameOf) {
	if (record?.look === 'self') return 'Note to self';
	if (record?.name) return record.look === 'channel' ? `# ${record.name}` : record.name;
	const others = (room?.readers ?? []).filter((v) => v !== world?.mine && v !== room.vault);
	const people = (others.length ? others : room?.readers ?? []).filter((v) => v !== world?.mine);
	const byId = new Map((world?.vaults ?? []).map((v) => [v.id, v]));
	const names = people.map((v) => nameOf(byId.get(v))).filter(Boolean);
	return names.length ? names.join(', ') : LOOKS[record?.look] ?? 'Room';
}

/** Where the person last read each room, on this device alone (M4 syncs it): `{ [room]: count }`. */
const SEEN = 'maiacity:chat:seen';

export function seenAll() {
	try {
		return JSON.parse(localStorage.getItem(SEEN) ?? '{}') ?? {};
	} catch {
		return {};
	}
}

/** Room `room` read up to its `n`th message. */
export function markSeen(room, n) {
	try {
		const all = seenAll();
		if (all[room] === n) return;
		all[room] = n;
		localStorage.setItem(SEEN, JSON.stringify(all));
	} catch {
		/* a private window keeps nothing */
	}
}

/** A message being written in a room, kept on this device until it is sent. */
const DRAFT = 'maiacity:chat:draft:';

export function draftOf(room) {
	try {
		return localStorage.getItem(DRAFT + room) ?? '';
	} catch {
		return '';
	}
}

export function keepDraft(room, text) {
	try {
		if (text) localStorage.setItem(DRAFT + room, text);
		else localStorage.removeItem(DRAFT + room);
	} catch {
		/* nothing kept */
	}
}

/** A message's time as the timeline shows it: the hour and minute. */
export const clock = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

/** A day divider's words: Today, Yesterday, or the date. */
export function dayWords(at) {
	if (!at) return '';
	const d = new Date(at);
	const today = new Date();
	const y = new Date(today);
	y.setDate(today.getDate() - 1);
	if (d.toDateString() === today.toDateString()) return 'Today';
	if (d.toDateString() === y.toDateString()) return 'Yesterday';
	return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Search canonical local DMs across all pages, independently of the displayed sidebar.
 * A refused/cancelled read never proves absence. The caller owns and closes its read window. */
export async function directRoom(read, who) {
 for (let offset = 0; ; ) {
  const page = answer(await completeQuery(() => read({ op: 'query', where: { all: [
   { type: ['room'] }, { path: ['look'], eq: 'dm' }, { not: { tag: GONE } }
  ] }, select: [], order: [['created', 'desc']], offset, limit: 50 })));
  if (!page || page.countExact === false || page.pageComplete === false || !Array.isArray(page.rows) || !Number.isSafeInteger(page.count)) throw Error('Room lookup did not complete. Please try again.');
  if (page.rows.length) {
   const metadata = answer(await read({ op: 'entry_views', entries: page.rows.map(r => r.entry), types: ['room'] }));
   if (!metadata || !Array.isArray(metadata.rows)) throw Error('Room lookup did not complete. Please try again.');
   const rows = roomsOf({ entries: metadata.rows });
   if (rows.length !== page.rows.length || page.rows.some(r => !rows.some(m => m.entry === r.entry && m.record?.look === 'dm')))
    throw Error('Room access changed during lookup. Please try again.');
   const found = rows.find(r => r.record?.look === 'dm' && (r.readers ?? []).includes(who));
   if (found) return found.entry;
  }
  offset += page.rows.length;
  if (offset >= page.count) return null;
  if (!page.rows.length) throw Error('Room lookup changed. Please try again.');
 }
}
