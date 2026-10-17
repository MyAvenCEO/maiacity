/*
 * A film's script in avenDB (Jobs and studio 2.0, J8): the writing made into a film plan. A `script` entry links its
 * story and the article it is made from, and pins the version of the article it was made from (`pinned`, the hash of
 * its text), so that when the writing moves on the script shows it is behind and can take the change. It holds scenes,
 * rows in order; each scene the beat of the story's journey it serves, its lines (the voice-over and dialogue, a line
 * drawn from the article keeping the words it quotes, `quote`) and its shot list (planned shots: size, angle, move,
 * what it shows, the line it covers, and the take or world shot that covers it once there is one).
 *
 * It is an entry of its own type, as a cut is (./cuts.js), not a variant of the article: avenDB's variant keeps its
 * original's type, and a script is no article. People and agents write it on its lines (agents on proposals, as the
 * storyteller and director skills say); nothing here is a job.
 */

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const SCRIPT = 'script';

/** The shot sizes a shot list names, widest first, with their short names. */
export const SIZES = /** @type {const} */ ([
	['ews', 'Extreme wide'],
	['ws', 'Wide'],
	['ms', 'Medium'],
	['mcu', 'Medium close-up'],
	['cu', 'Close-up'],
	['ecu', 'Extreme close-up'],
	['insert', 'Insert']
]);
/** The camera's angles. */
export const ANGLES = /** @type {const} */ ([
	['eye', 'Eye level'],
	['high', 'High'],
	['low', 'Low'],
	['overhead', 'Overhead'],
	['dutch', 'Dutch']
]);
/** How the camera moves. */
export const MOVES = /** @type {const} */ ([
	['static', 'Static'],
	['pan', 'Pan'],
	['tilt', 'Tilt'],
	['push', 'Push in'],
	['pull', 'Pull out'],
	['track', 'Track'],
	['handheld', 'Handheld'],
	['orbit', 'Orbit']
]);
/** Who says a line: the voice-over, or someone on screen. */
export const WHO = /** @type {const} */ ([
	['voice', 'Voice-over'],
	['dialogue', 'On screen']
]);

const enumOf = (/** @type {readonly (readonly [string, string])[]} */ xs) => JSON.stringify(xs.map(([k]) => k));

/** The `script` record's schema, in the vault's own lane. */
export const SCRIPT_V1 = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Script, v1",
  "description": "A film's script: the story and article it is made from, the article's version it was made from, and its scenes, each with the beat it serves, its lines and its shot list.",
  "type": "object",
  "properties": {
    "kind": { "const": "script" },
    "title": { "type": "string", "maxLength": 200 },
    "story": { "type": "object", "properties": { "vault": { "type": "string", "maxLength": 64 }, "entry": { "type": "string", "maxLength": 64 } } },
    "article": { "type": "string", "maxLength": 64, "default": "" },
    "pinned": { "type": "string", "maxLength": 64, "default": "" },
    "language": { "type": "string", "maxLength": 16, "default": "en" },
    "scenes": {
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer" },
          "name": { "type": "string", "maxLength": 200, "default": "" },
          "beat": { "type": "integer" },
          "lines": {
            "type": "array",
            "default": [],
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "integer" },
                "who": { "enum": ${enumOf(WHO)} },
                "text": { "type": "string", "x-loro": "text", "default": "" },
                "quote": { "type": "string", "maxLength": 20000 }
              },
              "required": ["id"]
            }
          },
          "shots": {
            "type": "array",
            "default": [],
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "integer" },
                "size": { "enum": ${enumOf(SIZES)} },
                "angle": { "enum": ${enumOf(ANGLES)} },
                "move": { "enum": ${enumOf(MOVES)} },
                "shows": { "type": "string", "x-loro": "text", "default": "" },
                "line": { "type": "integer" },
                "take": { "type": "string", "maxLength": 64 },
                "shot": { "type": "string", "maxLength": 80 }
              },
              "required": ["id"]
            }
          }
        },
        "required": ["id"]
      }
    },
    "at": { "type": "integer", "minimum": 0 }
  },
  "required": ["kind", "title", "at"]
}
`;

/** @typedef {{ id: number, who?: string, text?: string, quote?: string }} Line */
/** @typedef {{ id: number, size?: string, angle?: string, move?: string, shows?: string, line?: number, take?: string, shot?: string }} Shot */
/** @typedef {{ id: number, name?: string, beat?: number, lines?: Line[], shots?: Shot[] }} Scene */

/** The version of article text `md` a script pins: the BLAKE3 of its text, in hex. @param {string} md */
export const pinOf = (md) => bytesToHex(blake3(utf8ToBytes(md ?? ''))).slice(0, 32);

/** A heading's words, without its marks. @param {string} md */
const headingOf = (md) => /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(md)?.[1] ?? null;
/** A picture alone in its block: what it shows, in its words. @param {string} md */
const pictureOf = (md) => /^!\[([^\]]*)\]\(\s*[^)\s]+\s*\)$/.exec(md.trim())?.[1];
/** Where an imported blog post was first published, and the rule above it: no part of the film. */
const SKIP = /^(First published on the maiaCITY blog\b|-{3,}$|\*{3,}$|_{3,}$|```|~~~)/;

