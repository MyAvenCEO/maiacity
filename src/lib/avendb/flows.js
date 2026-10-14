/**
 * Flows (avenDB's own `flow` schema): the stages an entry can be in, as the steps of a recipe, each saying whether an
 * entry in it is public and which stages it goes on to. An entry is in a stage while it carries the entry tag
 * `<flow>:<stage>`, so moving it swaps one tag. A public stage is one Public share of the entry's vault on that tag,
 * which reaches each entry tagged so, now and later, and lets go of one untagged: idea and draft stay with whoever
 * the vault shares them with, published is everyone's.
 *
 * Functions (avenDB's own `function` schema) react to a move: each names a flow, a stage and whether it runs as an
 * entry enters it or leaves it, and its code, run in QuickJS on the device that moves it (./functions.js), hands back
 * the ops that move makes besides. The device makes them as the acting vault, on the entry's vault alone, so every cap
 * still holds: a function asks, the vault decides.
 *
 * Every app knows the content flow and its two functions by heart (`CONTENT`, `FUNCTIONS`), as it knows avenDB's own
 * schemas, and avenCEO GmbH holds each as an entry of its own. A vault's own flows and functions come first, then
 * avenCEO GmbH's where this device knows it as the person's seed, then the app's: only those, so no one else's code
 * runs on a person's entries.
 */
import { runFunction } from './functions.js';
import { EVERYONE, seeded } from './vaults.js';

/** The types of entries that hold flows, functions and posts. */
export const FLOW = 'flow';
export const FUNCTION = 'function';
export const POST = 'post';

/**
 * @typedef {{ id: number, key: string, name: string, public: boolean, next: string[], x: number, y: number }} Stage
 * @typedef {{ kind: 'flow', key: string, name: string, about: string, types: string[], stages: Stage[],
 *   tags: string[], entry?: string, vault?: string }} Flow
 * @typedef {{ kind: 'function', name: string, about: string, on: 'enter' | 'leave', flow: string, stage: string,
 *   code: string, enabled: boolean, tags: string[], entry?: string, vault?: string }} Fn
 */

/** @type {Flow} the content flow: an idea, a draft, then published on the Maia Universe stream */
export const CONTENT = {
	kind: 'flow',
	key: 'content',
	name: 'Content',
	about:
		'An article from its idea to a draft to published. Idea and draft stay with whoever its vault shares them ' +
		'with; published is public, and goes on the Maia Universe stream.',
	types: ['article'],
	stages: [
		{ id: 1, key: 'idea', name: 'Idea', public: false, next: ['draft'], x: 0, y: 0 },
		{ id: 2, key: 'draft', name: 'Draft', public: false, next: ['idea', 'published'], x: 1, y: 0 },
		{ id: 3, key: 'published', name: 'Published', public: true, next: ['draft'], x: 2, y: 0 }
	],
	tags: []
};

const PUBLISH = `// As an article enters Published: a post about it on the Maia Universe stream. The post carries the stage's
// tag too, so the same Public share reaches it.
export function run(event) {
  if (event.posts.length) return [];
  const { entry, title, text } = event.item;
  const post = { kind: 'post', title, text, channel: 'Devlog', about: entry, tags: [] };
  return [{ op: 'create', type: 'post', tags: [event.tag], value: post }];
}
`;

const UNPUBLISH = `// As an article leaves Published: its posts deleted, and no longer public.
export function run(event) {
  return event.posts.flatMap((post) => [
    { op: 'insert', entry: post, path: ['tags'], value: 'avendb:deleted' },
    { op: 'tag', entry: post, remove: [event.tag] }
  ]);
}
`;

/** @type {Fn[]} the content flow's functions */
export const FUNCTIONS = [
	{
		kind: 'function',
		name: 'Publish to Maia Universe',
		about: 'A post on the Maia Universe stream, as an article is published.',
		on: 'enter',
		flow: 'content',
		stage: 'published',
		code: PUBLISH,
		enabled: true,
		tags: []
	},
	{
		kind: 'function',
		name: 'Take it off Maia Universe',
		about: 'Its posts deleted, as an article goes back from Published.',
		on: 'leave',
		flow: 'content',
		stage: 'published',
		code: UNPUBLISH,
		enabled: true,
		tags: []
	}
];

