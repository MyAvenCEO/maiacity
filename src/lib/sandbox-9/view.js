// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · WHAT THE PAGE SEES — reads a running world (./engine.js) into small plain objects the page draws:
 * the blobs on the field, the coins of today's sales, and the numbers under the charts. It only reads: nothing here
 * changes a world, so a world watched on the page runs exactly as it runs in the proof.
 *
 *   const v = makeViewer(w);      // one per world; it keeps 30-day running sums for the charts
 *   v.day();                      // call after every step(w): adds today to those sums
 *   v.frame();                    // the field: people, COOPs, coins, weather, energy (transferable arrays)
 *   v.point(a, b);                // one point of the time charts, from day a to day b
 *   v.panel();                    // the bar charts: ownership, energy by tenth, where energy goes, surplus split
 *
 * Every number comes from the world's own state or its daily records (./records.js); a coin is a real sale of the
 * day (a buyer that paid that COOP today), never an invented one.
 */
import { BASICS, BED, CLASS_NAMES, CONSUMER, ENERGY, FOOD, G, GOOD_IDS, LIMIT_NAMES, MAX_COOPS, WATER } from './consts.js';
import { treasuryR } from './coops.js';
import { getDay } from './engine.js';

const M = MAX_COOPS;
const WINDOW = 30; // days in the running sums of the bar charts
const COINS_PER_COOP = 3; // buyers drawn per COOP per frame (a sample of the day's real buyers)

/** a small seeded random source of the viewer's own, so watching never touches the world's random stream */
function rand(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 4294967296;
	};
}

