/*
 * The HITL queue (human in the loop): every change waiting for a person's yes, as cards (./Hitl.svelte). An aven, an
 * agent or any vault holding a Suggester share writes its changes on a proposal of an entry; the vault the entry is in
 * answers it. The queue is not stored anywhere: each device works it out from what it already holds, its world and
 * each such entry's `note`, so it works offline and an answer on one device clears the card on every other.
 *
 * An answer is a review: a record of the `review` schema in the entry's vault, written by the device like any edit,
 * naming the proposal and the version of it that was answered (its heads), with the verdict, `accepted`, `declined` or
 * `revise`, and for a revision the words that go back to whoever proposed. Accepting also merges the proposal, taking
 * its side wherever both lines changed one place. The policy for now is one owner: whoever acts for the vault as its
 * owner answers for it. A proposal that changes after a review asks again, as a new version is a new ask.
 *
 * The review schema is the vault's own, in its lane (avendb/docs/ARCHITECTURE.md §9): the page adds it the first time
 * the vault answers, the same bytes in every vault, so the same id. Plan: /mnt/project-files/scion-analysis/.
 */

/** The type of a review entry, and its record's kind. */
export const REVIEW = 'review';

/** The verdicts a review gives. */
export const VERDICTS = /** @type {const} */ (['accepted', 'declined', 'revise']);
/** @typedef {(typeof VERDICTS)[number]} Verdict */

