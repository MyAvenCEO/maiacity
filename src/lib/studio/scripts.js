/*
 * A film's script in avenDB (Jobs and studio 2.0, J8): a delivery of its story, beside its article and its inspire
 * piece, none made from another (Samuel 2026-10-17 08:15: the story is the one source of truth). A `script` entry links
 * its story and pins the version of the story's beats it was drawn from (`pinned`), so that when the story moves on the
 * script shows it is behind and can take the change. It holds scenes, rows in order; each scene drawn from one beat of
 * the story's journey (`beat`), with what happens in it (`action`, the beat's words to start with; `told`, the words it
 * was drawn from), its lines (the voice-over and dialogue) and its shot list (planned shots: size, angle, move, what it
 * shows, the line it covers, and the take or world shot that covers it once there is one).
 *
 * A script may be adapted from another delivery, the story's article (`from`, and the version of its text, `fromPinned`):
 * its paragraphs become lines that quote it (`quote`) and its pictures shots, and when the article moves on the script
 * takes its change too. A cut is made from a script (`cutFrom`): a slate for each planned shot, a line for each spoken
 * one, the cut naming the script and the story it is of.
 *
 * It is an entry of its own type, as a cut is (./cuts.js), not a variant of the story: avenDB's variant keeps its
 * original's type, and a script is no story. People and agents write it on its lines (agents on proposals, as the
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
export const SCRIPT_V2 = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Script, v2",
  "description": "A film's script, a delivery of its story: the story it tells and the version of its beats it was drawn from, the delivery it was adapted from if any, and its scenes, each drawn from a beat, with what happens, its lines and its shot list.",
  "type": "object",
  "properties": {
    "kind": { "const": "script" },
    "title": { "type": "string", "maxLength": 200 },
    "story": { "x-link": "newest" },
    "pinned": { "type": "string", "maxLength": 64, "default": "" },
    "from": { "x-link": "newest" },
    "fromPinned": { "type": "string", "maxLength": 64, "default": "" },
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
          "action": { "type": "string", "x-loro": "text", "default": "" },
          "told": { "type": "string", "maxLength": 20000, "default": "" },
          "feel": { "type": "string", "maxLength": 200, "default": "" },
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
  "required": ["kind", "title", "story", "at"]
}
`;

/** @typedef {{ id: number, who?: string, text?: string, quote?: string }} Line */
/** @typedef {{ id: number, size?: string, angle?: string, move?: string, shows?: string, line?: number, take?: string, shot?: string }} Shot */
/** @typedef {{ id: number, name?: string, beat?: number, action?: string, told?: string, feel?: string, lines?: Line[], shots?: Shot[] }} Scene */
/** @typedef {{ id: number, title?: string, type?: string, text?: string, feel?: string }} Beat */

/** The version of a text `md` a script pins: the BLAKE3 of it, in hex. @param {string} md */
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

/** The version of beats `beats` a script pins: what each says, in their order. @param {Beat[]} beats */
export const beatsPin = (beats) => pinOf(JSON.stringify((beats ?? []).map((b) => [b.id, b.type ?? '', b.title ?? '', b.text ?? ''])));

/** A scene drawn from beat `b`, as scene `id`. @param {Beat} b @param {number} id @param {(type: string) => string} label */
const sceneOf = (b, id, label) => ({
	id,
	name: (b.title ?? '').trim() || label(b.type ?? '') || `Scene ${id}`,
	beat: b.id,
	action: b.text ?? '',
	told: b.text ?? '',
	...(b.feel ? { feel: b.feel } : {}),
	lines: [],
	shots: []
});

/**
 * A first script of story `story` (an entry): a scene for each of its beats, in their order, each saying what happens
 * as the beat says it, with no lines or shots yet (adapt them from the article, `adaptOps`, or write them); a story
 * with no beats yet, one opening scene. People and agents take it on from there.
 * @param {import('../avendb/vaults.js').EntryView} story @param {number} now seconds since 1970
 * @param {(type: string) => string} [label] a beat kind's name, for a beat with no title
 */
export function draftFrom(story, now, label = (t) => t) {
	const r = /** @type {any} */ (story.record) ?? {};
	const beats = /** @type {Beat[]} */ (r.beats ?? []);
	/** @type {Scene[]} */
	const scenes = beats.length ? beats.map((b, k) => sceneOf(b, k + 1, label)) : [{ id: 1, name: 'Opening', action: '', told: '', lines: [], shots: [] }];
	return {
		kind: SCRIPT,
		title: `${story.title || r.title || 'Untitled'} · script`,
		story: { vault: story.vault, entry: story.entry },
		pinned: beatsPin(beats),
		language: r.language || 'en',
		scenes,
		at: now
	};
}