/** The tag that puts an entry in stage `stage` of flow `flow`. @param {string} flow @param {string} stage */
export const stageTag = (flow, stage) => `${flow}:${stage}`;

/**
 * The stage of flow `flow` entry `e` is in, by its tags: the stage, or `null` where it is in none.
 * @param {{ tags: string[] | null }} e @param {Flow} flow @returns {Stage | null}
 */
export function stageOf(e, flow) {
	const keys = (e.tags ?? []).filter((t) => t.startsWith(`${flow.key}:`)).map((t) => t.slice(flow.key.length + 1));
	return flow.stages.find((s) => keys.includes(s.key)) ?? null;
}

/**
 * The vaults whose flows and functions an entry of vault `vault` follows, besides the app's: its own, then avenCEO
 * GmbH, where this device knows it as the person's seed.
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 */
function trusted(world, vault) {
	const company = seeded(world)[1]?.[0]?.id;
	return company && company !== vault ? [vault, company] : [vault];
}

/**
 * The records of type `type` that vaults `vaults` hold and this device reads, those of the first vault first.
 * @param {import('./vaults.js').WorldView} world @param {string[]} vaults @param {string} type
 */
function held(world, vaults, type) {
	return vaults.flatMap((v) =>
		world.entries
			.filter((e) => e.vault === v && e.type === type && e.kind === 'record' && !e.deleted && e.record)
			.map((e) => ({ ...e.record, entry: e.entry, vault: v }))
	);
}

/**
 * Each of `xs` whose key `key` gives first: a vault's own over avenCEO GmbH's, both over the app's.
 * @template T @param {T[]} xs @param {(x: T) => string} key
 */
function first(xs, key) {
	const seen = new Set();
	return xs.filter((x) => !seen.has(key(x)) && !!seen.add(key(x)));
}

/**
 * The flows an entry of type `type` in vault `vault` can go through.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} type @returns {Flow[]}
 */
export function flowsFor(world, vault, type) {
	const all = /** @type {Flow[]} */ ([...held(world, trusted(world, vault), FLOW), CONTENT]);
	return first(all, (f) => f.key).filter((f) => (f.types ?? []).includes(type) && Array.isArray(f.stages));
}

/**
 * The functions of flow `flow` for entries of vault `vault`.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} flow @returns {Fn[]}
 */
export function functionsOf(world, vault, flow) {
	const all = /** @type {Fn[]} */ ([...held(world, trusted(world, vault), FUNCTION), ...FUNCTIONS]);
	return first(all, (f) => `${f.flow}\n${f.name}`).filter((f) => f.flow === flow);
}

/**
 * The posts about entry `entry` its vault holds, not deleted: their entries.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} entry
 */
export function postsAbout(world, vault, entry) {
	return world.entries
		.filter((e) => e.vault === vault && e.type === POST && !e.deleted && e.record?.about === entry)
		.map((e) => e.entry);
}

/** The tag a `where` picks entries by, where it picks by that one tag alone. @param {any} w @returns {string | null} */
function onlyTag(w) {
	if (!w || typeof w !== 'object') return null;
	if (typeof w.tag === 'string') return w.tag;
	const one = w.all?.length === 1 ? w.all[0] : w.any?.length === 1 ? w.any[0] : null;
	return one ? onlyTag(one) : null;
}

/**
 * The Public share of vault `vault` on the entries tagged `tag`, if it has one.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} tag
 */
export const publicShare = (world, vault, tag) =>
	world.caps.find((c) => c.over === vault && c.grantee === EVERYONE && onlyTag(c.slice?.where) === tag);

