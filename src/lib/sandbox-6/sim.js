/**
 * SANDBOX 6 · THE SIMULATION — the whole game as plain data and the rules that move it on, without a pixel: the page
 * draws it (./view.js), and a script can play it headless (./autoplay.js).
 *
 * The state is one JSON object (save it, load it, it goes on where it was). Every 0.1 s of game time:
 *   · carriers walk their roads: each road has one, who takes a ware from the flag at one end to the flag at the
 *     other; at its last flag the ware goes into the building that asked for it;
 *   · every half second the economy matches wares to who needs them: a site its planks and stone, a workshop its
 *     inputs, a guard hut its coins; a ware nobody needs goes to the nearest storehouse; what a storehouse holds is
 *     sent out to whoever asks, nearest first; a ware finds its way flag by flag along the shortest roads;
 *   · every second the people follow: a settler from a storehouse becomes the carrier of a new road, the builder of a
 *     site, the worker of a finished building (a worker takes tools along), a soldier fills a guard hut;
 *   · buildings work: workshops turn inputs into wares, gatherers go out into the land (trees, rocks, fish, fields);
 *   · soldiers hold the land: an occupied military building widens it; land lost burns what stands on it;
 *   · the rival keeps its keep and towers manned, trains its soldiers, and in time comes for your borders.
 */
import { BUILDINGS, FOOD, GOALS, GRASS, MAX_RANK, MOUNTAIN, START, WARES, WATER, holdsLand } from './rules.js';
import { SE, findPath, makeGrid } from './hex.js';
import { growValley } from './map.js';

/** seconds of game time a step moves on */
export const TICK = 0.1;
export const PLAYER = 0, RIVAL = 1;
/** wares a flag holds at most */
export const FLAG_CAP = 8;
/** each input of a workshop is kept this full */
const SLOT_CAP = 4;
/** nodes a second: walking, and carrying */
const WALK = 1.8, CARRY = 1.45;
/** how far soldiers march to attack */
export const ATTACK_REACH = 14;
/** soldiers the headquarters keeps home */
const HQ_GUARD = 2;
const FORESTER_TREES = 22;
/** a building rests while the storehouses hold this much of what it makes */
const ENOUGH = 40;

/**
 * A new game in a valley grown from a seed.
 * @param {number} [seed]
 */
export function newGame(seed = 7) {
	const v = growValley(seed);
	const N = v.W * v.H;
	const st = {
		v: 1,
		seed,
		time: 0,
		rng: (Math.imul(seed, 2654435761) >>> 0) || 1,
		W: v.W,
		H: v.H,
		terrain: v.terrain,
		height: v.height,
		ore: v.ore,
		amount: v.amount,
		fish: v.fish,
		obj: /** @type {any[]} */ (v.obj),
		road: /** @type {number[]} */ (Array(N).fill(0)),
		owner: /** @type {number[]} */ (Array(N).fill(-1)),
		/** @type {Record<string, any>} */ flags: {},
		/** @type {Record<string, any>} */ roads: {},
		/** @type {Record<string, any>} */ buildings: {},
		/** @type {Record<string, any>} */ units: {},
		/** @type {Record<string, any>} */ wares: {},
		nextId: 1,
		/** @type {Record<string, number>} */ made: {},
		/** @type {{ t: number, text: string, node: number, tone: string, n: number }[]} */ msgs: [],
		msgSeq: 0,
		/** @type {null | 'won' | 'lost'} */ result: null,
		/** what changed, for whoever draws it */
		netV: 1,
		objV: 1,
		terV: 1,
		/** when the slower rules next run */
		clocks: { dispatch: 0, people: 0, grow: 0, fish: 20, pop: 18, train: 10, goals: 1, reinforce: 110, rebalance: 45, promote: 260, raid: 2400 },
		hq: 0,
		keep: 0,
		/** buildings burning, for a while */
		/** @type {{ node: number, t: number }[]} */ fx: [],
		/** @type {Record<string, boolean>} */ goals: {}
	};
	const sim = createSim(st);
	sim.setup(v);
	return sim;
}

/** A game from its saved state. @param {string | object} saved */
export function loadGame(saved) {
	const st = typeof saved === 'string' ? JSON.parse(saved) : saved;
	if (!st || st.v !== 1 || !Array.isArray(st.terrain)) throw new Error('Not a Sandbox 6 game');
	return createSim(st);
}

/** @typedef {ReturnType<typeof createSim>} Sim */

