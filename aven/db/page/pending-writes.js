/**
 * A page's writes, painted the moment they are made (batch 5, W1 and W3; `aven/db/spec/AvenDB/LocalWrite.lean`, its
 * pending writes). What a view shows is the device's last answer with the writes still pending laid over it, oldest
 * first (`overlay`): laying one more over is one step, so a write paints in the frame it was made in, whatever the
 * engine, a peer or a catch-up is doing. A refused write is taken out (`settle(seq, false)`), and the view is exactly
 * what it was before the write was made. An accepted one stays laid over until a read made after it was accepted
 * answers for its entry (`heard`): that answer holds it, so dropping it changes nothing on screen, and it never shows
 * twice (an insert lays its row over by id once). The engine still checks every write; this only paints.
 *
 * Rows go by id, as the engine's records hold them (a room's messages, a list's items): an `insert` adds `value` to
 * the list at `path` unless a row with its id is there, a `set` changes the value at `path`, a step `{ id }` picking a
 * list's row. A path that leads nowhere changes nothing.
 */

/** Whether op `op` is one a page paints before the engine answers: an `insert` or `set` into a named entry. @param {any} op */
export const paints = (op) =>
	(op?.op === 'insert' || op?.op === 'set') && typeof op.entry === 'string' && Array.isArray(op.path) &&
	op.path.length > 0 && !JSON.stringify(op).includes('"$');

/** @param {any} at @param {any} step */
function child(at, step) {
	if (step && typeof step === 'object' && 'id' in step) return Array.isArray(at) ? at.find((row) => row?.id === step.id) : undefined;
	return at && typeof at === 'object' ? at[step] : undefined;
}

/** @param {any} a @param {any} b @returns {boolean} */
function same(a, b) {
	if (a === b) return true;
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
	const ka = Object.keys(a), kb = Object.keys(b);
	return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
}

/**
 * Op `op` laid over `record`, a copy where it changes something (the record itself where not, `LocalWrite.lean`
 * `applyOp`): `mark(row, op)` makes the row an insert adds, as a view shows a pending one.
 * @param {any} record @param {any} op @param {(row: any, op: any) => any} [mark]
 */
export function apply(record, op, mark = (row) => row) {
	/** @type {(at: any, i: number) => any} */
	const walk = (at, i) => {
		const step = op.path[i];
		const last = i === op.path.length - 1;
		if (op.op === 'insert' && i === op.path.length) {
			if (!Array.isArray(at)) return at === undefined ? [mark(op.value, op)] : at;
			const id = op.value?.id;
			if (id !== undefined && at.some((row) => row?.id === id)) return at;
			return [...at, mark(op.value, op)];
		}
		if (op.op === 'set' && last) {
			if (step && typeof step === 'object') return at;
			if (!at || typeof at !== 'object' || Array.isArray(at) || same(at[step], op.value)) return at;
			return { ...at, [step]: op.value };
		}
		const next = child(at, step);
		if (next === undefined && !(op.op === 'insert' && i === op.path.length - 1 && at && typeof at === 'object')) return at;
		/** @type {any} */
		const made = walk(next, i + 1);
		if (made === next) return at;
		if (step && typeof step === 'object') return at.map((/** @type {any} */ row) => (row === next ? made : row));
		return Array.isArray(at) ? Object.assign([...at], { [step]: made }) : { ...at, [step]: made };
	};
	return op.path.length ? walk(record, 0) : record;
}

/**
 * The page's pending writes. `changed()` is called whenever the list changes, for a view to draw again.
 * @param {() => void} [changed]
 */
export function createPendingWrites(changed = () => {}) {
	/** @type {{ seq: number, op: any, accepted: number | null }[]} */
	let list = [];
	let seq = 0;
	const set = (/** @type {typeof list} */ next) => { if (next !== list) { list = next; changed(); } };
	return {
		/** Every pending write, oldest first. */
		get list() { return list; },
		/** Lays op `op` over every view of its entry from now on: its number, for `settle`. @param {any} op */
		add(op) {
			const s = ++seq;
			set([...list, { seq: s, op, accepted: null }]);
			return s;
		},
		/** The engine answered write `s`: refused, it goes at once; accepted at `at` (the reads' count then), it stays
		 * until a read after that answers for its entry. @param {number} s @param {boolean} accepted @param {number} [at] */
		settle(s, accepted, at = 0) {
			set(accepted ? list.map((p) => (p.seq === s ? { ...p, accepted: at } : p)) : list.filter((p) => p.seq !== s));
		},
		/** A read made at `at` answered for entry `entry` (for each entry `entry` says yes to, where a function): the
		 * accepted writes it holds go. @param {string | ((entry: string) => boolean)} entry @param {number} at */
		heard(entry, at) {
			const held = (/** @type {typeof list[number]} */ p) => p.accepted !== null && p.accepted <= at &&
				(typeof entry === 'function' ? entry(p.op.entry) : p.op.entry === entry);
			set(list.some(held) ? list.filter((p) => !held(p)) : list);
		},
		/** Record `record` of entry `entry` with its pending writes laid over, oldest first (`LocalWrite.lean` `shown`).
		 * @param {string} entry @param {any} record @param {(row: any, op: any) => any} [mark] */
		overlay(entry, record, mark) {
			let out = record;
			for (const p of list) if (p.op.entry === entry) out = apply(out, p.op, mark);
			return out;
		},
		/** Forgets every pending write, as the device they were made on lets go. */
		clear() { set(list.length ? [] : list); },
		/** Whether entry `entry` has a write the engine hasn't answered yet. @param {string} entry */
		pending: (entry) => list.some((p) => p.op.entry === entry && p.accepted === null)
	};
}
