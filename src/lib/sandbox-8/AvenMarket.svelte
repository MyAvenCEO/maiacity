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
	import { createWorld, saveWorld, loadWorld, step, ranking, want, ROT, GOODS, GOOD_LABEL, GOOD_COLOUR, NEED, WORLD, DAY_S, CODE, hookSample } from './economy.js';
	import { loadCode } from './sandbox.js';
	import { RULES, CONFIG, DEFAULTS, changedRules, useConfig } from './rules.js';
	import RulesView from './RulesView.svelte';
	import ProposalsView from './ProposalsView.svelte';
	import { loadConfigs, loadRuns, loadWorldRun, saveWorldState, recorder, loadMinds, saveMinds, forgetMinds } from './store.js';
	import { wholeMind, beginRun, wear, night, editMind, keepMind, DIALS, WANTS, TRIAL_DAYS } from './mind.js';
	import { me, may } from '$lib/auth/client';
	import { native } from '$lib/native';
	// browsers can't call Liquid (no CORS), so every build, the local Mac one too, asks through api.maia.city, which holds the key
	const LIQUID = { relay: import.meta.env.VITE_LIQUID_RELAY || 'https://api.maia.city/api/liquid/decide' };
	import PriceChart from './PriceChart.svelte';
	import StatsView from './StatsView.svelte';
	import { stateFor, questionsFor, askLiquid, askBox, boxModels, boxModel, applyAnswers, LIQUID_MODEL, TOOLS, BOX_URL, BOX_HERE } from './brain.js';

	// every setting belongs to a world (Samuel, 2026-10-09): changing one changes this world's, kept with it when it saves
	function saveRules() {
		dirty = true;
		snap = snapshot();
	}

	// ---- the database: who is playing, the config the valley runs on, and this run, saved day by day ----
	const PICKED = 'sandbox-8-config';
	let acct = $state({ id: /** @type {string | null} */ (null), play: false, admin: false, note: '' });
	let configs = $state(/** @type {any[]} */ ([]));
	let newCfg = $state('valley'); // the config a new world starts on
	/** @type {any} */
	let rec = null;
	let saving = $state({ days: 0, error: '' });

	async function connect() {
		try {
			const f = await me();
			acct = { id: f.id, play: may(f, 'economy:play'), admin: may(f, 'economy:admin'), note: '' };
			if (!acct.play) {
				loadAllMinds();
				acct.note = native() ? "This studio's key can't play the economy yet: sign it out once (You, at the bottom, then Sign out) and in again with your passkey. Until then the valley runs on the catalogue's defaults and nothing is saved." : 'Your role cannot play the economy sandbox yet, so the valley runs on the defaults and nothing is saved.';
				return;
			}
			await reloadConfigs(true);
		} catch (e) {
			acct.note = `Not connected (${/** @type {any} */ (e)?.message || 'the API cannot be reached'}): sign in on maia.city to save runs and see the proposals. The valley runs on the catalogue's defaults.`;
			loadAllMinds();
		}
	}

	// ---- each aven's brain, kept across runs (mind.js; "brain" to Samuel, mind in the code, where brain.js is the model): who it is, what it wants, what it tried, learned, died of ----
	/** @type {Record<string, any>} */
	let minds = {}; // by aven name, for the config being played
	let mindsOf = ''; // which config they are
	let mindNote = $state('');
	const mindsRemote = () => acct.play;
	const mindsKey = () => 'global'; // an aven's brain is global (Samuel): one across every world and config
	/** take in the edits made from outside (the studio's MCP): the newest last; each says so in the decisions feed */
	function takeEdits(/** @type {any} */ m, /** @type {any[]} */ pending) {
		for (const e of (pending ?? []).filter((x) => x.id > (m.applied ?? 0)).sort((x, y) => x.id - y.id)) {
			const said = editMind(m, e);
			m.applied = e.id;
			const a = world.avens.find((/** @type {any} */ x) => x.name === m.name);
			if (a && said.length) {
				const all = (world.decisions ??= []);
				all.push({ n: (all.at(-1)?.n ?? 0) + 1, day: world.day, t: world.t, id: a.id, name: a.name, colour: a.colour, source: 'edit', changes: [`set by ${e.by ?? 'the admin'}: ${said.join(', ')}`] });
			}
		}
	}
	/** read every aven's mind for this config (a new one for an aven never played), and dress this valley's avens in them */
	async function loadAllMinds() {
		const cfg = mindsKey();
		/** @type {Record<string, any>} */
		let raw = {};
		try {
			raw = await loadMinds(cfg, mindsRemote());
			mindNote = '';
		} catch (e) {
			mindNote = `The avens' brains could not be read (${/** @type {any} */ (e)?.message || e}): they start fresh and are not kept.`;
		}
		if (cfg !== mindsKey()) return;
		mindsOf = cfg;
		minds = {};
		for (const a of world.avens) {
			const m = wholeMind(raw[a.name], a.name, RULES.reserveDays);
			takeEdits(m, raw[a.name]?.pending);
			minds[a.name] = m;
		}
		if (!started && world.day === 1 && world.t === 0 && Object.keys(carried()).length) {
			// the brains came after the world was dealt: deal it again with the HEARTS they bring
			world = createWorld(world.seed, { hearts: carried() });
			if (rec) rec = recorder(world, null, { id: rec.id, name: rec.name, sent: 0 });
		}
		if (!started) for (const a of world.avens) wear(a, minds[a.name]);
		snap = snapshot();
	}
	let syncing = false;
	/** each night: take in edits from outside, then write every mind */
	async function syncMinds(final = false) {
		if (syncing || mindsOf !== mindsKey() || !Object.keys(minds).length) return;
		syncing = true;
		const cfg = mindsOf;
		try {
			if (mindsRemote() && !final) {
				const raw = await loadMinds(cfg, true);
				for (const m of Object.values(minds)) takeEdits(m, raw[m.name]?.pending);
			}
			await saveMinds(cfg, Object.fromEntries(Object.values(minds).map((m) => [m.name, keepMind(m)])), mindsRemote());
			mindNote = '';
		} catch (e) {
			mindNote = `The avens' brains could not be saved (${/** @type {any} */ (e)?.message || e}).`;
		} finally {
			syncing = false;
		}
	}
	/** the admin: every aven of this config forgets everything and starts fresh */
	async function forgetAll() {
		if (!confirm(`Forget every aven's brain for ${CONFIG.name}? Their characters, trials, lessons and deaths go, and the next run starts fresh.`)) return;
		try {
			await forgetMinds(mindsKey(), mindsRemote());
		} catch (e) {
			mindNote = `Could not forget (${/** @type {any} */ (e)?.message || e}).`;
			return;
		}
		minds = {};
		mindsOf = '';
		reset();
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
		if (!cfg || started) return; // a world keeps the settings it began with: an accepted MIP shapes new worlds
		useConfig(cfg, first ? {} : changedRules());
		reset();
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

	/** a new world on a config (Samuel: worlds are never reset; you open a new one, and every old one stays) */
	function play(/** @type {any} */ cfg, local = {}) {
		useConfig(cfg, local);
		try {
			localStorage.setItem(PICKED, cfg.id);
		} catch {
			/* no storage here */
		}
		reset();
		setView('valley');
	}

	// ---- worlds (Samuel, 2026-10-09): every world is kept with its settings, and can be opened again and played on;
	// a new one starts fresh. Only the avens' brains go from world to world (they are global) ----
	let worlds = $state(/** @type {any[]} */ ([]));
	let here = $state({ id: /** @type {string | null} */ (null), name: '' }); // the world on the page
	let worldNote = $state('');
	let dirty = false; // its settings changed since it was last saved
	async function loadWorlds() {
		if (!acct.play) return;
		try {
			worlds = (await loadRuns(100)).runs;
			worldNote = '';
		} catch (e) {
			worldNote = `The worlds could not be read (${/** @type {any} */ (e)?.message || e}).`;
		}
	}
	/** what this world runs on: its config (cards and values), the changes tried on top, and the model its avens ask */
	const settingsOf = () => ({ config: { id: CONFIG.id, name: CONFIG.name, version: CONFIG.version, cards: CONFIG.cards, params: { ...DEFAULTS } }, local: changedRules(), model: brain.mode });
	let keeping = false;
	/** keep the world as it stands with its run: its last days, then the whole valley and its settings */
	async function keepWorld() {
		const r = rec;
		if (!r || keeping) return;
		keeping = true;
		try {
			await r.flush(summary(), world.avens.every((/** @type {any} */ a) => !a.alive));
			if (!r.id) return;
			await saveWorldState(r.id, { world: saveWorld(world), settings: settingsOf() });
			dirty = false;
		} catch (e) {
			saving = { ...saving, error: `This world could not be saved (${/** @type {any} */ (e)?.message || e}).` };
		} finally {
			keeping = false;
		}
	}
	/** open a kept world again, as it was, with its settings: paused, ready to play on */
	async function openWorld(/** @type {any} */ w) {
		worldNote = 'Opening…';
		let run;
		try {
			run = await loadWorldRun(w.id);
		} catch (e) {
			worldNote = `${w.name} could not be opened (${/** @type {any} */ (e)?.message || e}).`;
			return;
		}
		if (!run.state?.world && !run.state?.settings) {
			worldNote = `${w.name} is from before worlds were kept whole: its days are in Stats on the MCP, but it can't be played on.`;
			return;
		}
		if (started) {
			await keepWorld();
			syncMinds(true);
		}
		const s = run.state.settings ?? { config: { id: run.config_id, name: run.config_id ?? 'Defaults', version: run.config_version ?? 0, cards: run.config?.cards, params: run.config?.params ?? {} }, local: {} };
		useConfig({ id: s.config.id, name: s.config.name, version: s.config.version, cards: s.config.cards, params: s.config.params }, s.local ?? {});
		if (s.model && s.model in BRAINS) brain.mode = s.model;
		const fresh = !run.state.world; // made on the MCP and never played: dealt now, on its settings and seed
		world = fresh ? createWorld(run.seed ?? undefined, { hearts: carried() }) : loadWorld(run.state.world, run.day_rows.map((/** @type {any} */ d) => d.stats));
		rec = recorder(world, null, { id: run.id, name: run.name, sent: fresh ? 0 : world.stats.length });
		saving = { days: rec.sent, error: '' };
		here = { id: run.id, name: run.name };
		for (const a of world.avens) {
			const m = (minds[a.name] ??= wholeMind(null, a.name, RULES.reserveDays));
			wear(a, m);
			if (!fresh) beginRun(m, run.name, { resume: true });
		}
		calls = blankCalls();
		down = busy = '';
		paused = true;
		started = !fresh;
		dirty = false;
		worldNote = '';
		useCode();
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

	/** the world begins in the database: the config as played (cards, every value, your changes on top), seed and brain;
	 * once it has its name, each brain knows which world it is in */
	function startRecording() {
		if (!acct.play) return;
		saving = { days: 0, error: '' };
		const r = (rec = recorder(world, { config_id: CONFIG.id, config_version: CONFIG.version, config: { cards: CONFIG.cards, params: { ...RULES }, local: changedRules() }, seed: world.seed, brain: PLAN[brain.mode].filter(Boolean).map((/** @type {any} */ k) => (k === 'liquid' ? LIQUID_MODEL : box[k] || k)).join(', falling back to '), summary: summary() }));
		r.ready.then(() => {
			if (rec !== r || !r.id) return;
			here = { id: r.id, name: r.name };
			for (const a of world.avens) if (a.mind) a.mind.world = r.name;
			keepWorld();
			loadWorlds();
		});
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
	let tab = $state('decisions');
	let selected = $state(0);
	let panelOpen = $state(true);
	let page = $state('home'); // the main view: 'home' (the worlds), 'valley', 'stats', 'policy', 'world', 'mips'
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
			stale: 0,
			// the brains' queue right now, for the Decisions tab: who is thinking (and how long, real seconds), who waits
			// for a turn, and how old each one's latest decision is (in-game hours)
			queue: tab === 'decisions' ? world.avens.filter((/** @type {any} */ x) => x.alive).map((/** @type {any} */ x) => ({ id: x.id, name: x.name, colour: x.colour, thinking: x.brain.pending, by: x.brain.asking ?? '', waited: x.brain.pending ? (performance.now() - (x.brain.sentAt ?? performance.now())) / 1000 : 0, age: x.brain.ready ? (world.t - (x.brain.last?.t ?? world.t)) / 3600 : null, asks: x.brain.asks ?? 0 })).sort((/** @type {any} */ p, /** @type {any} */ q) => Number(q.thinking) - Number(p.thinking) || q.waited - p.waited) : [],
			month: Math.floor((world.day - 1) / 30) + 1,
			config: { id: CONFIG.id, name: CONFIG.name, version: CONFIG.version, local: Object.keys(changedRules()).length },
			code: CODE.run?.info() ?? null,
			// the daily rows, only while the Stats view is open (each row is never changed once written)
			stats: page === 'stats' ? world.stats.slice() : [],
			weather: { ...world.weather },
			policy: { mint: RULES.mint, decay: RULES.decay, start: world.startHearts },
			// every aven's wants right now: per good, what it holds against tonight's need and what it still wants to buy
			// every aven's brain decisions, newest first, only while the Decisions tab is open
			decisions: tab === 'decisions' ? (world.decisions ?? []).slice(-150).reverse().map((/** @type {any} */ d) => ({ ...d, changes: [...d.changes] })) : [],
			wants: tab === 'wants' ? world.avens.map((/** @type {any} */ o) => ({ id: o.id, name: o.name, colour: o.colour, alive: o.alive, grows: [...o.grows], last: { ...(o.yesterday?.short ?? {}) }, goods: Object.fromEntries(GOODS.map((g) => [g, { has: o.stock[g], need: NEED[g], buy: want(o, g), bought: o.today.bought[g] }])) })) : [],
			board: ranking(world).map((o) => ({ id: o.id, name: o.name, colour: o.colour, hearts: o.hearts, start: o.startHearts ?? RULES.startHearts, health: o.health, alive: o.alive, diedOn: o.diedOn, grows: o.grows, source: o.brain.last?.source ?? '—', pending: o.brain.pending })),
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
				brain: { ...a.brain },
				mind: a.mind && tab === 'ledger' ? JSON.parse(JSON.stringify(keepMind(a.mind))) : null
			}
		};
	}

	// every aven thinks all day long, not once a morning (Samuel): once its last decision is in and THINK_H in-game hours
	// have passed, it asks its brain again with what it sees now. There is no rule-based stand-in: an aven acts only on a
	// brain's answers, and the clock waits only until each living aven has its first one: after that, decisions run beside the
	// clock and each aven acts on its latest while the next is on its way (Samuel). The stalest aven asks
	// first. The brains (Samuel, 2026-10-09) run on his GPU machine, over Tailscale, picked on the page: d1 (its own
	// server, on the machine's CPU) one request every second (BOX_EVERY), sent whether or not the ones before have
	// answered, up to BOX_IN_FLIGHT at once; when d1 fails, Qwen answers and the picker turns to Qwen. Qwen is fast: every
	// aven that is due asks at once. Liquid's hosted d1:free (off the picker for now), one ask at a time:
	// it refuses once a burst of 2 or 3 asks (~20,000 tokens each) has gone through and sustains about one ask
	// every 4 s, so its gap adapts: 10% shorter after an answer (down to GAP_MIN), 50% longer after a refusal (up to
	// GAP_MAX). Only every third ask of an aven is a full one (haggling, stock); the rest ask its prices. A failure no
	// brain covers pauses the valley (a refusal from Liquid only waits).
	const THINK_H = 2;
	const GAP_MIN = 2500;
	const GAP_MAX = 30000;
	const BOX_EVERY = 1000; // d1 on Samuel's machine: one decision request a second (Samuel); Qwen: all at once
	const BOX_IN_FLIGHT = 6; // ...with at most this many waiting for their answers
	const REST = 60000; // a brain that failed is passed over this long
	let down = $state(/** @type {string} */ (''));
	let busy = $state(/** @type {string} */ (''));
	const gate = { inFlight: 0, nextAt: 0, gap: 4000, rest: /** @type {Record<string, number>} */ ({ d1: 0, qwen: 0, liquid: 0 }) };
	const isRateLimit = (/** @type {string} */ m) => / 429\b|rate.limit|too many/i.test(m);
	const errorOf = (/** @type {any} */ e) => (e?.name === 'AbortError' ? 'timed out' : e?.message || String(e || 'unreachable'));

	// ---- the brains: what answers, and what steps in when it can't ----
	/** @type {Record<string, string>} */
	const NAME = { d1: 'd1', qwen: 'Qwen', liquid: 'Liquid', edit: 'edit' };
	/** @type {Record<string, string>} */
	const BRAINS = { d1: 'd1', qwen: 'Qwen' };
	// d1 answers; when it can't, Qwen answers that ask and the picker turns to Qwen until it is set back to d1 (Samuel)
	/** @type {Record<string, [string, string | null]>} */
	const PLAN = { d1: ['d1', 'qwen'], qwen: ['qwen', null] };
	const BRAIN = 'sandbox-8-brain';
	let brain = $state({ mode: 'd1', url: BOX_URL });
	try {
		const b = JSON.parse(localStorage.getItem(BRAIN) ?? 'null');
		if (b?.mode === 'qwen') brain.mode = 'qwen';
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
		const questions = questionsFor(world, me, { full, writes: brain.mode === 'qwen' });
		/** @param {number} ms @param {(signal: AbortSignal) => Promise<any>} ask */
		const within = (ms, ask) => {
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), ms);
			return ask(ctrl.signal).finally(() => clearTimeout(timer));
		};
		/** @param {string} who */
		const ask = async (who) => {
			try {
				const answers = await (who === 'liquid' ? within(25000, (signal) => askLiquid(state, questions, { signal, ...LIQUID })) : within(who === 'd1' ? 60000 : 20000, (signal) => askBox(state, questions, { signal, url: brain.url, want: /** @type {any} */ (who) })));
				calls.errors[who] = '';
				gate.rest[who] = 0;
				return { answers, source: who };
			} catch (e) {
				calls.errors[who] = errorOf(e);
				gate.rest[who] = performance.now() + REST;
				throw e;
			}
		};
		if (brain.mode === 'qwen') return ask('qwen');
		try {
			return await ask('d1');
		} catch (e) {
			// d1 can't: Qwen answers, and the picker stays on Qwen until someone sets it back to d1
			if (brain.mode === 'd1') (brain.mode = 'qwen'), saveBrain();
			try {
				return await ask('qwen');
			} catch {
				throw e; // neither answers: d1's failure decides
			}
		}
	}

	/** @param {any} a */
	const lastAt = (a) => (a.brain.ready ? a.brain.last?.t ?? -Infinity : -Infinity);

	/** @param {number} now real time, ms */
	function think(now) {
		const local = brain.mode !== 'liquid';
		// Qwen is fast (Samuel): every aven that is due asks at once; d1 (on the machine's CPU) one a second
		const fast = brain.mode === 'qwen';
		if (gate.inFlight >= (fast ? world.avens.length : local ? BOX_IN_FLIGHT : 1) || now < gate.nextAt) return;
		// the stalest aven that is due: one with no decision yet first, then the oldest decision
		let a = null;
		for (const o of world.avens) {
			if (!o.alive || o.brain.pending) continue;
			// Qwen: a new ask as soon as the last one has answered and the clock has moved on; d1: every THINK_H hours
			if (o.brain.ready && (fast ? world.t <= o.brain.t0 : world.t - o.brain.t0 < THINK_H * 3600)) continue;
			if (!a || lastAt(o) < lastAt(a)) a = o;
		}
		if (!a) return;
		const me = a;
		const full = !me.brain.ready || (me.brain.asks ?? 0) % 3 === 0;
		me.brain.asks = (me.brain.asks ?? 0) + 1;
		me.brain.pending = true;
		me.brain.t0 = world.t;
		me.brain.sentAt = performance.now();
		me.brain.asking = brain.mode;
		gate.inFlight++;
		calls.asked++;
		calls.pending++;
		// the GPU machine: the next request a second from now, whether or not this one has answered by then
		if (local && !fast) gate.nextAt = now + BOX_EVERY;
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

	// decisions run beside the clock, never in its way (Samuel): it waits only until every living aven has its first
	// decision; after that each acts on its latest one while the next is on its way
	const decided = () => world.avens.every((/** @type {any} */ a) => !a.alive || a.brain.ready);

	/** the HEARTS each aven takes into a new world (Samuel: its money always goes with it), from its brain's wallet */
	const carried = () => (RULES.carryHearts && mindsOf === mindsKey() ? Object.fromEntries(Object.values(minds).filter((m) => m.hearts > 0).map((m) => [m.name, m.hearts])) : {});
	/** a new world, fresh, on the settings now in force; the one before is kept as it stands */
	function reset() {
		if (started) {
			keepWorld();
			syncMinds(true);
		}
		rec = null;
		here = { id: null, name: '' };
		saving = { days: 0, error: '' };
		world = createWorld(undefined, { hearts: carried() });
		if (mindsOf === mindsKey()) for (const a of world.avens) wear(a, (minds[a.name] ??= wholeMind(null, a.name, RULES.reserveDays)));
		else loadAllMinds();
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
		if (!started) {
			// a world begins: each brain counts it, and a trial left unfinished in another world is undone
			for (const a of world.avens) if (a.mind) beginRun(a.mind, here.name || 'a new world');
			if (!rec) startRecording(); // a world made on the MCP has its run already
			syncMinds(true);
		}
		started = true;
		if (paused) down = '';
		paused = !paused;
		if (paused) keepWorld();
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
		// the valley stays in daylight, night or day (Samuel)
		const light = 1;
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
		let lastKeep = 0;
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
						// a night passed: each mind takes in its day (mind.js), then they are written
						if (step(world, d)) {
							night(world);
							syncMinds();
						}
					}
				}
			}
			draw(now);
			if (rec && now - lastSave > 3000) {
				lastSave = now;
				save(world.avens.every((/** @type {any} */ a) => !a.alive));
			}
			// the whole world is kept every 20 s while it plays (and when paused, left or closed)
			if (rec && (!paused || dirty) && now - lastKeep > 20000) {
				lastKeep = now;
				keepWorld();
			}
			if (now - lastSnap > 250) {
				lastSnap = now;
				snap = snapshot();
			}
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		// what the minds learned since the last night is written when the page goes, too (best effort)
		const leave = () => {
			if (!started) return;
			keepWorld();
			syncMinds(true);
		};
		window.addEventListener('pagehide', leave);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			window.removeEventListener('pagehide', leave);
			leave();
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
		if (e.kind === 'death') return `died of ${e.cause ?? 'want'}${e.lost != null ? `, lost ${fmt(e.lost)} HEARTS and all it held` : ''}`;
		if (e.kind === 'reborn') return `reborn with ${fmt(e.hearts)} HEARTS and nothing in store`;
		if (e.kind === 'rot') return `rotted: ${Object.entries(e.rotted).map(([g, n]) => `${n} ${GOOD_LABEL[g]}`).join(', ')}`;
		if (e.kind === 'rain') return `rain: the barrel caught ${e.qty} WATER`;
		if (e.kind === 'grow') return `${e.note === 'dry' ? 'dry spell, the well gave' : e.note === 'bad' ? 'bad harvest:' : 'rich harvest:'} ${e.qty} ${GOOD_LABEL[e.good]} (usually ${e.cap})`;
		return e.kind;
	};
