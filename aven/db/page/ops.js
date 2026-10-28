// avenDB's ops as the page writes them (doc:docs/avendb §8, avendb's `engine`): every read
// and every change of the database is one JSON op, whatever its schema, which the device runs (`run(op)`, in this
// page's WebAssembly or in the Mac app's device alike) and answers `{ ok }`, `{ refused, why }`, or for a change its
// vault's owners approve that runs without the passkey's ceremony, `{ approve }`. A change acts for the vault it names
// (`as`), and the rules judge it as they judge any peer's edit; the page only asks beforehand, with `may`.

import { why } from './vaults.js';
import { READS, ASKS } from './op-names.js';
export { READS, ASKS };


/** Whether op `op` changes nothing: it only reads (`READS`), or asks by dry runs (`ASKS`). Either runs on what the
 * device holds and takes no ceremony. @param {any} op */
export const reads = (op) => READS.includes(op?.op) || ASKS.includes(op?.op);

/** Whether op `op` asks what changes would do, by dry runs, as the engine's `asks`. @param {any} op */
export const asks = (op) => ASKS.includes(op?.op);

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

/** What a local `read_file` fails with while this device doesn't hold the file yet: its keeper fetches it for the
 *  open view (avendb-net files.rs `keeper`), so the read is worth asking again, unlike a file the vault never had. */
const NOT_HELD_YET = /no blob [0-9a-f]{64} on the shelf|lacks \d+\.\.\d+|incomplete local file index/;

/**
 * Bytes `from` to `to` of file `root`, read off this device alone (`local`, as every page reads files since #1268),
 * by `run`: a refusal throws as `answer` does, and one only because the file hasn't reached this device yet throws
 * marked `passing`, so the reader asks again later rather than show it as missing for good.
 * @param {(op: any) => Promise<any>} run @param {string} root @param {number} size @param {number} from @param {number} to
 * @returns {Promise<Uint8Array>}
 */
export async function readLocalFile(run, root, size, from, to) {
	/** @type {any} */
	let out;
	try {
		out = await run({ op: 'read_file', root, size, from, to, local: true });
		answer(out);
		return out.bytes;
	} catch (e) {
		// a refusal while the device is behind (aven/db/spec/AvenDB/Freshness.lean): the entry that brings the file may
		// not have arrived yet, so it is asked again, never shown as missing for good
		if (out?.fresh?.state === 'behind' || NOT_HELD_YET.test(e instanceof Error ? e.message : String(e))) {
			const err = e instanceof Error ? e : new Error(String(e));
			/** @type {any} */ (err).passing = true;
			throw err;
		}
		throw e;
	}
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
