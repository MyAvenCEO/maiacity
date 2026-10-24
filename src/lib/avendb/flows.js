/**
 * Flows (avenDB's own `flow` schema): the stages an entry can be in, as the steps of a recipe, each saying whether an
 * entry in it is public and which stages it goes on to. An entry is in a stage while it carries the entry tag
 * `<flow>:<stage>`, so moving it swaps one tag. A public stage is one Public share of the entry's vault on that tag,
 * which reaches each entry tagged so, now and later, and lets go of one untagged: idea and draft stay with whoever
 * the vault shares them with, published is everyone's.
 *
 * Functions (avenDB's own `function` schema) react to a move: each names a flow, a stage and whether it runs as an
 * entry enters it or leaves it, and its code, checked by the one checker and run in QuickJS on the device that moves
 * it (./functions.js), hands back the ops that move makes besides. The device makes only those within what a function
 * may ask (`bound`): changes to the entry moved, its posts, its pictures and the entries it creates, and Public shares
 * of those entries by their ids, never of a wider slice; and it makes them as the acting vault, on the entry's vault
 * alone, so every cap still holds: a function asks, the vault decides.
 *
 * Every app knows the content flow and its two functions, and the story flow, by heart (`FLOWS`, `FUNCTIONS`), as it
 * knows avenDB's own schemas, and Maia City, the coop of the seed the person's claim founded, holds each as an entry
 * of its own (./Account.svelte `standardize`). A vault's own flows and functions come first, then Maia City's where
 * this device knows it as the person's seed (./vaults.js `seedCity`), then the app's: only those, so no one else's
 * code runs on a person's entries.
 */
import { fileNamed, pictures } from './article.js';
import { runFunction } from './functions.js';
import { EVERYONE, seedCity } from './vaults.js';

/** The types of entries that hold flows, functions and posts. */
export const FLOW = 'flow';
export const FUNCTION = 'function';
export const POST = 'post';
/** The type of a vault's profile, the entry that names it. */
const PROFILE = 'profile';

/**
 * @typedef {{ id: number, key: string, name: string, public: boolean, next: string[], x: number, y: number }} Stage
 * @typedef {{ kind: 'flow', key: string, name: string, about: string, types: string[], stages: Stage[],
 *   tags: string[], entry?: string, vault?: string }} Flow
 * @typedef {{ kind: 'function', name: string, about: string, on: 'enter' | 'leave', flow: string, stage: string,
 *   code: string, enabled: boolean, tags: string[], engine?: { host: string, version: number }, entry?: string,
 *   vault?: string }} Fn
 */

/** @type {Flow} the content flow: a post's idea, its draft, then published on the Maia Universe stream */
export const CONTENT = {
	kind: 'flow',
	key: 'content',
	name: 'Content',
	about:
		'A post from its idea to a draft to published. Idea and draft stay with whoever its vault shares them ' +
		'with; published is public, and goes on the Maia Universe stream.',
	types: ['post'],
	stages: [
		{ id: 1, key: 'idea', name: 'Idea', public: false, next: ['draft'], x: 0, y: 0 },
		{ id: 2, key: 'draft', name: 'Draft', public: false, next: ['idea', 'published'], x: 1, y: 0 },
		{ id: 3, key: 'published', name: 'Published', public: true, next: ['draft'], x: 2, y: 0 }
	],
	tags: []
};

/** The stages a story goes through, in order: each goes on to the next and back to the one before. */
const STORY_STAGES = /** @type {const} */ ([
	['idea', 'Idea'],
	['hook', 'Hook'],
	['thumbnail', 'Thumbnail'],
	['journey', 'Journey'],
	['writing', 'Writing'],
	['movie', 'Movie'],
	['derivatives', 'Derivatives'],
	['scheduled', 'Scheduled'],
	['published', 'Published']
]);

