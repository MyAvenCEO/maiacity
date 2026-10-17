/*
 * The HITL queue (human in the loop): every AIP waiting for a person's yes, as cards (./Hitl.svelte). AIPs, Aven
 * Improvement Proposals, are avenDB's one proposal standard, for every vault and every type of entry
 * (avendb/docs/ARCHITECTURE.md §8, "AIPs"): an aven, an agent or any vault with a share writes its changes on
 * proposals, opens an AIP over those lines (`aip_open`) and promotes it (`aip_promote`), which gives it the vault's
 * next number, AIP-n; the vault the AIP is in answers it, over every line at once. The queue is not stored anywhere:
 * each device reads it off what it already holds with one read, `aips`, so it works offline and an answer on one
 * device clears the card on every other.
 *
 * Only a promoted AIP asks: proposed, in the vault the person acts for, not the vault's own, and with no review that
 * answers its lines as they stand. Ideas ask nothing, and neither does a proposal no AIP names. An answer is one op,
 * `aip_review`: `accepted` writes the vault's accept on every line, merges each into main, taking the proposal's side
 * wherever both lines changed one place, and writes one review over them all; `declined` writes the review alone;
 * `revise` writes it with the words that go back, and the AIP is an idea again, keeping its number. The policy for now
 * is one owner: whoever acts for the vault as its owner answers for it. The card is a summary; the Proposals app shows
 * the whole AIP (`detail`).
 *
 * The review is a record of the schema "Review, v1", which avenDB ships, so every vault reads it with no schema entry
 * of its own; older vaults hold the same bytes in their lane, so the same id (`REVIEW_V1`). Plan:
 * /mnt/project-files/game-caps/plan.md.
 */

/** The type of a review entry, and its record's kind. */
export const REVIEW = 'review';

/** The verdicts a review gives. */
export const VERDICTS = /** @type {const} */ (['accepted', 'declined', 'revise']);
/** @typedef {(typeof VERDICTS)[number]} Verdict */

/** The review schema, as avenDB ships it and older vaults hold it in their lane: the same bytes, so the same id. */
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
 * An AIP as the `aips` read lists it (avendb's `engine::aips`): its entry (`null` for a bare proposal), its vault,
 * key, number and label (`AIP-n`, `null` for an idea), title and note, stage (`idea`, `proposed` or `archived`) and
 * outcome (`applied`, `rejected` or `null`), its tags and author, its lines, its reviews newest first (`current` where
 * one answers every line as it stands), the signatures so far, and a summary line per part. A line that is `new` is a
 * draft, a new entry proposed inside the AIP: its main line holds nothing until the vault accepts it, which lands it;
 * `public` where a share to everyone picks it once it lands, by its type or its `tags`.
 * @typedef {{ bare: boolean, entry: string | null, vault: string, key: string | null, number: number | null,
 *   label: string | null, title: string, note: string, stage: 'idea' | 'proposed' | 'archived',
 *   outcome: 'applied' | 'rejected' | null, why: string | null, was: string | null, tags: string[],
 *   author: string | null, intent: { vault: string, entry: string } | null,
 *   links: { id: number, name: string, url: string }[],
 *   lines: { entry: string, line: string, type: string | null, title: string | null, name: string | null,
 *     heads: string[], merged: boolean, new: boolean, tags: string[], public: boolean }[],
 *   reviews: { review: string, verdict: Verdict, text: string, heads: string[], by: string | null, at: number,
 *     current: boolean }[],
 *   signatures: { have: number, need: number, of: string }, summary: string[] }} Aip
 */

/** Whether two lists of heads name the same version. @param {string[]} a @param {string[]} b */
export const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * The AIPs waiting for vault `vault`'s yes, the oldest number first: proposed, in `vault`, not its own, and with no
 * review that answers every line as it stands.
 * @param {string} vault @param {Aip[]} aips @returns {Aip[]}
 */
export const asksOf = (vault, aips) =>
	aips
		.filter((a) => !a.bare && a.stage === 'proposed' && a.vault === vault && a.author !== vault)
		.filter((a) => !a.reviews.some((r) => r.current))
		.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

/**
 * The revisions asked of vault `vault`: its own AIPs whose newest review asks it to revise, and that are ideas again.
 * @param {string} vault @param {Aip[]} aips @returns {Aip[]}
 */
export const revisionsOf = (vault, aips) =>
	aips.filter((a) => !a.bare && a.author === vault && a.stage === 'idea' && a.reviews[0]?.verdict === 'revise');

/** How many AIPs wait for each of vaults `vaults`. @param {string[]} vaults @param {Aip[]} aips */
export const countsOf = (vaults, aips) => Object.fromEntries(vaults.map((v) => [v, asksOf(v, aips).length]));

/**
 * The op that answers AIP `aip` with `verdict`, acting for `as`, its vault: one `aip_review`, over every line. It names
 * the heads of every line as the card showed them, so avenDB refuses it where a line moved since: nothing written
 * after the card was drawn is accepted unseen.
 * @param {Aip} aip @param {Verdict} verdict @param {string} text @param {string} as
 */
export const answering = (aip, verdict, text, as) => [
	{
		op: 'aip_review',
		entry: aip.entry,
		verdict,
		text: text.slice(0, 2000),
		heads: aip.lines.flatMap((l) => l.heads),
		as
	}
];

/**
 * The new entries an AIP proposes, its drafts, each as its card's badge reads: "New logic", and where a share to
 * everyone picks it once accepted, "New logic · goes public on Accept (tag game:sandbox-7)", with the tags it carries.
 * @param {Aip} aip @returns {string[]}
 */
export const newsOf = (aip) =>
	aip.lines
		.filter((l) => l.new)
		.map((l) => {
			const tags = l.tags.length ? ` (tag${l.tags.length === 1 ? '' : 's'} ${l.tags.join(', ')})` : '';
			return `New ${l.type ?? 'entry'}${l.public ? ` · goes public on Accept${tags}` : ''}`;
		});

/** The Proposals app's page of AIP `entry`, which shows it whole: its text, every line's diff, its reviews. */
export const detail = (/** @type {string} */ entry) => `/app/aips/?aip=${encodeURIComponent(entry)}`;

/** The first `n` lines of a note, for a card. @param {string} note @param {number} [n] */
export function lead(note, n = 3) {
	const lines = note.split('\n').filter((l) => l.trim());
	return lines.length > n ? `${lines.slice(0, n).join('\n')}…` : lines.join('\n');
}

/** A summary's top `n` lines, and how many more. @param {string[]} summary @param {number} [n] */
export const top = (summary, n = 3) => ({ shown: summary.slice(0, n), more: Math.max(0, summary.length - n) });

/** The signatures so far against the policy, in words: "0 of 1 owner". @param {Aip['signatures']} s */
export const signed = (s) => `${s.have} of ${s.need} ${s.of === 'owners' && s.need === 1 ? 'owner' : s.of}`;
