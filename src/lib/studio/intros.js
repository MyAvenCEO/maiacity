/*
 * MaiaCity V1's two first-run intros in the studio (Samuel 2026-10-18: "the 2 game v1 intro videos … into our 3d world
 * timelines as 2 scripts … so we can visually tune them"): the first player's and the second's, each a story of its
 * own in the Maia City COOP vault, a script of it, and a cut of that script whose picture is the intro's world shots
 * (game/film/shot.js, world maiacity-v1, area A or B) and whose voice-over is its lines, at the times the game tells
 * them ($lib/maiacity-v1/intro.js, its times baked in $lib/maiacity-v1/intro/<seat>.json). Each shot starts as the
 * world's own camera (camera kind `world`: the moves the game codes) and is tuned in the studio, a new version of it
 * each time; the game plays the intro's shots (Game.svelte, ./intro.js `reelFor`).
 *
 * Like the legacy films (./legacyfilms.js) they are part of Maia City's seed: brought in the same one run
 * (`bringFilms`), only in the Mac app with avenDB open, only into the Maia City vault, never a person's own, and only
 * what is missing: the story, the script, the shots and the cut each carry the intro's tag, so a second run finds them.
 * Everything made here is data: the shots are specs ./shot.js checks, the cut names them; nothing in it is code.
 */

import { answer } from '$lib/avendb/ops.js';
import { WORLDS } from '../../../game/film/worlds.js';
import { CUT, createCut, schemaIn, worldOf } from './cuts.js';
import { SHOT, SHOT_V1 } from './avenshots.js';
import { DELIVERY, SCRIPT, SCRIPT_V2 } from './scripts.js';

/**
 * Each intro: its key (its tag is `intro:<key>`), the seat it is played for, and what it is called.
 * @typedef {{ key: string, seat: 'A' | 'B', name: string }} Intro
 * @type {Intro[]}
 */
export const INTROS = [
	{ key: 'v1-A', seat: 'A', name: `Intro · ${WORLDS['maiacity-v1'].areaNames?.A ?? 'Player 1'}` },
	{ key: 'v1-B', seat: 'B', name: `Intro · ${WORLDS['maiacity-v1'].areaNames?.B ?? 'Player 2'}` }
];

/** The story flow's Movie stage, as $lib/avendb/flows.js `stageTag('story', 'movie')` names it. */
const MOVIE = 'story:movie';

/** The tag everything of intro `i` carries: its story, its script, its shots and its cut. @param {Intro} i */
export const introTag = (i) => `intro:${i.key}`;

/**
 * @typedef {{ id: string, key: string, chapter: string, title: string, kind: string, t: number, dur: number,
 *   segs: { kind: string, n: number, t: number, dur: number }[], lines: { t: number, dur: number, text: string }[],
 *   text: string[], shots: { t: number, dur: number, hour: number, hourTo?: number, cold?: boolean, name: string, line?: string }[] }} Step
 * @typedef {{ version: number, seat: 'A' | 'B', seconds: number, steps: Step[] }} Baked
 */

/**
 * What vault `vault` holds of intro `i`: its story, its script and its cut, and its shots by name, each by its tag.
 * @param {import('../avendb/vaults.js').WorldView} world @param {string} vault @param {Intro} i
 */
export function heldIntro(world, vault, i) {
	const tag = introTag(i);
	const live = (/** @type {any} */ e) => e.vault === vault && !e.deleted && !(e.tags ?? []).includes('avendb:deleted') && (e.tags ?? []).includes(tag);
	const mine = world.entries.filter(live);
	/** @type {Map<string, string>} */
	const shots = new Map();
	for (const e of mine) if (e.type === SHOT && /** @type {any} */ (e.record)?.version === 1) shots.set(/** @type {any} */ (e.record).name, `shot:${e.entry}`);
	return {
		story: mine.find((e) => e.type === 'story') ?? null,
		script: mine.find((e) => e.type === SCRIPT) ?? null,
		cut: mine.find((e) => e.type === CUT) ?? null,
		shots
	};
}