</script>

<div class="market" class:open={panelOpen} class:statsview={page !== 'valley'}>
	<header>
		<div class="title">
			<b>Sandbox 7 · {here.name || (started ? 'This world (not kept)' : 'A new world')}</b>
			<span>Day {snap.day} · {snap.time} · month {snap.month}</span>
		</div>
		<nav class="views" aria-label="View">
			<button class:on={page === 'home'} onclick={() => (loadWorlds(), setView('home'))}>Worlds</button>
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
			<button onclick={() => (reset(), setView('valley'))}>New world</button>
			<button class="panel-btn" hidden={page === 'stats'} onclick={() => (panelOpen = !panelOpen)}>{panelOpen ? 'Hide books' : 'Books'}</button>
		</div>
	</header>

	<div class="stage" bind:this={stageEl}>
		<canvas bind:this={canvas} onpointerdown={onPointer}></canvas>
		{#if down}
			{@const [first, then] = PLAN[brain.mode]}
			<p class="liquid-note down">Paused: {NAME[first]} isn't answering ({down}){#if then && calls.errors[then]}, nor is {NAME[then]} ({calls.errors[then]}){/if}. The avens never play without a brain. Press Play to ask again.</p>
		{:else if !paused && (snap.waiting || snap.stale || busy)}
			<p class="liquid-note">{busy ? `${busy} ` : ''}{snap.waiting ? `Waiting for ${NAME[brain.mode]}: ${snap.waiting} aven${snap.waiting === 1 ? '' : 's'} still deciding ${snap.waiting === 1 ? 'its' : 'their'} first prices.` : snap.stale ? `The clock waits for ${NAME[brain.mode]}: ${snap.stale} aven${snap.stale === 1 ? '' : 's'} need a fresh decision.` : ''}</p>
		{/if}
		<div class="ticker" aria-label="Prices">
			{#each GOODS as g (g)}
				<span><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]} <b>{snap.market[g].price ?? '—'}</b> <small>avg {snap.market[g].avg ?? '—'}</small></span>
			{/each}
		</div>
	</div>

	{#if page === 'home'}
		<div class="statspage worlds">
			<h2>Worlds</h2>
			<p class="sub">Every world is kept as it stands, with its own settings, and can be opened again to play on. A new world starts fresh; only the avens' brains go with them from world to world, and learn there.</p>
			<div class="new">
				<button class="go" onclick={() => { const c = configs.find((x) => x.id === newCfg) ?? configs[0]; if (c) play(c); else (reset(), setView('valley')); }}>New world</button>
				{#if configs.length > 1}<label>on <select bind:value={newCfg}>{#each configs as c (c.id)}<option value={c.id}>{c.name} (v{c.version})</option>{/each}</select></label>{:else if configs[0]}<span class="sub">on {configs[0].name} (v{configs[0].version})</span>{/if}
			</div>
			{#if !acct.play}<p class="sub">{acct.note || 'Sign in to keep worlds.'} A world played here now is not kept.</p>{/if}
			{#if worldNote}<p class="sub miss">{worldNote}</p>{/if}
			<table class="worldlist">
				<thead><tr><th>World</th><th>Config</th><th>Days</th><th>Alive</th><th>Leader</th><th>Kept</th><th></th></tr></thead>
				<tbody>
					{#each worlds as w (w.id)}
						<tr class:sel={w.id === here.id}>
							<td><b>{w.name || 'A world'}</b></td>
							<td>{w.summary?.config?.name ?? w.config_id ?? 'Defaults'}{w.config_version ? ` v${w.config_version}` : ''}</td>
							<td class="num">{w.days}</td>
							<td class="num">{w.alive ?? '—'}</td>
							<td>{w.summary?.leader ?? '—'}</td>
							<td>{w.saved ? new Date(w.saved).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'history only'}</td>
							<td>{#if w.id === here.id}<button onclick={() => setView('valley')}>Playing</button>{:else if w.saved}<button onclick={() => openWorld(w)}>Open</button>{/if}</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="none">{acct.play ? 'No worlds yet: start a new one.' : ''}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
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
							<span class="num">{row.alive ? `${fmt(row.hearts)} ♥` : `died day ${row.diedOn} · back day ${row.diedOn + RULES.rebirthDays}`}</span>
							<span class="delta" class:up={row.hearts >= row.start} title="since it came into this world">{row.alive ? `${row.hearts >= row.start ? '+' : ''}${fmt(row.hearts - row.start)}` : ''}</span>
						</button>
					</li>
				{/each}
			</ol>
			<p class="brain">Model <select class="brain-mode" bind:value={brain.mode} onchange={saveBrain} aria-label="Model">{#each Object.entries(BRAINS) as [k, label] (k)}<option value={k}>{label}</option>{/each}</select></p>
		</section>

		<nav class="tabs">
			<button class:on={tab === 'decisions'} onclick={() => (tab = 'decisions')}>Decisions</button>
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
		{:else if tab === 'decisions'}
		<section>
			<h4>Now <small>{calls.pending} thinking · {calls.answered} answered{calls.failed ? ` · ${calls.failed} failed` : ''}</small></h4>
			<ul class="entries decisions queue">
				{#each snap.queue as q (q.id)}
					<li>
						<span class="when">{q.thinking ? `${q.waited.toFixed(1)} s` : ''}</span>
						<span class="what"><button class="who" onclick={() => select(q.id)}><i style:background={q.colour}></i>{q.name}</button> {#if q.thinking}<small>{NAME[q.by] ?? q.by}</small> thinking{:else}queued{/if}</span>
						<span class="num" title="age of its latest decision, in-game">{q.age == null ? 'no decision yet' : `${q.age < 1 ? '<1' : Math.round(q.age)} h old`}</span>
					</li>
				{/each}
			</ul>
			<h4>Decisions</h4>
			<ul class="entries decisions">
				{#each snap.decisions as d (d.n)}
					<li>
						<span class="when">d{d.day} {clock(d.t)}</span>
						<span class="what"><button class="who" onclick={() => select(d.id)}><i style:background={d.colour}></i>{d.name}</button> <small>{NAME[d.source] ?? d.source}</small> {d.changes.length ? d.changes.join(', ') : 'kept its prices'}</span>
					</li>
				{:else}
					<li class="none">No decisions yet: press Start.</li>
				{/each}
			</ul>
		</section>
		{:else}
		<section class="ledger">
			<h3><i style:background={snap.aven.colour}></i>{snap.aven.name}'s ledger</h3>
			<p class="sub">
				{snap.aven.alive ? `${fmt(snap.aven.hearts)} HEARTS · water ${Math.round(snap.aven.body.water)} · food ${Math.round(snap.aven.body.food)}` : `died on day ${snap.aven.diedOn}, reborn on day ${snap.aven.diedOn + RULES.rebirthDays}`} · keeps {snap.aven.mind ? `${snap.aven.mind.wants.water} days of water, ${snap.aven.mind.wants.food} of food` : `${snap.aven.reserveDays} days`} in stock<br />minted +{fmt(snap.aven.minted)} · decayed −{fmt(snap.aven.decayed)} so far
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
			{#if snap.aven.mind}
				{@const m = snap.aven.mind}
				<h4>Its brain <small>run {m.runs} · {m.days} days lived · died {m.deaths}× · {m.tally.trials} trials, {m.tally.kept} kept</small></h4>
				<ul class="dials">
					{#each Object.entries(DIALS) as [k, d] (k)}<li title={`0 ${d.low} · 10 ${d.high}`}><span>{d.label}</span><b style:width={`${m.dials[k] * 10}%`}></b><em>{m.dials[k]}</em></li>{/each}
					{#each Object.entries(WANTS) as [k, w] (k)}<li title={`days of ${k} it keeps, and buys up to`}><span>{w.label}</span><b class="want" style:width={`${m.wants[k] * 10}%`}></b><em>{m.wants[k]} d</em></li>{/each}
				</ul>
				<p class="sub">{m.trial ? `Trying ${m.trial.kind === 'wants' ? `${m.trial.key} stock` : m.trial.key} ${m.trial.from}→${m.trial.to} since day ${m.trial.day}: kept if it beats ${m.base}/day over ${TRIAL_DAYS} days.` : m.base == null ? `Measuring its setting (${TRIAL_DAYS} days) before its next trial.` : `Last stretch ${m.base}/day: it picks its next trial.`}</p>
				{#if m.log.length}<ul class="entries mind">{#each m.log.slice().reverse() as line, i (i)}<li><span class="what">{line}</span></li>{/each}</ul>{/if}
				{#if m.lessons.length}<h4>Lessons</h4><ul class="entries mind">{#each m.lessons as l (l.id)}<li><span class="what">#{l.id} {l.text}</span><span class="num">+{l.up} −{l.down}</span></li>{/each}</ul>{/if}
				{#if m.deathLog.length}<h4>Deaths</h4><ul class="entries mind">{#each m.deathLog.slice().reverse() as line, i (i)}<li class="death"><span class="what">{line}</span></li>{/each}</ul>{/if}
				{#if mindNote}<p class="sub miss">{mindNote}</p>{/if}
				{#if acct.admin}<button class="link forget" onclick={forgetAll}>Forget every aven's brain</button>{/if}
			{/if}
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
	.worlds {
		height: 100%;
		box-sizing: border-box;
		overflow: auto;
		background: #f4f1e8;
		color: #1f2a23;
		padding: 18px 20px 96px;
	}
	.worlds > * {
		max-width: 980px;
	}
	.worlds h2 {
		margin: 0 0 4px;
		font-size: 20px;
	}
	.worlds .new {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
		margin: 14px 0;
	}
	.worlds .go {
		background: #2f6b46;
		color: #fff;
		border: 0;
		border-radius: 10px;
		padding: 8px 16px;
		font-weight: 600;
		cursor: pointer;
	}
	.worldlist {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.worldlist th,
	.worldlist td {
		text-align: left;
		padding: 7px 8px;
		border-bottom: 1px solid #1f2a2318;
		white-space: nowrap;
	}
	.worldlist th {
		font-weight: 600;
		opacity: 0.7;
	}
	.worldlist tr.sel td {
		background: #2f6b4614;
	}
	.worldlist .none {
		opacity: 0.6;
	}
	@media (max-width: 760px) {
		.worlds {
			padding: 12px 12px 96px;
		}
		.worldlist th:nth-child(2),
		.worldlist td:nth-child(2),
		.worldlist th:nth-child(5),
		.worldlist td:nth-child(5) {
			display: none;
		}
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
	.dials {
		list-style: none;
		margin: 0.2rem 0 0.4rem;
		padding: 0;
		display: grid;
		gap: 0.2rem;
	}
	.dials li {
		display: grid;
		grid-template-columns: 7.5rem 1fr 2.8rem;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
	}
	.dials li b {
		height: 0.45rem;
		border-radius: 0.25rem;
		background: #b07ad8;
	}
	.dials li b.want {
		background: #2a78d6;
	}
	.dials li em {
		font-style: normal;
		white-space: nowrap;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.entries.mind li {
		font-size: 0.76rem;
	}
	.link.forget {
		margin: 0.3rem 0 0.6rem;
		background: none;
		border: 0;
		padding: 0;
		color: #b3261e;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
		font-size: 0.78rem;
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
	.wants .who,
	.decisions .who {
		border: 0;
		background: none;
		padding: 0;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.wants .who i,
	.decisions .who i {
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
	.decisions small {
		opacity: 0.55;
	}
	.decisions .none {
		opacity: 0.5;
		display: block;
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
