// @ts-nocheck — plain JS
/**
 * MaiaCity V1's first-run intro as a film: each seat's whole journey (./tour.js `story`) played on a fresh game, the
 * same every time, as a list of world shots (game/film/shot.js) one after another, each carrying its line of the
 * voice-over. The film world of /games/maiacity-v1/?film&area=A|B (./film.js) plays it on the film's clock; the studio
 * gets it as a story, a script and a cut in the Maia City vault ($lib/studio/intros.js), to tune shot by shot; the game
 * plays a step's moment through the same shots (Game.svelte, `reelFor`), so what the studio shows is what the game
 * plays.
 *
 * The plan is pure: the game each step is told on (the moves of the journey made one after another, at fixed times),
 * where the world stands for it (./tour.js `worldStage`), and the segments its moment plays as (the moment; the hold
 * while the game waits on the player's move; what follows the move). How long each segment runs, where each shot cuts
 * and when each line is told are measured by playing the world itself (./film.js `measure`) and kept per seat in
 * ./intro/A.json and ./intro/B.json (`bun run scripts/maiacity-v1/bake-intro.mjs`), each step under a key of what it
 * tells and shows, so a step whose words or moment changed is measured again rather than played to old times.
 *
 * Until a shot is tuned in the studio it is the world's own camera (camera kind `world`): the moves coded in ./world.js,
 * its hour the story's, its lights as the moment has them (the low cut cold).
 */

import { act, advance, newGame } from '../../../game/maiacity-v1/engine.js';
import { WORLDS } from '../../../game/film/worlds.js';
import { reelOf } from '../../../game/film/reel.js';
import { STORY_INVESTS, revealOf, story, worldStage } from './tour.js';
import { treeNow } from './trees.js';
import { plantOf } from './plants.js';

/** the seats an intro is played for, and what each is called in the studio */
export const SEATS = /** @type {const} */ (['A', 'B']);
/** the fresh game every intro is played on starts here (ms): the same game, the same story, every time */
export const EPOCH = Date.UTC(2026, 9, 1, 8);
/** the frames a second the world is moved on at (./film.js): every moment measured and played on the same ticks */
export const RATE = 60;
/** how long the film holds the shot a move is asked in, before the move is made (s) */
export const HOLD = 2;
/** the longest the film follows the walk to the spot (s): the game walks all the way, the film cuts to the stake */
export const WALK = 6;
/** where each seat's first tree grows in its intro, and its seed: the first's where the game's demo puts it */
export const TREES = { A: { x: 0, z: 40, plant: 'apple' }, B: { x: 30, z: -28, plant: 'pear' } };
/** the version of the plan's maths: a baked schedule of another is measured again */
export const PLAN_VERSION = 1;

/** the move a step of the story waits on, as the intro makes it (null: the step is done once told) */
function moveOf(view, seat, step) {
	if (step.kind === 'mint') return { type: 'mint' };
	if (step.kind === 'invest') return { type: 'invest', coop: step.coop, amount: Math.max(0, step.goal - step.have) };
	if (step.kind === 'spot') return { type: 'mark', x: TREES[seat].x, z: TREES[seat].z };
	if (step.kind === 'pick') return { type: 'seedling', plant: TREES[seat].plant };
	if (step.kind === 'sow') return { type: 'plant', v: plantOf(view.players[seat].seedling)?.version };
	return null;
}

/** what a step's moment plays as, one segment after another: the moment; the shot held while the move waits; after it
 *  (the first mint: the newcomer beaming; the spot: the walk to it and the plant stake) */
export function segsOf(step) {
	if (step.kind === 'mint') return ['moment', 'hold', 'joy'];
	if (step.kind === 'invest' || step.kind === 'pick') return ['moment', 'hold'];
	if (step.kind === 'spot') return ['moment', 'hold', 'walk', 'sticks'];
	return ['moment'];
}

/** a short stable hash (FNV-1a, 32 bits, hex) */
function hash(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}

/** a key of everything a step tells and shows: its baked times are its own while the key is the same */
export function stepKey(p) {
	const { step, stage, reveal, trees } = p;
	const shows = { id: step.id, kind: step.kind, part: step.part, leg: step.leg, what: step.what, fetch: step.fetch, place: step.place, shots: step.shots, hold: step.hold, talk: step.talk, act: step.act, close: step.close, lines: step.lines };
	return hash(JSON.stringify([PLAN_VERSION, RATE, HOLD, WALK, shows, stage, reveal, trees.map((t) => [t.seat, t.plant.id, t.x, t.z, t.stage]), segsOf(step)]));
}

/** the trees standing in a view, as the world draws them */
const treesOf = (view, now) => ['A', 'B'].filter((s) => view.players[s].tree).map((s) => ({ seat: s, name: view.players[s].tree.name, ...treeNow(view, view.players[s].tree, now) }));

