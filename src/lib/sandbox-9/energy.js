// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · ENERGY, THE MASTER RESOURCE — the calendar's sun, the harvest of every source, and the dispatch.
 *
 * Each day the dome cells and the fields harvest what the month's sun gives (Munich's shares, January 2.9 % of the
 * year, July 14.2 %), the geothermal share runs day and night at 94 %, and the battery shifts a little from one day to
 * the next. Heat is its own flow: the geothermal plant's 90→60 °C heat warms the domes and the growing dome, its
 * condenser heat (30–40 °C) warms the hot spring; without it, heat pumps make heat from electricity (COP 3).
 *
 * The dispatch serves electricity in a fixed order (world model 4.3): basics (people's basic need, food, water, the
 * domes), running (the works, people's extra use, upkeep, and the border's export that replaces worn accelerators),
 * building, then the export for what a project's accelerators need, R&D, storage; what is left is curtailed. Only
 * what reaches R&D is "surplus energy", the only thing innovation runs on. The two energy COOPs share what is sold by
 * the buyers' logit on their prices, each capped by what it harvested.
 */
import { DAYS_IN_MONTH, MONTHLY, SEASON_OF_MONTH, WEATHER, YEAR_DAYS } from './primitives.js';
import { CLASS, ENERGY, MAX_COOPS } from './consts.js';
import { exp } from './dmath.js';
import { polar } from './rng.js';
import { geoGrossKw, solarGain } from './genesis.js';
import { foodSeason, indoorIndex } from './food.js';
import { payEur } from './border.js';

const MONTH_START = DAYS_IN_MONTH.reduce((a, d, i) => (a.push((a[i - 1] ?? 0) + (i ? DAYS_IN_MONTH[i - 1] : 0)), a), []);
/** the month (0 = January) of a day of the world */
export function monthOf(day) {
	const doy = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
	let m = 11;
	while (m > 0 && MONTH_START[m] > doy) m--;
	return m;
}

/** the calendar of the day: month, season, sun and rain factors, and scheduled shocks in force */
export function calendar(w) {
	const m = monthOf(w.day), t = w.today;
	t.month = m;
	t.season = SEASON_OF_MONTH[m];
	t.sunShare = MONTHLY.sun.v[m] / DAYS_IN_MONTH[m];
	t.rainF = MONTHLY.rain.v[m];
	t.heatShare = MONTHLY.heat.v[m] / DAYS_IN_MONTH[m];
	t.harvestShare = MONTHLY.harvest.v[m] / DAYS_IN_MONTH[m];
	// this month's weather (drawn from the seed, ./energy.js monthWeather): sun and rain around the normals
	const wx = monthWeather(w);
	t.sunF = wx.sun;
	t.rainShock = wx.rain;
	t.wxSun = wx.sun;
	t.wxRain = wx.rain;
	// a heat pump's COP and the warm pond's heat loss follow the month
	t.cop = w.c.copMonth[m];
	t.springHeat = w.c.springHeat[m];
	t.geoUp = 1;
	t.shocks = [];
	for (const s of w.cfg.shocks) {
		if (w.day < s.day || w.day >= s.day + (s.days ?? 90)) continue;
		t.shocks.push(s.kind);
		if (s.kind === 'drought') t.rainShock *= s.factor ?? 0.5;
		else if (s.kind === 'darkWinter') t.sunF *= s.factor ?? 0.4;
		else if (s.kind === 'wellFail') t.geoUp = 0;
		if (w.day === s.day) {
			w.events.push({ day: w.day, kind: 'shock', what: s.kind, coop: s.coop ?? null });
			w.shockDays.push(w.day);
			w.slowUntil = Math.max(w.slowUntil, w.day + 90);
		}
	}
	t.sun = t.sunShare * 365 * t.sunF; // 1 = an average day of the year
	t.rain = t.rainF * t.rainShock;
	// the food domes' light today (an average day of the year = 1; with the LED top-up when it is on), and the outdoor
	// food's season and tree crop (./food.js)
	t.ghIdx = indoorIndex(m, t.sunF, w.c.led);
	foodSeason(w);
	// what the sellers read off their meters: rain and sun against an average day of the month (two-week averages);
	// their forward margins expect a dry or dark spell to go on (./coops.js supplyAhead)
	w.rainSeen = (w.rainSeen ?? 1) + (t.rain / t.rainF - (w.rainSeen ?? 1)) / 14;
	w.sunSeen = (w.sunSeen ?? 1) + (t.sunF - (w.sunSeen ?? 1)) / 14;
}