/** What each of the intro's moments plays, as a scene's action says it */
const PLAYS = {
	intro: 'The trailer: the van and the road, cut on the film camera’s moves.',
	station: 'At the gas station: the newcomer walks over to the pickup and gets in.',
	drive: 'A drive in the Village COOP’s pickup along the gravel track.',
	load: 'At the shed: what the village shares, loaded onto the pickup.',
	build: 'At home: it is set up, step by step, as the words tell it.',
	sow: 'The seed into the earth and the water over it.',
	mint: 'The first mint, the shot held while it is made; then the newcomer beams.',
	invest: 'The invest, the shot held while it is made.',
	spot: 'Choosing where the tree grows, the walk to it, the plant stake struck.',
	pick: 'The seed picked from the backpack, the shot held while it is.',
	done: 'The last shot of the intro.',
	next: 'Told over the world as it stands.'
};

/** A world shot's name in the vault: the intro's, then the shot's own. @param {Intro} i @param {Step['shots'][number]} s */
const shotName = (i, s) => `${i.name} · ${s.name}`;

/** The world shot each of a step's lines is told under: the one its line is on, else the one on screen as it starts. */
function shotOfLine(/** @type {Step} */ step, /** @type {string} */ text) {
	const told = step.lines.find((l) => l.text.includes(text));
	const at = told?.t ?? 0;
	return step.shots.find((s) => s.line?.includes(text)) ?? [...step.shots].reverse().find((s) => s.t <= at + 1e-6) ?? step.shots[0];
}

/**
 * The script of intro `i` from its baked times: a scene for each step of the story (its name the step's title, its
 * action what the world plays, its lines the voice-over, one planned shot a line, naming the world shot it is told
 * under: `shots` maps each shot's name to its id).
 * @param {Intro} i @param {Baked} data @param {{ vault: string, entry: string }} story @param {Map<string, string>} shots @param {number} now
 */
export function scriptOf(i, data, story, shots, now) {
	const scenes = data.steps.map((step, k) => {
		const lines = step.text.map((text, j) => ({ id: j + 1, who: 'voice', text }));
		return {
			id: k + 1,
			name: step.title,
			action: `${step.chapter}. ${PLAYS[/** @type {keyof typeof PLAYS} */ (step.kind)] ?? PLAYS.next}`,
			told: step.text.join(' '),
			lines,
			shots: lines.map((l) => {
				const s = shotOfLine(step, l.text);
				const id = s ? shots.get(shotName(i, s)) : undefined;
				return { id: l.id, shows: s ? `${s.name}: the world’s own camera, till it is tuned` : '', line: l.id, ...(id ? { shot: id } : {}) };
			})
		};
	});
	return { kind: SCRIPT, title: `${i.name} · script`, story, pinned: '', language: 'en', scenes, at: now };
}

/**
 * The chapters of a cut of the intro: one where each new chapter of the story starts, at that step's start (seconds).
 * @param {Baked} data @returns {{ id: number, at: number, name: string }[]}
 */
export function chaptersOf(data) {
	/** @type {{ id: number, at: number, name: string }[]} */
	const out = [];
	for (const step of data.steps) if (step.chapter && out.at(-1)?.name !== step.chapter) out.push({ id: out.length + 1, at: step.t, name: step.chapter });
	return out;
}

/**
 * The cut of intro `i`: its world shots one after another on the picture track, each at the second of the intro it
 * shows and as long, its lines on the voice track at the times they are told; its chapters; the script and the story
 * it is of.
 * @param {Intro} i @param {Baked} data @param {Map<string, string>} shots
 * @param {{ vault: string, entry: string }} script @param {{ vault: string, entry: string }} story
 * @returns {Partial<import('$lib/auth/client').Timeline>}
 */
export function cutOf(i, data, shots, script, story) {
	const round = (/** @type {number} */ x) => Math.round(x * 1e3) / 1e3;
	/** @type {import('$lib/auth/client').TimelineClip[]} */
	const clips = [];
	data.steps.forEach((step, k) => {
		step.shots.forEach((s, j) => {
			const id = shots.get(shotName(i, s));
			if (!id) return;
			clips.push({ id: `w${k + 1}-${j + 1}`, kind: 'world', track: 'V1', start: round(step.t + s.t), in: 0, dur: round(s.dur), vol: 0, shot: id, shotVersion: 1, script: { scene: step.title, label: `${k + 1}.${j + 1}`, description: s.line ?? '' } });
		});
		step.lines.forEach((l, j) => clips.push({ id: `l${k + 1}-${j + 1}`, kind: 'line', track: 'A1', start: round(step.t + l.t), in: 0, dur: round(l.dur), vol: 1, text: l.text }));
	});
	return {
		name: i.name,
		project: i.name,
		variant: null,
		description: `MaiaCity V1's first-run intro for ${WORLDS['maiacity-v1'].areaNames?.[i.seat] ?? i.seat}, shot by shot in its world: tune each shot, and the game plays it.`,
		aspect: '16:9',
		tags: [],
		stage: 'edit',
		version: 1,
		clips: clips.sort((a, b) => a.start - b.start || (a.track === b.track ? 0 : a.track === 'V1' ? -1 : 1)),
		chapters: chaptersOf(data),
		...(/** @type {any} */ ({ script, story }))
	};
}

