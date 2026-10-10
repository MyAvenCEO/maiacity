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
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { wayBack } from '$lib/app/back.svelte.js';
	import { createWorld, saveWorld, loadWorld, step, ranking, want, fieldGrown, fieldYield, fieldsOn, COOP_SPOT, edgeAlong, wedgeHome, ROT, GOODS, GOOD_LABEL, GOOD_COLOUR, NEED, WORLD, DAY_S, CODE, seeValley, activity, changeText } from './economy.js';
	import { loadCode } from './sandbox.js';
	import { fullCards } from '../../../game/economy/params.js';
	import { RULES, CONFIG, DEFAULTS, PARAMS, changedRules, useConfig } from './rules.js';
	import RulesView from './RulesView.svelte';
	import ProposalsView from './ProposalsView.svelte';
	import { loadConfigs, loadRuns, loadMips, loadWorldRun, saveWorldState, recorder, loadMinds, saveMinds, forgetMinds } from './store.js';
	import { wholeMind, beginRun, wear, night, editMind, keepMind, worldStamp, enterWorld, traits, TRIAL_DAYS, forgetMemory } from './mind.js';
	import AvensView from './AvensView.svelte';
	import ActivityFeed from './ActivityFeed.svelte';
	import { me, may } from '$lib/auth/client';
	import { native } from '$lib/native';
	// browsers can't call Liquid (no CORS), so every build, the local Mac one too, asks through api.maia.city, which holds the key
	const LIQUID = { relay: import.meta.env.VITE_LIQUID_RELAY || 'https://api.maia.city/api/liquid/decide' };
	import PriceChart from './PriceChart.svelte';
	import { short } from './format.js';
	import StatsView from './StatsView.svelte';
	import { stateFor, questionsFor, promptFor, askLiquid, askBox, boxModels, boxModel, applyAnswers, LIQUID_MODEL, BOX_URL, BOX_HERE } from './brain.js';

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
				loadAllMinds();
				acct.note = native() ? "This studio's key can't play the economy yet: sign it out once (You, at the bottom, then Sign out) and in again with your passkey. Until then the valley runs on the catalogue's defaults and nothing is saved." : 'Your role cannot play the economy sandbox yet, so the valley runs on the defaults and nothing is saved.';
				return;
			}
			await reloadConfigs(true);
			await loadWorlds();
		} catch (e) {
			acct.note = `Not connected (${/** @type {any} */ (e)?.message || 'the API cannot be reached'}): sign in on maia.city to save runs and see the proposals. The valley runs on the catalogue's defaults.`;
			loadAllMinds();
		}
	}

	// ---- each aven's brain, its own in each world (mind.js; "brain" to Samuel, mind in the code, where brain.js is the model): who it is, what it wants, what it tried, learned, died of ----
	/** @type {Record<string, any>} */
	let minds = {}; // by aven name, for the config being played
	let mindsOf = ''; // the world (run id) they are kept under; '' while a new world is not kept yet
	let mindNote = $state('');
	const mindsRemote = () => acct.play;
	const mindsKey = () => here.id ?? ''; // every world is a capsule (Samuel): its avens' brains are kept under its id
	/** take in the edits made from outside (the studio's MCP): the newest last; each says so in the decisions feed */
	function takeEdits(/** @type {any} */ m, /** @type {any[]} */ pending) {
		for (const e of (pending ?? []).filter((x) => x.id > (m.applied ?? 0)).sort((x, y) => x.id - y.id)) {
			const said = editMind(m, e);
			m.applied = e.id;
			const a = world.avens.find((/** @type {any} */ x) => x.name === m.name);
			if (a && said.length) {
				activity(world, { kind: 'edit', source: 'edit', changes: [`set by ${e.by ?? 'the admin'}: ${said.join(', ')}`] }, a);
			}
		}
	}
	/** read every aven's mind in this world, and dress its avens in them. A new world starts each with a copy of its
	 * brain in the world it follows (Samuel: a new world takes over all the last one learned), else its latest: the one
	 * it played with last on this page, else its newest kept in any world */
	async function loadAllMinds() {
		const cfg = mindsKey();
		/** @type {Record<string, any>} */
		let raw = {};
		/** @type {Record<string, any>} */
		let copies = {};
		const held = Object.values(minds);
		if (!cfg && !mindsOf && held.length && world.avens.every((/** @type {any} */ a) => minds[a.name])) {
			// the brains on the page are already copies for a world not kept yet (a new world dealt again): they go on
			// to this one as they are, copied nothing twice
			if (!started) for (const a of world.avens) wear(a, minds[a.name]);
			return;
		}
		try {
			if (cfg) raw = await loadMinds(cfg, mindsRemote());
			// a world not played yet (new, or made on the MCP): an aven without a brain of its own here gets a copy
			if (world.day === 1 && world.t === 0 && world.avens.some((/** @type {any} */ a) => !raw[a.name]?.dials)) {
				copies = (here.after && mindsRemote() ? await loadMinds(here.after, true) : null) ?? {};
				if (!Object.keys(copies).length)
					copies = held.length ? JSON.parse(JSON.stringify(Object.fromEntries(held.map((m) => [m.name, keepMind(m)])))) : mindsRemote() ? await loadMinds('latest', true) : {};
			}
			mindNote = '';
		} catch (e) {
			mindNote = `The avens' brains could not be read (${/** @type {any} */ (e)?.message || e}): they start fresh${cfg ? ' and are not kept' : ''}.`;
		}
		if (cfg !== mindsKey()) return;
		mindsOf = cfg;
		minds = {};
		const stamp = worldStamp(RULES, CONFIG.cards);
		for (const a of world.avens) {
			const own = raw[a.name]?.dials ? raw[a.name] : null;
			const { pending, updated, ...was } = own ?? copies[a.name] ?? {};
			const m = wholeMind(own || copies[a.name] ? was : null, a.name, RULES.reserveDays);
			if (!own && copies[a.name]) {
				enterWorld(m, stamp, PARAMS); // a copy learns what is set differently here
				// and forgets what its world's MIP said it should (memories from worlds that no longer apply)
				const gone = (here.forget?.[a.name] ?? []).filter((/** @type {any} */ f) => forgetMemory(m, f.list, f.ref)).length;
				if (gone) m.log.push(`${here.name || 'this world'} begins: forgot ${gone} ${gone === 1 ? 'memory' : 'memories'} of earlier worlds`);
			} else m.stamp = stamp;
			takeEdits(m, raw[a.name]?.pending); // edits made for this world (a copy's old ones stay behind)
			minds[a.name] = m;
		}
		if (!started) for (const a of world.avens) wear(a, minds[a.name]);
		snap = snapshot();
	}
	let syncing = false;
	/** each night: take in edits from outside, then write every mind */
	async function syncMinds(final = false) {
		if (syncing || !mindsOf || mindsOf !== mindsKey() || !Object.keys(minds).length) return; // a world not kept keeps no brains
		syncing = true;
		const cfg = mindsOf;
		try {
			if (mindsRemote() && !final) {
				const raw = await loadMinds(cfg, true);
				for (const m of Object.values(minds)) takeEdits(m, raw[m.name]?.pending);
			}
			if (!final) {
				// the settings it plays under now, to tell a copy what differs in the world it goes to next (not on the way
				// out of a world: a new world's settings may be in force by then)
				const stamp = worldStamp(RULES, CONFIG.cards);
				for (const m of Object.values(minds)) m.stamp = stamp;
			}
			await saveMinds(cfg, Object.fromEntries(Object.values(minds).map((m) => [m.name, keepMind(m)])), mindsRemote());
			mindNote = '';
		} catch (e) {
			mindNote = `The avens' brains could not be saved (${/** @type {any} */ (e)?.message || e}).`;
		} finally {
			syncing = false;
		}
	}
	/** the admin: every aven in this world forgets everything and plays on with a new brain */
	/** forget one memory of one aven's brain in this world (the admin, from the Avens view): taken in now, kept with the
	 * world's brains on the next night */
	function forgetOne(/** @type {string} */ name, /** @type {string} */ list, /** @type {any} */ ref) {
		const m = minds[name];
		if (!m) return;
		editMind(m, { forget: [{ list, ref }], by: 'the admin' });
		snap = snapshot();
	}
	async function forgetAll() {
		if (!confirm(`Forget every aven's brain in ${here.name || 'this world'}? Their characters, trials, lessons and deaths go, and they play on with new ones.`)) return;
		try {
			if (mindsOf) await forgetMinds(mindsOf, mindsRemote());
		} catch (e) {
			mindNote = `Could not forget (${/** @type {any} */ (e)?.message || e}).`;
			return;
		}
		for (const a of world.avens) {
			const m = (minds[a.name] = wholeMind(null, a.name, RULES.reserveDays));
			wear(a, m);
			if (started) beginRun(m, here.name || 'this world');
			if (!a.alive) m.gone = true;
		}
		snap = snapshot();
		syncMinds(true);
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
		if (!cfg || started || here.id) return; // a world keeps the settings it began with: an accepted MIP shapes new worlds
		useConfig(cfg, first ? {} : changedRules());
		reset();
	}

	// ---- the world's rulebook: every card's code, each card in its own QuickJS sandbox (sandbox.js), fresh for every
	// world; the section cards run their own code, else their rules' default (game/economy/rules-code.js) ----
	let codeWait = false; // the clock waits while it loads
	let codeNote = $state('');
	let codeGen = 0;
	function useCode() {
		const gen = ++codeGen;
		CODE.run?.dispose();
		CODE.run = null;
		codeNote = '';
		codeWait = true;
		loadCode(CONFIG.cards)
			.then((run) => {
				if (gen !== codeGen) return run?.dispose();
				CODE.run = run;
				seeValley(world);
			})
			.catch((e) => {
				if (gen === codeGen) codeNote = `The cards' code could not run here (${e?.message || e}); the valley runs on the engine's own copy of the default rules.`;
			})
			.finally(() => {
				if (gen === codeGen) codeWait = false;
				snap = snapshot();
			});
	}

	// ---- worlds (Samuel, 2026-10-09): every world is kept with its settings, and can be opened again and played on;
	// a new one starts fresh. Each is a capsule: its avens' money and brains are its own ----
	let worlds = $state(/** @type {any[]} */ ([]));
	let here = $state({ id: /** @type {string | null} */ (null), name: '', after: /** @type {string | null} */ (null), forget: /** @type {Record<string, any[]> | null} */ (null) }); // the world on the page, the world it follows, and what its copied brains forget
	let worldNote = $state('');
	let openMips = $state(/** @type {any[]} */ ([])); // MIPs waiting for a decision, listed in the welcome screen's aside
	let focusMip = $state(/** @type {number | null} */ (null)); // the proposal the Proposals page opens on, picked from that aside
	async function loadWorlds() {
		if (!acct.play) return;
		try {
			worlds = (await loadRuns(100)).runs;
			worldNote = '';
			openMips = ((await loadMips().catch(() => null))?.mips ?? []).filter((/** @type {any} */ m) => m.status === 'open');
		} catch (e) {
			worldNote = `The worlds could not be read (${/** @type {any} */ (e)?.message || e}).`;
		}
	}
	/** the Proposals page, scrolled to one proposal (Samuel, 2026-10-10: the welcome screen lists the open ones in an aside) */
	function openMip(/** @type {number | null} */ n) {
		focusMip = n;
		setView('mips');
	}
	const whenMip = (/** @type {string} */ t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
	const worldOfMip = (/** @type {any} */ m) => (m.world_id ? m.world_name ?? 'a deleted world' : m.action === 'world' ? m.world?.name ?? 'a new world' : m.config ?? '');
	/** what this world runs on: its config (cards and values), the changes tried on top, and the model its avens ask */
	const settingsOf = () => ({ config: { id: CONFIG.id, name: CONFIG.name, version: CONFIG.version, cards: fullCards(CONFIG.cards), params: { ...DEFAULTS } }, local: changedRules(), model: brain.mode });
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
		paused = true;
		world = fresh ? createWorld(run.seed ?? undefined) : loadWorld(run.state.world, run.day_rows.map((/** @type {any} */ d) => d.stats));
		// a new world that follows another starts from that world's last prices: its card's price hook gets each as
		// `inherited` for its first price (a world never played on passes none)
		if (fresh && s.after) {
			try {
				const prev = await loadWorldRun(s.after);
				const last = prev.state?.world?.posted ?? prev.day_rows?.at(-1)?.stats?.price ?? null;
				if (last) world.inherited = Object.fromEntries(Object.entries(last).filter(([, v]) => typeof v === 'number' && v > 0));
			} catch {
				// no prices to inherit: the card's own first price
			}
		}
		rec = recorder(world, null, { id: run.id, name: run.name, sent: fresh ? 0 : world.stats.length });
		saving = { days: rec.sent, error: '' };
		here = { id: run.id, name: run.name, after: s.after ?? null, forget: s.forget ?? null };
		trial = false;
		// its own brains, as it left them (or as the MCP set them for a world not played yet)
		await loadAllMinds();
		for (const a of world.avens) {
			const m = (minds[a.name] ??= wholeMind(null, a.name, RULES.reserveDays));
			wear(a, m);
			if (!fresh) beginRun(m, run.name, { resume: true });
			if (!a.alive) m.gone = true; // dead when it was left: its death is already in its brain
		}
		// a new world's first line in the feed: where it comes from, and what is set differently from the world it follows
		if (fresh) {
			const after = s.after ? (worlds.find((w) => w.id === s.after)?.name ?? 'the world before') : null;
			const changed = world.avens.map((/** @type {any} */ a) => a.mind?.changed).find((/** @type {any} */ c) => c?.length) ?? [];
			activity(world, { kind: 'world', source: s.mip ? `MIP-${s.mip}` : 'world', changes: [`${run.name} begins${s.mip ? ` (MIP-${s.mip})` : ''}${after ? `, following ${after}` : ''}`, ...changed] });
		}
		calls = blankCalls();
		down = busy = '';
		paused = true;
		started = !fresh;
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
			here = { id: r.id, name: r.name, after: null, forget: null };
			for (const a of world.avens) if (a.mind) a.mind.world = r.name;
			if (!mindsOf) mindsOf = r.id; // its new brains are kept with it from now on
			keepWorld();
			syncMinds();
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
			// the valley's activity (economy.js, activity), newest first, only while the Activity tab is open
			decisions: tab === 'decisions' && page === 'valley' ? (world.decisions ?? []).slice(-200).reverse().map((/** @type {any} */ d) => ({ ...d })) : [],
			wants: tab === 'wants' ? world.avens.map((/** @type {any} */ o) => ({ id: o.id, name: o.name, colour: o.colour, alive: o.alive, grows: [...o.grows], last: { ...(o.yesterday?.short ?? {}) }, goods: Object.fromEntries(GOODS.map((g) => [g, { has: o.stock[g], need: NEED[g], buy: want(o, g), bought: o.today.bought[g] }])) })) : [],
			// the Maia City Coop's ledger: what the avens paid it for their fields, and for what
			coop: world.coop ? { hearts: world.coop.hearts, from: { ...world.coop.from } } : null,
			board: ranking(world).map((o) => ({ id: o.id, name: o.name, colour: o.colour, hearts: o.hearts, health: o.health, stock: world.layout === 'coop' ? { ...o.stock } : null, alive: o.alive, diedOn: o.diedOn, grows: o.grows, source: o.brain.last?.source ?? '—', pending: o.brain.pending })),
			market: Object.fromEntries(
				GOODS.map((g) => {
					const m = world.market[g];
					// the real-time average: every trade of this good in the last 24 in-game hours, weighted by units
					const recent = world.trades.filter((/** @type {any} */ t) => t.good === g && world.t - t.t < DAY_S);
					const units = recent.reduce((/** @type {number} */ n, /** @type {any} */ t) => n + t.qty, 0);
					const avg = units ? Math.round((recent.reduce((/** @type {number} */ n, /** @type {any} */ t) => n + t.qty * t.price, 0) / units) * 100) / 100 : null;
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
				choices: { ...(a.choices ?? {}) },
				// its own fields (where its world has them): crop, level and how far grown
				fields: (a.fields ?? []).map((/** @type {any} */ f) => ({ crop: f.crop, level: f.level, grown: Math.round(fieldGrown(world, f) * 100), yield: Math.round(fieldYield(world, f) * 10) / 10 })),
				ledger: page === 'avens' ? a.ledger.slice(-200).reverse() : [],
				brain: { ...a.brain, labels: { ...(a.brain.labels ?? {}) }, units: { ...(a.brain.units ?? {}) } },
				mind: a.mind && page === 'avens' ? JSON.parse(JSON.stringify(keepMind(a.mind))) : null
			},
			// the Avens view: every aven to pick from, what a brain is in this world, the picked one's days and activity
			avens:
				page === 'avens'
					? {
							list: ranking(world).map((o, i) => ({ rank: i + 1, id: o.id, name: o.name, colour: o.colour, alive: o.alive, hearts: o.hearts, health: o.health })).sort((p, q) => p.id - q.id),
							traits: traits(),
							stats: world.stats.map((/** @type {any} */ r) => ({ day: r.day, dry: r.dry, hearts: r.hearts?.[a.id], health: r.health?.[a.id], water: r.body?.[a.id]?.water, food: r.body?.[a.id]?.food })),
							feed: (world.decisions ?? []).filter((/** @type {any} */ d) => d.id === a.id).slice(-200).reverse()
						}
					: null
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
				const answers = await (who === 'liquid' ? within(25000, (signal) => askLiquid(state, questions, { signal, ...LIQUID })) : within(who === 'd1' ? 60000 : 20000, (signal) => askBox(state, questions, { signal, url: brain.url, want: /** @type {any} */ (who), system: promptFor(me) })));
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
		// the stalest aven that is due: one just reborn or whose health fell first (it decides at once, Samuel), then one
		// with no decision yet, then the oldest decision
		let a = null;
		for (const o of world.avens) {
			if (!o.alive || o.brain.pending) continue;
			// Qwen: a new ask as soon as the last one has answered and the clock has moved on; d1: every THINK_H hours
			if (!o.urgent && o.brain.ready && (fast ? world.t <= o.brain.t0 : world.t - o.brain.t0 < THINK_H * 3600)) continue;
			if (!a || (o.urgent && !a.urgent) || (!o.urgent === !a.urgent && lastAt(o) < lastAt(a))) a = o;
		}
		if (!a) return;
		const me = a;
		const full = !me.brain.ready || me.urgent || (me.brain.asks ?? 0) % 3 === 0;
		me.urgent = false;
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

	/** a new world, fresh, on the settings now in force; the one before is kept as it stands */
	function reset() {
		if (started) {
			keepWorld();
			syncMinds(true);
		}
		rec = null;
		here = { id: null, name: '', after: null, forget: null };
		saving = { days: 0, error: '' };
		world = createWorld();
		paused = true;
		started = false;
		loadAllMinds(); // new brains: a world not kept yet has none to read
		calls = blankCalls();
		down = '';
		busy = '';
		useCode();
		snap = snapshot();
	}

	// the page opens on its worlds (Samuel, 2026-10-09): pick one and the valley, its views and its clock load. New worlds
	// are proposed over the studio's MCP, never here; once accepted under Proposals they appear in the list
	let trial = $state(false); // signed out, nothing is kept: a valley to try here
	const inWorld = $derived(!!here.id || trial);
	/** the welcome screen and the Proposals stand outside every world: no world's views, no clock */
	const outside = $derived(page === 'home' || page === 'mips');
	// out of a world, or out of the Proposals, the nav pill's Back leads to the welcome screen (Samuel, 2026-10-10)
	$effect(() => {
		if (page !== 'home') return wayBack('Back to the worlds', home);
	});
	/** back to the worlds: the one open pauses (and is kept as it stands) */
	function home() {
		if (!paused) toggle();
		loadWorlds();
		setView('home');
	}
	/** signed out: a valley to try, on the defaults, not kept */
	function tryValley() {
		trial = true;
		reset();
		setView('valley');
	}
	/** a world MIP accepted: the world is made; open it, ready to start */
	async function madeWorld(/** @type {any} */ r) {
		await loadWorlds();
		await openWorld({ id: r.world, name: r.name });
	}
	/** an amend MIP accepted: where it amends the world open here, that world plays on its new rules from now on (its
	 * kept settings in the database already have them; this brings the open valley in step, so the next save keeps them) */
	async function amendedWorld(/** @type {any} */ r) {
		await loadWorlds();
		if (!here.id || r.amended !== here.id) return;
		let run;
		try {
			run = await loadWorldRun(here.id);
		} catch {
			return;
		}
		const cards = run.state?.settings?.config?.cards;
		if (!cards?.length) return;
		useConfig({ id: CONFIG.id, name: CONFIG.name, version: CONFIG.version, cards, params: { ...DEFAULTS, ...Object.assign({}, ...cards.map((/** @type {any} */ c) => c.values ?? {})) } }, changedRules());
		useCode();
		activity(world, { kind: 'world', source: 'amend', changes: [`${here.name}'s rules are amended`, ...(r.diff ?? [])] });
		snap = snapshot();
	}
	/** @param {string} v */
	function setView(v) {
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

		// a fields valley (its own layout, Samuel's sketch): the COOP in the middle, a wedge of land per aven, its fields
		// around its home; older worlds keep the ring of round lands below
		if (world.layout === 'coop') drawCoopValley(ctx, light);
		else
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
		// on a fields valley each aven is a bigger dot with its name inside, below its eyes (Samuel, 2026-10-10)
		const big = world.layout === 'coop' ? 1.6 : 1;
		for (const a of world.avens) {
			const r = 15 * big;
			const wob = now / 260 + a.id * 1.7;
			ctx.save();
			ctx.translate(a.x, a.y);
			ctx.scale(big, big);
			if (!a.alive) ctx.scale(1.3, 0.55);
			ctx.beginPath();
			for (let i = 0; i <= 24; i++) {
				const ang = (i / 24) * Math.PI * 2;
				const rr = 15 * (1 + (a.alive ? 0.08 : 0.02) * Math.sin(ang * 3 + wob) + (a.alive ? 0.05 : 0) * Math.cos(ang * 2 - wob * 1.3));
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
			if (big > 1) {
				ctx.fillStyle = a.alive ? '#fff' : '#f4f1e8';
				ctx.font = '700 10px system-ui, sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(a.alive ? a.name : `${a.name} †`, a.x, a.y + (a.alive ? 10 : 0));
				ctx.textBaseline = 'alphabetic';
			}
			// its health ring (a fields valley shows health on the board only: on the map it read as a second home ring)
			if (a.alive && world.layout !== 'coop') {
				const share = a.health / RULES.healthMax;
				ctx.strokeStyle = share > 0.6 ? '#4fb37a' : share > 0.3 ? '#f0a03c' : '#e05a6d';
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.arc(a.x, a.y, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share);
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
			if (away && big === 1) ctx.fillText(a.name, a.x, a.y - r - 12);
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

	/** a fields valley: the Maia City Coop in the middle, the land cut into one wedge per aven out to the valley's edge,
	 * each aven's home in its wedge with its three field plots around it (F1, F2, F3: its crop, level and last harvest;
	 * an unopened plot dashed), its store below and its name */
	// the Maia City circle logo, served from the repo's static folder (Samuel, 2026-10-10), not from the vault's sync
	const coopLogo = typeof Image === 'undefined' ? /** @type {any} */ ({}) : Object.assign(new Image(), { src: `${base}/sandbox-8/maia-city-circle.png` });
	function drawCoopValley(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ light) {
		const n = world.avens.length;
		const C = COOP_SPOT;
		const ink = light > 0.5 ? '#1f2a23' : '#f4f1e8';
		const at = (/** @type {number} */ ang, /** @type {number} */ d) => /** @type {[number, number]} */ ([C.x + Math.cos(ang) * d, C.y + Math.sin(ang) * d]);
		// a part of a wedge, between two angles and two distances from the COOP (each a function of the angle), as points
		const region = (/** @type {number} */ b0, /** @type {number} */ b1, /** @type {(ang: number) => number} */ rin, /** @type {(ang: number) => number} */ rout) => {
			/** @type {[number, number][]} */
			const pts = [];
			for (let k = 0; k <= 16; k++) pts.push(at(b0 + ((b1 - b0) * k) / 16, rout(b0 + ((b1 - b0) * k) / 16)));
			for (let k = 16; k >= 0; k--) pts.push(at(b0 + ((b1 - b0) * k) / 16, rin(b0 + ((b1 - b0) * k) / 16)));
			return pts;
		};
		/** its area (any simple polygon) and the middle of it */
		const measure = (/** @type {[number, number][]} */ pts) => {
			let A = 0,
				cx = 0,
				cy = 0;
			pts.forEach(([x0, y0], k) => {
				const [x1, y1] = pts[(k + 1) % pts.length];
				const f = x0 * y1 - x1 * y0;
				A += f;
				cx += (x0 + x1) * f;
				cy += (y0 + y1) * f;
			});
			return { area: Math.abs(A / 2), x: cx / (3 * A || 1), y: cy / (3 * A || 1) };
		};
		const path = (/** @type {[number, number][]} */ pts) => {
			ctx.beginPath();
			pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
			ctx.closePath();
		};
		/** the value in lo..hi at which `f` reaches `want` (f grows with it) */
		const solve = (/** @type {(v: number) => number} */ f, /** @type {number} */ want, /** @type {number} */ lo, /** @type {number} */ hi) => {
			for (let k = 0; k < 30; k++) {
				const mid = (lo + hi) / 2;
				if (f(mid) < want) lo = mid;
				else hi = mid;
			}
			return (lo + hi) / 2;
		};
		// each aven's wedge, cut into its three plots as Samuel drew it (2026-10-10): F1 the tip, from the COOP out; beyond
		// it, the wedge's outer band split side by side into F2 and F3. Each plot its own size (its share, dealt with its
		// price), each coloured as the crop it grows; an unopened plot left bare
		const edge = (/** @type {number} */ ang) => edgeAlong(ang);
		const inner = () => C.r;
		/** @type {(() => void)[]} */
		const borders = [];
		world.avens.forEach((/** @type {any} */ a, /** @type {number} */ i) => {
			const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2,
				a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2;
			const share = a.plots?.length === 3 ? a.plots : [1, 1, 1];
			const sum = share.reduce((/** @type {number} */ m, /** @type {number} */ x) => m + x, 0);
			const whole = measure(region(a0, a1, inner, edge)).area;
			// where the tip ends: the share of the way out from the COOP to the edge that gives F1 its share of the land
			const cut = (/** @type {number} */ t) => (/** @type {number} */ ang) => C.r + (edge(ang) - C.r) * t;
			const t = solve((v) => measure(region(a0, a1, inner, cut(v))).area, (whole * share[0]) / sum, 0.05, 0.95);
			const band = measure(region(a0, a1, cut(t), edge)).area;
			// where the band splits: the angle that gives F2 its share of the band
			const split = solve((v) => measure(region(a0, v, cut(t), edge)).area, (band * share[1]) / (share[1] + share[2]), a0, a1);
			const plots = [region(a0, a1, inner, cut(t)), region(a0, split, cut(t), edge), region(split, a1, cut(t), edge)];
			plots.forEach((pts, k) => {
				const f = a.fields?.[k];
				path(pts);
				if (f) {
					ctx.fillStyle = a.alive ? GOOD_COLOUR[f.crop] : '#8a8a86';
					ctx.globalAlpha = 0.22 + 0.4 * fieldGrown(world, f) + 0.08 * (f.level - 1);
				} else {
					ctx.fillStyle = a.alive ? a.colour : '#808080';
					ctx.globalAlpha = 0.06;
				}
				ctx.fill();
				ctx.globalAlpha = 1;
				ctx.strokeStyle = light > 0.5 ? '#1f2a2333' : '#f4f1e833';
				ctx.lineWidth = 1;
				ctx.stroke();
				// what the plot is: its number, crop and level, last night's harvest. The tip's label sits near the COOP
				// (the home stands at the tip's outer edge); the band's out towards the valley's edge
				const mid = k === 0 ? (a0 + a1) / 2 : k === 1 ? (a0 + split) / 2 : (split + a1) / 2;
				const [lx, ly] = k === 0 ? at(mid, C.r + (edge(mid) - C.r) * t * 0.55) : at(mid, cut(t)(mid) + (edge(mid) - cut(t)(mid)) * 0.62);
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillStyle = ink;
				ctx.globalAlpha = f ? 0.85 : 0.4;
				ctx.font = '700 10px system-ui, sans-serif';
				ctx.fillText(f ? `F${k + 1} · ${GOOD_LABEL[f.crop]} L${f.level}` : `F${k + 1}`, lx, ly - 6);
				ctx.font = '600 9px system-ui, sans-serif';
				ctx.fillText(f ? (fieldGrown(world, f) < 1 ? `growing ${Math.round(fieldGrown(world, f) * 100)}%` : `${a.harvest?.[f.crop] ?? 0} last night`) : 'not opened', lx, ly + 6);
				ctx.globalAlpha = 1;
				ctx.textBaseline = 'alphabetic';
			});
			// the wedge's own border, in the aven's colour, drawn inside its land once every plot is down, so a neighbour's
			// border never covers it (Samuel, 2026-10-10)
			borders.push(() => {
				const land = region(a0, a1, inner, edge);
				ctx.save();
				path(land);
				ctx.clip();
				path(land);
				ctx.strokeStyle = a.alive ? `${a.colour}cc` : '#80808066';
				ctx.lineWidth = 6; // 3 inside the clip
				ctx.stroke();
				ctx.restore();
			});
		});
		borders.forEach((draw) => draw());
		// the Maia City Coop: its logo, nothing else (Samuel, 2026-10-10; its balance is on the board)
		if (coopLogo.complete && coopLogo.naturalWidth) ctx.drawImage(coopLogo, C.x - C.r, C.y - C.r, C.r * 2, C.r * 2);
		else {
			ctx.beginPath();
			ctx.arc(C.x, C.y, C.r, 0, Math.PI * 2);
			ctx.fillStyle = '#f1e6d4';
			ctx.fill();
		}
		// each home and its fields
		for (const a of world.avens) {
			const h = a.territory;
			// its home
			ctx.beginPath();
			ctx.arc(h.x, h.y, 32, 0, Math.PI * 2);
			ctx.fillStyle = light > 0.5 ? '#fbf8f0' : '#1f2a23';
			ctx.fill();
			ctx.strokeStyle = a.alive ? a.colour : '#8a8a86';
			ctx.lineWidth = 2;
			ctx.stroke();
			// its store, HEARTS and health are on the board (Samuel, 2026-10-10); its name is inside its dot
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
			if (rec && !paused && now - lastKeep > 20000) {
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
			return s.length ? `went short of ${s.map(([g, n]) => `${n} ${GOOD_LABEL[g]}`).join(', ')} · health ${e.health} of ${RULES.healthMax}` : `ate and drank in full · health ${e.health} of ${RULES.healthMax}`;
		}
		if (e.kind === 'price') return `${NAME[e.source] ?? 'Liquid'}: ${e.changes.length ? e.changes.map(changeText).join('; ') : 'kept every limit'}`;
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
			{#if inWorld && !outside}
				<b>Sandbox 7 · {here.name || 'A valley to try (not kept)'}</b>
				<span>Day {snap.day} · {snap.time} · month {snap.month}</span>
			{:else}
				<b>Sandbox 7</b>
				<span>{page === 'mips' ? 'Proposals' : 'Pick a world'}</span>
			{/if}
		</div>
		<!-- a world's own views; the welcome screen and the Proposals have none (Samuel, 2026-10-10): the nav pill's Back
		     leads out of a world, or out of the Proposals, to the welcome screen -->
		{#if inWorld && !outside}
			<nav class="views" aria-label="View">
				<button class:on={page === 'valley'} onclick={() => setView('valley')}>Valley</button>
				<button class:on={page === 'avens'} onclick={() => setView('avens')}>Avens</button>
				<button class:on={page === 'stats'} onclick={() => setView('stats')}>Stats</button>
				<button class:on={page === 'policy'} onclick={() => setView('policy')}>Policies</button>
				<button class:on={page === 'world'} onclick={() => setView('world')}>World</button>
			</nav>
		{/if}
		<div class="controls" hidden={!inWorld || outside}>
			<button onclick={toggle}>{paused ? (started ? '▶ Play' : '▶ Start') : '❚❚ Pause'}</button>
			<select bind:value={speed} aria-label="Speed">
				{#each SPEEDS as sp (sp.k)}<option value={sp.k}>{sp.label}</option>{/each}
			</select>
			<button class="panel-btn" hidden={page !== 'valley'} onclick={() => (panelOpen = !panelOpen)}>{panelOpen ? 'Hide books' : 'Books'}</button>
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
				<span><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]} <b>{short(snap.market[g].price)}</b> <small>avg {short(snap.market[g].avg)}</small></span>
			{/each}
		</div>
	</div>

	{#if page === 'home'}
		<div class="statspage worlds">
			<h2>Worlds</h2>
			<p class="sub">Pick a world to enter it: its valley, its views and its clock load with it, and the Back in the pill below brings you here again. Each world is a capsule: its settings, and every aven's HEARTS and brain in it, are its own. New worlds are proposed over the studio's MCP and appear here once accepted.</p>
			{#if !acct.play}
				<p class="sub">{acct.note || 'Sign in to see the worlds.'}</p>
				<div class="new"><button class="go" onclick={tryValley}>Try a valley here (not kept)</button></div>
			{/if}
			{#if worldNote}<p class="sub miss">{worldNote}</p>{/if}
			{#if acct.play}
				{@const kept = worlds.filter((w) => w.saved)}
				{@const old = worlds.filter((w) => !w.saved)}
				<div class="home">
					<div class="main">
						<div class="worldgrid">
							{#each kept as w (w.id)}
								<button class="worldtile" class:sel={w.id === here.id} onclick={() => (w.id === here.id ? setView('valley') : openWorld(w))}>
									<b>{w.name || 'A world'}</b>
									<span class="cfg">{w.summary?.config?.name ?? w.config_id ?? 'Defaults'}{w.config_version ? ` v${w.config_version}` : ''}</span>
									<span class="facts"><span><b>{w.days}</b> days</span><span><b>{w.alive ?? '—'}</b> alive</span></span>
									<span class="lead">{w.summary?.leader ? `Leader ${w.summary.leader}` : 'No leader yet'}</span>
									<span class="when">{w.id === here.id ? 'Open now' : `Kept ${new Date(w.saved).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</span>
								</button>
							{:else}
								<p class="sub none">No world yet: propose one over the studio's MCP, then accept it under Proposals.</p>
							{/each}
						</div>
						{#if old.length}
							<details class="old">
								<summary>{old.length} earlier {old.length === 1 ? 'world' : 'worlds'}, history only</summary>
								<p class="sub">They ran before worlds were kept whole, so they can't be entered: only their days are kept (economy_run on the MCP).</p>
								<div class="worldgrid">
									{#each old as w (w.id)}
										<div class="worldtile past">
											<b>{w.name || 'A world'}</b>
											<span class="cfg">{w.summary?.config?.name ?? w.config_id ?? 'Defaults'}{w.config_version ? ` v${w.config_version}` : ''}</span>
											<span class="facts"><span><b>{w.days}</b> days</span><span><b>{w.alive ?? '—'}</b> alive</span></span>
											<span class="lead">{w.summary?.leader ? `Leader ${w.summary.leader}` : ''}</span>
										</div>
									{/each}
								</div>
							</details>
						{/if}
					</div>
					<!-- the open proposals, each a click to its detail on the Proposals page, and the whole list behind "See all" -->
					<div class="open-mips">
						<div class="head">
							<h3>Open proposals</h3>
							<button class="link" onclick={() => openMip(null)}>See all</button>
						</div>
						{#each openMips as m (m.number)}
							<button class="omip" onclick={() => openMip(m.number)}>
								<b>MIP-{m.number} · {m.title}</b>
								<span>{worldOfMip(m)} · by {m.author_name ?? m.author ?? 'someone'} · {whenMip(m.created)}</span>
							</button>
						{:else}
							<p class="sub none">Nothing waits for a decision.</p>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
	{#if page === 'avens' && snap.avens}
		<div class="statspage">
			<AvensView data={snap.avens} aven={snap.aven} market={snap.market} names={NAME} trialDays={TRIAL_DAYS} onselect={select} {lineOf} admin={acct.admin} {mindNote} onforget={forgetAll} onforgetone={forgetOne} />
		</div>
	{/if}
	{#if page === 'stats'}
		<div class="statspage">
			<StatsView stats={snap.stats} series={snap.series} now={snap.t} avens={[...snap.board].sort((a, b) => a.id - b.id)} market={snap.market} />
		</div>
	{/if}
	{#if page === 'policy' || page === 'world'}
		<div class="statspage">
			{#key page}<RulesView view={page} />{/key}
		</div>
	{/if}
	{#if page === 'mips'}
		<div class="statspage">
			<ProposalsView {acct} {configs} {worlds} here={null} playing={null} focus={focusMip} onworld={madeWorld} onamend={amendedWorld} onreload={() => reloadConfigs().catch(() => {})} />
		</div>
	{/if}

	<aside>
		<section>
			<h3>Board</h3>
			{#if snap.coop && (fieldsOn() || snap.coop.hearts > 0)}
				<div class="coop" title="Paid to it: {Object.entries(snap.coop.from).map(([k, v]) => `${k === 'fields' ? 'opening fields' : k === 'levels' ? 'levelling up' : 'nightly keep'} ${fmt(v)}`).join(' · ') || 'nothing yet'}"><span class="coop-name"><b>Maia City Coop</b><span>the valley's ledger: every HEART paid for fields</span></span><span class="num">{fmt(snap.coop.hearts)} ♥</span></div>
			{/if}
			<ol class="board" class:stocked={snap.board.some((/** @type {any} */ r) => r.stock)}>
				{#each snap.board as row (row.id)}
					<li class:sel={row.id === selected} class:dead={!row.alive}>
						<button onclick={() => select(row.id)}>
							<i style:background={row.colour}></i>
							<b>{row.name}</b>
							<span class="grows">{#each row.grows as g (g)}<em style:background={GOOD_COLOUR[g]} title={GOOD_LABEL[g]}></em>{/each}</span>
							<span class="hp" title="health {row.alive ? `${row.health} of ${RULES.healthMax}` : '0'}"><i class:low={row.health / RULES.healthMax <= 0.3} style:width="{row.alive ? Math.max(0, Math.min(100, (row.health / RULES.healthMax) * 100)) : 0}%"></i></span>
							{#if row.stock}<span class="store" title="in store: {GOODS.map((g) => `${row.stock?.[g] ?? 0} ${GOOD_LABEL[g]}`).join(', ')}">{#each GOODS as g (g)}<em class:none={!(row.stock?.[g] > 0)} style:background={GOOD_COLOUR[g]}>{row.stock?.[g] ?? 0}</em>{/each}</span>{/if}
							<span class="num">{row.alive ? `${fmt(row.hearts)} ♥` : `died day ${row.diedOn} · back day ${row.diedOn + RULES.rebirthDays}`}</span>
						</button>
					</li>
				{/each}
			</ol>
			<p class="brain">Model <select class="brain-mode" bind:value={brain.mode} onchange={saveBrain} aria-label="Model">{#each Object.entries(BRAINS) as [k, label] (k)}<option value={k}>{label}</option>{/each}</select></p>
		</section>

		<nav class="tabs">
			<button class:on={tab === 'decisions'} onclick={() => (tab = 'decisions')}>Activity</button>
			<button class:on={tab === 'wants'} onclick={() => (tab = 'wants')}>Wants</button>
			<button class:on={tab === 'prices'} onclick={() => (tab = 'prices')}>Prices</button>
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
					{#each GOODS as g (g)}<tr><td><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]}</td><td class="num">{short(snap.market[g].price)}</td><td class="num">{short(snap.market[g].avg)}</td><td class="num">{snap.market[g].units}</td></tr>{/each}
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
			<h4>Activity</h4>
			<ActivityFeed entries={snap.decisions} names={NAME} onselect={select} />
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
		grid-template-columns: minmax(0, 1fr);
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
	.worlds > .home {
		max-width: 1280px;
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
	.worlds .old {
		margin-top: 18px;
		opacity: 0.75;
	}
	.worlds .old summary {
		cursor: pointer;
		font-size: 13px;
	}
	@media (max-width: 760px) {
		.worlds {
			padding: 12px 12px 96px;
		}
	}
	.views {
		display: flex;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
		background: #1f2a2314;
		border-radius: 10px;
		padding: 2px;
	}
	.views button {
		flex: none;
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
	.controls[hidden] {
		display: none;
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
	.entries .when {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
	}
	.entries .num {
		color: #b8483b;
	}

	/* phones upright: the valley on top, the books in a sheet of at most half the screen */
	@media (max-width: 760px) {
		.market,
		.market:not(.open) {
			grid-template-columns: minmax(0, 1fr);
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

	/* the welcome screen: the worlds as tiles, three in a row, and the open proposals in an aside on the right */
	.home {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 280px;
		gap: 18px;
		align-items: start;
		max-width: 1280px;
	}
	.open-mips {
		border: 1px solid rgb(38 56 44 / 0.16);
		border-radius: 14px;
		background: #fff;
		padding: 12px 14px 14px;
		position: sticky;
		top: 0;
	}
	.open-mips .head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 6px;
	}
	.open-mips h3 {
		margin: 0;
		font-size: 14px;
	}
	.open-mips .link {
		background: none;
		border: 0;
		padding: 0;
		color: #2f6b46;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		text-decoration: underline;
	}
	.open-mips .omip {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 8px 0;
		text-align: left;
		border: 0;
		border-top: 1px solid rgb(38 56 44 / 0.12);
		background: none;
		cursor: pointer;
		color: inherit;
	}
	.open-mips .omip:hover b {
		color: #2f6b46;
	}
	.open-mips .omip b {
		font-size: 13px;
		line-height: 1.3;
	}
	.open-mips .omip span {
		font-size: 12px;
		opacity: 0.65;
	}
	.open-mips .none {
		margin: 4px 0 0;
		font-size: 13px;
	}
	@media (max-width: 900px) {
		.home {
			grid-template-columns: minmax(0, 1fr);
		}
		.open-mips {
			position: static;
			order: -1;
		}
	}
	.worldgrid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}
	@media (max-width: 1100px) {
		.worldgrid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 560px) {
		.worldgrid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.worldtile {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		min-height: 132px;
		padding: 14px 16px;
		text-align: left;
		border: 1px solid rgb(38 56 44 / 0.16);
		border-radius: 14px;
		background: #fff;
		cursor: pointer;
	}
	.worldtile:hover {
		border-color: rgb(38 56 44 / 0.45);
	}
	.worldtile.sel {
		border-color: var(--ink, #263828);
		box-shadow: inset 0 0 0 1px var(--ink, #263828);
	}
	.worldtile.past {
		cursor: default;
		opacity: 0.6;
		background: transparent;
	}
	.worldtile > b {
		font-size: 1.05em;
	}
	.worldtile .cfg,
	.worldtile .lead,
	.worldtile .when {
		font-size: 0.85em;
		opacity: 0.7;
	}
	.worldtile .facts {
		display: flex;
		gap: 14px;
	}
	.worldtile .when {
		margin-top: auto;
	}
	.worldgrid .none {
		grid-column: 1 / -1;
	}
	/* each aven's health on the board: a small bar beside its HEARTS */
	.board .hp {
		display: inline-block;
		width: 44px;
		height: 6px;
		border-radius: 999px;
		background: #1f2a231a;
		overflow: hidden;
		justify-self: end;
	}
	.board .hp i {
		display: block;
		height: 100%;
		background: #3f9b62;
		border-radius: 999px;
	}
	.board .hp i.low {
		background: #d0533f;
	}
	/* the Maia City Coop, on top of the board */
	.coop {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0 0 0.6rem;
		padding: 0.4rem 0.35rem;
		border-radius: 8px;
		border: 1.5px dotted #24452f88;
	}
	.coop-name {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}
	.coop-name b {
		font-size: 0.85rem;
	}
	.coop-name span {
		font-size: 0.68rem;
		opacity: 0.75;
	}
	.coop .num {
		margin-left: auto;
	}
	.board.stocked button {
		grid-template-columns: 14px 3.2rem auto 1fr auto 4.6rem;
	}
	/* each aven's store on the board, between its health and its HEARTS */
	.board .store {
		display: flex;
		gap: 2px;
	}
	.board .store em {
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 2px;
		border-radius: 999px;
		color: #fff;
		font-style: normal;
		font-size: 0.6rem;
		font-weight: 700;
		line-height: 1.15rem;
		text-align: center;
		box-sizing: border-box;
	}
	.board .store em.none {
		opacity: 0.3;
	}
</style>
