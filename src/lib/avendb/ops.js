// avenDB's ops as the page writes them (avendb/docs/ARCHITECTURE.md §8, avendb's `engine`): every read
// and every change of the database is one JSON op, whatever its schema, which the device runs (`run(op)`, in this
// page's WebAssembly or in the Mac app's device alike) and answers `{ ok }`, `{ refused, why }`, or for a change its
// vault's owners approve that runs without the passkey's ceremony, `{ approve }`. A change acts for the vault it names
// (`as`), and the rules judge it as they judge any peer's edit; the page only asks beforehand, with `may`.

import { why } from './vaults.js';

/** The ops that only read: they run on what the device holds, change nothing, and take no ceremony. */
export const READS = [
	'read_guard',
	'entry_views',
	'query',
	'get',
	'history',
	'schemas',
	'groups',
	'kinds',
	'world',
	'world_summary',
	'jobs',
	'shares',
	'database',
	'note',
	'room',
	'log',
	'read_file',
	'creatable',
	'taggable',
	'limits',
	'perf',
	'requests',
	'aips',
	'aip',
	'objective_check',
	'may',
	'cap_groups',
	'code',
	'bring',
	'demand',
	'synced',
	'network',
	'api_pass'
];

/** Whether op `op` only reads. @param {any} op */
export const reads = (op) => READS.includes(op?.op);

/** The changes that act for a vault the op names (`as`); the rest act for their vault, or the device's own. */
const ACTING = [
	'create',
	'set',
	'unset',
	'insert',
	'remove',
	'move',
	'tag',
	'propose',
	'merge',
	'review',
	'aip_open',
	'aip_objective',
	'aip_measure',
	'aip_promote',
	'aip_withdraw',
	'aip_review',
	'restore',
	'undo',
	'variant',
	'batch',
	'share',
	'share_group',
	'keep',
	'revoke',
	'put_file',
	'ask'
];

/** Whether change op `op` takes the vault it acts for (`as`). @param {any} op */
export const acts = (op) => ACTING.includes(op?.op);

/**
 * Whether op `op` brings a file, its bytes handed over beside it (avendb's `engine::brings`): a `put_file`, or a
 * `create` whose entry and its file are one edit (`file: { len, name?, media? }`).
 * @param {any} op
 */
export const brings = (op) => op?.op === 'put_file' || (op?.op === 'create' && !!op.file);

/**
 * What an op did, from the device's answer; a refusal throws, in the page's words where it has them, and for a batch,
 * which op it stopped at.
 * @param {any} out
 */
export function answer(out) {
	if (out && 'ok' in out) return out.ok;
	if (out && 'approve' in out) throw new Error('Refused: it needs the approval of the vault’s owners.');
	const at = typeof out?.at === 'number' ? ` (op ${out.at + 1} of the batch)` : '';
	throw new Error(`Refused${at}: ${why(out)}.`);
}

/**
 * Op `op` of a list run one after another, each `"$n"` in it the entry op n of the list created, by the answers of
 * those before it, `done` (as a flow's move names the post its function creates, ./flows.js), and each `"$n.line"` the
 * line it started (a proposal's or a variant's).
 * @param {any} op @param {any[]} done @returns {any}
 */
export function refs(op, done) {
	const ref = typeof op === 'string' ? /^\$(\d+)(\.line)?$/.exec(op) : null;
	if (ref) return done[Number(ref[1])]?.[ref[2] ? 'line' : 'entry'] ?? op;
	if (Array.isArray(op)) return op.map((x) => refs(x, done));
	if (op && typeof op === 'object') return Object.fromEntries(Object.entries(op).map(([k, v]) => [k, refs(v, done)]));
	return op;
}

/** Whether the device would make an op, as `may` answers: alone, or once its owners approve it. @param {any} v */
export const allowed = (v) => v === true || (!!v && typeof v === 'object' && 'approve' in v);

/**
 * Whether the acting vault `actor` may make each of the change ops `ops` now, as the device answers by a dry run of
 * each that checks, proves and refuses as running it would, and makes nothing (the engine's `may`): `true`,
 * `{ approve }` where its vault's owners approve it, or the refusal, `{ refused, why }`. What a page asks before it
 * offers a button, so the rules stay the device's alone. Where the device fails to answer, each is `NoAnswer`.
 * @param {{ ask: (op: object) => Promise<any> }} api @param {string} actor @param {object[]} ops
 * @returns {Promise<import('./vaults.js').Verdict[]>}
 */
export async function may(api, actor, ops) {
	if (!ops.length) return [];
	const out = await api.ask({ op: 'may', as: actor, ops }).catch(() => null);
	const no = { refused: out?.refused ?? 'NoAnswer', why: out ? why(out) : 'the device didn’t answer' };
	return out?.ok ?? ops.map(() => no);
}

/**
 * The answer to read op `op`, or `fallback` where the device refused it or didn't answer.
 * @param {{ ask: (op: object) => Promise<any> }} api @param {object} op @param {any} fallback
 * @returns {Promise<any>}
 */
export async function read(api, op, fallback) {
	const out = await api.ask(op).catch(() => null);
	return out && 'ok' in out ? out.ok : fallback;
}

/** A mounted view's read and its cleanup. Close it when its query changes or the view leaves.
 * @param {{ ask: (op: object) => Promise<any>, window?: () => any }} api
 * @param {object} op @param {any} fallback
 * @param {any} [activeWindow] A window retained by the component between reactive reads.
 */
export function windowRead(api, op, fallback, activeWindow) {
	const window = activeWindow ?? api.window?.();
	/** @type {Promise<any>} */
	const result = (window ? window.read(op) : api.ask(op)).catch(() => null)
		.then((/** @type {any} */ out) => out && 'ok' in out ? out.ok : fallback);
	return { result, close: () => activeWindow ? activeWindow.clear() : window?.close() };
}

/**
 * The tags vault `actor` must add besides `tags` to add an entry of type `type` to vault `vault`, as the device says
 * (`creatable`): those a share it adds through asks for, `[]` for none, or `null` where nothing lets it add one.
 * @param {{ ask: (op: object) => Promise<any> }} api @param {string} actor @param {string} vault @param {string} type
 * @param {string[]} [tags] @returns {Promise<string[] | null>}
 */
export const creatable = (api, actor, vault, type, tags = []) =>
	read(api, { op: 'creatable', vault, type, tags, as: actor }, null).then((out) => out?.tags ?? null);

/**
 * An article as this app writes one, of avenDB's own article schema: titled `title`, its text one Markdown text that
 * `text` starts it as.
 * @param {string} title @param {string} text
 */
export const articleRecord = (title, text) => ({ kind: 'article', title, text, tags: [] });

/** The place of the text of block `id` of a document. @param {number} id */
export const blockText = (id) => ['blocks', { id }, 'text'];

/** The tag that marks a note deleted (avendb-browser's `DELETED`): listed apart, and back once the tag is out. */
export const DELETED = 'avendb:deleted';

/**
 * The op that deletes note `entry`, or with `back`, brings it back: its mark among its own tags, on its main line.
 * @param {string} entry @param {boolean} [back]
 */
export const deleting = (entry, back = false) => ({ op: back ? 'remove' : 'insert', entry, path: ['tags'], value: DELETED });
