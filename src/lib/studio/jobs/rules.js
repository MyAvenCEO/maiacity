/*
 * The rules of studio 2.0 (plan J0b, §1.7): what is wanted, never how. A worker maps a rule's `key` to the Rust that
 * does it (vault/app/src/jobs.rs); a vault turns a rule off or narrows its `when` without touching code.
 *
 * Rules are held like flows: the app's own (below), overridden by avenCEO GmbH's, overridden by the vault's, each by
 * its key, the newest version of a key winning within one holder (`layered`).
 *
 * `when` picks the entries a rule wants something for, in avenDB's selector words (`type`, `tag`, `noTag`, `all`,
 * `any`) plus `media`, a file's media type, `*` at its end matching any subtype, and `record`, fields its record holds
 * exactly (`{ record: { look: 'youtube' } }`). A rule with no `when` runs only when
 * asked (a button, an agent, a function on a stage move): renders and hero frames are asked for, not missing.
 * `inputs` names what a task reads: `$entry` the entry picked, or `{ made, from }` what another rule made of it, which
 * the task waits for (`optional`: it doesn't wait, and is made again once the other is made). `params` are the input places whose values change the result, so they are part of its key.
 * `makes` says what it makes: Library files with role tags, or a value (`{ value: name }`) that goes on the task.
 */

import { RULE } from './schemas.js';

/**
 * A rule as the page reads it, its JSON fields parsed.
 * @typedef {{ key: string, name: string, version: number, lane: import('./schemas.js').Lane, when: any,
 *   inputs: Record<string, '$entry' | { made: string, from: '$entry', optional?: boolean }>, params: string[],
 *   makes: ({ type: 'file', tags: string[] } | { value: string })[], about: string, off: boolean }} Rule
 */

/** @type {Rule[]} */
export const BUILT_IN = [
	{
		key: 'checksum',
		name: 'Checksum',
		version: 1,
		lane: 'io',
		when: { all: [{ type: ['file'] }, { tag: 'jobs:test' }] },
		inputs: { file: '$entry' },
		params: [],
		makes: [{ value: 'blake3' }],
		about: 'The test rule: reads a file through the worker and names its BLAKE3. Only files tagged jobs:test.',
		off: false
	},
	{
		key: 'probe',
		name: 'Probe',
		version: 1,
		lane: 'io',
		when: { all: [{ type: ['file'] }, { tag: 'media:original' }, { any: [{ media: 'video/*' }, { media: 'audio/*' }] }] },
		inputs: { original: '$entry' },
		params: [],
		makes: [{ value: 'probe' }],
		about: 'Its streams, length, frame rate, timecode, camera and colour journey, read from the file.',
		off: false
	},
	{
		key: 'proxy',
		name: 'Proxy',
		version: 1,
		lane: 'gpu',
		when: { all: [{ type: ['file'] }, { tag: 'media:original' }, { media: 'video/*' }] },
		inputs: { original: '$entry', probe: { made: 'probe', from: '$entry' } },
		params: ['probe.journey'],
		makes: [{ type: 'file', tags: ['media:proxy'] }],
		about: 'An HD proxy in ACEScct, HEVC Main10, to play and grade on.',
		off: false
	},
	{
		key: 'still',
		name: 'Grading still',
		version: 1,
		lane: 'gpu',
		when: { all: [{ type: ['file'] }, { tag: 'media:original' }, { media: 'video/*' }] },
		inputs: { original: '$entry', probe: { made: 'probe', from: '$entry' }, analysis: { made: 'analysis', from: '$entry', optional: true } },
		params: ['probe.journey', 'analysis.hero.t'],
		makes: [{ type: 'file', tags: ['media:still'] }, { type: 'file', tags: ['media:preview'] }],
		about: "A 4K ACEScct still and its preview at the hero frame: the middle until the analysis picks one, then there.",
		off: false
	},
	{
		key: 'transcript',
		name: 'Transcript',
		version: 1,
		lane: 'speech',
		when: { all: [{ type: ['file'] }, { tag: 'media:original' }, { any: [{ media: 'video/*' }, { media: 'audio/*' }] }] },
		inputs: { original: '$entry' },
		params: [],
		makes: [{ value: 'transcript' }],
		about: 'Its words with their times. A new model is a new version, so every file is heard again.',
		off: false
	},
	{
		key: 'analysis',
		name: 'AI analysis',
		version: 1,
		lane: 'ai',
		when: { all: [{ type: ['file'] }, { tag: 'media:original' }, { media: 'video/*' }] },
		inputs: { original: '$entry', proxy: { made: 'proxy', from: '$entry' }, transcript: { made: 'transcript', from: '$entry' } },
		params: [],
		makes: [{ value: 'analysis' }],
		about: 'Tags, cues, takes and a hero frame, from the proxy and the words.',
		off: false
	},
	{
		key: 'world-proxy',
		name: 'World proxy',
		version: 1,
		lane: 'gpu',
		when: null,
		inputs: { shot: '$entry' },
		params: [],
		makes: [{ type: 'file', tags: ['media:proxy'] }],
		about: "A world shot version's HD proxy in ACEScct, rendered in the unseen world, when a cut plays it.",
		off: false
	},
	{
		key: 'youtube',
		name: 'YouTube',
		version: 1,
		lane: 'net',
		when: { all: [{ type: ['artifact'] }, { record: { look: 'youtube' } }] },
		inputs: { artifact: '$entry' },
		params: ['url'],
		makes: [{ value: 'youtube' }],
		about: "A YouTube video's title, channel, length, chapters and words with their times, from YouTube through yt-dlp on the Mac.",
		off: false
	},
	{
		key: 'render',
		name: 'Render',
		version: 1,
		lane: 'gpu',
		when: null,
		inputs: { cut: '$entry' },
		params: ['delivery'],
		makes: [{ type: 'file', tags: ['media:delivery'] }],
		about: 'Every delivery of a locked cut, levelled. Asked for, never missing.',
		off: false
	},
	{
		key: 'frame',
		name: 'Graded still',
		version: 1,
		lane: 'gpu',
		when: null,
		inputs: { cut: '$entry' },
		params: ['clip', 't', 'shape'],
		makes: [{ type: 'file', tags: ['media:preview'] }],
		about: "A clip's grading still through its grade, as its file's preview, when a cut changes how it looks; of a world clip or a gap, a hero frame at a time in a shape.",
		off: false
	}
];