/**
 * The weather of the month: a sun factor and a rain factor around the monthly normals (lognormal, mean 1, spreads in
 * WEATHER), drawn once a month from a random stream of its own seeded by the world's seed. Its own stream: two worlds
 * of one seed (an experiment's pair) get the same weather whatever else differs between them, and the weather does not
 * move any other draw. Setting `weather: false` gives the normals every year.
 */
function monthWeather(w) {
	const mi = Math.floor(w.day / YEAR_DAYS) * 12 + monthOf(w.day);
	const wx = (w.wx ??= { mi: -1, sun: 1, rain: 1, rs: ((w.cfg.seed >>> 0) ^ 0x5bd1e995) >>> 0 || 1 });
	if (wx.mi === mi) return wx;
	wx.mi = mi;
	if (w.cfg.weather === false) return wx;
	const u = () => {
		wx.rs = (wx.rs + 0x6d2b79f5) >>> 0;
		let x = wx.rs;
		x = Math.imul(x ^ (x >>> 15), x | 1);
		x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
	const ss = WEATHER.sunSpread.v, rs = WEATHER.rainSpread.v;
	wx.sun = exp(ss * polar(u) - (ss * ss) / 2);
	wx.rain = exp(rs * polar(u) - (rs * rs) / 2);
	return wx;
}

/** what each energy plant can give today: electricity (kWh), heat and condenser heat (kWh_th) */
export function harvest(w) {
	const t = w.today, h = t.harvest;
	h.solar = h.geo = h.battery = h.geoHeat = h.lowHeat = h.geoQin = h.geoGross = h.geoLossKwh = 0;
	if (!w.eAvail || w.eAvail.length !== MAX_COOPS) w.eAvail = new Float64Array(MAX_COOPS);
	w.eAvail.fill(0);
	if (!w.heatAvail || w.heatAvail.length !== MAX_COOPS) w.heatAvail = new Float64Array(MAX_COOPS);
	w.heatAvail.fill(0);
	for (const co of w.coops) {
		if (!co.alive || co.good !== ENERGY) continue;
		let e = 0;
		for (const pl of co.plants) {
			const live = Math.max(0, pl.cap - pl.worn) * shockFactor(w, co);
			if (pl.tech === 'solar') {
				// a field kWp gives what the sun gives; dome cells fitted after a gain give more from the same glass
				const kwp = pl.cap > 0 ? live : 0;
				const x = kwp * w.c.kwhPerKwp * t.sunShare * t.sunF * solarGain(pl);
				pl.out = x;
				e += x;
				h.solar += x;
			} else if (pl.tech === 'geo') {
				// the ORC turns a share of the heat it draws into gross electricity (its own vintage); pumps and fans take
				// a fixed part; the condenser takes what is left after the losses: heat in = gross + condenser + losses
				const up = w.c.geoUptime * t.geoUp;
				const gross = geoGrossKw(w, pl);
				const net = gross - w.c.geoPumps;
				const cond = w.c.geoQin - gross - w.c.geoLoss;
				const x = live * net * 24 * up;
				pl.out = x;
				e += x;
				h.geo += x;
				h.geoHeat += live * w.c.geoHeatKw * 24 * up;
				h.lowHeat += live * cond * 24 * up;
				h.geoQin = (h.geoQin ?? 0) + live * w.c.geoQin * 24 * up;
				h.geoGross = (h.geoGross ?? 0) + live * gross * 24 * up;
				h.geoLossKwh = (h.geoLossKwh ?? 0) + live * w.c.geoLoss * 24 * up;
				w.heatAvail[co.k] += live * (w.c.geoHeatKw + cond) * 24 * up;
			}
		}
		w.eAvail[co.k] = e;
	}
}

/** a COOP whose output a scheduled failure cuts (world model 4.5: "a COOP fails, output to 10 %") */
export function shockFactor(w, co) {
	for (const s of w.cfg.shocks) if (s.kind === 'coopFail' && s.coop === co.id && w.day >= s.day && w.day < s.day + (s.days ?? 365)) return s.factor ?? 0.1;
	return 1;
}

/**
 * The dispatch. `req` holds the electricity asked for by class (kWh), `heatReq` the heat (direct and condenser), and
 * `basicsB` the part of the basics class that is the domes' climate (the rest of the basics, served first, is water
 * pumping, each person's basic power and food processing; the heat pumps for the domes' heat join the second part).
 * Heat comes from the geothermal plant first; the rest is made by heat pumps (this month's COP), which ask for
 * electricity in the class of what they heat. `exportAsk` holds the electricity the border line asks for accelerators
 * (paper §11.4) in two parts: `up`, what replaces worn accelerators (upkeep), is served with the running class, after
 * the basics and the works and before any building; `build`, what a project needs, after the building class (the
 * city's own energy plants, basics and every other project come first) and before R&D. It is not the city's own
 * use. Returns the share served of each class; the basics' two parts are in today.fillA and today.fillB, the export's
 * two parts in today.fillExportUp and today.fillExportBuild.
 */
export function dispatch(w, req, heatReq, basicsB = 0, exportAsk = null) {
	const t = w.today, h = t.harvest, c = w.c;
	const cop = t.cop ?? c.cop;
	// heat: direct geothermal heat for the domes and the growing dome, condenser heat for the spring
	const direct = Math.min(heatReq.basics, h.geoHeat);
	const low = Math.min(heatReq.running, h.lowHeat + (h.geoHeat - direct));
	t.heatUse = direct + low;
	t.heatFromGeo = { basics: direct, running: low };
	t.heatVented = h.geoHeat + h.lowHeat - direct - low;
	const hpBasics = (heatReq.basics - direct) / cop, hpRunning = (heatReq.running - low) / cop;
	req[CLASS.basics] += hpBasics;
	req[CLASS.running] += hpRunning;
	t.heatPumpKwh = hpBasics + hpRunning;
	t.heatPump = { basics: hpBasics, running: hpRunning };
	// electricity: harvest, then the battery when the first two classes need it
	let supply = h.solar + h.geo;
	const needFirst = req[CLASS.basics] + req[CLASS.running];
	let battOut = 0;
	const battery = batteryOf(w);
	if (battery && needFirst > supply) {
		battOut = Math.min(battery.batt, needFirst - supply);
		battery.batt -= battOut;
		supply += battOut;
	}
	h.battery = battOut;
	// the grid, during the build-out only (./ramp.js): what the camp and the young village's basics and works need beyond
	// their own sun and batteries is bought through the line (its capacity) by the first energy COOP, which sells it on;
	// the euros go through the bank (./border.js payEur), counted as an import
	let gridIn = 0;
	if (w.ramp && !w.ramp.over && needFirst > supply && c.gridEurKwh > 0) {
		const seller = w.coops.find((co) => co.alive && co.good === ENERGY && co.plants.some((p) => p.tech === 'solar')) ?? w.coops.find((co) => co.alive && co.good === ENERGY);
		if (seller) {
			gridIn = Math.min(needFirst - supply, c.lineKwhDay ?? Infinity);
			supply += gridIn;
			w.eAvail[seller.k] += gridIn;
			const eur = gridIn * c.gridEurKwh;
			payEur(w, seller, eur);
			t.imp.grid = (t.imp.grid ?? 0) + gridIn;
			t.impEur.grid = (t.impEur.grid ?? 0) + eur;
		}
	}
	h.grid = gridIn;
	const fill = new Float64Array(5);
	let left = supply, exp = 0, lineLeft = Infinity;
	const exUp = Math.max(0, exportAsk?.up ?? 0), exBuild = Math.max(0, exportAsk?.build ?? 0);
	t.fillExportUp = t.fillExportBuild = 1;
	for (const cl of [CLASS.basics, CLASS.running, CLASS.building, CLASS.rd]) {
		const r = req[cl];
		const served = Math.min(r, left);
		fill[cl] = r > 0 ? served / r : 1;
		t.use[cl] = served;
		t.unserved[cl] = r - served;
		left -= served;
		if (cl === CLASS.basics) {
			// within the basics: water, people's basic power and food first, then the domes' climate and heat
			const B = Math.max(0, Math.min(r, basicsB + hpBasics)), A = r - B;
			const sA = Math.min(A, served);
			t.fillA = A > 0 ? sA / A : 1;
			t.fillB = B > 0 ? Math.max(0, served - sA) / B : 1;
		}
		if (cl === CLASS.running) {
			// what the line can carry today, hour by hour (./energy.js lineRoom): at noon the sun can make more than it
			lineLeft = lineRoom(w, h, t.use[CLASS.basics] + t.use[CLASS.running]);
			t.lineRoomKwh = lineLeft;
			// the border's export that replaces worn accelerators is upkeep (world model 4.3: upkeep is in the running
			// class), so it is served with the running class, after the city's basics and works and before any building
			const x = Math.min(exUp, left, lineLeft);
			lineLeft -= x;
			t.fillExportUp = exUp > 0 ? x / exUp : 1;
			left -= x;
			exp += x;
		}
		if (cl === CLASS.building) {
			// what a project's accelerators need: after the city's own building (its energy plants, its basics, every
			// other project), before R&D
			const y = Math.min(exBuild, left, lineLeft);
			lineLeft -= y;
			t.fillExportBuild = exBuild > 0 ? y / exBuild : 1;
			left -= y;
			exp += y;
		}
	}
	// storage: the battery takes what is left of the solar harvest
	let charge = 0;
	if (battery && left > 0) {
		const solarLeft = Math.min(left, h.solar);
		charge = Math.min(solarLeft, (battery.battCap - battery.batt) / c.battRT);
		battery.batt += charge * c.battRT;
		left -= charge;
	}
	t.use[CLASS.storage] = charge;
	t.battIn = charge;
	t.battLoss = charge * (1 - c.battRT);
	// the border (setting chipImport): what the line exported for accelerators, served above (upkeep with running, a
	// project's after building); it is electricity the energy COOPs sold, never energy the city used
	t.exportKwh = exp;
	t.exportAsk = exUp + exBuild;
	t.curtailed = left;
	fill[CLASS.storage] = 1;
	// who sold it: the buyers' logit on price, each seller capped by what it has (the battery is the solar COOP's)
	const sold = supply - left - charge; // (the export included: it is electricity the energy COOPs sell)
	splitSellers(w, sold, battOut, battery);
	// surplus energy: what was left after basics, running (with upkeep), building and the export, for R&D, storage or
	// curtailment
	t.surplusKwh = t.use[CLASS.rd] + charge + left;
	return fill;
}

/** hours of daylight in Munich (48° N) by month, Jan first (sunrise to sunset, mid-month) */
const DAYLIGHT_H = [8.6, 10.1, 11.9, 13.7, 15.3, 16.1, 15.6, 14.2, 12.5, 10.7, 9.0, 8.2];
/**
 * What the line can export today, hour by hour (kWh): each quarter hour it carries at most its rating, and only what
 * the village makes beyond its own use in that quarter hour. The sun's day is a half sine over the daylight hours
 * (its peak π/2 times the day's mean over them), the geothermal plant runs flat, the village's basics and running use
 * is spread evenly over the day; the battery serves the village and is not exported. So a sunny June noon makes more
 * than the line can carry, and what the line cannot carry is curtailed or stored.
 */
export function lineRoom(w, h, ownUse) {
	const L = (w.c.lineKwhDay ?? Infinity) / 24;
	if (!Number.isFinite(L)) return Infinity;
	const D = DAYLIGHT_H[monthOf(w.day)];
	const peak = ((h.solar ?? 0) * Math.PI) / (2 * D);
	const geo = (h.geo ?? 0) / 24, load = ownUse / 24;
	let room = 0;
	for (let q = 0; q < 96; q++) {
		const hr = (q + 0.5) / 4, t0 = 12 - D / 2;
		const sun = hr > t0 && hr < t0 + D ? peak * Math.sin((Math.PI * (hr - t0)) / D) : 0;
		room += Math.min(L, Math.max(0, geo + sun - load)) / 4;
	}
	return room;
}

/** the plant that holds the battery, if any */
function batteryOf(w) {
	for (const co of w.coops) if (co.alive && co.good === ENERGY) for (const pl of co.plants) if (pl.battCap > 0) return pl;
	return null;
}

/** how much of the electricity sold today each energy COOP delivered, and the blended price in R a kWh */
function splitSellers(w, sold, battOut, battery) {
	const M = MAX_COOPS;
	if (!w.eSold || w.eSold.length !== M) w.eSold = new Float64Array(M);
	w.eSold.fill(0);
	const avail = Float64Array.from(w.eAvail);
	if (battery) for (const co of w.coops) if (co.alive && co.plants.includes(battery)) avail[co.k] += battOut;
	const share = w.shares, base = ENERGY * M;
	let left = sold;
	// first pass by the logit shares, then what a seller could not give goes to the others with room
	for (let k = 0; k < M; k++) {
		const s = share[base + k];
		if (!(s > 0)) continue;
		const x = Math.min(avail[k], sold * s);
		w.eSold[k] = x;
		left -= x;
	}
	for (let pass = 0; pass < 3 && left > 1e-9; pass++) {
		let room = 0;
		for (let k = 0; k < M; k++) room += Math.max(0, avail[k] - w.eSold[k]);
		if (!(room > 0)) break;
		const take = Math.min(left, room);
		for (let k = 0; k < M; k++) {
			const r = Math.max(0, avail[k] - w.eSold[k]);
			if (r > 0) {
				const x = (take * r) / room;
				w.eSold[k] += x;
				left -= x;
			}
		}
	}
	let pR = 0;
	for (let k = 0; k < M; k++) if (w.eSold[k] > 0) pR += (w.eSold[k] / Math.max(1e-12, sold - left)) * w.coops[k].price * w.P[k];
	if (!(pR > 0)) pR = w.pbar[ENERGY];
	w.today.energyPriceR = pR;
	for (const co of w.coops) if (co.alive && co.good === ENERGY) co.supplyToday = avail[co.k];
}