/** a fresh game with the seats taken: the first's journey made already when the intro is the second's */
function gameFor(seat) {
	const names = WORLDS['maiacity-v1'].areaNames;
	let g = newGame(EPOCH);
	g.players.A.founder = 'intro:A';
	g.players.A.name = names.A;
	if (seat === 'B') {
		g.players.B.founder = 'intro:B';
		g.players.B.name = names.B;
		// the second's journey comes after the first's (as the game's own demo of it): minted, invested, planted
		const t = TREES.A;
		const moves = [{ type: 'mint' }, { type: 'invest', coop: 'maia', amount: STORY_INVESTS.maia }, { type: 'invest', coop: 'village', amount: STORY_INVESTS.village }, { type: 'invest', coop: 'tribe', amount: STORY_INVESTS.tribe }, { type: 'mark', x: t.x, z: t.z }, { type: 'seedling', plant: t.plant }, { type: 'plant', v: plantOf(t.plant)?.version }];
		moves.forEach((m, i) => (g = act(g, 'A', m, EPOCH + 5e3 + i * 1e3)));
	}
	return g;
}

/**
 * A seat's intro as it plays: every step of its story in order, each with the game it is told on (view), where the
 * world stands (stage: what `world.set` takes, and the place looked at), how much land shows (reveal), the trees,
 * the segments its moment plays as, the move made after it, and its key.
 * @param {'A' | 'B'} seat
 */
export function introPlan(seat) {
	let g = gameFor(seat);
	const seen = {};
	const out = [];
	for (let i = 0, t = EPOCH + 30e3; i < 80; i++, t += 1e3) {
		const view = advance(g, t);
		const steps = story(view, seat, seen);
		const at = steps.findIndex((x) => !x.done);
		if (at < 0) break;
		const step = steps[at];
		const move = moveOf(view, seat, step);
		const p = { i: out.length, step, view, now: t, steps, at, stage: worldStage(view, seat, steps, at), reveal: revealOf(steps, at), trees: treesOf(view, t), segs: segsOf(step), move };
		p.key = stepKey(p);
		out.push(p);
		if (move) g = act(g, seat, move, t);
		else seen[step.id] = true; // told (a Next, an intro), or a moment the world plays and is done with
	}
	return { seat, steps: out };
}

// the baked times (./intro/A.json, ./intro/B.json), loaded as they are asked for
const baked = {};
const loading = {};
/** a seat's baked times, once loaded (null: none, or not yet) */
export const bakedOf = (seat) => baked[seat] ?? null;
/** load a seat's baked times @returns {Promise<any>} */
export function loadBaked(seat) {
	loading[seat] ??= (seat === 'B' ? import('./intro/B.json') : import('./intro/A.json'))
		.then((m) => (baked[seat] = m.default ?? m))
		.catch(() => (baked[seat] = null));
	return loading[seat];
}

/** the baked step a planned step plays to, if its key is still the same (else it is measured again) */
export function freshStep(data, p) {
	const b = data?.version === PLAN_VERSION ? data.steps.find((x) => x.id === p.step.id) : null;
	return b && b.key === p.key ? b : null;
}

/** a world shot of the intro: the world's own camera at that second of the seat's intro, its hour and lights the
 *  story's (the low cut cold), carrying its line */
export function shotSpec(seat, step, shot) {
	return {
		world: { sandbox: 'maiacity-v1', area: seat, build: null, seed: 1, stand: [0, 0], clock: round(step.t + shot.t) },
		seconds: round(shot.dur),
		fps: 30,
		aspect: '16:9',
		camera: { kind: 'world' },
		lens: { fov: 42 },
		time: { hour: shot.hour, ...(shot.hourTo !== undefined ? { hourTo: shot.hourTo } : {}) },
		exposure: { meter: 'lock', stops: 0 },
		lights: shot.cold ? COLD : [],
		meta: { name: shot.name, scene: step.id, chapter: step.chapter, title: step.title, ...(shot.line ? { line: shot.line } : {}) }
	};
}
/** the low cut cold (./world.js `light`): a bluer, flatter sun, the fill and the tent's glow down */
export const COLD = [{ id: 'sun', intensity: 0.55, color: '#bfccd9' }, { id: 'fill', intensity: 0.8 }, { id: 'glow', intensity: 0.35 }];
const round = (x) => Math.round(x * 1e4) / 1e4;

/**
 * The shots a step is filmed by in the game (its moment's, from its start; joy and the plant stake play their own),
 * as a reel (game/film/reel.js), when the seat's baked times are in and still the step's; else null (the moves coded
 * in ./world.js). Starts loading the baked times the first time it is asked.
 */
export function reelFor(seat, step) {
	const data = bakedOf(seat);
	if (!data) return void loadBaked(seat), null;
	const b = data.version === PLAN_VERSION ? data.steps.find((x) => x.id === step.id) : null;
	if (!b || b.lineKey !== linesKey(step)) return null;
	const end = b.segs[0]?.dur ?? b.dur;
	const shots = b.shots.filter((s) => s.t < end - 1e-6);
	return shots.length ? reelOf(shots.map((s) => shotSpec(seat, b, s))) : null;
}
/** what a step tells, the part of its key the game can check without the plan */
export const linesKey = (step) => hash(JSON.stringify([step.id, step.kind, step.lines]));
