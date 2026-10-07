/**
 * SANDBOX 6 · THE SIMULATION — the whole game as plain data and the rules that move it on, without a pixel: the page
 * draws it (./view.js), and a script can play it headless (./autoplay.js).
 *
 * The state is one JSON object (save it, load it, it goes on where it was). Every 0.1 s of game time:
 *   · carriers walk their roads: each road has one, who takes a ware from the flag at one end to the flag at the
 *     other; at its last flag the ware goes into the building that asked for it;
 *   · every half second the economy matches wares to who needs them: a site its planks and stone, a workshop its
 *     inputs, a market hall what you sell; a ware nobody needs goes to the nearest storehouse; what a storehouse holds
 *     is sent out to whoever asks, nearest first; a ware finds its way flag by flag along the shortest roads;
 *   · every second the people follow: a settler from a storehouse becomes the carrier of a new road, the builder of a
 *     site, the worker of a finished building (a worker takes tools along);
 *   · buildings work: workshops turn inputs into wares, gatherers go out into the land (trees, rocks, fish, fields);
 *   · traders cart wares to the fair and back: yours by the orders you set, the neighbours' by what they have spare
 *     and what they lack (./market.js);
 *   · every settlement eats, drinks and keeps its homes, and the valley's abundance follows how well they all live.
 */
import { ABUNDANT, BUILDINGS, FOOD, GOALS, GRASS, HOLD, HOUSE_BEDS, HOUSE_UP, IRON, MOUNTAIN, PEOPLE, START, WARES, WATER, holdsLand } from './rules.js';
import { CART, NEIGHBOURS, TRADED, abundance, buyOne, cost, fair, live, make, newMarket, orderRule, price, request, sellOne, shop, toSell, trend } from './market.js';
import { findPath, makeGrid } from './hex.js';
import { makePlan } from './plots.js';
import { growValley } from './map.js';

/** seconds of game time a step moves on */
export const TICK = 0.1;
/** who owns what: you, the two neighbours (1, 2), and the fair */
export const PLAYER = 0, FAIR = 4;
/** wares a flag holds at most */
export const FLAG_CAP = 8;
/** each input of a workshop is kept this full */
const SLOT_CAP = 4;
/** nodes a second: walking, and carrying */
const WALK = 1.8, CARRY = 1.45;
/** nodes a second a trader's cart goes */
const CART_SPEED = 1.3;
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
		v: 5,
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
		/** who holds each village (./plots.js), or -1 @type {number[]} */
		villageOwner: [],
		/** @type {Record<string, any>} */ flags: {},
		/** @type {Record<string, any>} */ roads: {},
		/** @type {Record<string, any>} */ buildings: {},
		/** @type {Record<string, any>} */ units: {},
		/** @type {Record<string, any>} */ wares: {},
		nextId: 1,
		/** @type {Record<string, number>} */ made: {},
		/** @type {{ t: number, text: string, node: number, tone: string, n: number }[]} */ msgs: [],
		msgSeq: 0,
		/** @type {null | 'won'} */ result: null,
		/** what changed, for whoever draws it */
		netV: 1,
		objV: 1,
		terV: 1,
		/** when the slower rules next run */
		clocks: { dispatch: 0, people: 0, grow: 0, fish: 20, pop: 18, goals: 1, needs: 0, trade: 5, grow2: 60 },
		hq: 0,
		/** the fair, and the neighbours' villages (building ids) */
		fair: 0,
		/** @type {number[]} */ villages: [],
		...newMarket(),
		/** your orders at the fair: sell or buy, by ware @type {Record<string, 'sell' | 'buy'>} */
		orders: {},
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
	if (!st || st.v !== 5 || !Array.isArray(st.terrain)) throw new Error('Not a Sandbox 6 game of this kind');
	return createSim(st);
}

/** @typedef {ReturnType<typeof createSim>} Sim */