/**
 * Where script record `s` stands against its story's beats `beats`: whether it is behind (the beats moved on since it
 * was pinned), and if so how: each scene whose beat now says other words than it was drawn from, each beat no scene is
 * drawn from (after the scene of the beat before it), and each scene whose beat is gone.
 * @param {any} s @param {Beat[]} beats
 */
export function storyBehindOf(s, beats) {
	if (!s || (s.pinned ?? '') === beatsPin(beats)) return { behind: false, changed: [], added: [], gone: [] };
	const scenes = /** @type {Scene[]} */ (s.scenes ?? []);
	const byId = new Map((beats ?? []).map((b) => [b.id, b]));
	/** @type {{ scene: Scene, was: string, now: string }[]} */
	const changed = [];
	/** @type {{ scene: Scene }[]} */
	const gone = [];
	for (const sc of scenes) {
		if (sc.beat == null) continue;
		const b = byId.get(sc.beat);
		if (!b) gone.push({ scene: sc });
		else if ((b.text ?? '') !== (sc.told ?? '')) changed.push({ scene: sc, was: sc.told ?? '', now: b.text ?? '' });
	}
	/** @type {{ beat: Beat, after: number | null }[]} */
	const added = [];
	let after = /** @type {number | null} */ (null);
	for (const b of beats ?? []) {
		const sc = scenes.findLast((x) => x.beat === b.id);
		if (sc) after = sc.id;
		else added.push({ beat: b, after });
	}
	return { behind: true, changed, added, gone };
}

/** An id none of `rows` has, nor any of `taken`. @param {{ id: number }[]} rows @param {number[]} [taken] */
const freeId = (rows, taken = []) => Math.max(0, ...rows.map((r) => r.id ?? 0), ...taken) + 1;

/**
 * The ops that bring script entry `entry` (record `s`) up to its story's beats `beats`: a scene whose beat says new
 * words takes them where it still said what it was drawn from (else it keeps its own) and notes the new; a beat no
 * scene is drawn from comes in as a scene after the scene of the beat before it; a scene whose beat is gone stays, on no
 * beat; and the script pins the beats' version.
 * @param {string} entry @param {any} s @param {Beat[]} beats @param {(type: string) => string} [label]
 */
export function storyTakingOps(entry, s, beats, label = (t) => t) {
	const { behind, changed, added, gone } = storyBehindOf(s, beats);
	/** @type {any[]} */
	const ops = [];
	if (!behind) return ops;
	const at = (/** @type {number} */ id) => ['scenes', { id }];
	for (const c of changed) {
		if ((c.scene.action ?? '') === c.was) ops.push({ op: 'set', entry, path: [...at(c.scene.id), 'action'], value: c.now });
		ops.push({ op: 'set', entry, path: [...at(c.scene.id), 'told'], value: c.now });
	}
	for (const g of gone) ops.push({ op: 'unset', entry, path: [...at(g.scene.id), 'beat'] });
	/** the scenes' ids in order, as new ones come in */
	const order = (/** @type {Scene[]} */ (s.scenes ?? [])).map((x) => x.id);
	/** the scene each new beat's follower comes after: the last new one after the same scene */
	const last = new Map();
	for (const a of added) {
		const id = freeId(s.scenes ?? [], order);
		const after = last.has(a.after) ? last.get(a.after) : a.after;
		const to = after == null ? 0 : order.indexOf(after) + 1;
		order.splice(to, 0, id);
		last.set(a.after, id);
		ops.push({ op: 'insert', entry, path: ['scenes'], value: sceneOf(a.beat, id, label) });
		if (to < order.length - 1) ops.push({ op: 'move', entry, path: at(id), to });
	}
	ops.push({ op: 'set', entry, path: ['pinned'], value: beatsPin(beats) });
	return ops;
}

