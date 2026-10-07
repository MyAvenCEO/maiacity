/**
 * SANDBOX 6 · AUTOPLAY — a player that builds the whole economy by itself, step by step, the way a person would:
 * wood first, then stone and food, the mines, the smiths, the soldiers, and at last the march on the keep. The film
 * camera grows its valley with it (a settlement that is already busy), and it plays a whole game headless to prove
 * every chain runs end to end.
 */
import { BUILDINGS, WATER } from './rules.js';
import { PLAYER, RIVAL } from './sim.js';

/** the plan: what to build, in order, and where it would rather stand */
const PLAN = [
	['woodcutter', 'trees'],
	['sawmill', 'home'],
	['quarry', 'rocks'],
	['woodcutter', 'trees'],
	['forester', 'woodcutter'],
	['fishery', 'water'],
	['well', 'home'],
	['farm', 'open'],
	['coalmine', 'mine'],
	['ironmine', 'mine'],
	['guardhut', 'east'],
	['mill', 'home'],
	['bakery', 'home'],
	['smelter', 'home'],
	['farm', 'open'],
	['livestock', 'home'],
	['armourer', 'home'],
	['toolmaker', 'home'],
	['fishery', 'water'],
	['guardhut', 'south'],
	['watchtower', 'east'],
	['coalmine', 'mine'],
	['forester', 'woodcutter'],
	['goldmine', 'mine'],
	['mint', 'home'],
	['armourer', 'home'],
	['well', 'home'],
	['guardhut', 'east']
];

/**
 * Plays a game one decision at a time: call `tick()` now and then (every few seconds of game time).
 * @param {import('./sim.js').Sim} sim
 * @param {{ attack?: boolean }} [o]
 */
export function createAutoplay(sim, o = {}) {
	const st = sim.state, g = sim.grid;
	st.auto ??= 0;
	/** @type {string[][]} the plan as this game follows it (a used-up mine adds its rebuilding) */
	st.autoPlan ??= PLAN.map((x) => [...x]);
	const plan = st.autoPlan;
	let tries = 0;
	const hq = () => st.buildings[st.hq];
	const keep = () => st.buildings[st.keep];
	const count = (/** @type {(n: number) => boolean} */ f, /** @type {number} */ n, /** @type {number} */ r) => g.within(n, r).filter(f).length;
	const ofType = (/** @type {string} */ t) => Object.values(st.buildings).filter((b) => b.type === t && b.owner === PLAYER);

	/** how well a node suits a building: higher is better, -Infinity where it may not stand */
	function score(/** @type {string} */ type, /** @type {string} */ want, /** @type {number} */ n) {
		if (sim.canBuild(type, n)) return -Infinity;
		const home = hq().node;
		const d = g.dist(home, n);
		const east = g.x(n) - g.x(home);
		switch (want) {
			case 'trees':
				return count((j) => st.obj[j]?.k === 'tree', n, 5) * 3 - d;
			case 'rocks':
				return count((j) => st.obj[j]?.k === 'rock', n, 4) * 4 - d;
			case 'water':
				return count((j) => st.terrain[j] === WATER, n, 3) * 2 - d * 1.5;
			case 'woodcutter': {
				const w = ofType('woodcutter')[0];
				return w ? -g.dist(w.node, n) * 2 - d * 0.3 : -d;
			}
			case 'mine': {
				const ore = /** @type {string} */ (BUILDINGS[type].ore);
				const code = ore === 'coal' ? 1 : ore === 'iron' ? 2 : 3;
				return count((j) => st.ore[j] === code, n, 2) * 3 - d;
			}
			case 'open':
				return count((j) => !st.obj[j] && st.terrain[j] === 0, n, 2) - d;
			case 'east': {
				// toward the rival, at the edge of the land
				return east * 0.8 + (g.dist(n, keep()?.node ?? n) < 9 ? -50 : 0) - Math.abs(g.z(n) - g.z(keep()?.node ?? home)) * 0.2;
			}
			case 'keep':
				return -g.dist(n, keep()?.node ?? n);
			case 'south':
				return g.z(n) - g.z(home) + east * 0.3;
			default:
				return -d - (count((j) => st.obj[j]?.k === 'bld', n, 3) > 3 ? 4 : 0);
		}
	}
	function place(/** @type {string} */ type, /** @type {string} */ want) {
		const spots = [];
		for (let n = 0; n < g.N; n++) {
			if (st.owner[n] !== PLAYER) continue;
			const s = score(type, want, n);
			if (s > -Infinity) spots.push([s, n]);
		}
		spots.sort((a, b) => b[0] - a[0]);
		for (const [, n] of spots.slice(0, 6)) {
			const r = sim.build(type, n, true);
			if (r.ok && r.linked) return true;
			if (r.ok) sim.demolish(n);
		}
		return false;
	}
	/** split long roads with flags, so more carriers share the load */
	function flags() {
		for (const r of Object.values(st.roads)) {
			if (r.path.length < 6) continue;
			const k = Math.floor(r.path.length / 2);
			if (!sim.canFlag(r.path[k])) {
				sim.flag(r.path[k]);
				return;
			}
		}
	}
	return {
		tick() {
			if (st.result) return;
			flags();
			// a used-up mine is torn down and dug again elsewhere
			for (const b of Object.values(st.buildings))
				if (b.owner === PLAYER && b.deposit <= 0 && BUILDINGS[b.type].kind === 'mine' && b.stage === 'live') {
					sim.demolish(b.node);
					plan.splice(st.auto, 0, [b.type, 'mine']);
				}
			const s = sim.summary();
			if (st.auto < plan.length) {
				const [type, want] = plan[st.auto];
				const cost = BUILDINGS[type].cost;
				const sites = Object.values(st.buildings).filter((b) => b.owner === PLAYER && b.stage === 'site').length;
				const enough = Object.entries(cost).every(([w, n]) => (s.stock[w] ?? 0) >= n);
				if (sites < 3 && (enough || tries > 8)) {
					if (place(type, want) || ++tries > 12) {
						st.auto++;
						tries = 0;
					}
				} else tries++;
			}
			// once the plan is built, towers toward the keep, so enough soldiers stand in reach of it
			const k = keep();
			if (st.auto >= plan.length && k && k.owner === RIVAL) {
				const near = Object.values(st.buildings).filter((b) => b.owner === PLAYER && BUILDINGS[b.type].kind === 'military' && g.dist(b.node, k.node) <= 14);
				const building = near.some((b) => b.stage === 'site');
				if (!building && near.length < 5 && (s.stock.plank ?? 0) >= 3 && (s.stock.stone ?? 0) >= 4) place('watchtower', 'keep');
			}
			if (o.attack !== false) {
				// march on the nearest rival building that can be taken
				const targets = Object.values(st.buildings).filter((b) => b.owner === RIVAL && sim.attackable(b.id) > 0);
				for (const t of targets) {
					const have = sim.attackable(t.id);
					if (have >= t.soldiers.length + 2) {
						sim.attack(t.id, have);
						break;
					}
				}
			}
		},
		get step() {
			return st.auto;
		}
	};
}