/** @param {any} st */
export function createSim(st) {
	const g = makeGrid(st.W, st.H);
	const N = g.N;
	const plan = makePlan(g);
	/** the village a node lies in */
	const villageAt = (/** @type {number} */ n) => plan.villageOf[plan.plotOf[n]];

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
		// every building's door faces the flag in the middle of its settlement
		const fnode = plan.centre[plan.plotOf[node]];
		if (st.obj[fnode] && st.obj[fnode].k !== 'flag') st.obj[fnode] = null;
		const flag = flagAt(fnode) ?? makeFlag(fnode, owner);
		const b = {
			id: newId(), type, node, flag: flag.id, owner, stage: live ? 'live' : 'site', since: st.time,
			cost: { ...t.cost }, used: /** @type {Record<string, number>} */ ({}), got: /** @type {Record<string, number>} */ ({}), inc: /** @type {Record<string, number>} */ ({}),
			builder: 0, worker: 0, slots: (t.inputs ?? []).map(() => ({ have: 0, inc: 0 })),
			timer: 0, out: 0, paused: false, status: live ? '' : 'Waiting for a builder', eff: 0,
			stock: /** @type {Record<string, number>} */ ({}), settlers: 0, deposit: 0, fields: 0, level: 0,
			/** a market hall's: what waits to go to the fair, what is on its way to it, what came back */
			box: /** @type {Record<string, number>} */ ({}), incBox: /** @type {Record<string, number>} */ ({}), outQ: /** @type {string[]} */ ([])
		};
		for (const w of Object.keys(b.cost)) (b.used[w] = 0), (b.got[w] = 0), (b.inc[w] = 0);
		if (t.kind === 'mine') b.deposit = depositAt(node);
		flag.bld ||= b.id;
		st.obj[node] = { k: 'bld', id: b.id };
		st.buildings[b.id] = b;
		st.objV++;
		return b;
	}
	/** how much ore a mine at a node can dig: what the rock round it holds */
	function depositAt(/** @type {number} */ node) {
		let n = 0;
		for (const j of g.within(node, 2)) if (st.terrain[j] === MOUNTAIN && st.ore[j] === IRON) n += st.amount[j];
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
		else if (w.slot === -3) b.incBox[w.type] = Math.max(0, (b.incBox[w.type] ?? 0) - 1);
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
		for (const b of all(st.buildings)) if (b.flag === f.id && st.buildings[b.id]) removeBuilding(b);
		for (const wid of [...f.wares]) if (st.wares[wid]) destroyWare(st.wares[wid]);
		delete st.flags[f.id];
		st.obj[f.node] = null;
		st.netV++;
		st.objV++;
	}
	function removeBuilding(/** @type {any} */ b, burn = true, retally = true) {
		delete st.buildings[b.id];
		st.obj[b.node] = null;
		const f = st.flags[b.flag];
		if (f && f.bld === b.id) f.bld = all(st.buildings).find((x) => x.flag === f.id)?.id ?? 0;
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
		releaseTarget(u);
		delete st.units[u.id];
	}
	/** a unit with nothing left to do walks to the nearest storehouse (a neighbour's to its village) */
	function goHome(/** @type {any} */ u) {
		const here = nodeOf(u);
		const homes = u.owner === PLAYER ? warehouses() : all(st.buildings).filter((b) => b.type === 'village' && b.owner === u.owner);
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
			h.settlers++;
			if (u.ware && isWarehouse(h)) h.stock[u.ware] = (h.stock[u.ware] ?? 0) + 1;
		}
		removeUnit(u);
	}

	/** settlers become carriers, builders and workers */
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
						say('You are out of tools: a toolmaker makes them from iron ore and planks, or buy them at the fair.', b.node, 'alert');
					}
					continue;
				}
				wh.settlers--;
				if (t.tools) wh.stock.tools--;
				const u = spawn('worker', PLAYER, [wh.node, ...walk, b.node], 'w-go', { bld: b.id });
				b.worker = u.id;
				b.status = `A ${t.worker?.toLowerCase()} is on the way`;
			}
		}
	}

	// ── the economy: who needs what, and where it comes from ──
	function requestsOf(/** @type {any} */ b) {
		const t = T(b);
		if (b.stage === 'site') return Object.keys(b.cost).map((w) => ({ types: [w], slot: -1, n: b.cost[w] - b.used[w] - b.got[w] - b.inc[w] }));
		if (b.stage !== 'live') return [];
		if (b.paused || !b.worker) return [];
		if (t.kind === 'market') return hallWants(b);
		return (t.inputs ?? []).map((/** @type {string[]} */ types, /** @type {number} */ k) => ({ types, slot: k, n: SLOT_CAP - b.slots[k].have - b.slots[k].inc }));
	}
	function claim(/** @type {any} */ w, /** @type {any} */ b, /** @type {number} */ slot) {
		w.dest = b.id;
		w.slot = slot;
		if (b.stage === 'site') b.inc[w.type]++;
		else if (slot === -3) b.incBox[w.type] = (b.incBox[w.type] ?? 0) + 1;
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
		} else if (w.slot === -3) {
			b.incBox[w.type] = Math.max(0, (b.incBox[w.type] ?? 0) - 1);
			b.box[w.type] = (b.box[w.type] ?? 0) + 1;
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
			const home = all(st.buildings).find((x) => x.flag === f.id && isWarehouse(x));
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
		if (st.terrain[j] !== GRASS || st.obj[j] || st.road[j] || st.owner[j] > PLAYER) return false;
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
		if (isWarehouse(b) || !t.worker) return;
		const u = st.units[b.worker];
		if (!u || u.job === 'w-go') return;
		if (t.kind === 'market') return hall(b, u, dt);
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
		if (b.type === 'house') {
			const was = b.level;
			b.level = Math.max(1, b.level + (b.level ? 1 : 0));
			b.cost = {};
			if (was) {
				b.stage = 'live';
				b.status = '';
				const u = st.units[b.builder];
				b.builder = 0;
				if (u) goHome(u);
				say(`A house now holds ${HOUSE_BEDS[b.level - 1]} settlers`, b.node, 'good');
				st.objV++;
				return;
			}
		}
		b.stage = 'live';
		b.timer = 0;
		b.since = st.time;
		const t = T(b);
		b.status = t.worker ? 'Waiting for a worker' : '';
		const u = st.units[b.builder];
		b.builder = 0;
		if (u) goHome(u);
		say(`${t.label} finished`, b.node, 'good');
		st.objV++;
		if (holdsLand(b.type)) territory();
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
					u.ware = 'plank';
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

	// ── trade ──
	/** your purse */
	const purse = () => st.parties[PLAYER].coins;
	/** what of a ware is on its way to the storehouses from the market halls */
	const coming = (/** @type {string} */ w) => all(st.buildings).reduce((s, b) => s + (b.type === 'market' ? b.outQ.filter((/** @type {string} */ x) => x === w).length : 0), 0);
	/** contracts you took that still want a ware */
	/** @returns {any[]} */
	const promised = (/** @type {string} */ w) => st.market.contracts.filter((/** @type {any} */ c) => c.taken && c.w === w && c.got < c.n && c.until > st.time);
	/** what selling or buying a ware means for you now (./market.js) */
	const rule = (/** @type {string} */ w) => orderRule(w, st.parties[PLAYER].pop ?? 0);
	/** what a market hall asks the storehouses for: what your sell orders let go of, and what your requests promise */
	function hallWants(/** @type {any} */ b) {
		const reqs = [];
		const boxed = Object.values(b.box).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0) + Object.values(b.incBox).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0);
		let room = CART * 2 - boxed;
		for (const w of TRADED) {
			if (room <= 0) break;
			const o = st.orders[w];
			const owed = promised(w).reduce((s, c) => s + c.n - c.got, 0);
			const inHand = (b.box[w] ?? 0) + (b.incBox[w] ?? 0);
			let n = Math.max(0, Math.min(owed - inHand, stocked(w)));
			if (o === 'sell') {
				const r = rule(w);
				if (price(st.market, w) >= r.above) n = Math.max(n, Math.min(CART - inHand, stocked(w) - r.keep));
			}
			n = Math.min(n, room);
			if (n > 0) {
				reqs.push({ types: [w], slot: -3, n });
				room -= n;
			}
		}
		return reqs;
	}
	/** what your buy orders would fetch now: [ware, how many], the most wanted first */
	function wantBuys() {
		const m = st.market;
		/** @type {[string, number][]} */
		const list = [];
		for (const w of TRADED) {
			if (st.orders[w] !== 'buy') continue;
			const r = rule(w);
			if (m.pool[w] < 1 || cost(m, w) > r.below || cost(m, w) > purse()) continue;
			const n = Math.min(CART, r.upTo - stocked(w) - coming(w));
			if (n > 0) list.push([w, n]);
		}
		return list.sort((a, b) => b[1] - a[1]);
	}
	/** a market hall at work: its trader sets out when there is a cartload to sell or something to buy */
	function hall(/** @type {any} */ b, /** @type {any} */ u, /** @type {number} */ dt) {
		const f = st.flags[b.flag];
		while (b.outQ.length && f && f.wares.length < FLAG_CAP) newWare(b.outQ.shift(), f);
		if (!u.inside) {
			b.status = u.job === 't-go' ? 'The trader is on the way to the fair' : 'The trader is on the way back';
			return;
		}
		if (b.timer > 0) return void (b.timer -= dt);
		b.timer = 2;
		if (b.paused) return void (b.status = 'Paused');
		const boxed = Object.values(b.box).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0);
		const coming_ = Object.values(b.incBox).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n, 0);
		const buys = wantBuys();
		if (!(boxed >= CART || (boxed > 0 && coming_ === 0) || buys.length)) {
			b.status = boxed || coming_ ? 'Loading wares for the fair' : 'Nothing to trade: choose what to sell or buy in the Market';
			return;
		}
		const fairB = st.buildings[st.fair];
		const path = fairB && findPath(g, b.node, fairB.node, walkable);
		if (!path) return void (b.status = 'No way to the fair');
		/** @type {Record<string, number>} */
		const load = {};
		let room = CART;
		for (const w of Object.keys(b.box).sort((x, y) => b.box[y] - b.box[x])) {
			const n = Math.min(room, b.box[w]);
			if (n <= 0) continue;
			load[w] = n;
			b.box[w] -= n;
			room -= n;
		}
		Object.assign(u, { inside: false, path, p: 0, tgt: path.length - 1, job: 't-go', speed: CART_SPEED, load, ware: Object.keys(load)[0] ?? '' });
		b.status = 'The trader is on the way to the fair';
	}
	/** your trader at the fair: requests first, then your sell orders, then your buy orders */
	function tradeHere(/** @type {any} */ u) {
		const m = st.market;
		const you = st.parties[PLAYER];
		/** @type {Record<string, number>} */
		const back = {};
		for (let [w, n] of Object.entries(u.load)) {
			for (const c of promised(w)) {
				const give = Math.min(n, c.n - c.got);
				c.got += give;
				n -= give;
				m.sold += give;
				const p = st.parties[c.k];
				p.stock[w] = (p.stock[w] ?? 0) + give;
				if (c.got >= c.n) {
					const paid = Math.min(c.reward, Math.floor(p.coins));
					p.coins -= paid;
					you.coins += paid;
					m.filled++;
					say(paid ? `${p.name} got its ${WARES[w].label.toLowerCase()} and paid ${paid} coins. Thank you!` : `${p.name} thanks you for the ${WARES[w].label.toLowerCase()}!`, -1, 'good');
				}
			}
			const floor = st.orders[w] === 'sell' ? rule(w).above : 0;
			while (n > 0 && price(m, w) >= floor) {
				you.coins += sellOne(m, w);
				m.sold++;
				n--;
			}
			if (n > 0) back[w] = n;
		}
		let room = CART - Object.values(back).reduce((a, b) => a + b, 0);
		for (const [w, want] of wantBuys()) {
			const below = rule(w).below;
			let n = Math.min(want, room);
			while (n > 0 && m.pool[w] >= 1 && cost(m, w) <= below && cost(m, w) <= you.coins) {
				you.coins -= buyOne(m, w);
				back[w] = (back[w] ?? 0) + 1;
				m.bought++;
				n--;
				room--;
			}
			if (room <= 0) break;
		}
		u.load = back;
		u.ware = Object.keys(back)[0] ?? '';
	}
	/** a trader reaches the fair, or home again */
	function traderArrive(/** @type {any} */ u) {
		const home = st.buildings[u.bld];
		if (u.job === 't-go') {
			if (u.owner === PLAYER) tradeHere(u);
			else {
				const m = st.market, p = st.parties[u.owner];
				for (const [w, n] of Object.entries(u.load)) for (let k = 0; k < /** @type {number} */ (n); k++) p.coins += sellOne(m, w);
				u.load = shop(m, p);
				u.ware = Object.keys(u.load)[0] ?? '';
			}
			const path = home && findPath(g, nodeOf(u), home.node, walkable);
			if (!path) return u.owner === PLAYER ? goHome(u) : removeUnit(u);
			Object.assign(u, { path, p: 0, tgt: path.length - 1, job: 't-back' });
			return;
		}
		// home again
		if (u.owner === PLAYER) {
			if (!home) return goHome(u);
			for (const [w, n] of Object.entries(u.load)) for (let k = 0; k < /** @type {number} */ (n); k++) home.outQ.push(w);
			Object.assign(u, { inside: true, job: 'w-in', load: {}, ware: '', speed: WALK });
			return;
		}
		const p = st.parties[u.owner];
		for (const [w, n] of Object.entries(u.load)) p.stock[w] = (p.stock[w] ?? 0) + /** @type {number} */ (n);
		removeUnit(u);
	}

	// ── the land ──
	function territory() {
		// a village belongs to whoever has a house (or a city hall, or the fair) in it
		const vo = Array(plan.villages.length).fill(-1);
		for (const b of all(st.buildings).sort((x, y) => x.since - y.since)) if (holdsLand(b.type) && vo[villageAt(b.node)] === -1) vo[villageAt(b.node)] = b.owner;
		st.villageOwner = vo;
		const own = Array(N).fill(-1);
		for (let i = 0; i < N; i++) own[i] = vo[villageAt(i)];
		st.owner = own;
		st.terV++;
		// what stands on land its owner lost, burns
		for (const b of all(st.buildings))
			if (st.buildings[b.id] && b.owner === PLAYER && own[b.node] !== b.owner) {
				if (b.owner === PLAYER) say(`Your ${T(b).label.toLowerCase()} burned: the land is no longer yours`, b.node, 'alert');
				removeBuilding(b, true, false);
			}
		for (const f of all(st.flags)) if (st.flags[f.id] && f.owner === PLAYER && own[f.node] !== f.owner) removeFlag(f);
		for (const r of all(st.roads)) if (st.roads[r.id] && r.path.some((/** @type {number} */ n) => own[n] !== r.owner)) removeRoad(r);
	}

	// ── homes ──
	/** the beds in your city: the city hall's and every house's (a house being enlarged keeps its beds meanwhile) */
	const beds = () => all(st.buildings).reduce((s, b) => s + (b.owner !== PLAYER ? 0 : b.type === 'hq' ? /** @type {number} */ (BUILDINGS.hq.beds) : b.type === 'house' && b.level ? HOUSE_BEDS[b.level - 1] : 0), 0);
	/** the neighbours' cities as they grow: a settlement (a house, two factories) for every eight or so people */
	function neighbourTowns() {
		for (let k = 1; k < st.parties.length; k++) {
			const p = st.parties[k];
			const hall = st.buildings[st.villages[k - 1]];
			if (!hall) continue;
			const vill = plan.villages[villageAt(hall.node)];
			const ring = vill.plots.filter((x) => x !== plan.plotOf[hall.node]);
			const count = Math.max(1, Math.min(ring.length, Math.ceil(p.pop / 8)));
			let level = 1;
			while (level < 4 && count * HOUSE_BEDS[level - 1] < p.pop) level++;
			const kinds = NEIGHBOURS[k - 1].builds;
			const want = [plan.plotOf[hall.node], ...ring.slice(0, count)];
			want.forEach((plot, x) => {
				const [h, f1, f2] = plan.spots[plot];
				if (x > 0 && h >= 0) {
					const b = buildingAt(h);
					if (!b) {
						if (st.obj[h]) st.obj[h] = null;
						const nb = makeBuilding('house', h, k, true);
						nb.level = level;
						nb.since = -1;
					} else if (b.type === 'house' && b.level !== level) {
						b.level = level;
						st.objV++;
					}
				}
				for (const [y, spot] of [f1, f2].entries()) {
					if (spot < 0 || buildingAt(spot)) continue;
					const type = kinds[(x * 2 + y) % kinds.length];
					if (BUILDINGS[type].on === 'mountain' ? st.terrain[spot] !== MOUNTAIN : st.terrain[spot] === WATER) continue;
					if (st.obj[spot]) st.obj[spot] = null;
					makeBuilding(type, spot, k, true).since = -1;
				}
			});
		}
	}

	// ── the settlements: needs, the neighbours' work and trade, abundance ──
	/** your people: in the storehouses and out at work */
	const yourPeople = () => warehouses().reduce((s, w) => s + w.settlers, 0) + all(st.units).filter((u) => u.owner === PLAYER).length;
	function settlements(/** @type {number} */ dt) {
		const m = st.market, c = st.clocks;
		// yours eat from the storehouses, the fullest first
		const you = st.parties[PLAYER];
		you.pop = yourPeople();
		live(
			you,
			you.pop,
			dt,
			(w) => {
				const wh = warehouses().filter((x) => (x.stock[w] ?? 0) > 0).sort((a, b) => b.stock[w] - a.stock[w])[0];
				if (!wh) return false;
				wh.stock[w]--;
				return true;
			},
			stocked
		);
		for (let k = 1; k < st.parties.length; k++) {
			const p = st.parties[k];
			make(p, k, dt);
			live(
				p,
				p.pop,
				dt,
				(w) => ((p.stock[w] ?? 0) >= 1 ? ((p.stock[w] -= 1), true) : false),
				(w) => p.stock[w] ?? 0
			);
		}
		fair(m, st.time, dt);
		// the neighbours' traders
		if (st.time >= c.trade) {
			c.trade = st.time + 1;
			for (let k = 1; k < st.parties.length; k++) {
				const p = st.parties[k];
				const village = st.buildings[st.villages[k - 1]];
				if (!village || st.time < p.trip || all(st.units).some((u) => u.kind === 'trader' && u.owner === k)) continue;
				p.trip = st.time + 20 + rand() * 25;
				const sell = toSell(m, p);
				const short = Object.values(p.sat).some((x) => x < 0.97) || p.reserve < 0.8;
				if (!sell && !(short && p.coins > 4)) continue;
				const path = findPath(g, village.node, st.buildings[st.fair].node, walkable);
				if (!path) continue;
				/** @type {Record<string, number>} */
				const load = {};
				if (sell) {
					load[sell.w] = sell.n;
					p.stock[sell.w] -= sell.n;
				}
				spawn('trader', k, path, 't-go', { bld: village.id, load, ware: sell?.w ?? '', speed: CART_SPEED });
			}
		}
		// they grow when they live well, and shrink when they don't
		if (st.time >= c.grow2) {
			c.grow2 = st.time + 120;
			for (let k = 1; k < st.parties.length; k++) {
				const p = st.parties[k];
				// a family settles where people live well and there is food put by for them
				if (p.wb >= 78 && p.reserve >= 0.75 && p.pop < 50) p.pop++;
				else if (p.wb < 40 && p.pop > 10) {
					p.pop--;
					if (rand() < 0.3) say(`${p.name} is struggling: a family left the valley`, st.buildings[st.villages[k - 1]]?.node ?? -1, 'alert');
				}
			}
		}
		// requests
		if (st.time >= m.clock.contract) {
			m.clock.contract = st.time + 120 + rand() * 90;
			const req = request(m, st.parties, st.time, rand);
			const what = req && `${req.n} ${WARES[req.w].label.toLowerCase()}`;
			if (req) say(req.reward ? `${st.parties[req.k].name} asks for ${what}: ${req.reward} coins. See the Market.` : `${st.parties[req.k].name} has no coins left and asks for help: ${what}. See the Market.`, st.buildings[st.villages[req.k - 1]]?.node ?? -1, req.reward ? 'info' : 'alert');
		}
		for (const ct of m.contracts)
			if (!ct.gone && ct.got < ct.n && ct.until <= st.time) {
				ct.gone = true;
				if (ct.taken) say(`Too late: ${st.parties[ct.k].name}’s request for ${WARES[ct.w].label.toLowerCase()} ran out`, -1, 'alert');
			}
		// abundance
		m.abundance = abundance(st.parties);
		// the last goal: it counts once the others are reached
		const ready = GOALS.every((x) => x.id === 'abundance' || st.goals[x.id]);
		const pops = st.parties.map((/** @type {any} */ p, /** @type {number} */ k) => (k ? p.pop : yourPeople()));
		m.thriving = st.parties.filter((/** @type {any} */ p, /** @type {number} */ k) => p.wb >= ABUNDANT && pops[k] >= PEOPLE).length;
		if (ready && m.thriving === st.parties.length) {
			if (m.since < 0) {
				m.since = st.time;
				say(`Every settlement lives well (abundance ${Math.round(m.abundance)}). Hold it for ten minutes!`, -1, 'good');
			}
			if (st.time - m.since >= HOLD && !st.goals.abundance) {
				st.result = 'won';
				st.goals.abundance = true;
				say('Ten minutes of abundance for the whole valley. Everyone lives well!', -1, 'good');
			}
		} else if (m.since >= 0) {
			m.since = -1;
			const who = st.parties.find((/** @type {any} */ p, /** @type {number} */ k) => p.wb < ABUNDANT || pops[k] < PEOPLE);
			say(`${who?.name === 'You' ? 'Your settlement' : who?.name ?? 'A settlement'} slipped below ${ABUNDANT} or ${PEOPLE} people: see the Market`, -1, 'alert');
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
			if (goal.id === 'wood') done = live('woodcutter') && live('quarry');
			else if (goal.id === 'house') done = all(st.buildings).some((b) => b.type === 'house' && b.owner === PLAYER && b.level >= 4);
			else if (goal.id === 'market') done = st.market.sold > 0;
			else if (goal.id === 'trade') done = st.market.sold + st.market.bought >= /** @type {number} */ (goal.n);
			else if (goal.id === 'contract') done = st.market.filled > 0;
			else if (goal.id === 'abundance') done = !!st.goals.abundance;
			else if (goal.ware) done = progress(goal.ware) >= /** @type {number} */ (goal.n);
			if (done) {
				st.goals[goal.id] = true;
				say(`Goal reached: ${goal.label}`, -1, 'good');
			}
		}
	}
	const progress = (/** @type {string} */ ware) => (ware === 'food' ? FOOD.reduce((s, w) => s + (st.made[w] ?? 0), 0) : st.made[ware] ?? 0);

	function step(dt = TICK) {
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
			if (u.inside || u.job === 'b-work') continue;
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
			} else if (u.job !== 'c-idle' && u.job !== 'w-in') arrive(u);
		}
		for (const b of all(st.buildings)) if (st.buildings[b.id] && b.owner === PLAYER) work(b, dt);
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
			// newcomers settle where people live well and there is a bed for them; with too few beds, people leave
			const people = yourPeople(), room = beds();
			if (hq && people < room && st.parties[PLAYER].wb >= 45) hq.settlers++;
			else if (people > room) {
				const wh = warehouses().find((w) => w.settlers > 0);
				if (wh) {
					wh.settlers--;
					say('A settler left: there are not enough beds. Build or enlarge houses.', wh.node, 'alert');
				}
			}
			neighbourTowns();
		}
		if (st.time >= c.needs) {
			c.needs = st.time + 2;
			settlements(2);
		}
		if (st.time >= c.goals) {
			c.goals = st.time + 1;
			goals();
		}
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
		if (u.kind === 'worker' && (u.job === 't-go' || u.job === 't-back')) return traderArrive(u);
		if (u.kind === 'worker') return workerArrive(u);
		if (u.kind === 'trader') return traderArrive(u);
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
		const plot = plan.plotOf[n], spot = plan.spotOf[n];
		if (spot < 0) return 'Buildings stand round a settlement’s flag: pick a marked spot';
		if (type === 'house' && spot !== 0) return 'A house stands on its settlement’s house spot';
		if (type !== 'house' && spot === 0) return 'This spot is for the settlement’s house';
		const v = villageAt(n), vo = st.villageOwner[v] ?? -1;
		if (type === 'house') {
			if (vo !== PLAYER && !(vo === -1 && plan.villages[v].near.some((x) => st.villageOwner[x] === PLAYER))) return vo === -1 ? 'Too far: found houses in your city or in a village next to it' : 'This village is not yours';
		} else {
			if (vo !== PLAYER) return 'Outside your city';
			const home = buildingAt(plan.spots[plot][0]);
			if (!home || home.owner !== PLAYER || (home.type !== 'house' && home.type !== 'hq')) return 'Build this settlement’s house first';
		}
		if (st.obj[n]) return st.obj[n].k === 'tree' ? 'A tree stands here' : st.obj[n].k === 'rock' ? 'A rock lies here' : 'Something stands here';
		if (st.road[n]) return 'A road runs here';
		if (t.on === 'mountain' ? st.terrain[n] !== MOUNTAIN : st.terrain[n] !== GRASS) return t.on === 'mountain' ? 'Mines stand on mountains' : 'Needs open grass';
		const c = plan.centre[plan.plotOf[n]];
		if (st.terrain[c] === WATER) return 'Its flag would stand in water';
		const f = flagAt(c);
		if (f && f.owner !== PLAYER) return 'Not yours';
		if (st.road[c]) return 'A road runs where its flag goes';
		if (type === 'fishery' && !g.within(n, 4).some((j) => st.terrain[j] === WATER)) return 'Needs water nearby';
		if (t.kind === 'mine' && depositAt(n) <= 0) return 'No iron ore in this rock';
		return '';
	}
	/** the open way for a road between a flag and a node, or null @param {number} from @param {number} to */
	function planRoad(from, to) {
		const start = flagAt(from);
		if (!start || start.owner !== PLAYER || from === to || to < 0) return null;
		const end = flagAt(to);
		if (end ? end.owner !== PLAYER : canFlag(to)) return null;
		// roads keep to the lanes between settlements where they can (a building spot only when there is no other way), never over another settlement's middle
		const open = (/** @type {number} */ j) => st.owner[j] === PLAYER && st.terrain[j] !== WATER && !st.obj[j] && !st.road[j] && plan.centre[plan.plotOf[j]] !== j;
		const path = findPath(g, from, to, open, 2500, (j) => (plan.spotOf[j] >= 0 ? 3 : 0));
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

	return {
		state: st,
		grid: g,
		plan,
		step,
		setup(/** @type {import('./map.js').Valley} */ v) {
			const hq = makeBuilding('hq', v.hq, PLAYER, true);
			hq.stock = { ...START.stock };
			hq.settlers = START.settlers;
			st.parties[PLAYER].coins = START.coins;
			hq.since = 0;
			st.hq = hq.id;
			// the neighbours hold their land first
			st.villages = v.villages.map((n, k) => {
				const b = makeBuilding('village', n, k + 1, true);
				b.since = -1;
				return b.id;
			});
			const f = makeBuilding('fair', v.fair, FAIR, true);
			st.fair = f.id;
			// the first houses round the city hall, nearest first
			const ring = plan.villages[villageAt(hq.node)].plots.filter((k) => k !== plan.plotOf[hq.node]).sort((a, b) => g.dist(plan.centre[a], hq.node) - g.dist(plan.centre[b], hq.node));
			START.houses.forEach((level, x) => {
				const h = plan.spots[ring[x]][0];
				if (h < 0) return;
				const b = makeBuilding('house', h, PLAYER, true);
				b.level = level;
				b.since = 0;
			});
			territory();
			for (const b of all(st.buildings)) if (b.type === 'house') autoRoad(b.flag);
			neighbourTowns();
			say('Welcome to your city. Every building stands round a settlement’s flag: a house and two factories. Build a woodcutter and a quarry beside a house.', hq.node);
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
			if (type === 'house') territory();
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
				if (b.owner !== PLAYER || b.type === 'hq') return { ok: false, why: b.type === 'hq' ? 'The city hall stays' : 'Not yours' };
				removeBuilding(b);
				return { ok: true };
			}
			const f = flagAt(n);
			if (f) {
				if (f.owner !== PLAYER || all(st.buildings).some((x) => x.flag === f.id && x.type === 'hq')) return { ok: false, why: 'This flag stays' };
				removeFlag(f);
				return { ok: true };
			}
			if (st.road[n] && st.roads[st.road[n]]?.owner === PLAYER) {
				removeRoad(st.roads[st.road[n]]);
				return { ok: true };
			}
			return { ok: false, why: 'Nothing to tear down here' };
		},
		/** enlarge a house to its next size: builders bring what it costs, and its settlers stay meanwhile */
		upgrade(/** @type {number} */ id) {
			const b = st.buildings[id];
			if (!b || b.owner !== PLAYER || b.type !== 'house') return { ok: false, why: 'Only your houses grow' };
			if (b.stage !== 'live') return { ok: false, why: 'It is being built' };
			if (b.level >= 4) return { ok: false, why: 'It is as large as a house gets' };
			b.cost = { ...HOUSE_UP[b.level - 1] };
			for (const w of Object.keys(b.cost)) (b.used[w] = 0), (b.got[w] = 0), (b.inc[w] = 0);
			b.stage = 'site';
			b.status = 'Waiting for a builder';
			st.objV++;
			return { ok: true };
		},
		pause(/** @type {number} */ id, /** @type {boolean} */ paused) {
			const b = st.buildings[id];
			if (b && b.owner === PLAYER) b.paused = paused;
		},
		/** sell or buy a ware at the fair, or (null) neither */
		order(/** @type {string} */ w, /** @type {'sell' | 'buy' | null} */ o) {
			if (!TRADED.includes(w)) return;
			if (o) st.orders[w] = o;
			else delete st.orders[w];
		},
		/** take (or let go of) a neighbour's request: your market halls gather it and your trader brings it */
		take(/** @type {number} */ id, on = true) {
			const c = st.market.contracts.find((/** @type {any} */ x) => x.id === id);
			if (c && c.got < c.n && c.until > st.time) c.taken = on;
		},
		/** the fair as the Market shows it */
		market() {
			const m = st.market;
			return {
				purse: purse(),
				halls: all(st.buildings).filter((b) => b.type === 'market' && b.owner === PLAYER).length,
				abundance: m.abundance,
				since: m.since,
				wares: TRADED.map((w) => ({ w, price: price(m, w), cost: cost(m, w), trend: trend(m, w), pool: Math.floor(m.pool[w]), stock: stocked(w), order: st.orders[w] ?? null, hist: [...m.hist[w], price(m, w)] })),
				contracts: m.contracts.filter((/** @type {any} */ c) => c.got < c.n && c.until > st.time).map((/** @type {any} */ c) => ({ ...c, who: st.parties[c.k].name, left: c.until - st.time })),
				parties: st.parties.map((/** @type {any} */ p, /** @type {number} */ k) => ({
					name: p.name,
					about: k ? NEIGHBOURS[k - 1].about : 'Your settlement.',
					pop: k ? p.pop : yourPeople(),
					wb: p.wb,
					sat: { ...p.sat },
					reserve: p.reserve,
					coins: k ? p.coins : purse(),
					node: k ? st.buildings[st.villages[k - 1]]?.node ?? -1 : st.buildings[st.hq]?.node ?? -1
				})),
				sold: m.sold,
				bought: m.bought
			};
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
			let settlers = 0;
			for (const wh of warehouses()) {
				for (const [w, n] of Object.entries(wh.stock)) stock[w] = (stock[w] ?? 0) + /** @type {number} */ (n);
				settlers += wh.settlers;
			}
			stock.coin = Math.floor(purse());
			let carriers = 0, workers = 0;
			for (const u of all(st.units)) if (u.owner === PLAYER) u.kind === 'carrier' ? carriers++ : workers++;
			const m = st.market;
			return {
				time: st.time,
				stock,
				settlers,
				people: yourPeople(),
				beds: beds(),
				villages: st.villageOwner.filter((/** @type {number} */ o) => o === PLAYER).length,
				carriers,
				workers,
				abundance: m.abundance,
				/** settlements living well with enough people */
				thriving: m.thriving ?? 0,
				/** seconds the valley has been abundant, or -1 */
				held: m.since >= 0 ? st.time - m.since : -1,
				parties: st.parties.map((/** @type {any} */ p) => ({ name: p.name, wb: p.wb })),
				result: st.result,
				goals: GOALS.map((x) => ({ ...x, done: !!st.goals[x.id], have: x.ware ? progress(x.ware) : x.id === 'trade' ? m.sold + m.bought : undefined, need: x.n })),
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
				about: b.type === 'village' ? NEIGHBOURS[b.owner - 1].about : t.about,
				name: b.type === 'village' ? st.parties[b.owner].name : '',
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
				stock: isWarehouse(b) ? { ...b.stock } : null,
				settlers: b.settlers,
				box: t.kind === 'market' ? { ...b.box } : null,
				party: b.type === 'village' ? { ...st.parties[b.owner], stock: { ...st.parties[b.owner].stock } } : null,
				level: b.level,
				beds: b.type === 'house' && b.level ? HOUSE_BEDS[b.level - 1] : b.type === 'hq' ? BUILDINGS.hq.beds : 0,
				upgrading: b.type === 'house' && b.stage === 'site' && b.level > 0,
				up: b.type === 'house' && b.level >= 1 && b.level < 4 ? HOUSE_UP[b.level - 1] : null,
				village: villageAt(b.node)
			};
		},
		toJSON: () => JSON.stringify(st)
	};
}