/**
 * The ops that adapt script entry `entry` (record `s`) from article `a`, a delivery of the same story: each of its
 * paragraphs a line of the voice-over quoting it, each of its pictures a shot that shows what it says, in the scene
 * its heading names (the scene of that name, or drawn from the beat of that name; a heading no scene answers, a new
 * scene at the end; the words before any heading, the first scene); and the script names the article and pins its
 * version.
 * @param {string} entry @param {any} s @param {import('../avendb/vaults.js').EntryView} a @param {Beat[]} [beats] the story's
 */
export function adaptOps(entry, s, a, beats = []) {
	/** @type {any[]} */
	const ops = [];
	const scenes = /** @type {Scene[]} */ (s.scenes ?? []);
	const same = (/** @type {string | undefined} */ x, /** @type {string} */ y) => (x ?? '').trim().toLowerCase() === y.trim().toLowerCase();
	/** each scene's lines' and shots' ids, as new ones come in */
	const rows = new Map(scenes.map((sc) => [sc.id, { lines: (sc.lines ?? []).map((l) => l.id), shots: (sc.shots ?? []).map((x) => x.id) }]));
	const sceneIds = scenes.map((x) => x.id);
	let now = /** @type {number | null} */ (scenes[0]?.id ?? null);
	const open = (/** @type {string} */ name) => {
		const id = freeId(scenes, sceneIds);
		sceneIds.push(id);
		rows.set(id, { lines: [], shots: [] });
		ops.push({ op: 'insert', entry, path: ['scenes'], value: { id, name, action: '', told: '', lines: [], shots: [] } });
		return id;
	};
	for (const p of partsOf(a.text ?? '')) {
		if (p.kind === 'heading') {
			const beat = beats.find((b) => same(b.title, p.text))?.id;
			now = scenes.find((x) => same(x.name, p.text) || (beat != null && x.beat === beat))?.id ?? open(p.text);
			continue;
		}
		if (now == null) now = open('Opening');
		const r = /** @type {{ lines: number[], shots: number[] }} */ (rows.get(now));
		if (p.kind === 'words') {
			const id = Math.max(0, ...r.lines) + 1;
			r.lines.push(id);
			ops.push({ op: 'insert', entry, path: ['scenes', { id: now }, 'lines'], value: { id, who: 'voice', text: p.text, quote: p.text } });
		} else {
			const id = Math.max(0, ...r.shots) + 1;
			r.shots.push(id);
			const line = r.lines.at(-1);
			ops.push({ op: 'insert', entry, path: ['scenes', { id: now }, 'shots'], value: { id, size: 'ws', angle: 'eye', move: 'static', shows: p.text, ...(line != null ? { line } : {}) } });
		}
	}
	ops.push({ op: 'set', entry, path: ['from'], value: { vault: a.vault, entry: a.entry } });
	ops.push({ op: 'set', entry, path: ['fromPinned'], value: pinOf(a.text ?? '') });
	return ops;
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
 * Where script record `s` stands against the text `md` of the article it was adapted from: whether it is behind (the
 * article moved on since it was pinned), and if so how: each quoted line whose words the article no longer holds, with the paragraph that now
 * says it (the likest one no other line quotes, `null` where it is gone), and the article's new paragraphs no line
 * quotes, each after the line it follows.
 * @param {any} s @param {string} md
 */
export function articleBehindOf(s, md) {
	if (!s || !s.from || (s.fromPinned ?? '') === pinOf(md)) return { behind: false, changed: [], added: [] };
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
 * The ops that bring script entry `entry` (record `s`) up to the text `md` of the article it was adapted from: each changed line takes the
 * article's new words where the line still said what it quoted (else it keeps its own and quotes the new), a line
 * whose paragraph is gone keeps its words and quotes nothing; each new paragraph comes in as a line after the one it
 * follows (the first scene's first, where it follows none); and the script pins the article's version (`fromPinned`).
 * @param {string} entry @param {any} s @param {string} md
 */
export function articleTakingOps(entry, s, md) {
	const { behind, changed, added } = articleBehindOf(s, md);
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
	ops.push({ op: 'set', entry, path: ['fromPinned'], value: pinOf(md) });
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


/** How long line text `text` takes to say: 150 words a minute, never under a second and a half. @param {string} text */
const sayFor = (text) => Math.max(1.5, Math.round(((text ?? '').split(/\s+/).filter(Boolean).length / 2.5) * 10) / 10);
/** A shot size's short name on a slate, as a shot list writes it (WS, MCU). @param {string | undefined} size */
const sizeName = (size) => (size === 'insert' ? 'Insert' : (size ?? '').toUpperCase());
/** @param {readonly (readonly [string, string])[]} xs @param {string | undefined} key */
const nameIn = (xs, key) => xs.find(([k]) => k === key)?.[1] ?? '';

/**
 * A first cut of script record `s` (entry `script` of vault `vault`), as the studio opens a timeline: each planned shot
 * a slate on the picture track (its scene, its number, what it shows, its size, and its angle and move where they are
 * not plain), each line a line on the voice track under the shot that covers it (the shot whose `line` it is, else the
 * one over the line before it), each as long as it takes to say; a scene with no shots one slate of what happens in it.
 * The cut names the script and the story it is of (`script`, `story`), so the story lists its cuts.
 * @param {any} s @param {string} vault @param {string} script
 * @returns {Partial<import('$lib/auth/client').Timeline> & { script: { vault: string, entry: string }, story: any }}
 */
export function cutFrom(s, vault, script) {
	/** @type {import('$lib/auth/client').TimelineClip[]} */
	const clips = [];
	const round = (/** @type {number} */ x) => Math.round(x * 10) / 10;
	let t = 0;
	(/** @type {Scene[]} */ (s?.scenes ?? [])).forEach((sc, k) => {
		const lines = sc.lines ?? [];
		/** @type {(Shot & { plain?: boolean })[]} */
		const shots = sc.shots?.length ? sc.shots : [{ id: 0, shows: sc.action ?? '', plain: true }];
		/** the shot each line is said under */
		const under = new Map();
		let owner = shots[0].id;
		for (const l of lines) {
			owner = shots.find((x) => x.line === l.id)?.id ?? owner;
			under.set(l.id, owner);
		}
		shots.forEach((sh, j) => {
			const said = lines.filter((l) => under.get(l.id) === sh.id);
			let at = round(t + 0.3);
			for (const l of said) {
				const dur = sayFor(l.text ?? '');
				clips.push({ id: `l${sc.id}-${l.id}`, kind: 'line', track: 'A1', start: at, in: 0, dur, vol: 1, text: l.text ?? '' });
				at = round(at + dur + 0.3);
			}
			const dur = Math.max(3, round(at - t));
			const notes = [sh.angle && sh.angle !== 'eye' ? `${nameIn(ANGLES, sh.angle)} angle` : '', sh.move && sh.move !== 'static' ? nameIn(MOVES, sh.move) : '']
				.filter(Boolean)
				.join(', ');
			/** @type {import('$lib/auth/client').ClipScript} */
			const where = { scene: sc.name || `Scene ${k + 1}`, label: sh.plain ? `${k + 1}` : `${k + 1}.${j + 1}`, description: sh.shows ?? '' };
			if (sh.size) where.size = sizeName(sh.size);
			if (notes) where.notes = notes;
			clips.push({ id: `s${sc.id}-${sh.id}`, kind: 'slate', track: 'V1', start: round(t), in: 0, dur, vol: 0, script: where });
			t = round(t + dur);
		});
	});
	const title = (s?.title ?? 'A script').replace(/\s*·\s*script$/, '');
	return {
		name: `${title} · cut`,
		project: null,
		variant: null,
		description: `Made from the script “${s?.title ?? title}”.`,
		aspect: '16:9',
		tags: [],
		stage: 'edit',
		version: 1,
		clips: clips.sort((a, b) => a.start - b.start || (a.track === b.track ? 0 : a.track === 'V1' ? -1 : 1)),
		script: { vault, entry: script },
		story: s?.story ?? null
	};
}

/**
 * The cuts made from the scripts of story entry `story`, or naming it, the first made first.
 * @param {import('../avendb/vaults.js').WorldView} world @param {string} story
 */
export function cutsOf(world, story) {
	return world.entries
		.filter((e) => e.type === 'cut' && !e.deleted && !(e.tags ?? []).includes('avendb:deleted'))
		.map((e) => {
			try {
				return { e, t: JSON.parse(/** @type {any} */ (e.record)?.timeline || '{}') };
			} catch {
				return { e, t: {} };
			}
		})
		.filter(({ t }) => t?.story?.entry === story)
		.sort((a, b) => (a.e.created ?? 0) - (b.e.created ?? 0))
		.map(({ e, t }) => ({ entry: e.entry, name: /** @type {any} */ (e.record)?.name ?? 'A cut', script: t.script?.entry ?? null, clips: (t.clips ?? []).length }));
}
