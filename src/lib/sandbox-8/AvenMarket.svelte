<!--
	avenCITY Sandbox 7 — avens trading ($lib/sandbox-8). Ten blobs in a 2D valley, each with 1,000 HEARTS and a territory
	that grows 1 to 3 of the 5 goods. Every hour the market matches their asks and bids (no market place: after a deal the
	buyer walks over to fetch its goods); all day long each one keeps re-deciding its prices with Liquid's decision model
	d1 on Samuel's own GPU machine (over Tailscale), Qwen there answering when d1 can't; Liquid's hosted d1:free is a choice
	too. No brain, no game: the valley pauses until one answers. It plays only on a device in Samuel's tailnet (Samuel):
	elsewhere it stays locked.
	Survive, and end with the most HEARTS. Signed in (the Mac app's key, or the site's session) the valley runs on a config
	from the database, changed only by MIPs (the Proposals view), and every run is saved there day by day (store.js).
-->
<script>
	import { onMount } from 'svelte';
	import { createWorld, step, ranking, want, ROT, GOODS, GOOD_LABEL, GOOD_COLOUR, NEED, WORLD, DAY_S, CODE, hookSample } from './economy.js';
	import { loadCode } from './sandbox.js';
	import { RULES, CONFIG, setRules, changedRules, useConfig } from './rules.js';
	import RulesView from './RulesView.svelte';
	import ProposalsView from './ProposalsView.svelte';
	import { loadConfigs, recorder } from './store.js';
	import { me, may } from '$lib/auth/client';
	import { native } from '$lib/native';
	// browsers can't call Liquid (no CORS), so every build, the local Mac one too, asks through api.maia.city, which holds the key
	const LIQUID = { relay: import.meta.env.VITE_LIQUID_RELAY || 'https://api.maia.city/api/liquid/decide' };
	import PriceChart from './PriceChart.svelte';
	import StatsView from './StatsView.svelte';
	import { stateFor, questionsFor, askLiquid, askBox, boxModels, boxModel, applyAnswers, LIQUID_MODEL, TOOLS, BOX_URL, BOX_HERE } from './brain.js';

	// the rules this viewer changed last time, kept in this browser only
	const SAVED = 'sandbox-8-rules';
	try {
		setRules(JSON.parse(localStorage.getItem(SAVED) ?? '{}'));
	} catch {
		/* no storage here: the defaults */
	}
	function saveRules() {
		try {
			localStorage.setItem(SAVED, JSON.stringify(changedRules()));
		} catch {
			/* no storage here */
		}
		snap = snapshot();
	}

	// ---- the database: who is playing, the config the valley runs on, and this run, saved day by day ----
	const PICKED = 'sandbox-8-config';
	let acct = $state({ id: /** @type {string | null} */ (null), play: false, admin: false, note: '' });
	let configs = $state(/** @type {any[]} */ ([]));
	/** @type {any} */
	let rec = null;
	let saving = $state({ days: 0, error: '' });

	async function connect() {
		try {
			const f = await me();
			acct = { id: f.id, play: may(f, 'economy:play'), admin: may(f, 'economy:admin'), note: '' };
			if (!acct.play) {
				acct.note = native() ? "This studio's key can't play the economy yet: sign it out once (You, at the bottom, then Sign out) and in again with your passkey. Until then the valley runs on the catalogue's defaults and nothing is saved." : 'Your role cannot play the economy sandbox yet, so the valley runs on the defaults and nothing is saved.';
				return;
			}
			await reloadConfigs(true);
		} catch (e) {
			acct.note = `Not connected (${/** @type {any} */ (e)?.message || 'the API cannot be reached'}): sign in on maia.city to save runs and see the proposals. The valley runs on the catalogue's defaults.`;
		}
	}

	/** load the configs; run on the one picked last (or the first), keeping your changes on top */
	async function reloadConfigs(first = false) {
		configs = (await loadConfigs()).configs;
		let want = CONFIG.id;
		if (first)
			try {
				want = localStorage.getItem(PICKED) ?? 'valley';
			} catch {
				want = 'valley';
			}
		const cfg = configs.find((c) => c.id === want) ?? configs[0];
		if (!cfg) return;
		useConfig(cfg, changedRules());
		saveRules();
		if (!started) reset();
		else if (codeKey() !== loadedKey) useCode();
	}

	// ---- the config cards' code, each card in its own QuickJS sandbox (sandbox.js), fresh for every run ----
	let codeWait = false; // the clock waits while it loads
	let codeNote = $state('');
	let loadedKey = '';
	let codeGen = 0;
	const codeKey = () => JSON.stringify(CONFIG.cards.filter((c) => c.code?.trim()).map((c) => [c.id, c.code]));
	function useCode() {
		const gen = ++codeGen;
		CODE.run?.dispose();
		CODE.run = null;
		codeNote = '';
		loadedKey = codeKey();
		if (loadedKey === '[]') return (codeWait = false);
		codeWait = true;
		loadCode(CONFIG.cards)
			.then((run) => {
				if (gen !== codeGen) return run?.dispose();
				CODE.run = run;
			})
			.catch((e) => {
				if (gen === codeGen) codeNote = `The cards' code could not run here (${e?.message || e}); the valley runs on the values alone.`;
			})
			.finally(() => {
				if (gen === codeGen) codeWait = false;
				snap = snapshot();
			});
	}

	/** play another config: your changes go, the valley starts again */
	function play(/** @type {any} */ cfg) {
		useConfig(cfg, {});
		try {
			localStorage.setItem(PICKED, cfg.id);
		} catch {
			/* no storage here */
		}
		saveRules();
		reset();
		setView('valley');
	}

	/** where the run stands, for the database: who its avens are and how they do */
	function summary() {
		const live = world.avens.filter((/** @type {any} */ a) => a.alive);
		return {
			day: world.day,
			alive: live.length,
			total: Math.round(world.avens.reduce((/** @type {number} */ n, /** @type {any} */ a) => n + a.hearts, 0)),
			leader: ranking(world)[0]?.name ?? null,
			config: { id: CONFIG.id, name: CONFIG.name, version: CONFIG.version },
			code: CODE.run?.info() ?? null,
			avens: world.avens.map((/** @type {any} */ a) => ({ id: a.id, name: a.name, colour: a.colour, grows: [...a.grows], hearts: Math.round(a.hearts), health: Math.round(a.health), alive: a.alive, diedOn: a.diedOn ?? null }))
		};
	}

	/** the run begins in the database: the config as played (cards, every value, your changes on top), seed and brain */
	function startRecording() {
		if (!acct.play) return;
		saving = { days: 0, error: '' };
		rec = recorder(world, { config_id: CONFIG.id, config_version: CONFIG.version, config: { cards: CONFIG.cards, params: { ...RULES }, local: changedRules() }, seed: world.seed, brain: PLAN[brain.mode].filter(Boolean).map((/** @type {any} */ k) => (k === 'liquid' ? LIQUID_MODEL : box[k] || k)).join(', falling back to '), summary: summary() });
	}

	/** send the finished days (every few seconds); `end` closes the run */
	function save(end = false) {
		if (!rec || rec.ended) return;
		const r = rec;
		r.flush(summary(), end).then(() => (saving = { days: r.sent, error: r.error }));
	}

	const SPEEDS = [
		{ k: 1, label: 'Real time' },
		{ k: 24, label: '1 day = 1 h' },
		{ k: 1440, label: '1 day = 1 min' },
		{ k: 4320, label: '1 month = 10 min' },
		{ k: 8640, label: '1 month = 5 min' }
	];

	let world = createWorld();
	let speed = $state(8640);
	let paused = $state(true); // Samuel: nothing runs until you press Start
	let started = $state(false);
	let tab = $state('market');
	let selected = $state(0);
	let panelOpen = $state(true);
	let page = $state('valley'); // the main view: 'valley' or 'stats'
	let snap = $state.raw(snapshot());
	const blankCalls = () => ({ asked: 0, answered: 0, pending: 0, by: /** @type {Record<string, number>} */ ({ d1: 0, qwen: 0, liquid: 0 }), failed: 0, limited: 0, lastError: '', errors: /** @type {Record<string, string>} */ ({ d1: '', qwen: '', liquid: '' }) });
	let calls = $state(blankCalls());

	/** @type {HTMLCanvasElement} */
	let canvas;
	/** @type {HTMLDivElement} */
	let stageEl;

	/** @param {number} n */
	function fmt(n) {
		return Math.round(n).toLocaleString('en-US');
	}
	/** an aven's price against the market price, as ±% (nothing while the good has no market price)
	 * @param {number | null} v @param {number | null} m */
	function pctOf(v, m) {
		if (v == null || m == null) return '';
		const p = Math.round((v / m - 1) * 100);
		return p ? `${p > 0 ? '+' : ''}${p}%` : '±0';
	}
	/** @param {number} t */
	function clock(t) {
		const s = t % DAY_S;
		return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
	}

	/** @returns {any} */
	function snapshot() {
		const a = world.avens[selected ?? 0];
		return {
			day: world.day,
			time: clock(world.t),
			t: world.t,
			// the chart's lines, only while the Prices tab is open: at most ~300 points a good
			series: tab === 'prices' || page === 'stats' ? Object.fromEntries(GOODS.map((g) => { const all = world.market[g].series; const every = Math.max(1, Math.ceil(all.length / 300)); return [g, all.filter((/** @type {any} */ _p, /** @type {number} */ i) => i % every === 0 || i === all.length - 1).map((/** @type {any} */ p) => ({ ...p }))]; })) : {},
			waiting: world.avens.filter((/** @type {any} */ x) => x.alive && !x.brain.ready).length,
			stale: world.avens.filter((/** @type {any} */ x) => x.alive && x.brain.ready && world.t - (x.brain.last?.t ?? 0) >= STALE_H * 3600).length,
			month: Math.floor((world.day - 1) / 30) + 1,
			config: { id: CONFIG.id, name: CONFIG.name, version: CONFIG.version, local: Object.keys(changedRules()).length },
			code: CODE.run?.info() ?? null,
			// the daily rows, only while the Stats view is open (each row is never changed once written)
			stats: page === 'stats' ? world.stats.slice() : [],
			weather: { ...world.weather },
			policy: { mint: RULES.mint, decay: RULES.decay, start: world.startHearts },
			// every aven's wants right now: per good, what it holds against tonight's need and what it still wants to buy
			wants: tab === 'wants' ? world.avens.map((/** @type {any} */ o) => ({ id: o.id, name: o.name, colour: o.colour, alive: o.alive, grows: [...o.grows], last: { ...(o.yesterday?.short ?? {}) }, goods: Object.fromEntries(GOODS.map((g) => [g, { has: o.stock[g], need: NEED[g], buy: want(o, g), bought: o.today.bought[g] }])) })) : [],
			board: ranking(world).map((o) => ({ id: o.id, name: o.name, colour: o.colour, hearts: o.hearts, health: o.health, alive: o.alive, diedOn: o.diedOn, grows: o.grows, source: o.brain.last?.source ?? '—', pending: o.brain.pending })),
			market: Object.fromEntries(
				GOODS.map((g) => {
					const m = world.market[g];
					// the real-time average: every trade of this good in the last 24 in-game hours, weighted by units
					const recent = world.trades.filter((/** @type {any} */ t) => t.good === g && world.t - t.t < DAY_S);
					const units = recent.reduce((/** @type {number} */ n, /** @type {any} */ t) => n + t.qty, 0);
					const avg = units ? Math.round(recent.reduce((/** @type {number} */ n, /** @type {any} */ t) => n + t.qty * t.price, 0) / units) : null;
					return [g, { avg, units, rotted: world.rotted[g], price: m.price, open: m.open, supply: m.supply, demand: m.demand, history: m.history.slice(-30).concat(m.price == null ? [] : [m.price]), sells: m.sells.map((/** @type {any} */ o) => ({ ...o })), wants: m.wants.map((/** @type {any} */ o) => ({ ...o })) }];
				})
			),
			aven: {
				...a,
				stock: { ...a.stock },
				body: { ...a.body },
				harvest: { ...a.harvest },
				ask: { ...a.ask },
				bid: { ...a.bid },
				ledger: a.ledger.slice(-80).reverse(),
				brain: { ...a.brain }
			}
		};
	}

	// every aven thinks all day long, not once a morning (Samuel): once its last decision is in and THINK_H in-game hours
	// have passed, it asks its brain again with what it sees now. There is no rule-based stand-in: an aven acts only on a
	// brain's answers, and the clock waits while any living aven's decision is older than STALE_H. The stalest aven asks
	// first. The brains (Samuel, 2026-10-09) run on his GPU machine, over Tailscale: d1 itself by default, and Qwen, fast,
	// whenever d1 can't (an error, or while d1 rests after one): one request every second (BOX_EVERY, Samuel), sent whether
	// or not the ones before have answered, up to BOX_IN_FLIGHT at once. Liquid's hosted d1:free, one ask at a time, is
	// still a choice: it refuses once a burst of 2 or 3 asks (~20,000 tokens each) has gone through and sustains about one ask
	// every 4 s, so its gap adapts: 10% shorter after an answer (down to GAP_MIN), 50% longer after a refusal (up to
	// GAP_MAX). Only every third ask of an aven is a full one (haggling, stock); the rest ask its prices. A failure no
	// brain covers pauses the valley (a refusal from Liquid only waits).
	const THINK_H = 2;
	const STALE_H = 24;
	const GAP_MIN = 2500;
	const GAP_MAX = 30000;
	const BOX_EVERY = 1000; // Samuel's own machine: one decision request a second (Samuel)
	const BOX_IN_FLIGHT = 6; // ...with at most this many waiting for their answers
	const REST = 60000; // a brain that failed is passed over this long
	let down = $state(/** @type {string} */ (''));
	let busy = $state(/** @type {string} */ (''));
	const gate = { inFlight: 0, nextAt: 0, gap: 4000, rest: /** @type {Record<string, number>} */ ({ d1: 0, qwen: 0, liquid: 0 }) };
	const isRateLimit = (/** @type {string} */ m) => / 429\b|rate.limit|too many/i.test(m);
	const errorOf = (/** @type {any} */ e) => (e?.name === 'AbortError' ? 'timed out' : e?.message || String(e || 'unreachable'));

	// ---- the brains: what answers, and what steps in when it can't ----
	/** @type {Record<string, string>} */
	const NAME = { d1: 'Local d1', qwen: 'Qwen', liquid: 'Liquid' };
	/** @type {Record<string, string>} */
	const BRAINS = { local: "Local d1, Qwen when d1 can't", d1: 'Local d1 only', qwen: 'Qwen only', liquid: `Liquid's hosted ${LIQUID_MODEL}` };
	/** @type {Record<string, [string, string | null]>} */
	const PLAN = { local: ['d1', 'qwen'], d1: ['d1', null], qwen: ['qwen', null], liquid: ['liquid', null] };
	const BRAIN = 'sandbox-8-brain';
	let brain = $state({ mode: 'local', url: BOX_URL });
	try {
		const b = JSON.parse(localStorage.getItem(BRAIN) ?? 'null');
		if (b) brain = { mode: b.mode in BRAINS ? b.mode : 'local', url: b.url || BOX_URL };
	} catch {
		/* no storage here */
	}
	/** @type {{ d1: string, qwen: string } & Record<string, string>} */
	let box = $state({ d1: '', qwen: '' }); // the models the GPU machine serves
	function saveBrain() {
		gate.rest = { d1: 0, qwen: 0, liquid: 0 };
		gate.nextAt = 0;
		calls.errors = { d1: '', qwen: '', liquid: '' };
		down = busy = '';
		try {
			localStorage.setItem(BRAIN, JSON.stringify(brain));
		} catch {
			/* no storage here */
		}
	}
	/** what the GPU machine serves; reaching it is how the page knows this device is in the tailnet */
	async function findBox() {
		await Promise.race([boxModels(brain.url), new Promise((_, no) => setTimeout(() => no(new Error('no answer in 8 s')), 8000))]);
		// each model where it is served: d1 may listen on the machine's other port
		const where = (/** @type {'d1' | 'qwen'} */ k) => boxModel(brain.url, k).then((m) => `${m.id}${m.base === brain.url.trim().replace(/\/+$/, '') ? '' : ` (${m.base.replace(/^https?:\/\/[^:/]+/, '')})`}`, () => '');
		const [d1, qwen] = await Promise.all([where('d1'), where('qwen')]);
		box = { d1, qwen };
	}

	// ---- the lock (Samuel, 2026-10-09): the sandbox plays only on a device in his tailnet, one that reaches his GPU
	// machine; anywhere else (the public site, a device without Tailscale) it stays locked and asks nothing of anyone ----
	let access = $state({ ok: false, checking: true, why: '' });
	async function unlock() {
		access = { ok: false, checking: true, why: '' };
		if (!BOX_HERE) return (access = { ok: false, checking: false, why: '' });
		try {
			await findBox();
		} catch (e) {
			return (access = { ok: false, checking: false, why: errorOf(e) });
		}
		access = { ok: true, checking: false, why: '' };
		connect();
	}

	/** one aven's decision, from the brain whose turn it is: resolves to { answers, source } or throws */
	async function decide(/** @type {any} */ me, /** @type {boolean} */ full) {
		const state = stateFor(world, me);
		const questions = questionsFor(world, me, { full });
		/** @param {number} ms @param {(signal: AbortSignal) => Promise<any>} ask */
		const within = (ms, ask) => {
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), ms);
			return ask(ctrl.signal).finally(() => clearTimeout(timer));
		};
		/** @param {string} who */
		const ask = async (who) => {
			try {
				const answers = await (who === 'liquid' ? within(25000, (signal) => askLiquid(state, questions, { signal, ...LIQUID })) : within(20000, (signal) => askBox(state, questions, { signal, url: brain.url, want: /** @type {any} */ (who) })));
				calls.errors[who] = '';
				gate.rest[who] = 0;
				return { answers, source: who };
			} catch (e) {
				calls.errors[who] = errorOf(e);
				gate.rest[who] = performance.now() + REST;
				throw e;
			}
		};
		const [first, then] = PLAN[brain.mode];
		const now = performance.now();
		// while the first rests after a failure, the second answers (unless it rests too: then the first it is)
		if (then && now < gate.rest[first] && now >= gate.rest[then])
			try {
				return await ask(then);
			} catch {
				/* the first, then */
			}
		try {
			return await ask(first);
		} catch (e) {
			if (!then || performance.now() < gate.rest[then]) throw e;
			try {
				return await ask(then);
			} catch {
				throw e; // neither answers: the first one's failure decides
			}
		}
	}

	/** @param {any} a */
	const lastAt = (a) => (a.brain.ready ? a.brain.last?.t ?? -Infinity : -Infinity);

	/** @param {number} now real time, ms */
	function think(now) {
		const local = brain.mode !== 'liquid';
		if (gate.inFlight >= (local ? BOX_IN_FLIGHT : 1) || now < gate.nextAt) return;
		// the stalest aven that is due: one with no decision yet first, then the oldest decision
		let a = null;
		for (const o of world.avens) {
			if (!o.alive || o.brain.pending) continue;
			if (o.brain.ready && world.t - o.brain.t0 < THINK_H * 3600) continue;
			if (!a || lastAt(o) < lastAt(a)) a = o;
		}
		if (!a) return;
		const me = a;
		const full = !me.brain.ready || (me.brain.asks ?? 0) % 3 === 0;
		me.brain.asks = (me.brain.asks ?? 0) + 1;
		me.brain.pending = true;
		me.brain.t0 = world.t;
		gate.inFlight++;
		calls.asked++;
		calls.pending++;
		// the GPU machine: the next request a second from now, whether or not this one has answered by then
		if (local) gate.nextAt = now + BOX_EVERY;
		const myWorld = world;
		decide(me, full)
			.then(({ answers, source }) => {
				if (source === 'liquid') {
					gate.gap = Math.max(GAP_MIN, gate.gap * 0.9);
					gate.nextAt = performance.now() + gate.gap;
				}
				busy = '';
				if (myWorld !== world || !me.alive) return;
				calls.answered++;
				calls.by[source]++;
				me.brain.error = null;
				applyAnswers(world, me, answers, source);
			})
			.catch((/** @type {any} */ e) => {
				const msg = errorOf(e);
				me.brain.t0 = -Infinity; // it asks again first
				if (brain.mode === 'liquid' && isRateLimit(msg)) {
					// Liquid is busy, not down: wait and ask again, the clock holds meanwhile
					gate.gap = Math.min(GAP_MAX, gate.gap * 1.5);
					gate.nextAt = performance.now() + gate.gap;
					busy = `Liquid's free model is busy (rate limit): asking again in ${Math.round(gate.gap / 1000)} s.`;
					if (myWorld === world) calls.limited++;
					return;
				}
				if (!local) gate.nextAt = performance.now() + gate.gap;
				if (myWorld !== world) return;
				calls.failed++;
				calls.lastError = msg;
				me.brain.error = msg;
				// no decision, no game: pause until a brain answers again
				down = msg;
				paused = true;
			})
			.finally(() => {
				gate.inFlight--;
				if (myWorld === world) calls.pending--;
				me.brain.pending = false;
			});
	}

	/** the clock runs only while every living aven has a decision from Liquid no older than STALE_H */
	const decided = () => world.avens.every((/** @type {any} */ a) => !a.alive || (a.brain.ready && world.t - lastAt(a) < STALE_H * 3600));

	function reset() {
		save(true);
		rec = null;
		saving = { days: 0, error: '' };
		world = createWorld();
		calls = blankCalls();
		down = '';
		busy = '';
		paused = true;
		started = false;
		useCode();
		snap = snapshot();
	}

	let draft = $state(false); // the Proposals view opens on a new MIP (from Policies or World: "Propose as a MIP")
	/** @param {string} v */
	function setView(v) {
		if (v !== 'mips') draft = false;
		page = v;
		snap = snapshot();
	}

	/** Start (the first decisions go out now) or pause */
	function toggle() {
		if (!access.ok) return;
		if (!started) startRecording();
		started = true;
		if (paused) down = '';
		paused = !paused;
	}

	function select(/** @type {number} */ id) {
		selected = id;
		panelOpen = true;
		snap = snapshot();
	}

	// ---- drawing ----
	let view = { s: 1, ox: 0, oy: 0 };

	function fit() {
		const r = stageEl.getBoundingClientRect();
		if (!r.width || !r.height) return; // hidden behind the Stats view
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		canvas.width = Math.round(r.width * dpr);
		canvas.height = Math.round(r.height * dpr);
		canvas.style.width = `${r.width}px`;
		canvas.style.height = `${r.height}px`;
		// room at the foot for the nav pill that floats over every sandbox
		const phone = window.matchMedia('(max-width: 760px)').matches;
		const pad = phone ? 8 : 20,
			foot = phone ? 8 : 76;
		const top = phone ? 52 : 40; // under the price ticker
		const s = Math.min((r.width - pad * 2) / WORLD.w, (r.height - top - foot) / WORLD.h);
		view = { s: s * dpr, ox: ((r.width - WORLD.w * s) / 2) * dpr, oy: (top + (r.height - top - foot - WORLD.h * s) / 2) * dpr };
	}

	function draw(/** @type {number} */ now) {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const { s, ox, oy } = view;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		// sky over the valley follows the hour: dark at night, light by day
		const hour = (world.t % DAY_S) / 3600;
		const light = Math.max(0, Math.min(1, Math.sin(((hour - 6) / 12) * Math.PI) * 1.4 + 0.25));
		ctx.fillStyle = `rgb(${Math.round(28 + 200 * light)} ${Math.round(40 + 196 * light)} ${Math.round(36 + 178 * light)})`;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(s, 0, 0, s, ox, oy);
		ctx.fillStyle = `rgb(${Math.round(60 + 150 * light)} ${Math.round(80 + 140 * light)} ${Math.round(60 + 120 * light)} / 0.55)`;
		ctx.beginPath();
		ctx.roundRect(0, 0, WORLD.w, WORLD.h, 28);
		ctx.fill();

		// territories
		for (const a of world.avens) {
			const t = a.territory;
			ctx.fillStyle = a.alive ? `${a.colour}22` : '#80808018';
			ctx.strokeStyle = a.alive ? `${a.colour}88` : '#80808055';
			ctx.lineWidth = 2;
			ctx.setLineDash([6, 6]);
			ctx.beginPath();
			ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			ctx.setLineDash([]);
			const ink = light > 0.5 ? '#1f2a23' : '#f4f1e8';
			// its crops (1 to 3) as fields along the top of its land, last night's harvest written in each
			const spread = a.grows.length === 1 ? [0] : a.grows.length === 2 ? [-0.8, 0.8] : [-1.25, 0, 1.25];
			a.grows.forEach((/** @type {string} */ g, /** @type {number} */ i) => {
				const ang = -Math.PI / 2 + spread[i];
				const fx = t.x + Math.cos(ang) * t.r * 0.55,
					fy = t.y + Math.sin(ang) * t.r * 0.55 + (a.grows.length === 3 && i !== 1 ? 6 : 0);
				ctx.fillStyle = a.alive ? GOOD_COLOUR[g] : '#8a8a86';
				ctx.beginPath();
				ctx.arc(fx, fy, 16, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = '#fff';
				ctx.font = '700 13px system-ui, sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(String(a.harvest[g] ?? a.produce[g]), fx, fy + 0.5);
				ctx.textBaseline = 'alphabetic';
				ctx.fillStyle = ink;
				ctx.font = '600 9px system-ui, sans-serif';
				ctx.fillText(GOOD_LABEL[g], fx, fy + 26);
			});
			// its store: a half-size dot per good, how many units it holds written in each
			GOODS.forEach((g, i) => {
				const sx = t.x + (i - 2) * 22,
					sy = t.y + 34;
				const n = a.stock[g];
				ctx.globalAlpha = n > 0 ? 1 : 0.35;
				ctx.fillStyle = a.alive ? GOOD_COLOUR[g] : '#8a8a86';
				ctx.beginPath();
				ctx.arc(sx, sy, 9, 0, Math.PI * 2);
				ctx.fill();
				ctx.globalAlpha = 1;
				ctx.fillStyle = '#fff';
				ctx.font = '700 10px system-ui, sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(String(n), sx, sy + 0.5);
				ctx.textBaseline = 'alphabetic';
			});
			ctx.fillStyle = ink;
			ctx.globalAlpha = 0.7;
			ctx.font = '600 9px system-ui, sans-serif';
			ctx.fillText('STORE', t.x, t.y + 56);
			ctx.globalAlpha = 1;
			ctx.fillStyle = light > 0.5 ? '#1f2a23aa' : '#f4f1e8aa';
			ctx.font = '600 13px system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(a.alive ? `${a.name} · ${fmt(a.hearts)} ♥` : `${a.name} †`, t.x, t.y + t.r + 18);
		}

		// trades just made: a ring on the seller's land, in the good's colour
		for (const e of world.events) {
			const age = (world.t - e.t) / 1800;
			ctx.strokeStyle = `${GOOD_COLOUR[e.good]}${Math.round((1 - age) * 255)
				.toString(16)
				.padStart(2, '0')}`;
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc(e.x, e.y, 14 + age * 40, 0, Math.PI * 2);
			ctx.stroke();
		}

		// the avens: wobbling blobs, a health arc, a name
		for (const a of world.avens) {
			const r = 15;
			const wob = now / 260 + a.id * 1.7;
			ctx.save();
			ctx.translate(a.x, a.y);
			if (!a.alive) ctx.scale(1.3, 0.55);
			ctx.beginPath();
			for (let i = 0; i <= 24; i++) {
				const ang = (i / 24) * Math.PI * 2;
				const rr = r * (1 + (a.alive ? 0.08 : 0.02) * Math.sin(ang * 3 + wob) + (a.alive ? 0.05 : 0) * Math.cos(ang * 2 - wob * 1.3));
				const px = Math.cos(ang) * rr,
					py = Math.sin(ang) * rr;
				if (i) ctx.lineTo(px, py);
				else ctx.moveTo(px, py);
			}
			ctx.fillStyle = a.alive ? a.colour : '#8a8a86';
			ctx.shadowColor = 'rgb(0 0 0 / 0.25)';
			ctx.shadowBlur = 8;
			ctx.shadowOffsetY = 3;
			ctx.fill();
			ctx.shadowColor = 'transparent';
			if (a.alive) {
				ctx.fillStyle = '#fff';
				ctx.beginPath();
				ctx.arc(-5, -3, 3.4, 0, Math.PI * 2);
				ctx.arc(5, -3, 3.4, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = '#1f2a23';
				ctx.beginPath();
				ctx.arc(-4.4, -2.6, 1.6, 0, Math.PI * 2);
				ctx.arc(5.6, -2.6, 1.6, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.restore();
			if (a.alive) {
				ctx.strokeStyle = a.health > 60 ? '#4fb37a' : a.health > 30 ? '#f0a03c' : '#e05a6d';
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.arc(a.x, a.y, r + 6, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * a.health) / 100);
				ctx.stroke();
			}
			if (a.id === selected) {
				ctx.strokeStyle = light > 0.5 ? '#1f2a23' : '#f4f1e8';
				ctx.lineWidth = 1.5;
				ctx.setLineDash([3, 4]);
				ctx.beginPath();
				ctx.arc(a.x, a.y, r + 12, 0, Math.PI * 2);
				ctx.stroke();
				ctx.setLineDash([]);
			}
			ctx.fillStyle = light > 0.5 ? '#1f2a23' : '#f4f1e8';
			ctx.font = '700 12px system-ui, sans-serif';
			ctx.textAlign = 'center';
			// away from home, fetching what it bought: its name goes with it
			const away = Math.hypot(a.x - a.territory.x, a.y - a.territory.y) > 30;
			if (away) ctx.fillText(a.name, a.x, a.y - r - 12);
			// what it bought on the way: a small dot per good, until it is home
			const carried = a.alive ? GOODS.filter((g) => a.carry[g] > 0) : [];
			carried.forEach((g, i) => {
				ctx.fillStyle = GOOD_COLOUR[g];
				ctx.strokeStyle = '#fff';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.arc(a.x + (i - (carried.length - 1) / 2) * 10, a.y + r + 13, 4, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			});
			if (a.brain.pending) {
				ctx.fillStyle = light > 0.5 ? '#1f2a23' : '#f4f1e8';
				ctx.font = '11px system-ui, sans-serif';
				ctx.fillText('thinking…', a.x + r + 34, a.y + 4);
			}
		}
	}

	function onPointer(/** @type {PointerEvent} */ e) {
		const r = canvas.getBoundingClientRect();
		const dpr = canvas.width / r.width;
		const x = ((e.clientX - r.left) * dpr - view.ox) / view.s;
		const y = ((e.clientY - r.top) * dpr - view.oy) / view.s;
		let best = null;
		for (const a of world.avens) {
			const d = Math.hypot(a.x - x, a.y - y);
			if (d < 40 && (!best || d < best.d)) best = { d, id: a.id };
		}
		if (!best)
			for (const a of world.avens) if (Math.hypot(a.territory.x - x, a.territory.y - y) < a.territory.r) best = { d: 0, id: a.id };
		if (best) select(best.id);
	}

	onMount(() => {
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(stageEl);
		unlock();
		let last = performance.now();
		let lastSnap = 0;
		let lastSave = 0;
		let raf = 0;
		const frame = (/** @type {number} */ now) => {
			const dtReal = Math.min(250, now - last);
			last = now;
			if (!paused) {
				think(now);
				if (decided() && !codeWait) {
					let game = (dtReal / 1000) * speed;
					while (game > 0) {
						const d = Math.min(120, game);
						game -= d;
						step(world, d);
					}
				}
			}
			draw(now);
			if (rec && now - lastSave > 3000) {
				lastSave = now;
				save(world.avens.every((/** @type {any} */ a) => !a.alive));
			}
			if (now - lastSnap > 250) {
				lastSnap = now;
				snap = snapshot();
			}
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			save();
		};
	});

	const lineOf = (/** @type {any} */ e) => {
		const talk = e.haggled ? ` (haggled: asked ${e.haggled.ask}, offered ${e.haggled.bid})` : '';
		if (e.kind === 'buy') return `bought ${e.qty} ${GOOD_LABEL[e.good]} from ${e.with} at ${e.price}${talk}`;
		if (e.kind === 'sell') return `sold ${e.qty} ${GOOD_LABEL[e.good]} to ${e.with} at ${e.price}${talk}`;
		if (e.kind === 'nodeal') return `no deal on ${GOOD_LABEL[e.good]} with ${e.with}: asked ${e.ask}, offered ${e.bid}`;
		if (e.kind === 'eat') {
			const s = Object.entries(e.short ?? {});
			return s.length ? `went short of ${s.map(([g, n]) => `${n} ${GOOD_LABEL[g]}`).join(', ')} · health ${e.health}` : `ate and drank in full · health ${e.health}`;
		}
		if (e.kind === 'price') return `${NAME[e.source] ?? 'Liquid'}: ${e.changes.length ? e.changes.join('; ') : 'kept every price'}`;
		if (e.kind === 'death') return 'died';
		if (e.kind === 'rot') return `rotted: ${Object.entries(e.rotted).map(([g, n]) => `${n} ${GOOD_LABEL[g]}`).join(', ')}`;
		if (e.kind === 'rain') return `rain: the barrel caught ${e.qty} WATER`;
		if (e.kind === 'grow') return `${e.note === 'dry' ? 'dry spell, the well gave' : e.note === 'bad' ? 'bad harvest:' : 'rich harvest:'} ${e.qty} ${GOOD_LABEL[e.good]} (usually ${e.cap})`;
		return e.kind;
	};
</script>

<div class="market" class:open={panelOpen} class:statsview={page !== 'valley'}>
	<header>
		<div class="title">
			<b>Sandbox 7 · Avens trading</b>
			<span>Day {snap.day} · {snap.time} · month {snap.month}</span>
		</div>
		<nav class="views" aria-label="View">
			<button class:on={page === 'valley'} onclick={() => setView('valley')}>Valley</button>
			<button class:on={page === 'stats'} onclick={() => setView('stats')}>Stats</button>
			<button class:on={page === 'policy'} onclick={() => setView('policy')}>Policies</button>
			<button class:on={page === 'world'} onclick={() => setView('world')}>World</button>
			<button class:on={page === 'mips'} onclick={() => setView('mips')}>Proposals</button>
		</nav>
		<div class="controls">
			<button onclick={toggle}>{paused ? (started ? '▶ Play' : '▶ Start') : '❚❚ Pause'}</button>
			<select bind:value={speed} aria-label="Speed">
				{#each SPEEDS as sp (sp.k)}<option value={sp.k}>{sp.label}</option>{/each}
			</select>
			<button onclick={reset}>Reset</button>
			<button class="panel-btn" hidden={page === 'stats'} onclick={() => (panelOpen = !panelOpen)}>{panelOpen ? 'Hide books' : 'Books'}</button>
		</div>
	</header>

	<div class="stage" bind:this={stageEl}>
		<canvas bind:this={canvas} onpointerdown={onPointer}></canvas>
		{#if down}
			{@const [first, then] = PLAN[brain.mode]}
			<p class="liquid-note down">Paused: {NAME[first]} isn't answering ({down}){#if then && calls.errors[then]}, nor is {NAME[then]} ({calls.errors[then]}){/if}. The avens never play without a brain. Press Play to ask again.</p>
		{:else if !paused && (snap.waiting || snap.stale || busy)}
			<p class="liquid-note">{busy ? `${busy} ` : ''}{snap.waiting ? `Waiting for Liquid: ${snap.waiting} aven${snap.waiting === 1 ? '' : 's'} still deciding ${snap.waiting === 1 ? 'its' : 'their'} first prices.` : snap.stale ? `The clock waits for Liquid: ${snap.stale} aven${snap.stale === 1 ? '' : 's'} need a fresh decision.` : ''}</p>
		{/if}
		<div class="ticker" aria-label="Prices">
			{#each GOODS as g (g)}
				<span><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]} <b>{snap.market[g].price ?? '—'}</b> <small>avg {snap.market[g].avg ?? '—'}</small></span>
			{/each}
		</div>
	</div>

	{#if page === 'stats'}
		<div class="statspage">
			<StatsView stats={snap.stats} series={snap.series} now={snap.t} avens={[...snap.board].sort((a, b) => a.id - b.id)} />
		</div>
	{/if}
	{#if page === 'policy' || page === 'world'}
		<div class="statspage">
			{#key page}<RulesView view={page} onchange={saveRules} onrestart={() => { reset(); setView('valley'); }} onpropose={() => { draft = true; setView('mips'); }} />{/key}
		</div>
	{/if}
	{#if page === 'mips'}
		<div class="statspage">
			<ProposalsView {acct} {configs} playing={snap.config} {draft} sample={() => hookSample(world)} onplay={play} onreload={() => reloadConfigs().catch(() => {})} />
		</div>
	{/if}

	<aside>
		<section>
			<h3>Board</h3>
			<ol class="board">
				{#each snap.board as row (row.id)}
					<li class:sel={row.id === selected} class:dead={!row.alive}>
						<button onclick={() => select(row.id)}>
							<i style:background={row.colour}></i>
							<b>{row.name}</b>
							<span class="grows">{#each row.grows as g (g)}<em style:background={GOOD_COLOUR[g]} title={GOOD_LABEL[g]}></em>{/each}</span>
							<span class="num">{row.alive ? `${fmt(row.hearts)} ♥` : `died day ${row.diedOn}`}</span>
							<span class="delta" class:up={row.hearts >= snap.policy.start}>{row.alive ? `${row.hearts >= snap.policy.start ? '+' : ''}${fmt(row.hearts - snap.policy.start)}` : ''}</span>
						</button>
					</li>
				{/each}
			</ol>
			<p class="brain" class:dry={snap.weather.dry}>Water: {snap.weather.dry ? `dry spell, ${snap.weather.dry} more night${snap.weather.dry === 1 ? '' : 's'}: wells give 40 to 70%, no rain` : snap.weather.rain ? `rain last night, every barrel caught ${snap.weather.rain}` : 'no rain last night'}. Wells vary; one night in 3 it rains into every land's barrel.</p>
			<p class="brain">HEARTS: every aven mints {snap.policy.mint} a day; every HEART decays {snap.policy.decay}% a year{#if snap.code?.hooks.some((/** @type {any} */ h) => h.hooks.includes('mint') || h.hooks.includes('decay'))}, as a card's code changes them{/if}. <button class="link" onclick={() => setView('policy')}>Policies</button></p>
			<p class="brain">
				Config: {snap.config.name}{snap.config.id ? ` v${snap.config.version}` : ''}{snap.config.local ? ` + ${snap.config.local} change${snap.config.local === 1 ? '' : 's'} of yours` : ''} · {#if !acct.play}not saved{:else if !started}saved once you press Start{:else if saving.error}<span class="warn">not saved: {saving.error}</span>{:else}saved, {saving.days} day{saving.days === 1 ? '' : 's'} so far{/if} <button class="link" onclick={() => setView('mips')}>Proposals</button>
			</p>
			<p class="brain">
				{#if snap.code?.hooks.length || snap.code?.errors.length || codeNote}
					Card code (QuickJS):
					{#each snap.code?.hooks ?? [] as h, i (h.card)}{i ? '; ' : ''}{h.name} runs {h.hooks.join(', ')}{h.calls ? ` (${h.ms} ms a call)` : ''}{/each}{#each snap.code?.errors ?? [] as e (e.card)}{' · '}<span class="warn">{e.name} stopped: {e.error}; the valley uses the values instead.</span>{/each}{#if codeNote}{' · '}<span class="warn">{codeNote}</span>{/if}
					<br />
				{/if}
				Brains: <select class="brain-mode" bind:value={brain.mode} onchange={saveBrain} aria-label="Brains">{#each Object.entries(BRAINS) as [k, label] (k)}<option value={k}>{label}</option>{/each}</select>
				· {calls.answered} of {calls.asked} answered{#if calls.pending > 1}&nbsp;({calls.pending} waiting){/if}{#if Object.values(calls.by).filter(Boolean).length > 1}&nbsp;({Object.entries(calls.by).filter(([, n]) => n).map(([k, n]) => `${NAME[k]} ${n}`).join(', ')}){/if}{#if calls.limited}&nbsp;· {calls.limited} met Liquid's rate limit{/if}{#if calls.failed}&nbsp;· {calls.failed} unanswered ({calls.lastError}){/if}
				{#if brain.mode !== 'liquid'}<br />GPU machine <input class="brain-url" bind:value={brain.url} onchange={() => (saveBrain(), findBox().catch((e) => (calls.errors.d1 = errorOf(e))))} spellcheck="false" aria-label="The GPU machine's address" /> · d1: {box.d1 || 'not served'} · Qwen: {box.qwen || 'not served'}{#each ['d1', 'qwen'] as k (k)}{#if calls.errors[k]}{' · '}<span class="warn">{NAME[k]} not answering: {calls.errors[k]}</span>{/if}{/each}{/if}
			</p>
		</section>

		<nav class="tabs">
			<button class:on={tab === 'market'} onclick={() => (tab = 'market')}>Market</button>
			<button class:on={tab === 'wants'} onclick={() => (tab = 'wants')}>Wants</button>
			<button class:on={tab === 'prices'} onclick={() => (tab = 'prices')}>Prices</button>
			<button class:on={tab === 'ledger'} onclick={() => (tab = 'ledger')}>{snap.aven.name}'s ledger</button>
		</nav>

		{#if tab === 'wants'}
		<section>
			<p class="sub">Tonight each aven needs 3 WATER and 2 of each food. <span class="ok">✓</span> it holds enough; <span class="miss">−n</span> it is n short unless it buys before night. "own": it grows that good. "buys n": it still wants n to reach its stock target. Last column: whether last night's needs were met.</p>
			<div class="scroll"><table class="wants">
				<thead><tr><th>Aven</th>{#each GOODS as g (g)}<th><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g].slice(0, 3)}</th>{/each}<th>Tonight</th><th>Last night</th></tr></thead>
				<tbody>
					{#each snap.wants as w (w.id)}
						{@const missing = GOODS.filter((g) => w.goods[g].has < w.goods[g].need)}
						<tr class:dead={!w.alive}>
							<td><button class="who" onclick={() => select(w.id)}><i style:background={w.colour}></i>{w.name}</button></td>
							{#if w.alive}
								{#each GOODS as g (g)}
									{@const c = w.goods[g]}
									<td class="num" class:grown={w.grows.includes(g)} title={w.grows.includes(g) ? `grows ${GOOD_LABEL[g]}` : ''}>
										{#if c.has >= c.need}<span class="ok">✓</span>{:else}<span class="miss">−{c.need - c.has}</span>{/if}
										<small>{w.grows.includes(g) ? 'own' : c.buy ? `buys ${c.buy}` : ''}</small>
									</td>
								{/each}
								<td class="num">{#if missing.length}<span class="miss">{missing.length} short</span>{:else}<span class="ok">all met</span>{/if}</td>
								<td class="num">{#if Object.keys(w.last).length}<span class="miss">{Object.entries(w.last).map(([g, n]) => `${GOOD_LABEL[g].slice(0, 3)} −${n}`).join(' ')}</span>{:else}<span class="ok">met</span>{/if}</td>
							{:else}
								<td colspan={GOODS.length + 2} class="none">died</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table></div>
		</section>
		{:else if tab === 'prices'}
		<section>
			<PriceChart series={snap.series} now={snap.t} />
			<table class="avgs">
				<thead><tr><th>Good</th><th>Market</th><th>Avg traded, 24 h</th><th>Units, 24 h</th></tr></thead>
				<tbody>
					{#each GOODS as g (g)}<tr><td><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]}</td><td class="num">{snap.market[g].price ?? '—'}</td><td class="num">{snap.market[g].avg ?? '—'}</td><td class="num">{snap.market[g].units}</td></tr>{/each}
				</tbody>
			</table>
		</section>
		{:else if tab === 'market'}
		<section class="market-board">
			<p class="sub">Live: who sells and who wants what, right now. No price is set: each aven names its own, and the market price is the average actually traded over the last day (none before the first trade).</p>
			{#each GOODS as g (g)}
				{@const m = snap.market[g]}
				{@const change = m.open && m.price != null ? Math.round(((m.price - m.open) / m.open) * 100) : 0}
				{@const lo = Math.min(...m.history)}
				{@const hi = Math.max(...m.history)}
				<div class="good">
					<div class="good-head">
						<span><em style:background={GOOD_COLOUR[g]}></em><b>{GOOD_LABEL[g]}</b></span>
						<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
							<polyline fill="none" stroke={GOOD_COLOUR[g]} stroke-width="2" points={m.history.map((/** @type {number} */ p, /** @type {number} */ i) => `${(i / Math.max(1, m.history.length - 1)) * 100},${22 - ((p - lo) / Math.max(1, hi - lo)) * 20}`).join(' ')} />
						</svg>
						<span class="num" title="market price"><b>{m.price ?? '—'}</b> ♥ <small class:up={change > 0} class:down={change < 0}>{change > 0 ? '+' : ''}{change}%</small></span>
					</div>
					<div class="avg">Average traded, last 24 h: <b>{m.avg ?? '—'}</b>{m.avg != null ? ` ♥ over ${m.units} units` : ' (no trades)'}{ROT[g] ? ` · rots ${Math.round(ROT[g] * 100)}% a night, ${m.rotted} rotted so far` : ' · keeps'}</div>
					<div class="sd">
						<span>offered {m.supply}</span>
						<i><b style:width="{(m.supply / Math.max(1, m.supply + m.demand)) * 100}%"></b></i>
						<span>wanted {m.demand}</span>
					</div>
					<div class="orders">
						<ul>
							<li class="cap">Sells</li>
							{#each m.sells as o (o.id)}<li>{o.name} <span class="num">{o.qty} at {o.price}</span></li>{:else}<li class="none">nobody</li>{/each}
						</ul>
						<ul>
							<li class="cap">Wants</li>
							{#each m.wants as o (o.id)}<li>{o.name} <span class="num">{o.qty} up to {o.price}</span></li>{:else}<li class="none">nobody</li>{/each}
						</ul>
					</div>
				</div>
			{/each}
		</section>
		{:else}
		<section class="ledger">
			<h3><i style:background={snap.aven.colour}></i>{snap.aven.name}'s ledger</h3>
			<p class="sub">
				{snap.aven.alive ? `${fmt(snap.aven.hearts)} HEARTS · water ${Math.round(snap.aven.body.water)} · food ${Math.round(snap.aven.body.food)}` : `died on day ${snap.aven.diedOn}`} · keeps {snap.aven.reserveDays} days in stock<br />minted +{fmt(snap.aven.minted)} · decayed −{fmt(snap.aven.decayed)} so far
			</p>
			<div class="scroll"><table>
				<thead><tr><th>Good</th><th title="needed a day">Need</th><th title="grows a day on average, and last night's harvest">Grows</th><th title="share that rots each night">Rots</th><th>Stock</th><th title="market price">Mkt</th><th title="sells at, and against the market price">Sells</th><th title="pays up to, and against the market price">Pays</th></tr></thead>
				<tbody>
					{#each GOODS as g (g)}
						<tr>
							<td><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]}</td>
							<td class="num">{NEED[g]}</td>
							<td class="num">{#if snap.aven.produce[g] != null}{snap.aven.produce[g]}<small>last {snap.aven.harvest[g]}</small>{/if}</td>
							<td class="num">{ROT[g] ? `${Math.round(ROT[g] * 100)}%` : '—'}</td>
							<td class="num">{snap.aven.stock[g]}</td>
							<td class="num">{snap.market[g].price ?? '—'}</td>
							<td class="num">{#if snap.aven.ask[g] != null}{snap.aven.ask[g]}<small>{pctOf(snap.aven.ask[g], snap.market[g].price)}</small>{/if}</td>
							<td class="num">{#if snap.aven.bid[g] != null}{snap.aven.bid[g]}<small>{pctOf(snap.aven.bid[g], snap.market[g].price)}</small>{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table></div>
			<h4>Its tools</h4>
			<ul class="tools">
				{#each TOOLS as tool (tool.id)}<li><b>{tool.label}</b> · {tool.note}</li>{/each}
			</ul>
			<ul class="entries">
				{#each snap.aven.ledger as e, i (i)}
					<li class={e.kind}>
						<span class="when">d{e.day} {clock(e.t)}</span>
						<span class="what">{lineOf(e)}</span>
						{#if e.hearts}<span class="num" class:up={e.hearts > 0}>{e.hearts > 0 ? '+' : ''}{fmt(e.hearts)}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>
		{/if}
	</aside>
	{#if !access.ok}
		<div class="locked">
			<div>
				<h2>{access.checking ? 'Looking for the tailnet…' : 'Sandbox 7 is locked here'}</h2>
				{#if access.checking}
					<p>The valley plays only on a device in Samuel's tailnet: checking that this one reaches its GPU machine.</p>
				{:else if !BOX_HERE}
					<p>The valley plays only in the maiaCITY studio, on a device in Samuel's tailnet.</p>
				{:else}
					<p>The valley plays only on a device in Samuel's tailnet, and this one can't reach its GPU machine ({access.why}). Start Tailscale, then try again.</p>
					<p><input class="brain-url" bind:value={brain.url} spellcheck="false" aria-label="The GPU machine's address" /> <button onclick={() => (saveBrain(), unlock())}>Try again</button></p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.market {
		position: fixed;
		inset: 0;
		display: grid;
		grid-template-columns: 1fr 380px;
		grid-template-rows: auto 1fr;
		background: #20302a;
		color: #1f2a23;
		font: 13px/1.35 system-ui, sans-serif;
	}
	.market:not(.open) {
		grid-template-columns: 1fr 0;
	}
	.market:not(.open) aside {
		display: none;
	}
	/* the Stats view takes the whole page under the header; the valley keeps running behind it */
	.market.statsview {
		grid-template-columns: 1fr;
		grid-template-rows: auto 1fr;
	}
	.market.statsview .stage,
	.market.statsview aside {
		display: none;
	}
	.statspage {
		min-height: 0;
		overflow: hidden;
	}
	.views {
		display: flex;
		background: #1f2a2314;
		border-radius: 10px;
		padding: 2px;
	}
	.views button {
		border: 0;
		background: transparent;
		border-radius: 8px;
		padding: 0.25rem 0.8rem;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		text-decoration: underline;
		font-size: inherit;
		color: inherit;
	}
	.warn {
		color: #a03224;
	}
	.views button.on {
		background: #24452f;
		color: #f4f1e8;
	}
	header {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.9rem;
		background: #f4f1e8;
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.2);
		z-index: 1;
	}
	.title {
		display: flex;
		flex-direction: column;
		margin-right: auto;
	}
	.title span {
		opacity: 0.7;
		font-variant-numeric: tabular-nums;
	}
	.controls {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
	}
	button,
	select {
		font: inherit;
		border: 1px solid #1f2a2333;
		background: #fff;
		border-radius: 8px;
		padding: 0.3rem 0.6rem;
		cursor: pointer;
	}
	.toggle {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		white-space: nowrap;
	}
	.stage {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}
	canvas {
		display: block;
		touch-action: manipulation;
	}
	aside {
		background: #f4f1e8;
		overflow-y: auto;
		padding: 0.6rem 0.9rem var(--nav-room, 5rem);
		min-height: 0;
	}
	h3 {
		margin: 0.4rem 0;
		font-size: 0.95rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	h3 i,
	.board i {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		display: inline-block;
		flex: none;
	}
	em {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 2px;
		margin-right: 0.25rem;
		vertical-align: baseline;
	}
	.board {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.board button {
		width: 100%;
		display: grid;
		grid-template-columns: 14px 3.2rem auto 1fr 4.6rem;
		gap: 0.4rem;
		align-items: center;
		text-align: left;
		border: none;
		background: transparent;
		padding: 0.3rem 0.35rem;
		border-radius: 8px;
	}
	.board li.sel button {
		background: #fff;
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.1);
	}
	.board li.dead {
		opacity: 0.55;
	}
	.grows em {
		margin: 0 1px;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.delta {
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: #b8483b;
		font-size: 0.75rem;
	}
	.delta.up,
	.entries .up {
		color: #2f7d4f;
	}
	.brain,
	.prices,
	.sub {
		margin: 0.5rem 0 0;
		font-size: 0.75rem;
		opacity: 0.8;
	}
	.brain.dry {
		color: #b5541c;
		opacity: 1;
		font-weight: 600;
	}
	.prices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.7rem;
	}
	.ledger {
		padding-top: 0.2rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 0.5rem;
		font-size: 0.75rem;
	}
	th {
		text-align: right;
		font-weight: 600;
		opacity: 0.7;
		padding: 0.15rem 0.2rem;
	}
	th:first-child {
		text-align: left;
	}
	.scroll {
		overflow-x: auto;
	}
	.ok {
		color: #2f7d4f;
		font-weight: 700;
	}
	.miss {
		color: #c2410c;
		font-weight: 700;
	}
	.wants td.grown {
		background: #24452f0d;
	}
	.wants tr.dead {
		opacity: 0.5;
	}
	.wants .who {
		border: 0;
		background: none;
		padding: 0;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.wants .who i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
	}
	td small {
		display: block;
		font-size: 0.62rem;
		opacity: 0.6;
	}
	td {
		white-space: nowrap;
		padding: 0.15rem 0.15rem;
		border-top: 1px solid #1f2a2312;
	}
	.ticker {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		right: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.8rem;
		justify-content: center;
		pointer-events: none;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.ticker span {
		background: rgb(250 248 242 / 0.85);
		border-radius: 999px;
		padding: 0.12rem 0.5rem;
	}
	.ticker small {
		opacity: 0.65;
	}
	.avg {
		font-size: 0.72rem;
		margin-top: 0.2rem;
	}
	.tabs {
		display: flex;
		gap: 0.3rem;
		margin: 0.9rem 0 0.4rem;
		border-top: 1px solid #1f2a231a;
		padding-top: 0.6rem;
	}
	.tabs button {
		flex: 1;
	}
	.tabs button.on {
		background: #24452f;
		color: #f4f1e8;
	}
	.good {
		background: #fff;
		border-radius: 10px;
		padding: 0.45rem 0.6rem;
		margin-top: 0.45rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
	}
	.good-head {
		display: grid;
		grid-template-columns: 7.2rem 1fr 6.5rem;
		gap: 0.5rem;
		align-items: center;
	}
	.spark {
		width: 100%;
		height: 22px;
	}
	.good-head small {
		font-size: 0.7rem;
		opacity: 0.8;
	}
	.good-head small.up {
		color: #2f7d4f;
	}
	.brain-mode,
	.brain-url {
		font: inherit;
		font-size: 0.72rem;
		border: 1px solid #1f2a2333;
		border-radius: 6px;
		padding: 0.05rem 0.25rem;
		background: #fff;
		color: inherit;
	}
	.brain-url {
		width: 14rem;
		max-width: 60%;
	}
	.locked {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: 1.5rem 1rem 7rem;
		background: #20302a;
		color: #e8efe9;
		text-align: center;
	}
	.locked > div {
		max-width: 30rem;
	}
	.locked h2 {
		margin: 0 0 0.6rem;
		font-size: 1.2rem;
	}
	.locked p {
		margin: 0.4rem 0;
		color: #c9d6cd;
		line-height: 1.45;
	}
	.locked .brain-url {
		color: #1f2a23;
		font-size: 0.85rem;
		width: 16rem;
	}
	.locked button {
		font: inherit;
		border: 0;
		border-radius: 999px;
		padding: 0.3rem 0.9rem;
		background: #e8efe9;
		color: #1f2a23;
		cursor: pointer;
	}
	.liquid-note {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		top: 52px;
		z-index: 2;
		max-width: calc(100% - 32px);
		margin: 0;
		padding: 8px 12px;
		border-radius: 8px;
		background: rgba(20, 24, 32, 0.85);
		color: #fff;
		font-size: 13px;
		text-align: center;
	}
	.liquid-note.down {
		background: rgba(150, 30, 30, 0.9);
	}
	.good-head small.down {
		color: #b8483b;
	}
	.sd {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.7rem;
		opacity: 0.85;
		margin-top: 0.25rem;
	}
	.sd i {
		height: 6px;
		border-radius: 3px;
		background: #e05a6d55;
		overflow: hidden;
	}
	.sd i b {
		display: block;
		height: 100%;
		background: #4fb37a;
	}
	.orders {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
		margin-top: 0.3rem;
	}
	.orders ul {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.72rem;
	}
	.orders li {
		display: flex;
		justify-content: space-between;
		gap: 0.3rem;
	}
	.orders .cap {
		font-weight: 600;
		opacity: 0.6;
	}
	.orders .none {
		opacity: 0.45;
	}
	.entries .nodeal .what {
		opacity: 0.6;
		font-style: italic;
	}
	h4 {
		margin: 0.8rem 0 0.2rem;
		font-size: 0.8rem;
	}
	.tools {
		margin: 0;
		padding-left: 1rem;
		font-size: 0.75rem;
	}
	.entries {
		list-style: none;
		padding: 0;
		margin: 0.7rem 0 0;
		font-size: 0.75rem;
	}
	.entries li {
		display: grid;
		grid-template-columns: 4.6rem 1fr auto;
		gap: 0.4rem;
		padding: 0.18rem 0;
		border-top: 1px solid #1f2a230d;
	}
	.entries .when {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
	}
	.entries .price .what {
		color: #4a5ea8;
	}
	.entries .rot .what {
		color: #8a6d3b;
	}
	.entries .grow .what {
		color: #4a5ea8;
	}
	.entries .eat .what {
		opacity: 0.7;
	}
	.entries .death .what {
		color: #b8483b;
		font-weight: 700;
	}
	.entries .num {
		color: #b8483b;
	}
	.entries .num.up {
		color: #2f7d4f;
	}

	/* phones upright: the valley on top, the books in a sheet of at most half the screen */
	@media (max-width: 760px) {
		.market,
		.market:not(.open) {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr auto;
		}
		aside {
			max-height: 50vh;
			max-height: 50dvh;
			border-radius: 14px 14px 0 0;
			box-shadow: 0 -4px 14px rgb(0 0 0 / 0.2);
		}
		header {
			gap: 0.4rem;
			padding: 0.4rem 0.6rem;
		}
		.title b {
			font-size: 0.85rem;
		}
		.controls button,
		.controls select {
			padding: 0.2rem 0.45rem;
			font-size: 0.75rem;
		}
		.toggle {
			font-size: 0.75rem;
		}
	}
	/* phones on their side: the books slide in from the right */
	@media (max-height: 500px) and (min-width: 600px) {
		.market {
			grid-template-columns: 1fr 320px;
		}
		header {
			padding: 0.3rem 0.6rem;
		}
	}
</style>