/** The story's text: the intro's voice-over, a paragraph a step. @param {Baked} data */
const textOf = (data) => data.steps.map((s) => s.text.join(' ')).filter(Boolean).join('\n\n');

/**
 * Every intro the Maia City vault lacks a cut of, brought into it: its story (made first, so the studio shows it as it
 * comes), its world shots, its script and its cut, each only if it is not there yet. `tell` hears how far each is,
 * `arrived` each as its cut is made (or why it can't be: `missing`).
 * @param {(c: string, ...a: any[]) => Promise<any>} call @param {{ vault: string, as: string }} city
 * @param {{ tell: (i: Intro, line: string, at?: import('./importer.js').Progress) => void,
 *   arrived: (i: Intro, failed: { hash: string, error: string }[], missing?: string) => Promise<void> }} on
 * @returns {Promise<{ film: Intro, failed: { hash: string, error: string }[] }[]>}
 */
export async function bringIntros(call, city, on) {
	const { loadBaked, shotSpec } = await import('$lib/maiacity-v1/intro.js');
	const brought = [];
	let world = await worldOf(call);
	for (const i of INTROS) {
		let held = heldIntro(world, city.vault, i);
		if (held.cut) continue;
		const data = /** @type {Baked | null} */ (await loadBaked(i.seat));
		if (!data?.steps?.length) {
			await on.arrived(i, [], 'the intro is not timed yet (bun scripts/maiacity-v1/bake-intro.mjs)');
			continue;
		}
		const tag = introTag(i);
		on.tell(i, 'Making its story…');
		let story = held.story?.entry;
		if (!story) {
			const value = { kind: 'story', title: i.name, text: textOf(data), description: `MaiaCity V1's first-run intro, as ${WORLDS['maiacity-v1'].areaNames?.[i.seat] ?? i.seat} plays it.`, series: 'MaiaCity V1', sparks: [], tags: [] };
			story = answer(await call('run', { op: 'create', vault: city.vault, type: 'story', tags: [MOVIE, tag], value, as: city.as })).entry;
		}
		// its world shots, each the world's own camera at its second of the intro, made once
		await schemaIn(call, world, city.vault, SHOT_V1, city.as);
		const all = data.steps.flatMap((step) => step.shots.map((s) => ({ step, s })));
		let done = 0;
		for (const { step, s } of all) {
			const name = shotName(i, s);
			if (!held.shots.has(name)) {
				const value = { kind: SHOT, shot: '', name, project: i.name, version: 1, spec: JSON.stringify(shotSpec(i.seat, step, s)), at: Math.floor(Date.now() / 1000) };
				held.shots.set(name, `shot:${answer(await call('run', { op: 'create', vault: city.vault, type: SHOT, tags: [tag], value, as: city.as })).entry}`);
			}
			on.tell(i, `Its world shots: ${++done} of ${all.length}`, { done, total: all.length, part: 0, failed: [] });
		}
		world = await worldOf(call);
		held = { ...heldIntro(world, city.vault, i), shots: held.shots };
		const storyLink = { vault: city.vault, entry: /** @type {string} */ (story) };
		let script = held.script?.entry;
		if (!script) {
			on.tell(i, 'Its script…');
			await schemaIn(call, world, city.vault, SCRIPT_V2, city.as);
			script = answer(await call('run', { op: 'create', vault: city.vault, type: SCRIPT, tags: [DELIVERY, tag], value: scriptOf(i, data, storyLink, held.shots, Math.floor(Date.now() / 1000)), as: city.as })).entry;
		}
		on.tell(i, 'Its cut…');
		await createCut(cutOf(i, data, held.shots, { vault: city.vault, entry: /** @type {string} */ (script) }, storyLink), { vault: city.vault, as: city.as, tags: [tag] });
		await on.arrived(i, []);
		brought.push({ film: i, failed: [] });
		world = await worldOf(call);
	}
	return brought;
}