/** @param {any} st */
export function createSim(st) {
	const g = makeGrid(st.W, st.H);
	const N = g.N;

	const rand = () => {
		st.rng = (st.rng + 0x6d2b79f5) >>> 0;
		let t = st.rng;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const newId = () => st.nextId++;
	/** @param {string} text @param {number} [node] @param {'info'|'good'|'alert'} [tone] */
	const say = (text, node = -1, tone = 'info') => {
		st.msgSeq = (st.msgSeq ?? 0) + 1;
		st.msgs.push({ t: st.time, text, node, tone, n: st.msgSeq });
		if (st.msgs.length > 40) st.msgs.shift();
	};
	const T = (/** @type {any} */ b) => BUILDINGS[b.type];
	const isWarehouse = (/** @type {any} */ b) => b.type === 'hq' || b.type === 'storehouse';
	const all = (/** @type {Record<string, any>} */ o) => Object.values(o);
	const flagAt = (/** @type {number} */ n) => (st.obj[n]?.k === 'flag' ? st.flags[st.obj[n].id] : null);
	const buildingAt = (/** @type {number} */ n) => (st.obj[n]?.k === 'bld' ? st.buildings[st.obj[n].id] : null);
	const warehouses = (owner = PLAYER) => all(st.buildings).filter((b) => b.owner === owner && isWarehouse(b) && b.stage === 'live');
	/** where a unit stands now, as a node */
	const nodeOf = (/** @type {any} */ u) => u.path[Math.max(0, Math.min(u.path.length - 1, Math.round(u.p)))];
	/** a walk across the land: anywhere but water and other buildings */
	const walkable = (/** @type {number} */ i) => st.terrain[i] !== WATER && st.obj[i]?.k !== 'bld';
	const made = (/** @type {string} */ ware) => (st.made[ware] = (st.made[ware] ?? 0) + 1);

	// ── the road network: flags joined by roads, and the shortest way from any flag to any other ──
	let netSeen = -1;
	/** @type {Record<string, { road: number, to: number, cost: number }[]>} */
	let adj = {};
	/** @type {Map<number, Map<number, { d: number, road: number }>>} */
	const routes = new Map();
	function network() {
		if (netSeen === st.netV) return adj;
		netSeen = st.netV;
		routes.clear();
		adj = {};
		for (const f of all(st.flags)) adj[f.id] = [];
		for (const r of all(st.roads)) {
			const cost = r.path.length - 1 + 0.5;
			adj[r.a]?.push({ road: r.id, to: r.b, cost });
			adj[r.b]?.push({ road: r.id, to: r.a, cost });
		}
		return adj;
	}
	/** Every flag that can reach `dest`, how far, and which road it takes first. @param {number} dest */
	function route(dest) {
		network();
		let m = routes.get(dest);
		if (m) return m;
		m = new Map([[dest, { d: 0, road: 0 }]]);
		const open = [dest];
		const done = new Set();
		while (open.length) {
			let k = 0;
			for (let j = 1; j < open.length; j++) if (/** @type {any} */ (m.get(open[j])).d < /** @type {any} */ (m.get(open[k])).d) k = j;
			const f = open.splice(k, 1)[0];
			if (done.has(f)) continue;
			done.add(f);
			const d = /** @type {any} */ (m.get(f)).d;
			for (const e of adj[f] ?? []) {
				const nd = d + e.cost;
				if (nd < (m.get(e.to)?.d ?? Infinity)) {
					m.set(e.to, { d: nd, road: e.road });
					open.push(e.to);
				}
			}
		}
		routes.set(dest, m);
		return m;
	}
	/** how far along the roads, flag to flag */
	const roadDist = (/** @type {number} */ from, /** @type {number} */ to) => route(to).get(from)?.d ?? Infinity;
	/** the road a ware takes next from where it lies */
	const nextRoad = (/** @type {any} */ w) => {
		const b = st.buildings[w.dest];
		return b ? route(b.flag).get(w.flag)?.road ?? 0 : 0;
	};
	/** the nodes a walker follows along the roads from one flag to another, or null */
	function roadWalk(/** @type {number} */ from, /** @type {number} */ to) {
		const m = route(to);
		if (!m.has(from)) return null;
		const nodes = [st.flags[from].node];
		let f = from;
		while (f !== to) {
			const r = st.roads[/** @type {any} */ (m.get(f)).road];
			const fwd = r.a === f;
			const p = fwd ? r.path : [...r.path].reverse();
			for (let k = 1; k < p.length; k++) nodes.push(p[k]);
			f = fwd ? r.b : r.a;
		}
		return nodes;
	}
	/** the nearest storehouse a flag reaches by road that `ok` accepts */
	function nearestWarehouse(/** @type {number} */ flag, /** @type {(b: any) => boolean} */ ok) {
		const m = route(flag);
		let best = null, bd = Infinity;
		for (const wh of warehouses()) {
			const d = m.get(wh.flag)?.d ?? Infinity;
			if (d < bd && ok(wh)) (best = wh), (bd = d);
		}
		return best;
	}

	// ── making and unmaking things ──
	function makeFlag(/** @type {number} */ node, /** @type {number} */ owner) {
		const f = { id: newId(), node, owner, wares: /** @type {number[]} */ ([]), bld: 0 };
		st.flags[f.id] = f;
		const rid = st.road[node];
		st.obj[node] = { k: 'flag', id: f.id };
		if (rid) splitRoad(st.roads[rid], f);
		st.netV++;
		st.objV++;
		return f;
	}
	function makeRoad(/** @type {number[]} */ path, /** @type {number} */ owner) {
		const a = /** @type {any} */ (flagAt(path[0])), b = /** @type {any} */ (flagAt(path[path.length - 1]));
		const r = { id: newId(), a: a.id, b: b.id, path, carrier: 0, owner };
		for (let k = 1; k < path.length - 1; k++) st.road[path[k]] = r.id;
		st.roads[r.id] = r;
		st.netV++;
		return r;
	}
	/** a flag set down on a road splits it in two: the carrier keeps the half it stands on */
	function splitRoad(/** @type {any} */ r, /** @type {any} */ f) {
		const k = r.path.indexOf(f.node);
		const u = st.units[r.carrier];
		for (let j = 1; j < r.path.length - 1; j++) st.road[r.path[j]] = 0;
		delete st.roads[r.id];
		const r1 = makeRoad(r.path.slice(0, k + 1), r.owner);
		const r2 = makeRoad(r.path.slice(k), r.owner);
		if (!u) return;
		if (u.job === 'c-go') {
			u.road = r1.id;
			r1.carrier = u.id;
			return;
		}
		const second = u.p > k;
		const r_ = second ? r2 : r1;
		r_.carrier = u.id;
		u.road = r_.id;
		u.path = r_.path;
		u.p = second ? u.p - k : Math.min(u.p, k);
		if (u.wareId) {
			const w = st.wares[u.wareId];
			u.wareId = 0;
			u.ware = '';
			if (w && f.wares.length < FLAG_CAP) {
				w.flag = f.id;
				w.since = st.time;
				f.wares.push(w.id);
			} else if (w) destroyWare(w);
		}
		u.job = 'c-idle';
		u.wait = 0;
		u.tgt = Math.floor((u.path.length - 1) / 2);
	}
	function makeBuilding(/** @type {string} */ type, /** @type {number} */ node, /** @type {number} */ owner, live = false) {
		const t = BUILDINGS[type];
		const fnode = g.nb(node, SE);
		const flag = flagAt(fnode) ?? makeFlag(fnode, owner);
		const b = {
			id: newId(), type, node, flag: flag.id, owner, stage: live ? 'live' : 'site', since: st.time,
			cost: { ...t.cost }, used: /** @type {Record<string, number>} */ ({}), got: /** @type {Record<string, number>} */ ({}), inc: /** @type {Record<string, number>} */ ({}),
			builder: 0, worker: 0, slots: (t.inputs ?? []).map(() => ({ have: 0, inc: 0 })),
			timer: 0, out: 0, paused: false, status: live ? '' : 'Waiting for a builder', eff: 0,
			soldiers: /** @type {number[]} */ ([]), incS: 0, coins: 0, incC: 0,
			stock: /** @type {Record<string, number>} */ ({}), settlers: 0, deposit: 0, fields: 0, alarm: -99,
			/** @type {null | { a: number, d: number, t: number }} */ fight: null
		};
		for (const w of Object.keys(b.cost)) (b.used[w] = 0), (b.got[w] = 0), (b.inc[w] = 0);
		if (t.kind === 'mine') b.deposit = depositAt(node, /** @type {string} */ (t.ore));
		flag.bld = b.id;
		st.obj[node] = { k: 'bld', id: b.id };
		st.buildings[b.id] = b;
		st.objV++;
		return b;
	}
	/** how much ore a mine at a node can dig: what the rock round it holds */
	function depositAt(/** @type {number} */ node, /** @type {string} */ ore) {
		const code = ore === 'coal' ? 1 : ore === 'iron' ? 2 : 3;
		let n = 0;
		for (const j of g.within(node, 2)) if (st.terrain[j] === MOUNTAIN && st.ore[j] === code) n += st.amount[j];
		return n * 4;
	}
	function destroyWare(/** @type {any} */ w) {
		unclaim(w);
		if (w.flag) {
			const f = st.flags[w.flag];
			if (f) f.wares = f.wares.filter((/** @type {number} */ x) => x !== w.id);
		}
		delete st.wares[w.id];
	}
	/** a ware no longer goes where it was bound: its building stops counting on it */
	function unclaim(/** @type {any} */ w) {
		const b = st.buildings[w.dest];
		w.dest = 0;
		if (!b) return;
		if (b.stage === 'site') b.inc[w.type] = Math.max(0, (b.inc[w.type] ?? 0) - 1);
		else if (w.slot === -2) b.incC = Math.max(0, b.incC - 1);
		else if (w.slot >= 0 && b.slots[w.slot]) b.slots[w.slot].inc = Math.max(0, b.slots[w.slot].inc - 1);
	}
	function removeRoad(/** @type {any} */ r) {
		for (let k = 1; k < r.path.length - 1; k++) st.road[r.path[k]] = 0;
		delete st.roads[r.id];
		const u = st.units[r.carrier];
		if (u) {
			if (u.wareId && st.wares[u.wareId]) destroyWare(st.wares[u.wareId]);
			u.wareId = 0;
			u.ware = '';
			u.road = 0;
			goHome(u);
		}
		st.netV++;
		st.objV++;
	}
	function removeFlag(/** @type {any} */ f) {
		for (const r of all(st.roads)) if (r.a === f.id || r.b === f.id) removeRoad(r);
		if (f.bld && st.buildings[f.bld]) removeBuilding(st.buildings[f.bld]);
		for (const wid of [...f.wares]) if (st.wares[wid]) destroyWare(st.wares[wid]);
		delete st.flags[f.id];
		st.obj[f.node] = null;
		st.netV++;
		st.objV++;
	}
	function removeBuilding(/** @type {any} */ b, burn = true, retally = true) {
		delete st.buildings[b.id];
		if (b.fight && st.units[b.fight.d]) delete st.units[b.fight.d];
		st.obj[b.node] = null;
		const f = st.flags[b.flag];
		if (f) f.bld = 0;
		for (const w of all(st.wares)) if (w.dest === b.id) w.dest = 0;
		for (const uid of [b.worker, b.builder]) {
			const u = st.units[uid];
			if (!u) continue;
			if (u.inside) {
				u.inside = false;
				u.path = [b.node];
				u.p = 0;
				u.tgt = 0;
			}
			releaseTarget(u);
			goHome(u);
		}
		// the soldiers inside walk home
		if (holdsLand(b.type) && b.owner === PLAYER && !isWarehouse(b))
			for (const rank of b.soldiers) {
				const u = spawn('soldier', PLAYER, [b.node], 'home', { rank });
				goHome(u);
			}
		if (burn) st.fx.push({ node: b.node, t: st.time });
		st.objV++;
		if (retally && holdsLand(b.type)) territory();
	}
	function releaseTarget(/** @type {any} */ u) {
		const o = st.obj[u.target];
		if (o && o.r === u.id) delete o.r;
	}

	// ── people ──
	function spawn(/** @type {string} */ kind, /** @type {number} */ owner, /** @type {number[]} */ path, /** @type {string} */ job, extra = {}) {
		const u = {
			id: newId(), kind, owner, path, p: 0, tgt: path.length - 1, speed: kind === 'carrier' ? CARRY : WALK, job,
			road: 0, bld: 0, home: 0, target: -1, ware: '', wareId: 0, rank: 0, wait: 0, inside: false, end: 0, ...extra
		};
		st.units[u.id] = u;
		return u;
	}
	function removeUnit(/** @type {any} */ u) {
		if (u.job === 's-go') {
			const b = st.buildings[u.bld];
			if (b) b.incS = Math.max(0, b.incS - 1);
		}
		releaseTarget(u);
		delete st.units[u.id];
	}
	/** a unit with nothing left to do walks to the nearest storehouse (a rival's to its keep) */
	function goHome(/** @type {any} */ u) {
		if (u.job === 's-go') {
			const b = st.buildings[u.bld];
			if (b) b.incS = Math.max(0, b.incS - 1);
		}
		const here = nodeOf(u);
		const homes = u.owner === PLAYER ? warehouses() : all(st.buildings).filter((b) => b.type === 'keep' && b.owner === RIVAL);
		homes.sort((a, b) => g.dist(here, a.node) - g.dist(here, b.node));
		for (const h of homes.slice(0, 3)) {
			const path = findPath(g, here, h.node, walkable);
			if (path) {
				Object.assign(u, { path, p: 0, tgt: path.length - 1, job: 'home', home: h.id, inside: false, wait: 0, road: 0 });
				return;
			}
		}
		removeUnit(u);
	}
	function arriveHome(/** @type {any} */ u) {
		const h = st.buildings[u.home];
		if (h && h.owner === u.owner) {
			if (u.kind === 'soldier') h.soldiers.push(u.rank);
			else h.settlers++;
			if (u.ware && isWarehouse(h)) h.stock[u.ware] = (h.stock[u.ware] ?? 0) + 1;
		}
		removeUnit(u);
	}

	/** settlers become carriers, builders and workers; soldiers go to man the military buildings */
	function people() {
		for (const r of all(st.roads)) {
			if (r.carrier || r.owner !== PLAYER) continue;
			const wh = nearestWarehouse(r.a, (w) => w.settlers > 0);
			const walk = wh && roadWalk(wh.flag, r.a);
			if (!wh || !walk) continue;
			wh.settlers--;
			const u = spawn('carrier', PLAYER, [wh.node, ...walk], 'c-go', { road: r.id });
			u.speed = WALK;
			r.carrier = u.id;
		}
		for (const b of all(st.buildings)) {
			if (b.owner !== PLAYER) continue;
			const t = T(b);
			if (b.stage === 'site' && !b.builder) {
				const wh = nearestWarehouse(b.flag, (w) => w.settlers > 0);
				const walk = wh && roadWalk(wh.flag, b.flag);
				if (!wh || !walk) {
					b.status = wh ? 'Not connected by road' : 'No settlers free';
					continue;
				}
				wh.settlers--;
				const u = spawn('builder', PLAYER, [wh.node, ...walk, b.node], 'b-go', { bld: b.id });
				b.builder = u.id;
				b.status = 'A builder is on the way';
			} else if (b.stage === 'live' && t.worker && !b.worker) {
				const wh = nearestWarehouse(b.flag, (w) => w.settlers > 0 && (!t.tools || (w.stock.tools ?? 0) > 0));
				const walk = wh && roadWalk(wh.flag, b.flag);
				if (!wh || !walk) {
					const any = nearestWarehouse(b.flag, () => true);
					const noTools = t.tools && !warehouses().some((w) => (w.stock.tools ?? 0) > 0);
					b.status = !any ? 'Not connected by road' : noTools ? 'Waiting for tools (build a toolmaker)' : 'Waiting for a settler';
					if (any && noTools && st.time - (st.toolsWarned ?? -999) > 300) {
						st.toolsWarned = st.time;
						say('You are out of tools: a toolmaker makes them from iron and planks.', b.node, 'alert');
					}
					continue;
				}
				wh.settlers--;
				if (t.tools) wh.stock.tools--;
				const u = spawn('worker', PLAYER, [wh.node, ...walk, b.node], 'w-go', { bld: b.id });
				b.worker = u.id;
				b.status = `A ${t.worker?.toLowerCase()} is on the way`;
			} else if (b.stage === 'live' && t.kind === 'military' && b.soldiers.length + b.incS < /** @type {number} */ (t.capacity)) {
				const wh = nearestWarehouse(b.flag, (w) => w.soldiers.length > (w.type === 'hq' ? HQ_GUARD : 0));
				const walk = wh && roadWalk(wh.flag, b.flag);
				if (!wh || !walk) {
					if (!b.soldiers.length) b.status = nearestWarehouse(b.flag, () => true) ? 'Waiting for soldiers (forge weapons)' : 'Not connected by road';
					continue;
				}
				const k = wh.soldiers.indexOf(Math.max(...wh.soldiers));
				const rank = wh.soldiers.splice(k, 1)[0];
				spawn('soldier', PLAYER, [wh.node, ...walk, b.node], 's-go', { bld: b.id, rank });
				b.incS++;
				if (!b.soldiers.length) b.status = 'Soldiers are on the way';
			}
		}
	}

	// ── the economy: who needs what, and where it comes from ──
	function requestsOf(/** @type {any} */ b) {
		const t = T(b);
		if (b.stage === 'site') return Object.keys(b.cost).map((w) => ({ types: [w], slot: -1, n: b.cost[w] - b.used[w] - b.got[w] - b.inc[w] }));
		if (b.stage !== 'live') return [];
		if (t.kind === 'military')
			return b.soldiers.length && b.soldiers.some((/** @type {number} */ r) => r < MAX_RANK) ? [{ types: ['coin'], slot: -2, n: 2 - b.coins - b.incC }] : [];
		if (b.paused || !b.worker) return [];
		return (t.inputs ?? []).map((/** @type {string[]} */ types, /** @type {number} */ k) => ({ types, slot: k, n: SLOT_CAP - b.slots[k].have - b.slots[k].inc }));
	}
	function claim(/** @type {any} */ w, /** @type {any} */ b, /** @type {number} */ slot) {
		w.dest = b.id;
		w.slot = slot;
		if (b.stage === 'site') b.inc[w.type]++;
		else if (slot === -2) b.incC++;
		else if (slot >= 0) b.slots[slot].inc++;
	}
	function deliver(/** @type {any} */ w) {
		const b = st.buildings[w.dest];
		delete st.wares[w.id];
		if (!b) return;
		if (isWarehouse(b) && b.stage === 'live') b.stock[w.type] = (b.stock[w.type] ?? 0) + 1;
		else if (b.stage === 'site') {
			b.inc[w.type] = Math.max(0, b.inc[w.type] - 1);
			b.got[w.type]++;
		} else if (w.slot === -2) {
			b.incC = Math.max(0, b.incC - 1);
			b.coins++;
		} else if (w.slot >= 0 && b.slots[w.slot]) {
			b.slots[w.slot].inc = Math.max(0, b.slots[w.slot].inc - 1);
			b.slots[w.slot].have++;
		}
	}
	/** a ware set down at a flag, bound nowhere yet */
	function newWare(/** @type {string} */ type, /** @type {any} */ f) {
		const w = { id: newId(), type, flag: f.id, dest: 0, slot: -1, since: st.time };
		st.wares[w.id] = w;
		f.wares.push(w.id);
		return w;
	}
	let turn = 0;
	function dispatch() {
		// wares bound somewhere they can no longer reach let go of it; wares at their building's own flag go in
		for (const w of all(st.wares)) {
			if (!w.flag) continue;
			const b = st.buildings[w.dest];
			if (w.dest && !b) w.dest = 0;
			if (!w.dest) continue;
			if (b.flag === w.flag) {
				const f = st.flags[w.flag];
				f.wares = f.wares.filter((/** @type {number} */ x) => x !== w.id);
				deliver(w);
			} else if (!route(b.flag).has(w.flag)) unclaim(w);
		}
		const loose = all(st.wares).filter((w) => w.flag && (!w.dest || isWarehouse(st.buildings[w.dest])));
		const list = all(st.buildings).filter((b) => b.owner === PLAYER);
		turn = (turn + 1) % Math.max(1, list.length);
		const ordered = [...list.slice(turn), ...list.slice(0, turn)].sort((a, b) => (a.stage === 'site' ? 0 : 1) - (b.stage === 'site' ? 0 : 1));
		const whs = warehouses();
		for (const b of ordered) {
			for (const req of requestsOf(b)) {
				for (let k = 0; k < req.n; k++) if (!supply(b, req, loose, whs)) break;
			}
		}
		// what nobody needs goes to the nearest storehouse
		for (const w of loose) {
			if (w.dest) continue;
			let best = null, bd = Infinity;
			for (const wh of whs) {
				const d = roadDist(w.flag, wh.flag);
				if (d < bd) (best = wh), (bd = d);
			}
			if (best) {
				if (best.flag === w.flag) {
					const f = st.flags[w.flag];
					f.wares = f.wares.filter((/** @type {number} */ x) => x !== w.id);
					w.dest = best.id;
					deliver(w);
				} else claim(w, best, -1);
			}
		}
	}
	function supply(/** @type {any} */ b, /** @type {{ types: string[], slot: number }} */ req, /** @type {any[]} */ loose, /** @type {any[]} */ whs) {
		const m = route(b.flag);
		let best = null, bd = Infinity;
		for (const w of loose) {
			if (st.buildings[w.dest] && !isWarehouse(st.buildings[w.dest])) continue;
			if (!req.types.includes(w.type)) continue;
			const d = m.get(w.flag)?.d ?? Infinity;
			if (d < bd) (best = w), (bd = d);
		}
		if (best) {
			if (best.dest) best.dest = 0;
			claim(best, b, req.slot);
			return true;
		}
		const ranked = whs.map((wh) => /** @type {[number, any]} */ ([m.get(wh.flag)?.d ?? Infinity, wh])).filter(([d]) => d < Infinity).sort((x, y) => x[0] - y[0]);
		for (const [, wh] of ranked) {
			const f = st.flags[wh.flag];
			const type = req.types.filter((t) => (wh.stock[t] ?? 0) > 0).sort((x, y) => wh.stock[y] - wh.stock[x])[0];
			if (!type) continue;
			if (f.wares.length >= FLAG_CAP || (wh.emit ?? 0) > st.time) return false;
			wh.stock[type]--;
			wh.emit = st.time + 0.6;
			const w = newWare(type, f);
			claim(w, b, req.slot);
			return true;
		}
		return false;
	}

	// ── carriers ──
	/** a ware waiting at either end of a carrier's road to go along it: the carrier goes for the oldest */
	function carrierJob(/** @type {any} */ u) {
		const r = st.roads[u.road];
		if (!r) return false;
		let pick = null, end = 0;
		for (const [e, fid] of /** @type {[number, number][]} */ ([[0, r.a], [1, r.b]])) {
			const f = st.flags[fid];
			for (const wid of f.wares) {
				const w = st.wares[wid];
				if (w && w.dest && nextRoad(w) === r.id && (!pick || w.since < pick.since)) (pick = w), (end = e);
			}
		}
		if (!pick) return false;
		u.job = 'c-fetch';
		u.end = end;
		u.tgt = end ? r.path.length - 1 : 0;
		return true;
	}
	function carrierArrive(/** @type {any} */ u) {
		const r = st.roads[u.road];
		if (!r) return goHome(u);
		if (u.job === 'c-go') {
			u.path = r.path;
			u.p = 0;
			u.speed = CARRY;
			u.job = 'c-idle';
			u.tgt = Math.floor((r.path.length - 1) / 2);
			return;
		}
		const at = u.p === 0 ? r.a : r.b;
		const f = st.flags[at];
		if (u.job === 'c-fetch') {
			const wid = f.wares.find((/** @type {number} */ x) => st.wares[x]?.dest && nextRoad(st.wares[x]) === r.id);
			if (!wid) return idle(u, r);
			f.wares = f.wares.filter((/** @type {number} */ x) => x !== wid);
			const w = st.wares[wid];
			w.flag = 0;
			u.wareId = wid;
			u.ware = w.type;
			u.job = 'c-carry';
			u.tgt = u.p === 0 ? r.path.length - 1 : 0;
			return;
		}
		if (u.job === 'c-carry' || u.job === 'c-wait') {
			const w = st.wares[u.wareId];
			if (!w) {
				u.wareId = 0;
				u.ware = '';
				return idle(u, r);
			}
			const dest = st.buildings[w.dest];
			if (dest && dest.flag === f.id) {
				// in through the door
				u.job = 'c-in';
				u.wait = 0.7;
				return;
			}
			if (f.wares.length < FLAG_CAP) {
				w.flag = f.id;
				w.since = st.time;
				f.wares.push(w.id);
				u.wareId = 0;
				u.ware = '';
				return idle(u, r);
			}
			// the flag of a storehouse is full: the storehouse takes the ware in, and sends it on when there is room
			const home = st.buildings[f.bld];
			if (home && isWarehouse(home) && home.owner === u.owner && home.stage === 'live') {
				unclaim(w);
				w.dest = home.id;
				u.job = 'c-in';
				u.wait = 0.7;
				return;
			}
			// the flag is full: swap with a ware going back the other way, or wait
			const back = f.wares.find((/** @type {number} */ x) => st.wares[x]?.dest && nextRoad(st.wares[x]) === r.id);
			if (back) {
				f.wares = f.wares.filter((/** @type {number} */ x) => x !== back);
				w.flag = f.id;
				w.since = st.time;
				f.wares.push(w.id);
				st.wares[back].flag = 0;
				u.wareId = back;
				u.ware = st.wares[back].type;
				u.job = 'c-carry';
				u.tgt = u.p === 0 ? r.path.length - 1 : 0;
				return;
			}
			u.job = 'c-wait';
		}
	}
	function idle(/** @type {any} */ u, /** @type {any} */ r) {
		u.job = 'c-idle';
		if (!carrierJob(u)) u.tgt = Math.floor((r.path.length - 1) / 2);
	}

	// ── buildings at work ──
	function flushOutput(/** @type {any} */ b, /** @type {string} */ ware) {
		const f = st.flags[b.flag];
		while (b.out > 0 && f && f.wares.length < FLAG_CAP) {
			newWare(ware, f);
			b.out--;
		}
		return b.out === 0;
	}
	/** a free spot of grass to plant on (a tree, a field): nothing on it, no road, no door or flag beside it */
	function freeSpot(/** @type {number} */ j) {
		if (st.terrain[j] !== GRASS || st.obj[j] || st.road[j] || st.owner[j] === RIVAL) return false;
		for (let d = 0; d < 6; d++) {
			const n = g.nb(j, d);
			if (n < 0) return false;
			const o = st.obj[n];
			if (o && (o.k === 'flag' || o.k === 'bld')) return false;
		}
		return true;
	}
	/** where a gatherer goes next: [the node it works, the node it stands on], or null */
	function findTarget(/** @type {any} */ b) {
		const t = T(b);
		const near = g.within(b.node, t.range ?? 0).sort((x, y) => g.dist(b.node, x) - g.dist(b.node, y));
		switch (b.type) {
			case 'woodcutter': {
				const j = near.find((n) => st.obj[n]?.k === 'tree' && st.obj[n].g >= 1 && !st.obj[n].r);
				return j === undefined ? null : [j, j];
			}
			case 'quarry': {
				const j = near.find((n) => st.obj[n]?.k === 'rock' && !st.obj[n].r);
				if (j === undefined) return null;
				// stand beside the rock
				for (let d = 0; d < 6; d++) {
					const s = g.nb(j, d);
					if (s >= 0 && walkable(s) && st.obj[s]?.k !== 'rock') return [j, s];
				}
				return null;
			}
			case 'fishery': {
				for (const j of near) {
					if (st.terrain[j] !== WATER || st.fish[j] <= 0) continue;
					for (let d = 0; d < 6; d++) {
						const s = g.nb(j, d);
						if (s >= 0 && st.terrain[s] !== WATER && walkable(s)) return [j, s];
					}
				}
				return null;
			}
			case 'forester': {
				let trees = 0;
				for (const n of near) if (st.obj[n]?.k === 'tree') trees++;
				if (trees >= FORESTER_TREES) return null;
				const spots = near.filter((n) => g.dist(b.node, n) >= 2 && freeSpot(n));
				if (!spots.length) return null;
				const j = spots[Math.floor(rand() * spots.length)];
				return [j, j];
			}
			case 'farm': {
				const ripe = near.find((n) => st.obj[n]?.k === 'field' && st.obj[n].b === b.id && st.obj[n].g >= 1 && !st.obj[n].r);
				if (ripe !== undefined) return [ripe, ripe];
				if (b.fields >= 7) return null;
				const j = near.find((n) => freeSpot(n));
				return j === undefined ? null : [j, j];
			}
		}
		return null;
	}
	const NOTHING = /** @type {Record<string, string>} */ ({ woodcutter: 'No grown trees nearby', quarry: 'No rocks nearby', fishery: 'No fish nearby', forester: 'The forest round it is full', farm: 'Fields are growing' });

	/** how much of a ware the storehouses hold */
	const stocked = (/** @type {string} */ ware) => warehouses().reduce((s, w) => s + (w.stock[ware] ?? 0), 0);
	function work(/** @type {any} */ b, /** @type {number} */ dt) {
		const t = T(b);
		if (b.stage === 'site') {
			const u = st.units[b.builder];
			if (!u || u.job !== 'b-work') return;
			if (b.timer > 0) {
				b.timer -= dt;
				if (b.timer <= 0) {
					const w = Object.keys(b.got).find((x) => b.got[x] > 0);
					if (w) (b.got[w]--, b.used[w]++);
					const total = Object.values(b.cost).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0);
					const used = Object.values(b.used).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0);
					if (used >= total) finish(b);
				}
			} else if (Object.values(b.got).some((n) => /** @type {number} */ (n) > 0)) {
				b.timer = 2.4;
				b.status = 'Being built';
			} else b.status = 'Waiting for materials';
			return;
		}
		if (b.stage !== 'live') return;
		if (t.kind === 'military') {
			// a coin trains the weakest soldier a rank up
			if (b.coins > 0 && b.soldiers.some((/** @type {number} */ r) => r < MAX_RANK)) {
				b.coins--;
				const k = b.soldiers.indexOf(Math.min(...b.soldiers));
				b.soldiers[k]++;
			}
			if (b.soldiers.length) b.status = `${b.soldiers.length} of ${t.capacity} soldiers`;
			return;
		}
		if (isWarehouse(b)) return;
		const u = st.units[b.worker];
		if (!u || u.job === 'w-go') return;
		let busy = false;
		if (t.kind === 'make' || t.kind === 'mine') {
			if (b.timer > 0) {
				busy = true;
				b.timer -= dt;
				if (b.timer <= 0) {
					b.out++;
					made(/** @type {string} */ (t.out));
					if (t.kind === 'mine') b.deposit--;
				}
			}
			if (b.out > 0 && !flushOutput(b, /** @type {string} */ (t.out))) b.status = 'Its flag is full';
			else if (b.timer > 0) b.status = 'Working';
			else if (b.paused) b.status = 'Paused';
			else if (t.kind === 'mine' && b.deposit <= 0) b.status = 'The vein is used up';
			else if (stocked(/** @type {string} */ (t.out)) >= ENOUGH) b.status = 'Resting: the storehouses are full of it';
			else {
				const missing = b.slots.findIndex((/** @type {any} */ s) => s.have < 1);
				if (missing >= 0) b.status = `Waiting for ${/** @type {string[][]} */ (t.inputs)[missing].map((w) => WARES[w].label.toLowerCase()).join(' or ')}`;
				else {
					for (const s of b.slots) s.have--;
					b.timer = /** @type {number} */ (t.time);
					b.status = 'Working';
					busy = true;
				}
			}
		} else if (u.inside) {
			// a gatherer: rest, then out into the land
			if (b.out > 0 && !flushOutput(b, /** @type {string} */ (t.out))) b.status = 'Its flag is full';
			else if (b.timer > 0) b.timer -= dt;
			else if (b.paused) b.status = 'Paused';
			else if (t.out && stocked(t.out) >= ENOUGH) {
				b.status = 'Resting: the storehouses are full of it';
				b.timer = 3;
			} else {
				const target = findTarget(b);
				const path = target && findPath(g, b.node, target[1], walkable, 1500);
				if (!target || !path) {
					b.status = NOTHING[b.type] ?? 'Nothing to do';
					b.timer = 3;
				} else {
					const plant = (b.type === 'farm' && st.obj[target[0]]?.k !== 'field') || b.type === 'forester';
					if (st.obj[target[0]] && !plant) st.obj[target[0]].r = u.id;
					Object.assign(u, { inside: false, path, p: 0, tgt: path.length - 1, job: 'w-out', target: target[0] });
					b.status = 'Working';
					busy = true;
				}
			}
		} else busy = true;
		b.eff += ((busy ? 1 : 0) - b.eff) * Math.min(1, dt / 40);
	}
	function finish(/** @type {any} */ b) {
		b.stage = 'live';
		b.timer = 0;
		b.since = st.time;
		const t = T(b);
		b.status = t.kind === 'military' ? 'Waiting for soldiers' : t.worker ? 'Waiting for a worker' : '';
		const u = st.units[b.builder];
		b.builder = 0;
		if (u) goHome(u);
		say(`${t.label} finished`, b.node, 'good');
		st.objV++;
	}
	/** what a gatherer does when it reaches its spot, and after */
	function workerArrive(/** @type {any} */ u) {
		const b = st.buildings[u.bld];
		if (!b) return goHome(u);
		if (u.job === 'w-go') {
			b.worker = u.id;
			u.inside = true;
			u.job = 'w-in';
			b.status = '';
			return;
		}
		if (u.job === 'w-out') {
			u.job = 'w-work';
			u.wait = /** @type {number} */ (T(b).time);
			return;
		}
		if (u.job === 'w-back') {
			u.inside = true;
			u.job = 'w-in';
			if (u.ware) {
				b.out++;
				made(u.ware);
				u.ware = '';
			}
			b.timer = /** @type {number} */ (T(b).rest);
		}
	}
	function workerDone(/** @type {any} */ u) {
		const b = st.buildings[u.bld];
		if (!b) return goHome(u);
		const j = u.target, o = st.obj[j];
		if (o?.r === u.id) delete o.r;
		switch (b.type) {
			case 'woodcutter':
				if (o?.k === 'tree') {
					st.obj[j] = null;
					u.ware = 'log';
					st.objV++;
				}
				break;
			case 'quarry':
				if (o?.k === 'rock') {
					o.n--;
					if (o.n <= 0) st.obj[j] = null;
					u.ware = 'stone';
					st.objV++;
				}
				break;
			case 'fishery':
				if (st.fish[j] > 0) {
					st.fish[j]--;
					u.ware = 'fish';
				}
				break;
			case 'forester':
				if (!st.obj[j] && !st.road[j]) {
					st.obj[j] = { k: 'tree', g: 0.04 };
					st.objV++;
				}
				break;
			case 'farm':
				if (o?.k === 'field' && o.g >= 1) {
					st.obj[j] = null;
					b.fields = Math.max(0, b.fields - 1);
					u.ware = 'grain';
					st.objV++;
				} else if (!o && !st.road[j]) {
					st.obj[j] = { k: 'field', g: 0, b: b.id };
					b.fields++;
					st.objV++;
				}
				break;
		}
		const path = findPath(g, nodeOf(u), b.node, walkable, 1500) ?? [nodeOf(u), b.node];
		Object.assign(u, { path, p: 0, tgt: path.length - 1, job: 'w-back' });
	}

	// ── soldiers ──
	function soldierArrive(/** @type {any} */ u) {
		if (u.job === 's-go') {
			const b = st.buildings[u.bld];
			if (b && b.owner === u.owner && b.stage === 'live' && b.soldiers.length < (T(b).capacity ?? 0)) {
				b.incS = Math.max(0, b.incS - 1);
				const first = !b.soldiers.length;
				b.soldiers.push(u.rank);
				delete st.units[u.id];
				if (first && b.type !== 'keep') {
					b.since = st.time;
					if (u.owner === PLAYER) say(`Soldiers moved into the ${T(b).label.toLowerCase()}: your land grows`, b.node, 'good');
					territory();
				}
				return;
			}
			return goHome(u);
		}
		if (u.job === 's-attack') {
			u.job = 's-siege';
			return;
		}
		if (u.job === 's-ret') {
			const b = st.buildings[u.home];
			if (b && b.owner === u.owner && (isWarehouse(b) || b.soldiers.length < (T(b).capacity ?? 0))) {
				b.soldiers.push(u.rank);
				delete st.units[u.id];
				return;
			}
			return goHome(u);
		}
	}
	/** send attackers home: back to where they came from */
	function retreat(/** @type {any} */ u) {
		const b = st.buildings[u.home];
		const path = b && findPath(g, nodeOf(u), b.node, walkable);
		if (path) Object.assign(u, { path, p: 0, tgt: path.length - 1, job: 's-ret' });
		else goHome(u);
	}
	/** the fights at the door of a besieged building, one duel at a time */
	function sieges(/** @type {number} */ dt) {
		/** @type {Map<number, any[]>} */
		const at = new Map();
		for (const u of all(st.units)) {
			if (u.job !== 's-siege' && u.job !== 's-fight') continue;
			const list = at.get(u.target) ?? [];
			list.push(u);
			at.set(u.target, list);
		}
		for (const [bid, attackers] of at) {
			const b = st.buildings[bid];
			if (!b || b.owner === attackers[0].owner) {
				for (const a of attackers) if (a.job !== 's-fight') retreat(a);
				continue;
			}
			if (b.owner === PLAYER && st.time - b.alarm > 40) {
				b.alarm = st.time;
				say(`Your ${T(b).label.toLowerCase()} is under attack!`, b.node, 'alert');
			}
			if (b.fight) {
				b.fight.t -= dt;
				if (b.fight.t > 0) continue;
				const a = st.units[b.fight.a], d = st.units[b.fight.d];
				b.fight = null;
				if (!a || !d) {
					if (d) {
						b.soldiers.push(d.rank);
						delete st.units[d.id];
					}
					if (a) a.job = 's-siege';
					continue;
				}
				const pa = Math.max(0.12, Math.min(0.88, 0.5 + 0.12 * (a.rank - d.rank)));
				if (rand() < pa) {
					delete st.units[d.id];
					a.job = 's-siege';
				} else {
					delete st.units[a.id];
					b.soldiers.push(d.rank);
					delete st.units[d.id];
				}
				continue;
			}
			const waiting = attackers.filter((a) => a.job === 's-siege');
			if (!waiting.length) continue;
			if (b.soldiers.length) {
				const k = b.soldiers.indexOf(Math.max(...b.soldiers));
				const rank = b.soldiers.splice(k, 1)[0];
				const door = st.flags[b.flag]?.node ?? b.node;
				const d = spawn('soldier', b.owner, [b.node, door], 's-defend', { rank, target: b.id });
				const a = waiting[0];
				a.job = 's-fight';
				b.fight = { a: a.id, d: d.id, t: 2.8 };
				continue;
			}
			capture(b, waiting);
		}
	}
	function capture(/** @type {any} */ b, /** @type {any[]} */ attackers) {
		const winner = attackers[0].owner;
		const label = T(b).label;
		if (b.type === 'hq') {
			st.result = 'lost';
			say('The rival took your headquarters. The valley is lost.', b.node, 'alert');
			return;
		}
		if (b.type === 'keep') {
			st.result = 'won';
			st.goals.keep = true;
			say('You took the rival keep. The valley is yours!', b.node, 'good');
		}
		b.owner = winner;
		b.soldiers = [];
		b.incS = 0;
		b.coins = 0;
		b.incC = 0;
		b.since = -st.time - 1;
		b.status = '';
		const f = st.flags[b.flag];
		if (f) {
			for (const r of all(st.roads)) if (r.a === f.id || r.b === f.id) removeRoad(r);
			for (const wid of [...f.wares]) if (st.wares[wid]) destroyWare(st.wares[wid]);
			f.owner = winner;
		}
		for (const w of all(st.wares)) if (w.dest === b.id) unclaim(w);
		const cap = T(b).capacity ?? 0;
		for (const a of attackers) {
			if (b.soldiers.length < cap) {
				b.soldiers.push(a.rank);
				delete st.units[a.id];
			} else retreat(a);
		}
		if (b.type !== 'keep') say(winner === PLAYER ? `You took the rival’s ${label.toLowerCase()}` : `The rival took your ${label.toLowerCase()}`, b.node, winner === PLAYER ? 'good' : 'alert');
		st.objV++;
		territory();
	}
	/** soldiers set out to attack a rival building from the military buildings in reach */
	function sendAttack(/** @type {any} */ target, /** @type {number} */ n, /** @type {number} */ owner) {
		const door = st.flags[target.flag]?.node ?? target.node;
		const sources = all(st.buildings)
			.filter((b) => b.owner === owner && holdsLand(b.type) && b.stage === 'live' && g.dist(b.node, target.node) <= ATTACK_REACH)
			.sort((a, b) => g.dist(a.node, target.node) - g.dist(b.node, target.node));
		let sent = 0;
		for (const s of sources) {
			const keep = s.type === 'hq' ? HQ_GUARD : 1;
			while (sent < n && s.soldiers.length > keep) {
				const path = findPath(g, s.node, door, walkable);
				if (!path) break;
				const k = s.soldiers.indexOf(Math.max(...s.soldiers));
				const rank = s.soldiers.splice(k, 1)[0];
				spawn('soldier', owner, path, 's-attack', { rank, target: target.id, home: s.id });
				sent++;
			}
		}
		return sent;
	}

	// ── the land ──
	function territory() {
		const own = Array(N).fill(-1);
		const holders = all(st.buildings)
			.filter((b) => holdsLand(b.type) && b.stage === 'live' && (b.type === 'hq' || b.type === 'keep' || b.soldiers.length > 0))
			.sort((a, b) => a.since - b.since);
		for (const b of holders) for (const j of g.within(b.node, /** @type {number} */ (T(b).radius))) if (own[j] === -1) own[j] = b.owner;
		for (const b of holders) {
			own[b.node] = b.owner;
			const f = st.flags[b.flag];
			if (f) own[f.node] = b.owner;
		}
		st.owner = own;
		st.terV++;
		// what stands on land its owner lost, burns
		for (const b of all(st.buildings))
			if (st.buildings[b.id] && own[b.node] !== b.owner) {
				if (b.owner === PLAYER) say(`Your ${T(b).label.toLowerCase()} burned: the land is no longer yours`, b.node, 'alert');
				removeBuilding(b, true, false);
			}
		for (const f of all(st.flags)) if (st.flags[f.id] && own[f.node] !== f.owner) removeFlag(f);
		for (const r of all(st.roads)) if (st.roads[r.id] && r.path.some((/** @type {number} */ n) => own[n] !== r.owner)) removeRoad(r);
	}

	// ── the rival ──
	function rival() {
		const keep = st.buildings[st.keep];
		if (!keep || keep.owner !== RIVAL) return;
		const c = st.clocks;
		const mine = all(st.buildings).filter((b) => b.owner === RIVAL && holdsLand(b.type) && b.stage === 'live');
		if (st.time >= c.reinforce) {
			c.reinforce = st.time + 110;
			if (keep.soldiers.length < 10) keep.soldiers.push(Math.floor(rand() * 3));
		}
		if (st.time >= c.rebalance) {
			c.rebalance = st.time + 45;
			for (const t of mine) {
				if (t === keep || t.soldiers.length + t.incS >= 3 || keep.soldiers.length <= 3) continue;
				const path = findPath(g, keep.node, t.node, walkable);
				if (!path) continue;
				const k = keep.soldiers.indexOf(Math.min(...keep.soldiers));
				const rank = keep.soldiers.splice(k, 1)[0];
				spawn('soldier', RIVAL, path, 's-go', { bld: t.id, rank });
				t.incS++;
				break;
			}
		}
		if (st.time >= c.promote) {
			c.promote = st.time + 260;
			const pool = mine.filter((b) => b.soldiers.some((/** @type {number} */ r) => r < MAX_RANK));
			const b = pool[Math.floor(rand() * pool.length)];
			if (b) b.soldiers[b.soldiers.indexOf(Math.min(...b.soldiers))]++;
		}
		if (st.time >= c.raid) {
			c.raid = st.time + 210;
			const targets = all(st.buildings).filter((b) => b.owner === PLAYER && holdsLand(b.type) && b.stage === 'live' && (b.type === 'hq' || b.soldiers.length > 0));
			let best = null, bd = Infinity;
			for (const s of mine)
				for (const t of targets) {
					const d = g.dist(s.node, t.node);
					if (d <= ATTACK_REACH && d < bd && s.soldiers.length >= 3) (best = [s, t]), (bd = d);
				}
			if (best) {
				const [s, t] = best;
				const n = sendAttack(t, Math.min(2, s.soldiers.length - 2), RIVAL);
				if (n) say(`The rival marches on your ${T(t).label.toLowerCase()}!`, t.node, 'alert');
			}
		}
	}

	// ── time ──
	function grow() {
		let changed = false;
		for (let i = 0; i < N; i++) {
			const o = st.obj[i];
			if (!o) continue;
			if (o.k === 'tree' && o.g < 1) {
				o.g = Math.min(1, o.g + 1 / 110);
				changed = true;
			} else if (o.k === 'field' && !st.buildings[o.b]) {
				st.obj[i] = null;
				changed = true;
			} else if (o.k === 'field' && o.g < 1) {
				o.g = Math.min(1, o.g + 1 / 55);
				changed = true;
			}
		}
		if (changed) st.objV++;
	}
	function goals() {
		const live = (/** @type {string} */ type) => all(st.buildings).some((b) => b.type === type && b.owner === PLAYER && b.stage === 'live' && st.units[b.worker]?.job === 'w-in');
		for (const goal of GOALS) {
			if (st.goals[goal.id]) continue;
			let done = false;
			if (goal.id === 'wood') done = live('woodcutter') && live('sawmill');
			else if (goal.id === 'land') done = landHeld() >= 3;
			else if (goal.id === 'keep') done = st.result === 'won';
			else if (goal.ware) done = progress(goal.ware) >= /** @type {number} */ (goal.n);
			if (done) {
				st.goals[goal.id] = true;
				say(`Goal reached: ${goal.label}`, -1, 'good');
			}
		}
	}
	const landHeld = () => all(st.buildings).filter((b) => b.owner === PLAYER && T(b).kind === 'military' && b.soldiers.length > 0).length;
	const progress = (/** @type {string} */ ware) => (ware === 'food' ? FOOD.reduce((s, w) => s + (st.made[w] ?? 0), 0) : st.made[ware] ?? 0);

	function step(dt = TICK) {
		if (st.result === 'lost') return;
		st.time += dt;
		const c = st.clocks;
		for (const u of all(st.units)) {
			if (!st.units[u.id]) continue;
			if (u.wait > 0) {
				u.wait -= dt;
				if (u.wait > 0) continue;
				u.wait = 0;
				if (u.job === 'w-work') workerDone(u);
				else if (u.job === 'c-in') {
					const w = st.wares[u.wareId];
					u.wareId = 0;
					u.ware = '';
					if (w) deliver(w);
					const r = st.roads[u.road];
					if (r) idle(u, r);
					else goHome(u);
				}
				continue;
			}
			if (u.inside || u.job === 's-siege' || u.job === 's-fight' || u.job === 'b-work') continue;
			if (u.job === 'c-idle' && carrierJob(u) && u.p === u.tgt) {
				carrierArrive(u);
				continue;
			}
			if (u.job === 'c-wait') {
				carrierArrive(u);
				continue;
			}
			if (u.p !== u.tgt) {
				const dir = Math.sign(u.tgt - u.p);
				u.p += dir * u.speed * dt;
				if ((dir > 0 && u.p >= u.tgt) || (dir < 0 && u.p <= u.tgt)) {
					u.p = u.tgt;
					arrive(u);
				}
			} else if (u.job !== 'c-idle' && u.job !== 's-defend' && u.job !== 'w-in') arrive(u);
		}
		for (const b of all(st.buildings)) if (st.buildings[b.id] && b.owner === PLAYER) work(b, dt);
		sieges(dt);
		if (st.time >= c.dispatch) {
			c.dispatch = st.time + 0.5;
			dispatch();
		}
		if (st.time >= c.people) {
			c.people = st.time + 1;
			people();
		}
		if (st.time >= c.grow) {
			c.grow = st.time + 1;
			grow();
		}
		if (st.time >= c.fish) {
			c.fish = st.time + 20;
			for (let i = 0; i < N; i++) if (st.terrain[i] === WATER && st.fish[i] < 4 && rand() < 0.35) st.fish[i]++;
		}
		const hq = st.buildings[st.hq];
		if (st.time >= c.pop) {
			c.pop = st.time + 18;
			if (hq && hq.owner === PLAYER && hq.settlers < 12) hq.settlers++;
		}
		if (st.time >= c.train) {
			c.train = st.time + 10;
			for (const wh of warehouses()) {
				if ((wh.stock.weapons ?? 0) > 0 && wh.settlers > 2) {
					wh.stock.weapons--;
					wh.settlers--;
					wh.soldiers.push(0);
				}
				if ((wh.stock.coin ?? 0) > 0 && wh.soldiers.some((/** @type {number} */ r) => r < MAX_RANK)) {
					wh.stock.coin--;
					const k = wh.soldiers.indexOf(Math.min(...wh.soldiers));
					wh.soldiers[k]++;
				}
			}
		}
		if (st.time >= c.goals) {
			c.goals = st.time + 1;
			goals();
		}
		rival();
		if (st.fx.length && st.time - st.fx[0].t > 12) st.fx.shift();
	}
	function arrive(/** @type {any} */ u) {
		if (u.kind === 'carrier') return u.job === 'home' ? arriveHome(u) : carrierArrive(u);
		if (u.job === 'home') return arriveHome(u);
		if (u.kind === 'builder') {
			const b = st.buildings[u.bld];
			if (!b || b.stage !== 'site') return goHome(u);
			u.job = 'b-work';
			return;
		}
		if (u.kind === 'worker') return workerArrive(u);
		if (u.kind === 'soldier') return soldierArrive(u);
	}

	// ── what a player may do ──
	/** why no flag may stand here ('' when one may) @param {number} n */
	function canFlag(n) {
		if (n < 0) return 'Off the map';
		if (st.owner[n] !== PLAYER) return 'Outside your land';
		if (st.terrain[n] === WATER) return 'Water';
		if (st.obj[n]) return 'Something stands here';
		for (let d = 0; d < 6; d++) if (st.obj[g.nb(n, d)]?.k === 'flag') return 'Too close to another flag';
		return '';
	}
	/** why this building may not stand here ('' when it may) @param {string} type @param {number} n */
	function canBuild(type, n) {
		const t = BUILDINGS[type];
		if (!t || !t.group) return 'Not something you can build';
		if (n < 0) return 'Off the map';
		if (st.owner[n] !== PLAYER) return 'Outside your land';
		if (st.obj[n]) return st.obj[n].k === 'tree' ? 'A tree stands here' : st.obj[n].k === 'rock' ? 'A rock lies here' : 'Something stands here';
		if (st.road[n]) return 'A road runs here';
		if (t.on === 'mountain' ? st.terrain[n] !== MOUNTAIN : st.terrain[n] !== GRASS) return t.on === 'mountain' ? 'Mines stand on mountains' : 'Needs open grass';
		for (let d = 0; d < 6; d++) {
			const j = g.nb(n, d);
			if (j < 0) return 'Too close to the edge';
			if (st.obj[j]?.k === 'bld') return 'Too close to another building';
		}
		const f = g.nb(n, SE);
		const o = st.obj[f];
		if (o?.k === 'flag') {
			if (st.flags[o.id].owner !== PLAYER) return 'Outside your land';
			if (st.flags[o.id].bld) return 'That flag already serves a building';
		} else if (canFlag(f)) return `No room for its flag: ${canFlag(f).toLowerCase()}`;
		if (type === 'fishery' && !g.within(n, 4).some((j) => st.terrain[j] === WATER)) return 'Needs water nearby';
		if (t.kind === 'mine' && depositAt(n, /** @type {string} */ (t.ore)) <= 0) return `No ${t.ore === 'iron' ? 'iron ore' : t.ore === 'gold' ? 'gold' : 'coal'} in this rock`;
		return '';
	}
	/** the open way for a road between a flag and a node, or null @param {number} from @param {number} to */
	function planRoad(from, to) {
		const start = flagAt(from);
		if (!start || start.owner !== PLAYER || from === to || to < 0) return null;
		const end = flagAt(to);
		if (end ? end.owner !== PLAYER : canFlag(to)) return null;
		const open = (/** @type {number} */ j) => st.owner[j] === PLAYER && st.terrain[j] !== WATER && !st.obj[j] && !st.road[j];
		const path = findPath(g, from, to, open, 2500);
		return path && path.length <= 40 ? path : null;
	}
	function buildRoad(/** @type {number} */ from, /** @type {number} */ to) {
		const path = planRoad(from, to);
		if (!path) return null;
		if (!flagAt(to)) makeFlag(to, PLAYER);
		return makeRoad(path, PLAYER);
	}
	/** a road from a flag to the nearest flag (or road) joined to the headquarters */
	function autoRoad(/** @type {number} */ flagId) {
		const f = st.flags[flagId];
		const hq = st.buildings[st.hq];
		if (!f || !hq) return null;
		const joined = route(hq.flag);
		if (joined.has(f.id)) return null;
		/** @type {number[]} */
		const ends = [];
		for (const x of all(st.flags)) if (x.id !== f.id && x.owner === PLAYER && joined.has(x.id)) ends.push(x.node);
		for (const r of all(st.roads)) if (joined.has(r.a)) for (let k = 1; k < r.path.length - 1; k++) if (!canFlag(r.path[k])) ends.push(r.path[k]);
		ends.sort((a, b) => g.dist(f.node, a) - g.dist(f.node, b));
		let best = null;
		for (const e of ends.slice(0, 10)) {
			const p = planRoad(f.node, e);
			if (p && (!best || p.length < best.length)) best = p;
		}
		return best ? buildRoad(best[0], best[best.length - 1]) : null;
	}

	/** how many soldiers can attack a rival building from your military buildings in reach @param {number} id */
	function attackable(id) {
		const t = st.buildings[id];
		if (!t || t.owner !== RIVAL || !holdsLand(t.type)) return 0;
		let n = 0;
		for (const b of all(st.buildings))
			if (b.owner === PLAYER && holdsLand(b.type) && b.stage === 'live' && g.dist(b.node, t.node) <= ATTACK_REACH) n += Math.max(0, b.soldiers.length - (b.type === 'hq' ? HQ_GUARD : 1));
		return n;
	}

	return {
		state: st,
		grid: g,
		step,
		setup(/** @type {import('./map.js').Valley} */ v) {
			const hq = makeBuilding('hq', v.hq, PLAYER, true);
			hq.stock = { ...START.stock };
			hq.settlers = START.settlers;
			hq.soldiers = [...START.soldiers];
			hq.since = 0;
			st.hq = hq.id;
			const keep = makeBuilding('keep', v.keep, RIVAL, true);
			keep.soldiers = [0, 1, 1, 2, 1, 0];
			keep.since = 0;
			st.keep = keep.id;
			const garrisons = [[0, 1], [1, 0, 1], [0, 1]];
			v.towers.forEach((n, k) => {
				const t = makeBuilding('watchtower', n, RIVAL, true);
				t.soldiers = garrisons[k];
				t.since = 1;
			});
			territory();
			say('Welcome to the valley. Build a woodcutter and a sawmill near the forest, and join them to your headquarters by road.', hq.node);
		},
		canBuild,
		canFlag,
		planRoad,
		/** place a building (its flag comes with it); with `connect`, a road to the network too */
		build(/** @type {string} */ type, /** @type {number} */ n, connect = true) {
			const why = canBuild(type, n);
			if (why) return { ok: false, why };
			const b = makeBuilding(type, n, PLAYER);
			b.since = st.time;
			const linked = connect ? autoRoad(b.flag) : null;
			return { ok: true, id: b.id, linked: !!linked || route(st.buildings[st.hq].flag).has(b.flag) };
		},
		flag(/** @type {number} */ n) {
			const why = canFlag(n);
			if (why) return { ok: false, why };
			return { ok: true, id: makeFlag(n, PLAYER).id };
		},
		road(/** @type {number} */ from, /** @type {number} */ to) {
			const r = buildRoad(from, to);
			return r ? { ok: true, id: r.id } : { ok: false, why: 'No way for a road there' };
		},
		autoRoad(/** @type {number} */ flagId) {
			return !!autoRoad(flagId);
		},
		/** tear down what stands at a node: a building, a flag (with its roads), or a road */
		demolish(/** @type {number} */ n) {
			const b = buildingAt(n);
			if (b) {
				if (b.owner !== PLAYER || b.type === 'hq') return { ok: false, why: b.type === 'hq' ? 'The headquarters stays' : 'Not yours' };
				removeBuilding(b);
				return { ok: true };
			}
			const f = flagAt(n);
			if (f) {
				if (f.owner !== PLAYER || st.buildings[f.bld]?.type === 'hq') return { ok: false, why: 'This flag stays' };
				removeFlag(f);
				return { ok: true };
			}
			if (st.road[n] && st.roads[st.road[n]]?.owner === PLAYER) {
				removeRoad(st.roads[st.road[n]]);
				return { ok: true };
			}
			return { ok: false, why: 'Nothing to tear down here' };
		},
		pause(/** @type {number} */ id, /** @type {boolean} */ paused) {
			const b = st.buildings[id];
			if (b && b.owner === PLAYER) b.paused = paused;
		},
		attackable,
		attack(/** @type {number} */ id, /** @type {number} */ n) {
			const t = st.buildings[id];
			if (!t || t.owner !== RIVAL) return 0;
			const sent = sendAttack(t, n, PLAYER);
			if (sent) say(`${sent} soldier${sent === 1 ? '' : 's'} march on the ${T(t).label.toLowerCase()}`, t.node);
			return sent;
		},
		/** what stands at a node */
		at(/** @type {number} */ n) {
			if (n < 0) return null;
			const o = st.obj[n];
			if (o?.k === 'bld') return { k: 'building', id: o.id };
			if (o?.k === 'flag') return { k: 'flag', id: o.id };
			if (st.road[n]) return { k: 'road', id: st.road[n] };
			if (o) return { k: o.k };
			return null;
		},
		/** what the page shows: the stock, the people, the goals, the news */
		summary() {
			/** @type {Record<string, number>} */
			const stock = {};
			let settlers = 0, soldiers = 0;
			for (const wh of warehouses()) {
				for (const [w, n] of Object.entries(wh.stock)) stock[w] = (stock[w] ?? 0) + /** @type {number} */ (n);
				settlers += wh.settlers;
				soldiers += wh.soldiers.length;
			}
			let carriers = 0, workers = 0, posted = 0;
			for (const u of all(st.units)) if (u.owner === PLAYER) u.kind === 'carrier' ? carriers++ : u.kind === 'soldier' ? posted++ : workers++;
			for (const b of all(st.buildings)) if (b.owner === PLAYER && !isWarehouse(b)) posted += b.soldiers.length;
			let rivals = 0;
			for (const b of all(st.buildings)) if (b.owner === RIVAL) rivals += b.soldiers.length;
			return {
				time: st.time,
				stock,
				settlers,
				soldiers,
				posted,
				carriers,
				workers,
				rivals,
				result: st.result,
				goals: GOALS.map((x) => ({ ...x, done: !!st.goals[x.id], have: x.ware ? progress(x.ware) : x.id === 'land' ? landHeld() : undefined, need: x.n ?? (x.id === 'land' ? 3 : undefined) })),
				msgs: st.msgs.slice(-6)
			};
		},
		/** a building as its card shows it */
		inspect(/** @type {number} */ id) {
			const b = st.buildings[id];
			if (!b) return null;
			const t = T(b);
			const worker = st.units[b.worker];
			return {
				id: b.id,
				type: b.type,
				label: t.label,
				about: b.owner === RIVAL && b.type !== 'keep' ? 'The rival’s soldiers hold the land round it. Take it, and its land is yours.' : t.about,
				owner: b.owner,
				node: b.node,
				stage: b.stage,
				status: b.stage === 'site' ? b.status : b.status || (worker?.job === 'w-in' || worker?.inside === false ? 'Working' : ''),
				progress: b.stage === 'site' ? Object.keys(b.cost).reduce((s, w) => s + b.used[w], 0) / Math.max(1, Object.values(b.cost).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0)) : 1,
				cost: Object.keys(b.cost).map((w) => ({ ware: w, need: b.cost[w], have: b.used[w] + b.got[w], coming: b.inc[w] })),
				inputs: (t.inputs ?? []).map((/** @type {string[]} */ types, /** @type {number} */ k) => ({ types, have: b.slots[k].have, coming: b.slots[k].inc, cap: SLOT_CAP })),
				out: t.out ?? '',
				worker: t.worker ?? '',
				hasWorker: !!worker && worker.job !== 'w-go',
				paused: b.paused,
				eff: Math.round(b.eff * 100),
				deposit: b.deposit,
				kind: t.kind,
				soldiers: [...b.soldiers].sort((x, y) => y - x),
				capacity: t.capacity ?? 0,
				coins: b.coins + b.incC,
				stock: isWarehouse(b) ? { ...b.stock } : null,
				settlers: b.settlers,
				attackable: b.owner === RIVAL ? attackable(id) : 0
			};
		},
		landHeld,
		toJSON: () => JSON.stringify(st)
	};
}