/** The review schema, as the vault's lane holds it: the same bytes everywhere, so every vault names it alike. */
export const REVIEW_V1 = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Review, v1",
  "type": "object",
  "properties": {
    "kind": { "const": "review" },
    "entry": { "type": "string", "maxLength": 64 },
    "line": { "type": "string", "maxLength": 64 },
    "heads": { "type": "array", "items": { "type": "string", "maxLength": 64 }, "maxItems": 64 },
    "by": { "type": "string", "maxLength": 64 },
    "verdict": { "enum": ["accepted", "declined", "revise"] },
    "text": { "type": "string", "maxLength": 2000, "default": "" },
    "at": { "type": "integer", "minimum": 0 }
  },
  "required": ["kind", "entry", "line", "heads", "verdict"]
}
`;

/**
 * One change waiting for vault `vault`'s yes: proposal `line` of entry `entry`, at version `heads`, which vault `from`
 * started; its title and text on main and on the proposal, the record's other fields it changes, and where both lines
 * changed one place (`conflicts`).
 * @typedef {{ vault: string, entry: string, line: string, name: string | null, heads: string[], from: string | null,
 *   kind: string | null, before: { title: string, text: string }, after: { title: string, text: string },
 *   fields: { key: string, before: any, after: any }[], conflicts: any[], since: number, again: Review | null }} Ask
 */
/**
 * A review as the queue reads it.
 * @typedef {{ id: string, vault: string, entry: string, line: string, heads: string[], by: string | null,
 *   verdict: Verdict, text: string, at: number }} Review
 */

/** Whether two lists of heads name the same version. @param {string[]} a @param {string[]} b */
export const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Every review the device reads, newest first.
 * @param {import('./vaults.js').WorldView} world @returns {Review[]}
 */
export function reviews(world) {
	return world.entries
		.filter((e) => e.type === REVIEW && e.record?.kind === REVIEW && !e.deleted)
		.map((e) => {
			const r = /** @type {any} */ (e.record);
			return {
				id: e.entry,
				vault: e.vault,
				entry: r.entry,
				line: r.line,
				heads: r.heads ?? [],
				by: r.by ?? null,
				verdict: r.verdict,
				text: r.text ?? '',
				at: r.at ?? e.created ?? 0
			};
		})
		.sort((a, b) => b.at - a.at);
}

/** The entries of vault `vault` with a proposal, whose notes the queue reads. @param {import('./vaults.js').WorldView}
 *  world @param {string} vault */
export const proposing = (world, vault) =>
	world.entries.filter((e) => e.vault === vault && e.proposals > 0 && !e.deleted && e.kind === 'note');

/** The record's fields a card compares beside its title and text: what a spark holds besides them. */
const SKIP = new Set(['kind', 'title', 'blocks', 'tags']);

/**
 * The changes waiting for vault `vault`'s yes, the oldest first: each proposal of its entries, `notes` by entry,
 * still open (its heads not all on main), not started by `vault` itself, and with no review of this version of it.
 * @param {string} vault @param {Record<string, any>} notes @param {Review[]} all
 * @returns {Ask[]}
 */
export function asksOf(vault, notes, all) {
	/** @type {Ask[]} */
	const out = [];
	for (const [entry, note] of Object.entries(notes)) {
		if (!note || note.vault !== vault) continue;
		const main = note.lines.find((/** @type {any} */ l) => l.line === null);
		if (!main) continue;
		const merged = new Set(main.history);
		for (const p of note.lines) {
			if (p.line === null || p.heads.every((/** @type {string} */ h) => merged.has(h))) continue;
			const start = note.edits.find((/** @type {any} */ e) => e.id === p.line);
			const from = start?.actor ?? null;
			if (from === vault) continue;
			const mine = all.filter((r) => r.entry === entry && r.line === p.line && r.vault === vault);
			if (mine.some((r) => same(r.heads, p.heads))) continue;
			const fields = [];
			for (const key of new Set([...Object.keys(main.record ?? {}), ...Object.keys(p.record ?? {})])) {
				if (SKIP.has(key)) continue;
				const [a, b] = [main.record?.[key], p.record?.[key]];
				if (JSON.stringify(a) !== JSON.stringify(b)) fields.push({ key, before: a, after: b });
			}
			const edits = note.edits.filter((/** @type {any} */ e) => e.line === p.line);
			out.push({
				vault,
				entry,
				line: p.line,
				name: p.name,
				heads: p.heads,
				from,
				kind: note.kind,
				before: { title: main.title ?? '', text: main.text ?? '' },
				after: { title: p.title ?? '', text: p.text ?? '' },
				fields,
				conflicts: p.conflicts ?? [],
				since: edits.length,
				again: mine[0] ?? null
			});
		}
	}
	return out;
}

/**
 * The revisions asked of vault `vault`: the newest review of each proposal it started, where that review asks it to
 * revise the version it answered and the proposal has not moved on since. `notes` by entry.
 * @param {string} vault @param {Record<string, any>} notes @param {Review[]} all @returns {Review[]}
 */
export function revisionsOf(vault, notes, all) {
	/** @type {Review[]} */
	const out = [];
	const seen = new Set();
	for (const r of all) {
		const key = `${r.entry}/${r.line}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const p = notes[r.entry]?.lines.find((/** @type {any} */ l) => l.line === r.line);
		const start = notes[r.entry]?.edits.find((/** @type {any} */ e) => e.id === r.line);
		if (r.verdict === 'revise' && p && start?.actor === vault && same(p.heads, r.heads)) out.push(r);
	}
	return out;
}

/**
 * The ops that answer ask `ask` with `verdict`, acting for `as`: the review schema first where the vault's lane lacks
 * it, for an acceptance the merge, taking the proposal's side wherever both changed one place, then the review.
 * @param {import('./vaults.js').WorldView} world @param {Ask} ask @param {Verdict} verdict @param {string} text
 * @param {string} as
 */
export function answering(world, ask, verdict, text, as) {
	const ops = [];
	const lane = world.entries.some(
		(e) => e.vault === ask.vault && e.type === 'schema' && e.title === 'Review, v1' && !e.deleted
	);
	if (!lane) ops.push({ op: 'create', vault: ask.vault, type: 'schema', value: REVIEW_V1, as });
	const value = {
		kind: REVIEW,
		entry: ask.entry,
		line: ask.line,
		heads: ask.heads,
		by: ask.from ?? '',
		verdict,
		text: text.slice(0, 2000),
		at: Math.floor(Date.now() / 1000)
	};
	const take = ask.conflicts.map((c) => ({ at: c.at, what: c.what }));
	if (verdict === 'accepted') ops.push({ op: 'merge', entry: ask.entry, from: ask.line, into: null, take, as });
	ops.push({ op: 'create', vault: ask.vault, type: REVIEW, value, as });
	return ops;
}