/** What a function may ask for: changes of entries, and Public shares. */
const ASKS = ['create', 'set', 'unset', 'insert', 'remove', 'move', 'tag', 'share'];

/**
 * Op `op` a function handed back, as the device makes it: on vault `vault`, as vault `actor`, its `$n` (the entry
 * its own op n created) counted from `base`, the ops before it; or why not: an op it may not ask for, an entry not
 * the one moved, nor one of its posts, nor one it created, or a share that isn't Public.
 * @param {any} op @param {string} vault @param {string} actor @param {string[]} entries @param {number} base
 * @returns {object | string}
 */
function bound(op, vault, actor, entries, base) {
	if (!ASKS.includes(op.op)) return `it may not ask for ${op.op}`;
	/** @param {unknown} x */
	const ref = (x) => (typeof x === 'string' && /^\$\d+$/.test(x) ? `$${base + Number(x.slice(1))}` : x);
	const out = { ...op, as: actor };
	if (op.op === 'create') return { ...out, vault };
	if (op.op === 'share') {
		if (op.who !== EVERYONE || op.level !== 'Public') return 'a share it asks for is Public alone';
		const what = op.what?.entry ? { entry: op.what.entry.map(ref) } : op.what;
		return { ...out, over: vault, what };
	}
	const entry = String(ref(op.entry));
	if (!entries.includes(entry) && !/^\$\d+$/.test(entry)) return 'it changes only the entry it moves, and its posts';
	return { ...out, entry };
}

/**
 * What moving entry `e` to stage `to` of flow `flow` takes, acting for `actor`, in order: the Public share on the
 * stage's tag where the stage is public and its vault gives none yet, the tag swapped, then the ops of each function
 * that runs as it leaves its stage and enters the new one (`$n` the entry the move's op n created, ./ops.js `refs`);
 * and why a function asked for nothing.
 * @param {import('./vaults.js').WorldView} world @param {string} actor
 * @param {import('./vaults.js').EntryView} e @param {Flow} flow @param {string} to
 * @returns {Promise<{ ops: object[], errors: string[] }>}
 */
export async function moving(world, actor, e, flow, to) {
	const [from, stage] = [stageOf(e, flow), flow.stages.find((s) => s.key === to)];
	if (!stage) return { ops: [], errors: [`${flow.name} has no stage ${to}`] };
	/** @type {object[]} */
	const ops = [];
	const tag = stageTag(flow.key, to);
	if (stage.public && !publicShare(world, e.vault, tag)) {
		ops.push({ op: 'share', over: e.vault, who: EVERYONE, level: 'Public', what: { tag }, as: actor });
	}
	const remove = from ? [stageTag(flow.key, from.key)] : [];
	ops.push({ op: 'tag', entry: e.entry, add: [tag], remove, as: actor });
	const posts = postsAbout(world, e.vault, e.entry);
	const item = { entry: e.entry, vault: e.vault, type: e.type, title: e.title, text: e.text, tags: e.tags };
	/** @type {string[]} */
	const errors = [];
	const runs = functionsOf(world, e.vault, flow.key).filter(
		(f) => f.enabled !== false && ((f.on === 'leave' && f.stage === from?.key) || (f.on !== 'leave' && f.stage === to))
	);
	for (const f of runs) {
		const at = f.on === 'leave' ? (from?.key ?? '') : to;
		const event = { on: f.on ?? 'enter', flow: flow.key, stage: at, tag: stageTag(flow.key, at), from: from?.key ?? null, to };
		const { ops: asked, error } = await runFunction(f.code, { ...event, item, posts, now: Math.floor(Date.now() / 1000) });
		if (error) errors.push(`${f.name}: ${error}`);
		const made = asked.map((o) => bound(o, e.vault, actor, [e.entry, ...posts], ops.length));
		const wrong = made.find((o) => typeof o === 'string');
		if (wrong) errors.push(`${f.name}: ${wrong}`);
		else ops.push(.../** @type {object[]} */ (made));
	}
	return { ops, errors };
}