/**
 * A rule record read into a rule; `null` where it isn't one (a field that doesn't parse).
 * @param {Record<string, any> | null | undefined} r
 * @returns {Rule | null}
 */
export function fromRecord(r) {
	if (!r || r.kind !== RULE || !r.key || !r.lane || !(r.version >= 1)) return null;
	try {
		return {
			key: r.key,
			name: r.name || r.key,
			version: r.version,
			lane: r.lane,
			when: r.when ? JSON.parse(r.when) : null,
			inputs: JSON.parse(r.inputs || '{}'),
			params: r.params ?? [],
			makes: JSON.parse(r.makes || '[]'),
			about: r.about ?? '',
			off: !!r.off
		};
	} catch {
		return null;
	}
}

/** A rule as its record holds it. @param {Rule} rule */
export function toRecord(rule) {
	return {
		kind: RULE,
		key: rule.key,
		name: rule.name,
		version: rule.version,
		lane: rule.lane,
		when: rule.when ? JSON.stringify(rule.when) : '',
		inputs: JSON.stringify(rule.inputs),
		params: rule.params,
		makes: JSON.stringify(rule.makes),
		about: rule.about,
		off: rule.off
	};
}

/**
 * The rules in force: each key from the nearest holder that has it, the app's, then avenCEO GmbH's, then the vault's,
 * the newest version of a key within one holder; those turned off left out.
 * @param {Rule[][]} holders nearest last: `[BUILT_IN, ceo, vault]`
 */
export function layered(...holders) {
	/** @type {Map<string, Rule>} */
	const out = new Map();
	for (const rules of holders) {
		/** @type {Map<string, Rule>} */
		const mine = new Map();
		for (const r of rules) if ((mine.get(r.key)?.version ?? 0) < r.version) mine.set(r.key, r);
		for (const [k, r] of mine) out.set(k, r);
	}
	return [...out.values()].filter((r) => !r.off);
}

/**
 * The rules vault `vault`'s own entries hold, from the device's world.
 * @param {import('../../avendb/vaults.js').WorldView} world @param {string} vault
 */
export function held(world, vault) {
	return world.entries
		.filter((e) => e.vault === vault && e.type === RULE && !e.deleted)
		.flatMap((e) => {
			const r = fromRecord(e.record);
			return r ? [r] : [];
		});
}