/**
 * @type {Flow} the story flow: one content piece from its idea to every platform it goes out on. Every stage is
 * private: what goes public is its master post and what it is cut into, not the story, so publishing a story takes
 * the functions the next milestones bring.
 */
export const STORY = {
	kind: 'flow',
	key: 'story',
	name: 'Story',
	about:
		'A story from its idea to every platform it goes out on: its hook, its thumbnail, its journey, its writing, its ' +
		'movie, what it is cut into, when each goes out, and published. Each stage stays with whoever its vault shares ' +
		'it with.',
	types: ['story'],
	stages: STORY_STAGES.map(([key, name], i) => ({
		id: i + 1,
		key,
		name,
		public: false,
		next: [STORY_STAGES[i + 1]?.[0], STORY_STAGES[i - 1]?.[0]].filter((k) => !!k),
		x: i,
		y: 0
	})),
	tags: []
};

/** @type {Flow[]} the flows every app knows by heart */
export const FLOWS = [CONTENT, STORY];

const PUBLISH = `// As a post enters Published: the pictures it shows go public with it. Each carries the stage's tag too, so the
// same Public share reaches it.
export function run(event) {
  return event.pictures.map((entry) => ({ op: 'tag', entry, add: [event.tag] }));
}
`;

const UNPUBLISH = `// As a post leaves Published: the pictures only it shows are no longer public.
export function run(event) {
  return event.pictures.map((entry) => ({ op: 'tag', entry, remove: [event.tag] }));
}
`;

