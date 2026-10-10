// avenDB's ops as the page writes them (avendb/docs/OPS.md, avendb's `engine`): every read and every change of a
// vault's entries is one JSON op, whatever their schema, which the device runs (`device.run`, in this page's
// WebAssembly or in the Mac app's device alike) and answers `{ ok }` or `{ refused, why }`. A change acts for the vault
// it names (`as`), and the rules judge it as they judge any peer's edit.

/** The ops that only read: they run on what the device holds, and change nothing. */
export const READS = ['query', 'get', 'history', 'schemas'];

/** Whether op `op` only reads. @param {any} op */
export const reads = (op) => READS.includes(op?.op);

/**
 * What an op did, from the device's answer; a refusal throws, in the engine's words, and for a batch, which op it
 * stopped at.
 * @param {any} out
 */
export function answer(out) {
	if (out && 'ok' in out) return out.ok;
	const at = typeof out?.at === 'number' ? ` (op ${out.at + 1} of the batch)` : '';
	throw new Error(`Refused${at}: ${out?.why ?? out?.refused ?? 'no answer'}.`);
}

/**
 * Whether the acting vault `actor` may make each of the change ops `ops` now, as the device answers by a dry run of
 * each that checks, proves and refuses as running it would, and makes nothing (the engine's `may`): `true`, or the
 * refusal, `{ refused, why }`. What a page asks before it offers a button, so the rules stay the device's alone.
 * @param {{ ask: (op: object) => Promise<any> }} api @param {string} actor @param {object[]} ops
 * @returns {Promise<(true | { refused: string, why: string })[]>}
 */
export async function may(api, actor, ops) {
	if (!ops.length) return [];
	const out = await api.ask({ op: 'may', as: actor, ops });
	const [refused, why] = [out?.refused ?? 'NoAnswer', out?.why ?? 'the device didn’t answer'];
	return out?.ok ?? ops.map(() => ({ refused, why }));
}

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