/** An emphasised paragraph alone: an article's subtitle. */
const SUBTITLE = /^(?:\*[^*\n][^*\n]*\*|_[^_\n][^_\n]*_)$/;

/** Text `md` parted into its blocks at its blank lines, a fenced piece of code one block. @param {string} md */
function blocksOf(md) {
	/** @type {string[]} */
	const out = [];
	let [now, fence] = [/** @type {string[]} */ ([]), ''];
	for (const line of (md ?? '').split('\n')) {
		const opens = /^\s{0,3}(```|~~~)/.exec(line)?.[1] ?? '';
		if (fence) {
			now.push(line);
			if (opens === fence) fence = '';
		} else if (!line.trim()) {
			if (now.length) out.push(now.join('\n').trim());
			now = [];
		} else {
			if (opens) fence = opens;
			now.push(line);
		}
	}
	if (now.length) out.push(now.join('\n').trim());
	return out;
}

/**
 * Article text `md` as the film says it: its body's blocks, past the subtitle and the cover it opens with (as the
 * journal lays an article out, ../avendb/article.js `laidOut`), each a heading (a new scene), a picture (a shot) or
 * words said (a line).
 * @param {string} md @returns {{ kind: 'heading' | 'picture' | 'words', md: string, text: string }[]}
 */
export function partsOf(md) {
	const all = blocksOf(md);
	let body = SUBTITLE.test(all[0] ?? '') ? 1 : 0;
	if (pictureOf(all[body] ?? '') !== undefined) body++;
	return all
		.slice(body)
		.filter((b) => !SKIP.test(b))
		.map((b) => {
			const h = headingOf(b);
			if (h !== null) return { kind: /** @type {const} */ ('heading'), md: b, text: h };
			const p = pictureOf(b);
			if (p !== undefined) return { kind: /** @type {const} */ ('picture'), md: b, text: p };
			return { kind: /** @type {const} */ ('words'), md: b, text: b };
		});
}

/** An id none of `rows` has: counting on from the highest. @param {{ id: number }[]} rows */
const nextId = (rows) => rows.reduce((m, r) => Math.max(m, r.id ?? 0), 0) + 1;

/**
 * A first script from article `a` of story `story` (an entry of each): a scene for each heading (the words before the
 * first, an opening), each serving the story's beat of the same name, if it has one; each paragraph a line of the
 * voice-over, quoting it; each picture a shot that shows what it says. People and agents take it on from there.
 * @param {import('../avendb/vaults.js').EntryView} story @param {import('../avendb/vaults.js').EntryView} a
 * @param {number} now seconds since 1970
 */
export function draftFrom(story, a, now) {
	const beats = /** @type {any[]} */ (/** @type {any} */ (story.record)?.beats ?? []);
	const beatNamed = (/** @type {string} */ name) => beats.find((b) => (b.title ?? '').trim().toLowerCase() === name.trim().toLowerCase())?.id;
	/** @type {Scene[]} */
	const scenes = [];
	const scene = (/** @type {string} */ name) => {
		/** @type {Scene} */
		const s = { id: scenes.length + 1, name, lines: [], shots: [] };
		const beat = beatNamed(name);
		if (beat != null) s.beat = beat;
		scenes.push(s);
		return s;
	};
	for (const p of partsOf(a.text ?? '')) {
		if (p.kind === 'heading') {
			scene(p.text);
			continue;
		}
		const s = scenes.at(-1) ?? scene('Opening');
		if (p.kind === 'words') {
			const lines = /** @type {Line[]} */ (s.lines);
			lines.push({ id: nextId(lines), who: 'voice', text: p.text, quote: p.text });
		} else {
			const shots = /** @type {Shot[]} */ (s.shots);
			const line = s.lines?.at(-1)?.id;
			shots.push({ id: nextId(shots), size: 'ws', angle: 'eye', move: 'static', shows: p.text, ...(line != null ? { line } : {}) });
		}
	}
	const r = /** @type {any} */ (a.record) ?? {};
	return {
		kind: SCRIPT,
		title: `${a.title || r.title || /** @type {any} */ (story.record)?.title || 'Untitled'} · script`,
		story: { vault: story.vault, entry: story.entry },
		article: a.entry,
		pinned: pinOf(a.text ?? ''),
		language: r.language || 'en',
		scenes,
		at: now
	};
}

/** The words of text `s`, lower case, for a likeness. @param {string} s */
const wordsOf = (s) => new Set((s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []));

/** How alike two texts are, 0 to 1: the words they share over the words of either. @param {string} a @param {string} b */
export function likeness(a, b) {
	const [x, y] = [wordsOf(a), wordsOf(b)];
	if (!x.size || !y.size) return 0;
	let both = 0;
	for (const w of x) if (y.has(w)) both++;
	return both / (x.size + y.size - both);
}

/**
 * Where script record `s` stands against its article's text `md`: whether it is behind (the article moved on since it
 * was pinned), and if so how: each quoted line whose words the article no longer holds, with the paragraph that now
 * says it (the likest one no other line quotes, `null` where it is gone), and the article's new paragraphs no line
 * quotes, each after the line it follows.
 * @param {any} s @param {string} md
 */
export function behindOf(s, md) {
	if (!s || (s.pinned ?? '') === pinOf(md)) return { behind: false, changed: [], added: [] };
	const words = partsOf(md).filter((p) => p.kind === 'words').map((p) => p.text);
	const lines = (/** @type {Scene[]} */ (s.scenes ?? [])).flatMap((sc) => (sc.lines ?? []).map((l) => ({ scene: sc.id, line: l })));
	const quoted = lines.filter((x) => x.line.quote);
	const held = new Set(quoted.map((x) => x.line.quote).filter((q) => words.includes(/** @type {string} */ (q))));
	/** @type {{ scene: number, line: Line, now: string | null }[]} */
	const changed = [];
	const taken = new Set(held);
	for (const x of quoted) {
		if (held.has(/** @type {string} */ (x.line.quote))) continue;
		const best = words
			.filter((w) => !taken.has(w))
			.map((w) => [w, likeness(/** @type {string} */ (x.line.quote), w)])
			.sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]))[0];
		const now = best && /** @type {number} */ (best[1]) >= 0.3 ? /** @type {string} */ (best[0]) : null;
		if (now) taken.add(now);
		changed.push({ ...x, now });
	}
	/** @type {{ text: string, after: { scene: number, line: number } | null }[]} */
	const added = [];
	/** the line that quotes each paragraph, as the script will quote it once it takes the change */
	const by = new Map();
	for (const x of quoted) by.set(changed.find((c) => c.line.id === x.line.id && c.scene === x.scene)?.now ?? x.line.quote, x);
	let last = /** @type {{ scene: number, line: number } | null} */ (null);
	for (const w of words) {
		const x = by.get(w);
		if (x) last = { scene: x.scene, line: x.line.id };
		else added.push({ text: w, after: last });
	}
	return { behind: true, changed, added };
}

/**
 * The ops that bring script entry `entry` (record `s`) up to its article's text `md`: each changed line takes the
 * article's new words where the line still said what it quoted (else it keeps its own and quotes the new), a line
 * whose paragraph is gone keeps its words and quotes nothing; each new paragraph comes in as a line after the one it
 * follows (the first scene's first, where it follows none); and the script pins the article's version.
 * @param {string} entry @param {any} s @param {string} md
 */
export function takingOps(entry, s, md) {
	const { behind, changed, added } = behindOf(s, md);
	/** @type {any[]} */
	const ops = [];
	if (!behind) return ops;
	const at = (/** @type {number} */ scene, /** @type {number} */ line) => ['scenes', { id: scene }, 'lines', { id: line }];
	for (const c of changed) {
		if (c.now === null) ops.push({ op: 'unset', entry, path: [...at(c.scene, c.line.id), 'quote'] });
		else {
			if ((c.line.text ?? '') === c.line.quote) ops.push({ op: 'set', entry, path: [...at(c.scene, c.line.id), 'text'], value: c.now });
			ops.push({ op: 'set', entry, path: [...at(c.scene, c.line.id), 'quote'], value: c.now });
		}
	}
	const scenes = /** @type {Scene[]} */ (s.scenes ?? []);
	/** the ids each scene's lines will have, as new ones come in */
	const ids = new Map(scenes.map((sc) => [sc.id, (sc.lines ?? []).map((l) => l.id)]));
	for (const a of added) {
		const scene = a.after?.scene ?? scenes[0]?.id;
		if (scene == null) continue;
		const rows = /** @type {number[]} */ (ids.get(scene));
		const id = Math.max(0, ...rows) + 1;
		const to = a.after ? rows.indexOf(a.after.line) + 1 : 0;
		rows.splice(to, 0, id);
		ops.push({ op: 'insert', entry, path: ['scenes', { id: scene }, 'lines'], value: { id, who: 'voice', text: a.text, quote: a.text } });
		if (to < rows.length - 1) ops.push({ op: 'move', entry, path: ['scenes', { id: scene }, 'lines', { id }], to });
		a.after = { scene, line: id };
	}
	ops.push({ op: 'set', entry, path: ['pinned'], value: pinOf(md) });
	return ops;
}

/** The scripts of story entry `story`, the first made first. @param {import('../avendb/vaults.js').WorldView} world @param {string} story */
export const scriptsOf = (world, story) =>
	world.entries
		.filter((e) => e.type === SCRIPT && !e.deleted && !(e.tags ?? []).includes('avendb:deleted') && /** @type {any} */ (e.record)?.story?.entry === story)
		.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));

/** How long script record `s` runs when read aloud, in seconds: 150 words a minute, as a voice-over goes. @param {any} s */
export const spokenSeconds = (s) =>
	Math.round(((s?.scenes ?? []).flatMap((/** @type {Scene} */ sc) => sc.lines ?? []).reduce((/** @type {number} */ n, /** @type {Line} */ l) => n + (l.text ?? '').split(/\s+/).filter(Boolean).length, 0) / 150) * 60);