/** @type {Fn[]} the content flow's functions */
export const FUNCTIONS = [
	{
		kind: 'function',
		name: 'Publish to Maia Universe',
		about: 'The pictures a post shows public with it, as it is published on the Maia Universe stream.',
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
		about: 'The pictures only it shows private again, as a post goes back from Published.',
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
 * The vaults whose flows and functions an entry of vault `vault` follows, besides the app's: its own, then Maia City,
 * the coop of the seed the person's claim founded, where this device knows it so (./vaults.js `seedCity`). No other
 * vault's, whatever it names itself.
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 */
function trusted(world, vault) {
	const city = seedCity(world)?.id;
	return city && city !== vault ? [vault, city] : [vault];
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
 * Each of `xs` whose key `key` gives first: a vault's own over Maia City's, both over the app's.
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
	const all = /** @type {Flow[]} */ ([...held(world, trusted(world, vault), FLOW), ...FLOWS]);
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
 * Every function entries of vault `vault` follow, whatever their flow, each with the flow it is wired to where this
 * device knows that flow (`null` where it doesn't, so it never runs).
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 * @returns {(Fn & { wired: Flow | null })[]}
 */
export function everyFunction(world, vault) {
	const vaults = trusted(world, vault);
	const flows = first(/** @type {Flow[]} */ ([...held(world, vaults, FLOW), ...FLOWS]), (f) => f.key);
	const all = /** @type {Fn[]} */ ([...held(world, vaults, FUNCTION), ...FUNCTIONS]);
	return first(all, (f) => `${f.flow}\n${f.name}`).map((f) => ({
		...f,
		wired: flows.find((w) => w.key === f.flow && Array.isArray(w.stages)) ?? null
	}));
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
	world.shares.find((c) => c.over === vault && c.who === EVERYONE && onlyTag(c.slice?.where) === tag);

/**
 * The pictures entry `e`'s text shows from its vault's Library (./article.js), as world `world` shows them: their
 * entries, the cover's first.
 * @param {import('./vaults.js').WorldView} world @param {import('./vaults.js').EntryView} e
 */
export const picturesOf = (world, e) =>
	pictures(e.text ?? '')
		.map((name) => fileNamed(world, e.vault, name))
		.filter(/** @returns {f is import('./vaults.js').EntryView} */ (f) => !!f);

/**
 * The pictures entry `e` shows that everyone may not read yet and that vault `actor` may tag (`picturesOf`): those
 * that go public with it as it is published, which its post shows only then.
 * @param {import('./vaults.js').WorldView} world @param {import('./vaults.js').EntryView} e @param {string} actor
 */
export const privatePictures = (world, e, actor) =>
	picturesOf(world, e).filter((f) => !f.public && (f.writers ?? []).includes(actor));

/**
 * The pictures entry `e` shows that carry tag `tag` and that no other entry tagged so shows, besides the posts:
 * those that go private again as it leaves the stage `tag` puts it in.
 * @param {import('./vaults.js').WorldView} world @param {import('./vaults.js').EntryView} e @param {string} tag
 */
function picturesOnlyIt(world, e, tag) {
	const others = world.entries.filter(
		(x) => x.entry !== e.entry && x.type !== POST && !x.deleted && (x.tags ?? []).includes(tag)
	);
	const shown = new Set(others.flatMap((x) => pictures(x.text ?? '')));
	return picturesOf(world, e).filter((f) => (f.tags ?? []).includes(tag) && !shown.has(f.title ?? ''));
}

/** What a function may ask for: changes of entries, and Public shares of them. */
export const ASKS = ['create', 'set', 'unset', 'insert', 'remove', 'move', 'tag', 'share'];

/**
 * The ops `asked` a function handed back, as the device makes them: on vault `vault`, as vault `actor`, each `$n` in
 * them (the entry its own op n created) counted from `base`, the ops before it; or why not, for the first it may not
 * ask for. A function may create entries in the vault; change and tag the entry moved, its posts and the pictures it
 * was handed (`entries`), and the entries its own ops before created; and share with Everyone, at Public, those same
 * entries by their ids (`what: { entry: [...] }`), and nothing wider: never a tag, a type or the whole vault (a share
 * with no `what`, or `everything`), which would reach entries the move doesn't concern.
 * @param {any[]} asked @param {string} vault @param {string} actor @param {string[]} entries @param {number} base
 * @returns {object[] | string}
 */
function bound(asked, vault, actor, entries, base) {
	/** Entry `x`, which op `i` names, as the device makes it: `$n` counted from `base`; `null` where it may not name it. */
	const reach = (/** @type {unknown} */ x, /** @type {number} */ i) => {
		if (typeof x !== 'string') return null;
		const n = /^\$(\d+)$/.exec(x)?.[1];
		if (n === undefined) return entries.includes(x) ? x : null;
		return Number(n) < i && asked[Number(n)]?.op === 'create' ? `$${base + Number(n)}` : null;
	};
	/** @type {object[]} */
	const made = [];
	for (const [i, op] of asked.entries()) {
		if (!ASKS.includes(op.op)) return `it may not ask for ${op.op}`;
		if (op.op === 'create') {
			// it has no bytes to bring
			if (op.file) return 'it brings no file';
			made.push({ ...op, as: actor, vault });
		} else if (op.op === 'share') {
			if (op.who !== EVERYONE || op.level !== 'Public') return 'a share it asks for is Public alone';
			const ids = op.what?.entry;
			const one = !!op.what && Object.keys(op.what).length === 1 && Array.isArray(ids) && ids.length > 0;
			const named = one ? ids.map((/** @type {unknown} */ x) => reach(x, i)) : [];
			if (!one || named.includes(null)) {
				return 'a share it asks for is on the entry it moves, its posts, its pictures or the entries it created, by their ids';
			}
			made.push({ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { entry: named }, as: actor });
		} else {
			const entry = reach(op.entry, i);
			if (entry === null) return 'it changes only the entry it moves, its posts, its pictures and the entries it created';
			made.push({ ...op, as: actor, entry });
		}
	}
	return made;
}

/**
 * Vault `vault`'s profile, the entry that names it, as the device reads it: its first entry of type `profile` it wrote
 * itself (avendb's `world::profile_of`).
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 */
const profileOf = (world, vault) =>
	world.entries.find((x) => x.vault === vault && x.type === PROFILE && x.by === vault);

/**
 * What moving entry `e` to stage `to` of flow `flow` takes, acting for `actor`, in order: where the stage is public,
 * the Public share on its tag where its vault gives none yet, and one on its vault's profile where that isn't public
 * yet, so that everyone reads who published it (the Maia Universe names each post's vault by it); the tag swapped,
 * then the ops of each function that runs as it leaves its stage and enters the new one (`$n` the entry the move's op
 * n created, ./ops.js `refs`); and why a function asked for nothing. Each function is handed the pictures the move
 * concerns (`pictures`, their entries): as it enters a public stage, those it shows that are private yet, where
 * `withPictures`, for them to go public with it; as it leaves one, those carrying its tag that only it shows.
 * @param {import('./vaults.js').WorldView} world @param {string} actor
 * @param {import('./vaults.js').EntryView} e @param {Flow} flow @param {string} to @param {boolean} [withPictures]
 * @returns {Promise<{ ops: object[], errors: string[] }>}
 */
export async function moving(world, actor, e, flow, to, withPictures = true) {
	const [from, stage] = [stageOf(e, flow), flow.stages.find((s) => s.key === to)];
	if (!stage) return { ops: [], errors: [`${flow.name} has no stage ${to}`] };
	if (from && from.key !== to && !from.next.includes(to)) return { ops: [], errors: [`${flow.name} cannot move from ${from.key} to ${to}`] };
	/** @type {object[]} */
	const ops = [];
	const tag = stageTag(flow.key, to);
	if (stage.public && !publicShare(world, e.vault, tag)) {
		ops.push({ op: 'share', over: e.vault, who: EVERYONE, level: 'Public', what: { tag }, as: actor });
	}
	const profile = stage.public ? profileOf(world, e.vault) : undefined;
	if (profile && !profile.public) {
		const what = { entry: [profile.entry] };
		ops.push({ op: 'share', over: e.vault, who: EVERYONE, level: 'Public', what, as: actor });
	}
	const remove = from ? [stageTag(flow.key, from.key)] : [];
	ops.push({ op: 'tag', entry: e.entry, add: [tag], remove, as: actor });
	const posts = postsAbout(world, e.vault, e.entry);
	const item = { entry: e.entry, vault: e.vault, type: e.type, title: e.title, text: e.text, tags: e.tags };
	const [going, leaving] = [
		stage.public && withPictures ? privatePictures(world, e, actor).map((f) => f.entry) : [],
		from?.public ? picturesOnlyIt(world, e, stageTag(flow.key, from.key)).map((f) => f.entry) : []
	];
	/** @type {string[]} */
	const errors = [];
	const runs = functionsOf(world, e.vault, flow.key).filter(
		(f) => f.enabled !== false && ((f.on === 'leave' && f.stage === from?.key) || (f.on !== 'leave' && f.stage === to))
	);
	for (const f of runs) {
		const at = f.on === 'leave' ? (from?.key ?? '') : to;
		const event = { on: f.on ?? 'enter', flow: flow.key, stage: at, tag: stageTag(flow.key, at), from: from?.key ?? null, to };
		const pictures = f.on === 'leave' ? leaving : going;
		const now = Math.floor(Date.now() / 1000);
		const { ops: asked, error } = await runFunction(f.code, { ...event, item, posts, pictures, now }, f.engine);
		if (error) errors.push(`${f.name}: ${error}`);
		const made = bound(asked, e.vault, actor, [e.entry, ...posts, ...pictures], ops.length);
		if (typeof made === 'string') errors.push(`${f.name}: ${made}`);
		else ops.push(...made);
	}
	if (errors.length) return { ops: [], errors };
	if (e.type === POST && stage.public && !e.record?.published) {
		ops.push({ op: 'set', entry: e.entry, path: ['published'], value: new Date().toISOString().slice(0, 10), as: actor });
	}
	return { ops, errors };
}