export function makeViewer(w) {
	const rnd = rand((w.cfg.seed ?? 1) * 7 + 3);
	// ring buffers of the last WINDOW days: energy (kWh) by source and by use, and the surplus of each basic (R)
	const E_KEYS = ['solar', 'geo', 'battery', ...CLASS_NAMES, 'curtailed', 'losses'];
	const ring = { e: new Float64Array(WINDOW * E_KEYS.length), buy: new Float64Array(WINDOW * 4), sell: new Float64Array(WINDOW * 4), n: new Float64Array(WINDOW), filled: 0, at: 0 };
	let evAt = 0; // the events already shown

	/** add the day just run to the running sums */
	function day() {
		const t = w.today, h = t.harvest, slot = ring.at;
		const e = [h.solar, h.geo, h.battery, ...Array.from(t.use), t.curtailed, t.battLoss];
		for (let j = 0; j < E_KEYS.length; j++) ring.e[slot * E_KEYS.length + j] = e[j] || 0;
		// who keeps the surplus of each basic: buyers (each person's limit less the price, on what they got) and
		// sellers (the price less the variable cost, on what they sold)
		for (let b = 0; b < 4; b++) {
			const p = w.pbar[BASICS[b]];
			let buy = 0;
			for (let i = 0; i < w.N; i++) {
				const room = w.limit[i * 4 + b] - p;
				if (room > 0) buy += room * w.q[i * G + BASICS[b]];
			}
			let sell = 0;
			for (const co of w.coops) if (co.alive && co.good === BASICS[b]) sell += Math.max(0, co.sold * (co.price * w.P[co.k] - (co.varR ?? 0)));
			ring.buy[slot * 4 + b] = buy;
			ring.sell[slot * 4 + b] = sell;
		}
		ring.n[slot] = w.N;
		ring.at = (slot + 1) % WINDOW;
		ring.filled = Math.min(WINDOW, ring.filled + 1);
	}

	/** the field: everything the canvas draws for this day */
	function frame() {
		const N = w.N, d = getDay(w), t = w.today;
		const dec = new Uint8Array(N), adec = new Uint8Array(N), owner = new Uint8Array(N);
		const met = new Float32Array(N), hold = new Float32Array(N), living = new Float32Array(N), div = new Float32Array(N), aven = new Float32Array(N), spent = new Float32Array(N);
		const lim = new Float32Array(N * 4);
		for (let i = 0; i < N; i++) {
			dec[i] = w.decH[i];
			adec[i] = w.decA[i];
			owner[i] = w.owner[i];
			met[i] = w.rec.n > 0 ? w.met[i] : NaN; // before day 0 has run, nobody has eaten yet: not short
			hold[i] = w.wealth[i];
			living[i] = w.L[i];
			div[i] = w.div[i];
			aven[i] = w.aven[i];
			spent[i] = w.spent[i];
			for (let b = 0; b < 4; b++) lim[i * 4 + b] = w.limit[i * 4 + b];
		}
		const price = Float32Array.from(BASICS, (b) => w.pbar[b]);
		const coops = w.coops.map((co) => ({
			id: co.id,
			k: co.k,
			good: co.good,
			city: !!co.city,
			alive: co.alive,
			tech: co.plants[0]?.tech ?? (co.city ? 'well' : ''),
			techs: [...new Set(co.plants.map((p) => p.tech))],
			treasuryR: treasuryR(w, co.k),
			reserveR: co.reserveR ?? 0,
			priceR: co.price * w.P[co.k],
			floorR: co.floorR,
			fullR: co.fullR,
			capacity: co.capDay,
			made: co.made,
			sold: co.sold,
			stock: co.stock,
			limit: LIMIT_NAMES[co.limiter ?? 0],
			tankL: co.plants.reduce((a, p) => a + (p.tech === 'rain' ? Math.max(0, p.cap - p.worn) * 1000 : 0), 0),
			why: co.why || ''
		}));
		// coins: for each COOP that sold today, a few of today's real buyers. A person bought from it if the person
		// got its good today (every buyer's order is shared among the good's sellers by their logit shares); a COOP
		// bought from it if it asked for that material today (w.b2b). A person pays with the seller's own MIND if it
		// holds some, else with the MIND of lowest Law 5 yield it holds (the engine's payment order), which the pools
		// convert, so the seller receives only its own MIND.
		// Then the fifth: two people drawn by what they hold of the seller's MIND, and the treasury that holds most.
		const coins = [];
		const order = w.payOrderCache ?? w.ks;
		for (const co of w.coops) {
			if (!co.alive || !(co.sold > 0)) continue;
			const k = co.k, g = co.good;
			const buyers = [];
			let seen = 0;
			if (CONSUMER.includes(g))
				for (let i = 0; i < N; i++) {
					if (!(w.q[i * G + g] > 0)) continue;
					seen++;
					if (buyers.length < COINS_PER_COOP) buyers.push(i);
					else {
						const j = Math.floor(rnd() * seen);
						if (j < COINS_PER_COOP) buyers[j] = i;
					}
				}
			const pays = buyers.map((i) => {
				if (w.hold[i * M + k] > 0) return k; // the seller's own MIND first: straight to the seller, no pool
				for (const j of order) if (w.hold[i * M + j] > 0) return j;
				return k;
			});
			const coopBuyers = [];
			if (w.b2b) for (const j of w.ks) if (j !== k && w.b2b[g * M + j] > 0 && w.coops[j]?.alive && coopBuyers.length < 2) coopBuyers.push(j);
			const holders = [];
			let tot = 0;
			for (let i = 0; i < N; i++) tot += w.hold[i * M + k];
			for (let n = 0; n < 2 && tot > 0; n++) {
				let x = rnd() * tot;
				for (let i = 0; i < N; i++) {
					x -= w.hold[i * M + k];
					if (x <= 0) {
						holders.push(i);
						break;
					}
				}
			}
			let tre = -1, tb = 0;
			for (const j of w.ks) if (j !== k && w.tre[j * M + k] > tb) (tb = w.tre[j * M + k]), (tre = j);
			coins.push({ k, buyers, pays, coopBuyers, holders, tre, pool: w.poolsOf?.[k]?.[0] ?? 0 });
		}
		const events = [];
		for (; evAt < w.events.length; evAt++) {
			const e = w.events[evAt];
			if (e.kind === 'found' || e.kind === 'receivership' || e.kind === 'shock') events.push({ day: e.day, kind: e.kind, coop: e.coop ?? null, what: e.what ?? null, heir: e.heir ?? null });
		}
		const rec = w.rec, n = rec.n - 1;
		return {
			day: d.day,
			year: d.year,
			month: d.month,
			season: d.season,
			sun: d.sun,
			rain: d.rain,
			shocks: d.shocks,
			N,
			dec, adec, owner, met, hold, living, div, aven, spent, lim, price,
			coops,
			pools: w.pools.map((p) => Array.from(p.members)),
			coins,
			events,
			energy: { solar: t.harvest.solar, geo: t.harvest.geo, battery: t.harvest.battery },
			basicCostR: t.basicCostR,
			score: {
				shortPD: rec.shortAnyPD,
				shortToday: n >= 0 ? rec.shortAny[n] : 0,
				strict: n >= 0 ? rec.strict[n] : NaN,
				poorL: n >= 0 ? rec.decH[n * 10] : NaN,
				Lmean: n >= 0 ? rec.Lmean[n] : NaN,
				exits: w.events.filter((e) => e.kind === 'receivership').length,
				founded: w.events.filter((e) => e.kind === 'found').length
			}
		};
	}

	/** one point of the time charts: the days [a, b) of the records folded into one */
	function point(a, b) {
		const rec = w.rec;
		b = Math.min(b, rec.n);
		a = Math.max(0, Math.min(a, b - 1));
		let short = 0, poor = 0, ceil = 0, mean = 0, c = 0;
		for (let d = a; d < b; d++) {
			short = Math.max(short, rec.shortAny[d]);
			poor += rec.decH[d * 10];
			ceil += rec.Lceil[d];
			mean += rec.Lmean[d];
			c++;
		}
		const own = ownership(w);
		return { d: b - 1, N: rec.N[b - 1], short, poorL: poor / c, ceil: ceil / c, Lmean: mean / c, people: own.people, treasuries: own.treasuries, pools: own.pools };
	}

	/** the bar charts: means over the running window */
	function panel() {
		const n = ring.filled || 1, K = E_KEYS.length;
		const sumE = new Float64Array(K), buy = new Float64Array(4), sell = new Float64Array(4);
		let people = 0;
		for (let s = 0; s < ring.filled; s++) {
			for (let j = 0; j < K; j++) sumE[j] += ring.e[s * K + j];
			for (let b = 0; b < 4; b++) (buy[b] += ring.buy[s * 4 + b]), (sell[b] += ring.sell[s * 4 + b]);
			people += ring.n[s];
		}
		const perPerson = people > 0 ? 1 / people : 0; // the window's kWh ÷ its person-days: kWh a person a day
		const energy = Object.fromEntries(E_KEYS.map((key, j) => [key, sumE[j] * perPerson]));
		// each tenth by holdings: living standard and own energy use over the window
		const rec = w.rec, a = Math.max(0, rec.n - WINDOW);
		const L = new Array(10).fill(0), kwh = new Array(10).fill(0);
		let c = 0;
		for (let d = a; d < rec.n; d++) {
			for (let x = 0; x < 10; x++) (L[x] += rec.decH[d * 10 + x]), (kwh[x] += rec.decHE[d * 10 + x]);
			c++;
		}
		for (let x = 0; x < 10; x++) (L[x] /= c || 1), (kwh[x] /= c || 1);
		let ePP = 0;
		for (let d = a; d < rec.n; d++) ePP += rec.ePP[d];
		ePP /= Math.max(1, rec.n - a);
		return {
			ownership: ownership(w),
			energy,
			ePP,
			deciles: { L, kwh },
			surplus: BASICS.map((g, b) => ({ good: GOOD_IDS[g], buyers: buy[b] / n, sellers: sell[b] / n }))
		};
	}

	return { day, frame, point, panel };
}

/** who holds all MIND, in R: people, COOP treasuries (the City COOP's too), and the protocol's pools */
export function ownership(w) {
	const P = w.P;
	let people = 0, tre = 0, pools = 0;
	for (let i = 0; i < w.N; i++) {
		const b = i * M;
		for (const k of w.ks ?? []) people += w.hold[b + k] * P[k];
	}
	for (let j = 0; j < M * M; j++) if (w.tre[j] !== 0) tre += w.tre[j] * P[j % M];
	for (const p of w.pools) for (let i = 0; i < p.x.length; i++) pools += p.x[i] * P[p.members[i]];
	const tot = people + tre + pools || 1;
	return { people: people / tot, treasuries: tre / tot, pools: pools / tot, totalR: people + tre + pools };
}

/** the goods a viewer can name: food, water, energy, a bed first */
export const BASIC_LABELS = ['Food', 'Water', 'Energy', 'A bed'];
export const BASIC_UNITS = ['kg', 'L', 'kWh', 'bed'];
export { FOOD, WATER, ENERGY, BED };
