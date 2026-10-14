// avenDB's ops as the page writes them (avendb/docs/ARCHITECTURE.md §8, avendb's `engine`): every read
// and every change of the database is one JSON op, whatever its schema, which the device runs (`run(op)`, in this
// page's WebAssembly or in the Mac app's device alike) and answers `{ ok }`, `{ refused, why }`, or for a change its
// vault's owners approve that runs without the passkey's ceremony, `{ approve }`. A change acts for the vault it names
// (`as`), and the rules judge it as they judge any peer's edit; the page only asks beforehand, with `may`.

import { why } from './vaults.js';

/** The ops that only read: they run on what the device holds, change nothing, and take no ceremony. */
export const READS = [
	'query',
	'get',
	'history',
	'schemas',
	'groups',
	'world',
	'shares',
	'database',
	'note',
	'log',
	'read_file',
	'creatable',
	'taggable',
	'may'
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
	'restore',
	'undo',
	'variant',
	'batch',
	'share',
	'keep',
	'revoke',
	'put_file'
];

/** Whether change op `op` takes the vault it acts for (`as`). @param {any} op */
export const acts = (op) => ACTING.includes(op?.op);

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

/** Whether the device would make an op, as `may` answers: alone, or once its owners approve it. @param {any} v */
export const allowed = (v) => v === true || (!!v && typeof v === 'object' && 'approve' in v);

/**
 * Whether the acting vault `actor` may make each of the change ops `ops` now, as the device answers by a dry run of
 * each that checks, proves and refuses as running it would, and makes nothing (the engine's `may`): `true`,
 * `{ approve }` where its vault's owners approve it, or the refusal, `{ refused, why }`. What a page asks before it
 * offers a button, so the rules stay the device's alone.
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

/**
 * The tags vault `actor` must add besides `tags` to add an entry of type `type` to vault `vault`, as the device says
 * (`creatable`): those a share it adds through asks for, `[]` for none, or `null` where nothing lets it add one.
 * @param {{ ask: (op: object) => Promise<any> }} api @param {string} actor @param {string} vault @param {string} type
 * @param {string[]} [tags] @returns {Promise<string[] | null>}
 */
export const creatable = (api, actor, vault, type, tags = []) =>
	read(api, { op: 'creatable', vault, type, tags, as: actor }, null).then((out) => out?.tags ?? null);

/**
 * A note as this app writes one, a document of avenDB's own schema: titled `title`, its opening heading (block 1)
 * the title too, then a paragraph (block 2) that reads `text`.
 * @param {string} title @param {string} text
 */
export const noteRecord = (title, text) => ({
	kind: 'document',
	title,
	blocks: [
		{ id: 1, type: 'heading', level: 1, text: title },
		{ id: 2, type: 'paragraph', text }
	]
});

/** The place of the text of block `id` of a document. @param {number} id */
export const blockText = (id) => ['blocks', { id }, 'text'];

/** The tag that marks a note a variant of entry `entry`, naming where it came from. @param {string} entry */
export const variantMark = (entry) => `avendb:variant:${entry}`;

/** The tag that marks a note deleted (avendb-browser's `DELETED`): listed apart, and back once the tag is out. */
export const DELETED = 'avendb:deleted';

/**
 * The op that deletes note `entry`, or with `back`, brings it back: its mark among its own tags, on its main line.
 * @param {string} entry @param {boolean} [back]
 */
export const deleting = (entry, back = false) => ({ op: back ? 'remove' : 'insert', entry, path: ['tags'], value: DELETED });
