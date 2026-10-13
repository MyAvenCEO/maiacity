<!--
	MaiaCity V1: the one shared game, as both players see it, as a game screen like Sandbox 1 and Sandbox 5 — the hex in
	3D under everything ($lib/maiacity-v1/world.js: the tent and the two players, nothing else), the COOPs and what
	they own (the MaiaCity COOP the hex and the AMM pool) as a list in a card, the numbers in pills across the top, the tools down the left, and
	a card on the right for whatever is open (a sheet from the foot on a phone, an aside down the right on its side).
	The server holds the game (api/src/maiacity-v1.js); the page reads it every few seconds and, in between, runs the
	same rules (game/maiacity-v1/engine.js) forward to the second, so the clock, the melt and the HEARTS growing count
	live. Every move goes to the server. Every decision is a MIP that needs both players' signatures.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { VILLAGE_INFO } from '$lib/models/village.js';
	import { WAYSIDE_INFO } from '$lib/models/wayside.js';
	import { RENTED, COOPS, DAY_MS, act, MINDS, PAYEES, PAYERS, SEATS, SETTING_LIMITS, SETTING_NAMES, TOKEN_COLOUR, TOKEN_LABEL, advance, calendar, dateOf, dateText, describe, heartsValue, inHearts, mintState, nameOf, invariant, nextPayDay, price, quote, signaturesOf, supply, timeOfMonth, weights } from '../../../game/maiacity-v1/engine.js';
	import { loadGame, resetGame, sendMove, takeSeat } from './store.js';
	import { createWorld } from './world.js';
	import LedgerView from './LedgerView.svelte';
	import { AT_HOME, lineDur, story } from './tour.js';
	import Frame from '$lib/genui/Frame.svelte';
	import { REPLACES, SLOT_NAMES, slotsOf, viewsOf } from '../../../game/maiacity-v1/views.js';
	import { rents } from '../../../game/maiacity-v1/engine.js';

	let game = $state.raw(null);
	let me = $state('');
	let admin = $state(false);
	let skew = 0; // server time minus this browser's
	let tick = $state(Date.now());
	let error = $state('');
	let busy = $state(false);
	let seat = $state('A');
	// what the card shows; a phone opens on the world, the card closed
	let panel = $state(typeof matchMedia !== 'undefined' && matchMedia('(max-width: 720px), (max-height: 500px)').matches ? null : 'you');
	let tools = $state(false); // the phone's tools, behind the action button
	let amount = $state(12);
	let swapToken = $state('MAIA');
	let swapTo = $state('TRIBE');
	let swapAmount = $state(1);
	let ledgerOfWho = $state('');
	let draft = $state(null);
	let labels = $state({});
	let canvas;
	let world;

	const now = $derived(tick + skew);
	const view = $derived(game ? advance(game, now) : null);
	const player = $derived(view?.players[seat]);
	const mine = $derived(player?.founder === me);
	const canMove = $derived(!!player && mine);
	const mySeat = $derived(view ? SEATS.find((s) => view.players[s].founder === me) : null);
	const cal = $derived(view ? calendar(view, now) : null);
	const hour = $derived(cal ? cal.hour : 11);
	const mint = $derived(view ? mintState(view, seat, now) : null);
	const who = $derived(ledgerOfWho || `player:${seat}`);
	const total = $derived(view ? supply(view) : null);
	const swapOut = $derived(view ? quote(view, swapToken, swapTo, Number(swapAmount) || 0) : 0);
	const nextMonth = $derived(view ? nextPayDay(view) : 0);
	// how fast the game runs and how far minting reaches, in words (both are settings a MIP may change)
	const hrs = (h) => (h === 24 ? 'a real day' : h % 24 === 0 ? `${h / 24} real days` : `${h} real hours`);
	const speed = $derived(view ? `a month ${view.settings.hoursPerMonth === 24 ? 'a real day' : `every ${hrs(view.settings.hoursPerMonth)}`}` : '');
	const reach = $derived(view ? hrs(view.settings.mintWindowHours) : '');
	const mips = $derived(view?.mips ?? []);
	const openMips = $derived(mips.filter((m) => m.status === 'open'));
	const decidedMips = $derived(mips.filter((m) => m.status !== 'open').reverse());

	$effect(() => world?.update(view, hour));
	// the land still to unlock shows its rims as the welcome story reaches it (all of it once the story is done or skipped)
	$effect(() => void (view && world?.reveal(tour ? Math.max(0, ...steps.slice(0, tourAt + 1).map((x) => x.reveal ?? 0)) : 2)));
	// where the story stands in the world: the pickup, the powercube and the players, and what the camera looks at
	// once a second player is in, the BatteryCube and the solar panel stand at home beside the tent
	const where = $derived(tour ?? { ...AT_HOME, battery: view?.players.B.founder ? 'home' : 'store' });
	const otherSeat = $derived(seat === 'A' ? 'B' : 'A');
	$effect(() => {
		if (!view || !world) return;
		const other = view.players[otherSeat]?.founder ? otherSeat : null;
		world.set({ at: where.at, cube: where.cube, tent: where.tent ?? 'up', battery: where.battery ?? 'store', me: seat, other, rides: !!tour && seat === 'B' && where.at === 'village' });
		world.touring(!!tour);
		if (where.place) world.focus(where.place);
	});
	// the arrival plays by itself the first time; its caption shows over it, with a way to skip
	let playing = $state(''); // the moment the world plays: 'intro', 'drive', 'load'
	let caption = $state(null); // the line the arrival's shot carries: { title, sub, big, dur }
	// the whole story plays as a film (Samuel 2026-10-13): every step is a shot with its words as a voice-over line by
	// line, the drives, the loading and the pitching play by themselves; only a move the player makes (mint, invest)
	// waits, and then only a small prompt with its button shows, after its words were told
	let told = $state({}); // the moves whose words were already told this visit
	let cut = 0; // bumped by Skip: the voice-over of the shot playing stops at once
	const toldFor = (lines) => lines.reduce((a, l) => a + lineDur(l), 0);
	/** the voice-over: the step's words as subtitles, one line after another; resolves when the last has been shown */
	async function narrate(lines) {
		const mine = cut;
		for (const line of lines) {
			if (cut !== mine) break;
			const dur = lineDur(line);
			caption = { title: line, dur };
			await new Promise((r) => setTimeout(r, dur * 1000));
		}
		if (cut === mine) caption = null;
	}
	function skipShot() {
		cut++;
		caption = null;
		world?.skip();
	}
	$effect(() => {
		if (!tour || !world || playing) return;
		const step = tour;
		if (step.kind === 'intro') {
			playing = 'intro';
			world.intro(step.part).then(() => ((playing = ''), mark(step.id)));
		} else if (step.kind === 'drive' || step.kind === 'load' || step.kind === 'build') {
			playing = step.kind;
			// the moment cuts a shot a line and carries the voice-over itself, so each action lands on its words
			const lines = step.lines;
			const moment = step.kind === 'load' ? world.load({ lines, what: step.what }) : step.kind === 'build' ? world.pitch({ lines, what: step.what }) : world.drive(step.leg, { fetch: !!step.fetch, lines });
			moment.then(() => ((playing = ''), mark(step.id)));
		} else if ((step.kind === 'invest' || step.kind === 'mint') && !told[step.id]) {
			playing = 'scene';
			Promise.all([world.scene(step.place, toldFor(step.lines), step), narrate(step.lines)]).then(() => ((playing = ''), (told = { ...told, [step.id]: true })));
		} else if (step.kind === 'next' || step.kind === 'done') {
			playing = 'scene';
			Promise.all([world.scene(step.place, toldFor(step.lines), step), narrate(step.lines)]).then(() => ((playing = ''), mark(step.id)));
		}
	});

	function take(res) {
		game = res.game;
		if (res.me) me = res.me;
		if (res.admin != null) admin = res.admin;
		if (res.now) skew = res.now - Date.now();
		tick = Date.now();
	}

	async function refresh() {
		if (demo) return; // a demo plays on its own copy of the game
		try {
			take(await loadGame());
			error = '';
		} catch (e) {
			error = e?.message ?? String(e);
		}
	}

	async function run(fn) {
		if (busy) return false;
		busy = true;
		error = '';
		try {
			take(await fn());
			return true;
		} catch (e) {
			error = e?.message ?? String(e);
			return false;
		} finally {
			busy = false;
		}
	}

	const doMove = (action) => (demo ? demoMove(action) : run(() => sendMove(seat, action)));

	// a test run of the second player's journey while that seat is free (Samuel 2026-10-13): the story plays for seat B
	// on a copy of the game in this browser, its moves made here and never sent; ending it brings the real game back
	let demo = $state(false);
	let realGame = null;
	function startDemo() {
		realGame = game;
		const g = structuredClone(game);
		g.players.B.founder = me;
		g.players.B.name = 'Player B';
		game = g;
		seen = { ...seen, B: {} };
		told = {};
		seat = 'B';
		panel = null;
		demo = true;
	}
	function demoMove(action) {
		try {
			game = act(game, seat, action, now);
			error = '';
		} catch (e) {
			error = e?.message ?? String(e);
		}
	}
	function endDemo() {
		skipShot();
		demo = false;
		game = realGame;
		try { seen = { ...seen, B: JSON.parse(localStorage.getItem(storyKey('B')) ?? '{}') }; } catch {}
		seat = mySeat ?? 'A';
		refresh();
	}

	onMount(() => {
		world = createWorld(canvas, {
			onPick: (name) => {
				// a Village COOP machine opens its own card
				if (name?.startsWith('asset:')) return void (panel = name);
				if (!name?.startsWith('player:')) return;
				seat = name.slice(7);
				open('you');
			},
			onLabels: (l) => (labels = l),
			onCaption: (c) => (caption = c)
		});
		refresh().then(async () => {
			// claim a seat (or keep mine) and bring its name up to the profile's: the Mac app reads the game with its app key,
			// which the server never seats on a read, so the page asks for the seat itself
			if (me && game && (mySeat || SEATS.some((s) => !game.players[s].founder))) {
				try {
					take(await takeSeat(mySeat ?? 'A'));
				} catch {}
			}
			if (mySeat) seat = mySeat;
		});
		const t = setInterval(() => (tick = Date.now()), 1000);
		const r = setInterval(refresh, 10000);
		return () => (clearInterval(t), clearInterval(r), world.dispose());
	});

	function open(name) {
		panel = panel === name ? null : name;
		tools = false;
		if (name === 'ledger') ledgerOfWho = '';
	}

	function newMip(payout) {
		draft = { title: payout ? `Payout from the ${nameOf(view, payout.from)}` : '', description: '', settings: { ...view.settings }, coops: Object.fromEntries(Object.values(view.coops).map((c) => [c.id, { name: c.name, assets: c.assets.map((x) => `${x.name} | ${x.kind}`).join('\n') }])), payouts: payout ? [payout] : [] };
		panel = 'mips';
	}

	async function propose() {
		const settings = Object.fromEntries(Object.entries(draft.settings).filter(([k, v]) => Number(v) !== view.settings[k]));
		const payouts = draft.payouts.filter((x) => Number(x.amount) > 0);
		// a COOP's assets are written one a line, "name | kind"; only what differs goes into the MIP
		const coops = {};
		for (const [id, c] of Object.entries(draft.coops)) {
			const now = view.coops[id];
			const assets = c.assets.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
				const [name, ...kind] = l.split('|');
				const known = now.assets.find((x) => x.name === name.trim());
				return { id: known?.id ?? '', name: name.trim(), kind: kind.join('|').trim() };
			});
			const change = {};
			if (c.name.trim() !== now.name) change.name = c.name.trim();
			if (JSON.stringify(assets.map((x) => [x.name, x.kind])) !== JSON.stringify(now.assets.map((x) => [x.name, x.kind]))) change.assets = assets;
			if (Object.keys(change).length) coops[id] = change;
		}
		if (await doMove({ type: 'propose', mip: { title: draft.title, description: draft.description, settings, coops, payouts } })) draft = null;
	}

	const f = (n, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
	const dur = (ms) => {
		if (!Number.isFinite(ms)) return '—';
		const s = Math.max(0, Math.round(ms / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
	};
	const pad = (n) => String(n).padStart(2, '0');
	const vdate = (vm) => dateText(dateOf(vm));
	const holdersList = $derived(view ? [...SEATS.map((s) => [`player:${s}`, view.players[s].name]), ...Object.keys(COOPS).map((id) => [`coop:${id}`, view.coops[id].name]), ['pool', 'AMM pool (MaiaCity COOP)']] : []);
	const TOOLS = [
		['you', '◉', 'You'],
		['mint', '♥', 'Mint'],
		['invest', '↗', 'Invest'],
		['swap', '⇄', 'Swap'],
		['coops', '◇', 'COOPs'],
		['mips', '✎', 'Proposals'],
		['ledger', '≡', 'Ledger'],
		['rules', '⚙', 'Rules']
	];
	// the game's screens (game/maiacity-v1/views.js): view cards a MIP brings, each a tool of its own, run sandboxed
	const screens = $derived(view ? viewsOf(view).filter((v) => (v.data?.slot ?? 'panel') === 'panel') : []);
	// a screen a MIP stood in one of the page's panels (views.js SLOTS): it replaces a panel that only shows and stands
	// over the moves of the others; `builtIn` brings the page's own panel back, for this visit
	const slotted = $derived(view ? slotsOf(view) : {});
	const slotCard = $derived(panel && !isViewPanel(panel) ? slotted[panel] : null);
	let builtIn = $state({});
	const allTools = $derived([...TOOLS, ...screens.map((v) => [`view:${v.id}`, '▦', v.name])]);
	const isViewPanel = (x) => typeof x === 'string' && x.startsWith('view:');
	// what a screen is handed: the game as it stands (never a seat's secrets: there are none in the state)
	const screenData = $derived(
		view
			? {
					date: dateText(cal),
					month: view.month,
					seat,
					minds: MINDS.map((t) => ({ id: t, label: TOKEN_LABEL[t], colour: TOKEN_COLOUR[t] })),
					hearts: heartsValue(view),
					players: SEATS.map((k) => ({ seat: k, name: view.players[k].name, wallet: { ...view.players[k].wallet }, worth: inHearts(view, view.players[k].wallet), arrears: view.players[k].arrears ?? 0 })),
					coops: Object.values(view.coops).map((c) => ({ id: c.id, name: c.name, mind: c.mind, treasury: { ...c.treasury }, worth: inHearts(view, c.treasury), assets: c.assets.map((a) => ({ ...a })) })),
					pool: { ...view.pool },
					poolWorth: inHearts(view, view.pool),
					settings: { ...view.settings },
					rents: rents(view),
					names: Object.fromEntries(holdersList),
					ledger: view.ledger.slice(-80).reverse().map((e) => ({ ...e }))
				}
			: null
	);
	// a view card as the sandboxed frame takes it: the same object while its code is (the game is copied every second,
	// its cards with it), so its frame never reloads until a MIP changes it
	const frames = new Map();
	const frameOf = (c) => {
		const k = `${c.id}\n${c.code}`;
		if (!frames.has(k)) frames.set(k, { id: c.id, title: c.name, kind: 'html', spec: { html: c.code, libs: c.data?.libs ?? [], height: c.data?.height ?? 400, data: {} } });
		return frames.get(k);
	};
	let preview = $state(''); // a proposal's screen being looked at before signing: `${number}:${id}`
	const isCoopPanel = (x) => typeof x === 'string' && x.startsWith('coop:');
	const isAssetPanel = (x) => typeof x === 'string' && x.startsWith('asset:');
	/** the COOP that owns an asset now (MIPs can move assets), and the asset as it lists it */
	/** the rent the Tribe COOP pays for an asset, if it rents it */
	const rentOf = (id) => RENTED.find((r) => r.asset === id);
	/** the first-run story ($lib/maiacity-v1/tour.js): one idea a step, for each player at their own seat. The steps
	 *  that only tell remember "Next" in this browser; the moves (mint, invest) are read off the game. */
	let seen = $state({});
	let seenOf = $state(0); // the game start the remembered steps were read for: no story before they are
	const steps = $derived(view && player && mine ? story(view, seat, seen[seat] ?? {}) : []);
	const tourAt = $derived(steps.findIndex((x) => !x.done));
	const tour = $derived(tourAt >= 0 && seenOf && seenOf === started && !seen[seat]?.off ? { ...steps[tourAt], n: tourAt + 1, steps: steps.length } : null);
	// each milestone of the story unlocks the controls and views it talks about (Samuel 2026-10-13): nothing but the
	// world in the trailer, then the HEARTS and the clock, the mint, the COOPs and their MINDs, invest, swap, and at
	// pay day the player's own page and the ledger; the rest comes with the last steps. Without a story, all of it.
	const UNLOCKS = { welcome: ['brand'], hearts: ['hearts', 'clock'], mint: ['mint'], coops: ['coops', 'minds'], maia: ['invest'], pool: ['swap'], payday: ['you', 'ledger', 'seats'], melt: ['mips', 'rules'], done: ['all'] };
	const unlocked = $derived.by(() => {
		if (!tour) return null;
		const on = new Set();
		for (const x of steps.slice(0, tourAt + 1)) for (const u of UNLOCKS[x.id] ?? []) on.add(u);
		return on;
	});
	const shows = (what) => !unlocked || unlocked.has('all') || unlocked.has(what) || (what.startsWith('view:') && unlocked.has('mips'));
	const mark = (id) => {
		seen = { ...seen, [seat]: { ...(seen[seat] ?? {}), [id]: true } };
		if (!demo) try { localStorage.setItem(storyKey(seat), JSON.stringify(seen[seat])); } catch {}
		if (id === 'payday') panel = 'you';
	};
	// remembered per game: a fresh game (a reset) starts every story from its first step again
	const started = $derived(game?.started ?? 0);
	const storyKey = (s) => `v1-story-${started}-${s}`;
	$effect(() => {
		if (!started) return;
		try { seen = Object.fromEntries(SEATS.map((s) => [s, JSON.parse(localStorage.getItem(storyKey(s)) ?? '{}')])); } catch {}
		seenOf = started;
	});
	const ownerOf = (id) => (view ? Object.keys(COOPS).map((k) => [k, view.coops[k]]).find(([, c]) => c.assets.some((a) => a.id === id)) : null);
</script>

<div class="v1" class:cinema={!!playing}>
	<canvas class="stage" bind:this={canvas}></canvas>
	{#if demo}<div class="demo panel" role="status">Test run · {view?.players.B.name}’s journey, nothing is saved <button class="link" onclick={endDemo}>End</button></div>{/if}

	{#if view}
		<!-- the players' names over them in the world: tap one to see them -->
		{#each Object.entries(labels) as [k, l] (k)}
			{#if l.on}
				<button class="tag" class:me={k === `player:${seat}`} style="left:{l.x}px;top:{l.y}px" onclick={() => ((seat = k.slice(7)), open('you'))}>
					{view.players[k.slice(7)].name}
					<small>♥ {f(view.players[k.slice(7)].wallet.HEARTS, 1)}</small>
				</button>
			{/if}
		{/each}
	{/if}

	{#if !view || shows('brand')}<div class="brand panel">MaiaCity <b>V1</b></div>{/if}

	{#if view && player}
		<div class="topstats">
			{#if shows('hearts')}<span class="stat panel" title="HEARTS held, and ready to mint"><span class="heart">♥</span> <b>{f(player.wallet.HEARTS, 1)}</b>{#if mint.amount > 0.05}<em>+{f(mint.amount, 1)}</em>{/if}</span>{/if}
			{#if shows('minds')}{#each MINDS as t (t)}<span class="stat panel" title={TOKEN_LABEL[t]}><i style="background:{TOKEN_COLOUR[t]}"></i> <b>{f(player.wallet[t], 1)}</b></span>{/each}{/if}
			{#if shows('clock')}<span class="clock m panel" title="The game clock: {cal.weekday} {cal.day} {cal.name}, year {cal.year} ({dateText(cal)}). {speed}, 13 months of 28 days.">{cal.weekday} {cal.day} {cal.name} Y{cal.year} · {pad(Math.floor(hour))}:{pad(Math.floor((hour % 1) * 60))}</span>{/if}
		</div>

		<div class="topright">
			{#if shows('seats')}<div class="seg panel">
				{#each SEATS as s (s)}
					{#if !view.players[s].founder && mySeat && !demo}
						<button title="Test run this seat's journey in this browser, as long as no one has taken it" onclick={startDemo}>{view.players[s].name} · try</button>
					{:else}
						<button class:on={seat === s} onclick={() => ((seat = s), (ledgerOfWho = ''))}>{view.players[s].name}{view.players[s].founder === me ? ' · you' : ''}</button>
					{/if}
				{/each}
			</div>{/if}
			{#if shows('clock')}<span class="clock panel" title="The game clock: {speed}, 13 months of 28 days"><small>{dateText(cal)}</small> {cal.weekday} {cal.day} {cal.name} · Y{cal.year} · {pad(Math.floor(hour))}:{pad(Math.floor((hour % 1) * 60))}</span>{/if}
		</div>

		{#if shows('mint')}<nav class="tools" class:open={tools}>
			{#each allTools.filter(([id]) => shows(id)) as [id, ic, label] (id)}
				<button class:on={panel === id} class:hint={tour?.hint === id} onclick={() => open(id)}><span class="ic">{ic}</span>{label}{#if id === 'mips' && openMips.length}<span class="badge">{openMips.length}</span>{/if}</button>
			{/each}
			{#if shows('you')}<p class="speednote">{speed} · pay day in {dur(nextMonth - now)}</p>{/if}
		</nav>{/if}
		{#if canMove && shows('mint')}
			<!-- the universal mint button: always at hand, over the nav pill -->
			<button class="mintbar" class:hint={tour?.hint === 'mintbar'} disabled={busy || mint.amount < 0.001} title={mint.lost > 0.001 ? `${f(mint.lost)} HEARTS grew more than a game month ago and are lost` : 'Mint all that grew since your last mint'} onclick={() => doMove({ type: 'mint' })}>
				<span class="heart">❤︎</span> Mint <b>{f(mint.amount)}</b>{#if mint.starter}<small>incl. starter pack</small>{/if}
			</button>
		{/if}
		{#if playing}
			<!-- the arrival, as a trailer: black bars, one line of the story a shot, fading in and out -->
			<div class="bars top" aria-hidden="true"></div><div class="bars bottom" aria-hidden="true"></div>
			<div class="fade-in" aria-hidden="true"></div>
			{#if caption}
				{#key caption.title}
					<div class="title" class:big={caption.big} style="--dur:{caption.dur ?? 5}s" role="status">
						<p>{caption.title}</p>
						{#if caption.sub}<small>{caption.sub}</small>{/if}
					</div>
				{/key}
			{/if}
			<button class="skip link" onclick={skipShot}>Skip</button>
			<button class="skip link all" onclick={() => (mark('off'), skipShot())}>Skip the story</button>
		{:else if tour && (tour.kind === 'invest' || tour.kind === 'mint')}
			<!-- the story's only stops: a move the player makes, its words already told as the film's voice-over, so only
			     its title and its button show (Samuel 2026-10-13: as little modal text as possible) -->
			<div class="tour panel prompt" class:down={tour.hint === 'mintbar'} role="dialog" aria-label={tour.title}>
				<b>{tour.title}</b>
				{#if tour.kind === 'invest'}
					<div class="goal"><span style="width:{Math.min(100, (tour.have / tour.goal) * 100)}%"></span></div>
					<p class="small">{f(tour.have, 0)} of {f(tour.goal, 0)} ❤︎ · you hold {f(player.wallet.HEARTS, 0)} ❤︎</p>
				{/if}
				<div class="buttons">
					<button class="link" onclick={() => mark('off')}>Skip the story</button>
					<span class="grow"></span>
					{#if tour.kind === 'invest'}
						{@const left = Math.min(Math.ceil(tour.goal - tour.have), Math.floor(player.wallet.HEARTS))}
						<button class="primary" disabled={busy || left < 1} onclick={() => doMove({ type: 'invest', coop: tour.coop, amount: left })}>Invest {f(left, 0)} ❤︎</button>
					{:else}
						<button class="primary" disabled={busy || mint.amount < 0.001} onclick={() => doMove({ type: 'mint' })}>Mint {f(mint.amount, 0)} ❤︎</button>
					{/if}
				</div>
			</div>
		{/if}
		{#if shows('mint')}<button class="fab" class:on={tools} aria-label="Tools" onclick={() => (tools = !tools)}>
			<svg viewBox="0 0 24 24"><path d={tools ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
		</button>{/if}

		{#if panel && shows(panel)}
		<aside class="card panel" class:wide={panel === 'ledger' || panel === 'mips' || isViewPanel(panel)}>
			<button class="close" aria-label="Close" onclick={() => (panel = null)}>×</button>

			{#if slotCard && !builtIn[panel]}
				<p class="eyebrow">A screen · an MCP App</p>
				{#if REPLACES.includes(panel)}<h2>{slotCard.name}</h2>{/if}
				{#key slotCard.id}<Frame view={frameOf(slotCard)} data={screenData} />{/key}
				<p class="small">A MIP stood the screen “{slotCard.name}” in {SLOT_NAMES[panel]}; it only shows, every move stays a button. <button class="link" onclick={() => (builtIn = { ...builtIn, [panel]: true })}>Show the built-in screen</button></p>
			{:else if slotCard}
				<p class="small"><button class="link" onclick={() => (builtIn = { ...builtIn, [panel]: false })}>Show the screen “{slotCard.name}”</button></p>
			{/if}
			{#if slotCard && !builtIn[panel] && REPLACES.includes(panel)}
				<!-- the screen above takes this panel's place -->
			{:else if panel === 'you'}
				<p class="eyebrow">{mine ? 'You' : player.founder ? 'The other player' : 'A free seat'}</p>
				<h2>{player.name}</h2>
				{#if !player.founder}
					<p class="about">This seat is waiting: the next person to sign in becomes {player.name}.</p>
					{#if mySeat}<button class="primary" onclick={startDemo}>Test run {player.name}’s journey</button>{/if}
				{:else if !mySeat}
					<p class="about">Both seats are taken, so you are watching this game.</p>
				{/if}
				{@const hv = heartsValue(view)}
				<p class="worth">{f(inHearts(view, player.wallet, hv))} <span>❤︎ in all</span></p>
				<ul class="hold">
					<li><span>{player.name.charAt(0).toLowerCase() + player.name.slice(1).replace(/\s+/g, '')}HEARTS{#if mint.amount > 0.005}<small>+{f(mint.amount)} ❤︎ ready to mint</small>{/if}</span><strong>{f(player.wallet.HEARTS)} ❤︎</strong></li>
					{#each MINDS as t (t)}<li><span>{TOKEN_LABEL[t]}<small>{total?.[t] ? `${f((player.wallet[t] / total[t]) * 100, 1)} % of all` : '—'}</small></span><strong>{f(player.wallet[t] * hv[t])} ❤︎<small>{f(player.wallet[t])} {TOKEN_LABEL[t]}</small></strong></li>{/each}
				</ul>
				<LedgerView {view} who={`player:${seat}`} show="cash" />
				{#if player.arrears > 0.001}<p class="bad small">{f(player.arrears)} tribeMIND tent rent owed</p>{/if}
				{#if canMove}
					<div class="buttons">
						<button class="primary" onclick={() => open('invest')}>Invest</button>
						<button onclick={() => open('ledger')}>Ledger</button>
					</div>
				{/if}
			{:else if panel === 'mint'}
				<p class="eyebrow">Your HEARTS</p>
				<h2>Mint</h2>
				<p class="about">Your first mint brings a starter pack of {f(view.settings.starterPack ?? 8736, 0)} HEARTS. After that your HEARTS grow {f(view.settings.heartsPerDay, 0)} a game day, {view.settings.heartsPerDay === 24 ? 'one every game hour' : `one every ${f(24 / view.settings.heartsPerDay, 1)} game hours`}, on the game clock ({f(view.settings.heartsPerDay * 28 * 24 / view.settings.hoursPerMonth, 0)} a real day). Mint whenever you like: you get all that grew since your last mint. The right to mint reaches back {reach} only, so check in at least that often: growth older than that is lost. HEARTS you hold stay.</p>
				<div class="wares">
					<div><span>Ready to mint</span><b>{f(mint.amount)}</b></div>
					{#if mint.starter}<div><span>Starter pack</span><b>{f(mint.starter)}</b></div>{/if}
					<div><span>Last mint</span><b class="small">{player.lastMint ? `${dur(now - player.lastMint)} ago` : 'never'}</b></div>
				</div>
				{#if mint.lost > 0.001}<p class="bad small">{f(mint.lost)} HEARTS grew more than {reach} ago and are lost.</p>{:else if mint.full > now}<p class="small">The mint window is full in {dur(mint.full - now)}: mint before then so none are lost.</p>{/if}
				{#if canMove}<div class="buttons"><button class="primary" disabled={busy || mint.amount < 0.001} onclick={() => doMove({ type: 'mint' })}>Mint {f(mint.amount)} HEARTS</button></div>{/if}
			{:else if panel === 'invest'}
				<p class="eyebrow">{f(player.wallet.HEARTS)} HEARTS held</p>
				<h2>Invest HEARTS</h2>
				<p class="about">Each HEART makes 1 MIND of the COOP: {f(50, 0)} % yours, {f(50 - view.settings.poolShare * 100, 0)} % its treasury, {f(view.settings.poolShare * 100, 0)} % into the city pool.</p>
				{#if canMove}
					<div class="row">
						<input type="number" min="0" step="1" bind:value={amount} />
						<button onclick={() => (amount = Math.floor(player.wallet.HEARTS * 1e6) / 1e6)}>All</button>
					</div>
					<div class="buttons col">
						{#each Object.keys(COOPS) as id (id)}
							<button class="primary" disabled={busy || !(player.wallet.HEARTS > 0)} onclick={() => doMove({ type: 'invest', coop: id, amount })}>Into the {view.coops[id].name}</button>
						{/each}
					</div>
				{/if}
			{:else if panel === 'swap'}
				<p class="eyebrow">The MaiaCity COOP’s AMM pool</p>
				<h2>Swap</h2>
				<p class="about">A Balancer weighted pool of the MaiaCity COOP: one basket of all three MINDs, weights {MINDS.map((t) => `${f(weights(view)[t] * 100, 0)} %`).join(' / ')}. Any MIND swaps for any other. A {f(view.settings.swapFee * 100, 1)} % fee stays in the pool.</p>
				{#if canMove}
					<div class="row">
						<input type="number" min="0" step="0.1" bind:value={swapAmount} />
						<select bind:value={swapToken}>{#each MINDS as t (t)}<option value={t}>{TOKEN_LABEL[t]}</option>{/each}</select>
					</div>
					<div class="row"><span class="arrow">→</span><select bind:value={swapTo}>{#each MINDS.filter((t) => t !== swapToken) as t (t)}<option value={t}>{TOKEN_LABEL[t]}</option>{/each}</select></div>
					<div class="buttons"><button class="primary" disabled={busy || !(swapOut > 0)} onclick={() => doMove({ type: 'swap', token: swapToken, to: swapTo, amount: swapAmount })}>Swap for {f(swapOut, 3)} {TOKEN_LABEL[swapTo]}</button></div>
				{/if}
				<dl>
					{#each MINDS as t (t)}<dt>Pool {TOKEN_LABEL[t]}</dt><dd>{f(view.pool[t], 3)}</dd>{/each}
					{#each MINDS.filter((t) => t !== 'MAIA') as t (t)}<dt>1 {TOKEN_LABEL[t]}</dt><dd>{price(view, t) == null ? 'needs both sides' : `${f(price(view, t), 4)} maiaMIND`}</dd>{/each}
				</dl>
			{:else if panel === 'coops'}
				<p class="eyebrow">Who owns what</p>
				<h2>COOPs</h2>
				<p class="about">Invest your HEARTS into a COOP to own a share of it: its MIND.</p>
				{#each Object.keys(COOPS) as id (id)}
					{@const c = view.coops[id]}
					<button class="coop" onclick={() => (panel = `coop:${id}`)}>
						<span class="coop-head"><b>{c.name}</b><span class="mind"><i style="background:{TOKEN_COLOUR[c.mind]}"></i>{TOKEN_LABEL[c.mind]}</span></span>
						<span class="assets">{#each c.assets as a (a.id)}<span class="asset">{a.name}</span>{/each}</span>
						<span class="treasury">Treasury {MINDS.filter((t) => t === c.mind || c.treasury[t] > 0.005).map((t) => `${f(c.treasury[t], 1)} ${TOKEN_LABEL[t]}`).join(' · ')}</span>
					</button>
				{/each}
			{:else if isAssetPanel(panel)}
				{@const id = panel.slice(6)}
				{@const owner = ownerOf(id)}
				{@const a = owner?.[1].assets.find((x) => x.id === id)}
				{@const info = VILLAGE_INFO[id] ?? WAYSIDE_INFO[id] ?? (id === 'tent' ? { name: 'The tent, packed', note: 'the Tribe COOP’s 2-person dome tent, rolled in its canvas with its poles, waiting to be pitched' } : id === 'fuel' ? { name: 'Two jerrycans of petrol', note: '2 × 20 litres for the ElectroCube’s petrol engine: about a day of light loads, a few hours at full power' } : null)}
				<p class="eyebrow">Asset · {a?.kind ?? (WAYSIDE_INFO[id] ? 'Wayside' : 'Machine')}</p>
				<h2>{a?.name ?? info?.name ?? info?.model}</h2>
				{#if info}<p class="about">{info.note[0].toUpperCase() + info.note.slice(1)}.</p>{/if}
				<dl>
					{#if owner}<dt>Owner</dt><dd>{owner[1].name}</dd><dt>Ownership</dt><dd>{TOKEN_LABEL[owner[1].mind]} holders</dd>{/if}
					{#if owner && rentOf(id) && owner[0] !== 'tribe'}<dt>Rented to</dt><dd>Tribe COOP</dd><dt>Rent</dt><dd>{f(view.settings[rentOf(id).setting] ?? 0)} {TOKEN_LABEL[owner[1].mind]} a month</dd>{/if}
					{#each info?.specs ?? [] as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
				</dl>
				{#if owner}<div class="buttons"><button onclick={() => (panel = `coop:${owner[0]}`)}>Open the {owner[1].name}</button></div>{/if}
			{:else if isCoopPanel(panel)}
				{@const c = view.coops[panel.slice(5)]}
				<button class="link back" onclick={() => (panel = 'coops')}>← All COOPs</button>
				<p class="eyebrow">COOP · mints {TOKEN_LABEL[c.mind]}</p>
				<h2>{c.name}</h2>
				<p class="eyebrow">Assets it owns</p>
				<ul class="asset-list">
					{#each c.assets as a (a.id)}
						<li>
							<b>{a.name}</b><span>{a.kind}</span>
							{#if a.id === 'pool'}
								<dl>
									{#each MINDS as t (t)}<dt>{TOKEN_LABEL[t]}</dt><dd>{f(view.pool[t], 3)}</dd>{/each}
									{#each MINDS.filter((t) => t !== 'MAIA') as t (t)}<dt>1 {TOKEN_LABEL[t]}</dt><dd>{price(view, t) == null ? 'needs both sides' : `${f(price(view, t), 4)} maiaMIND`}</dd>{/each}
								</dl>
								<small>A Balancer weighted basket, weights {MINDS.map((t) => `${f(weights(view)[t] * 100, 0)} %`).join(' / ')}, invariant {f(invariant(view), 3)}. {f(view.settings.poolShare * 100, 0)} % of every HEART invested flows in; it is never paid out. Rent payers swap through it when they lack a MIND.</small>
							{:else if a.id === 'hex'}
								<small>Rented to the Tribe COOP for {f(view.settings.hexRent)} maiaMIND a month, paid a quarter each weekly pay day.</small>
							{:else if a.id === 'tent'}
								<small>Rented to both players for {f(view.settings.tentRent)} tribeMIND a month each, paid a quarter each weekly pay day.</small>
							{:else if rentOf(a.id) && c.id !== 'tribe'}
								<small>Rented to the Tribe COOP for {f(view.settings[rentOf(a.id).setting] ?? 0)} {TOKEN_LABEL[c.mind]} a month, paid a quarter each weekly pay day.</small>
							{/if}
						</li>
					{/each}
				</ul>
				<p class="eyebrow">Treasury</p>
				<dl>
					{#each MINDS as t (t)}<dt>{TOKEN_LABEL[t]}</dt><dd>{f(c.treasury[t])}</dd>{/each}
					{#if c.id === 'tribe'}
						<dt>Gets tent rent</dt><dd>{f(view.settings.tentRent)} × 2 tribeMIND</dd>
						<dt>Pays hex rent</dt><dd>{f(view.settings.hexRent)} maiaMIND</dd>
						{#each RENTED.filter((r) => ownerOf(r.asset) && ownerOf(r.asset)[0] !== 'tribe') as r (r.asset)}<dt>Pays {r.label} rent</dt><dd>{f(view.settings[r.setting] ?? 0)} {TOKEN_LABEL[ownerOf(r.asset)[1].mind]}</dd>{/each}
					{:else if c.id === 'maia'}
						<dt>Gets hex rent</dt><dd>{f(view.settings.hexRent)} maiaMIND</dd>
					{/if}
					{#if c.id !== 'tribe'}{#each RENTED.filter((r) => c.assets.some((a) => a.id === r.asset)) as r (r.asset)}<dt>Gets {r.label} rent</dt><dd>{f(view.settings[r.setting] ?? 0)} {TOKEN_LABEL[c.mind]}</dd>{/each}{/if}
					{#if c.id === 'tribe'}{#each Object.entries(c.owed ?? {}).filter(([, v]) => v > 0.001) as [id, v] (id)}<dt>Owed for the {rentOf(id)?.label ?? id}</dt><dd class="bad">{f(v)} {TOKEN_LABEL[ownerOf(id)?.[1].mind ?? 'VILLAGE']}</dd>{/each}{/if}
					{#if c.arrears > 0.001}<dt>Owed for the hex</dt><dd class="bad">{f(c.arrears)} maiaMIND</dd>{/if}
				</dl>
				<div class="buttons">
					{#if canMove}<button class="primary" onclick={() => open('invest')}>Invest</button>{/if}
					{#if canMove}<button onclick={() => newMip({ from: panel, to: `player:${seat}`, token: c.mind, amount: 1 })}>Propose a payout</button>{/if}
					<button onclick={() => { const k = panel; panel = 'ledger'; ledgerOfWho = k; }}>Its ledger</button>
					{#if c.id === 'maia'}<button onclick={() => open('swap')}>Swap in the pool</button><button onclick={() => { panel = 'ledger'; ledgerOfWho = 'pool'; }}>The pool’s ledger</button>{/if}
				</div>
			{:else if panel === 'ledger'}
				<p class="eyebrow">Rents, cash flow and every transaction</p>
				<h2>Ledger</h2>
				<select class="full" bind:value={ledgerOfWho}>
					<option value="">{player.name} (shown)</option>
					{#each holdersList as [id, label] (id)}<option value={id}>{label}</option>{/each}
				</select>
				<LedgerView {view} {who} />
			{:else if panel === 'mips'}
				<p class="eyebrow">MaiaCity improvement proposals</p>
				<h2>Proposals</h2>
				<p class="about">Every decision is a MIP: any setting, a COOP's name and the assets it owns, payouts from a COOP treasury to any wallet, and the game's screens (look at a new one before you sign). It needs {signaturesOf(view)} signature{signaturesOf(view) === 1 ? '' : 's'} and applies at once, in this same game.</p>
				{#if draft}
					<div class="draft">
						<input class="full" placeholder="Title" bind:value={draft.title} />
						<textarea class="full" rows="3" placeholder="Why, in prose" bind:value={draft.description}></textarea>
						<p class="eyebrow">Settings</p>
						<dl class="settings">
							{#each Object.keys(SETTING_LIMITS) as k (k)}
								<dt class:changed={Number(draft.settings[k]) !== view.settings[k]}>{SETTING_NAMES[k]}</dt>
								<dd><input type="number" step="any" min={SETTING_LIMITS[k][0]} max={SETTING_LIMITS[k][1]} bind:value={draft.settings[k]} /></dd>
							{/each}
						</dl>
						<p class="eyebrow">COOPs and what they own</p>
						{#each Object.values(view.coops) as c (c.id)}
							<div class="coopdraft">
								<input class="full" class:changed={draft.coops[c.id].name.trim() !== c.name} bind:value={draft.coops[c.id].name} />
								<textarea class="full" rows={Math.max(2, c.assets.length + 1)} placeholder="One asset a line: name | kind" bind:value={draft.coops[c.id].assets}></textarea>
							</div>
						{/each}
						<p class="small">One asset a line, its name and kind split by “|”.</p>
						<p class="eyebrow">Payouts</p>
						{#each draft.payouts as x, i (i)}
							<div class="payout">
								<select bind:value={x.from}>{#each PAYERS as id (id)}<option value={id}>{nameOf(view, id)}</option>{/each}</select>
								<span>→</span>
								<select bind:value={x.to}>{#each PAYEES as id (id)}<option value={id}>{nameOf(view, id)}</option>{/each}</select>
								<input type="number" min="0" step="0.1" bind:value={x.amount} />
								<select bind:value={x.token}>{#each MINDS as t (t)}<option value={t}>{TOKEN_LABEL[t]}</option>{/each}</select>
								<button class="link" onclick={() => draft.payouts.splice(i, 1)}>Remove</button>
							</div>
						{/each}
						<button class="link" onclick={() => draft.payouts.push({ from: 'coop:maia', to: `player:${seat}`, token: 'MAIA', amount: 1 })}>+ Add a payout</button>
						<div class="buttons">
							<button class="primary" disabled={busy || !draft.title.trim()} onclick={propose}>Propose and sign as {player.name}</button>
							<button onclick={() => (draft = null)}>Cancel</button>
						</div>
					</div>
				{:else if canMove}
					<div class="buttons"><button class="primary" onclick={() => newMip()}>New proposal</button></div>
				{/if}
				{#each openMips as m (m.number)}
					<article class="mip open">
						<header><b>MIP #{m.number}</b><span class="status">open</span></header>
						<h3>{m.title}</h3>
						{#if m.description}<p>{m.description}</p>{/if}
						<p class="changes">{describe(view, m)}</p>
						{#each m.views ?? [] as v (v.id)}
							{@const key = `${m.number}:${v.id}`}
							<div class="buttons"><button onclick={() => (preview = preview === key ? '' : key)}>{preview === key ? 'Close the screen' : `Look at the screen “${v.name}”`}</button></div>
							{#if preview === key}<Frame view={frameOf(v)} data={screenData} />{/if}
						{/each}
						<p class="sigs">
							{#each SEATS as s (s)}<span class:ok={m.signatures.includes(s)}>{m.signatures.includes(s) ? '✓' : '○'} {view.players[s].name}</span>{/each}
						</p>
						{#if canMove}
							<div class="buttons">
								{#if !m.signatures.includes(seat)}<button class="primary" disabled={busy} onclick={() => doMove({ type: 'sign', number: m.number })}>Sign as {player.name}</button>{/if}
								<button disabled={busy} onclick={() => doMove({ type: 'reject', number: m.number })}>{m.by === seat ? 'Withdraw' : 'Reject'}</button>
							</div>
						{/if}
					</article>
				{/each}
				{#each decidedMips as m (m.number)}
					<article class="mip {m.status}">
						<header><b>MIP #{m.number}</b><span class="status">{m.status}</span></header>
						<h3>{m.title}</h3>
						<p class="changes">{describe(view, m)}</p>
					</article>
				{/each}
			{:else if isViewPanel(panel)}
				{@const card = screens.find((v) => panel === `view:${v.id}`)}
				<p class="eyebrow">A screen · an MCP App</p>
				<h2>{card?.name ?? 'Gone'}</h2>
				{#if card}
					{#if card.description}<p class="about">{card.description}</p>{/if}
					{#key card.id}<Frame view={frameOf(card)} data={screenData} />{/key}
					<p class="small">It runs in a sealed frame: it sees only the game as shown here and can't move for anyone. A MIP changes it.</p>
				{:else}
					<p class="about">A MIP took this screen out.</p>
				{/if}
			{:else if panel === 'rules'}
				<p class="eyebrow">The game’s settings</p>
				<h2>Rules</h2>
				<dl class="settings">
					{#each Object.keys(SETTING_LIMITS) as k (k)}<dt>{SETTING_NAMES[k]}</dt><dd>{view.settings[k]}</dd>{/each}
				</dl>
				<p class="about">One game month {view.settings.hoursPerMonth === 24 ? 'a real day' : `every ${hrs(view.settings.hoursPerMonth)}`}, from year 0, on the 13-month calendar: 13 months of 28 days, Sol first (it begins on 21 March, the new year) and March last. Every month starts on a Sunday. Every balance melts {f(view.settings.demurrage * 100, 0)} % a year. Every game week ends in a pay day (the 8th, 15th, 22nd and the next 1st, each a Sunday): every rent is paid, a quarter of a month’s, and a payer short of a MIND swaps its others through the pool on its own; what is still missing is owed and paid first next pay day. Every sale pays its owners: {f(view.settings.dividendShare * 100, 0)} % of every rent a COOP is paid goes at once to the holders of its MIND, pro rata. Every setting and every COOP changes only through a MIP with {signaturesOf(view)} signature{signaturesOf(view) === 1 ? '' : 's'}.</p>
				<div class="buttons">
					{#if canMove}<button class="primary" onclick={() => newMip()}>Propose a change</button>{/if}
					{#if admin}<button class="danger" disabled={busy} onclick={() => confirm('Start the game again from year 0? Every balance, MIP and the ledger go.') && run(resetGame)}>Start again from year 0</button>{/if}
				</div>
			{/if}
			{#if error}<p class="error">{error}</p>{/if}
		</aside>
		{:else if error}
			<p class="error toast">{error}</p>
		{/if}
	{:else}
		<div class="loading" role="status"><p class="eyebrow">MaiaCity V1</p><strong>One hex, one tent, two players</strong><span>{error || 'Opening the game…'}</span></div>
	{/if}
</div>

<style>
	.v1 {
		position: fixed;
		inset: 0;
		background: #cfe0e6;
		color: #1f2a23;
		font-size: 0.85rem;
		overflow: hidden;
	}
	.stage {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		cursor: grab;
		touch-action: none;
	}
	.panel,
	.tools button,
	.tag {
		background: rgb(250 248 242 / 0.86);
		border: 1px solid rgb(255 255 255 / 0.5);
		-webkit-backdrop-filter: blur(14px) saturate(1.2);
		backdrop-filter: blur(14px) saturate(1.2);
		box-shadow: 0 4px 18px rgb(0 0 0 / 0.12);
	}
	button {
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	i {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 3px;
		flex: none;
	}
	.brand {
		position: absolute;
		z-index: 2;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: calc(1rem + env(safe-area-inset-left, 0px));
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		font-weight: 600;
	}
	.brand b {
		color: #5f8f6e;
	}
	.topstats {
		position: absolute;
		z-index: 2;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.3rem;
	}
	.stat {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.stat em {
		font-style: normal;
		font-size: 0.72rem;
		color: #3d7a4a;
	}
	.heart {
		color: #e0435a;
	}
	.topright {
		position: absolute;
		z-index: 2;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		right: calc(1rem + env(safe-area-inset-right, 0px));
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.seg {
		display: flex;
		padding: 0.2rem;
		border-radius: 999px;
	}
	.seg button {
		padding: 0.35rem 0.75rem;
		border: 0;
		border-radius: 999px;
		background: none;
		white-space: nowrap;
	}
	.seg button.on {
		background: #fff;
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.12);
	}
	.clock.m {
		display: none;
	}
	.worth {
		margin: 0.2rem 0 0.6rem;
		font-family: var(--font-display);
		font-size: 1.9rem;
		font-variant-numeric: tabular-nums;
	}
	.worth span {
		font-family: var(--font-body);
		font-size: 0.85rem;
		opacity: 0.6;
	}
	.hold {
		margin: 0 0 0.8rem;
		padding: 0;
		list-style: none;
	}
	.hold li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.4rem 0;
		border-top: 1px solid rgb(31 42 35 / 0.08);
		font-size: 0.85rem;
	}
	.hold small {
		display: block;
		font-size: 0.7rem;
		font-weight: 400;
		opacity: 0.6;
	}
	.hold strong {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.tour {
		position: absolute;
		z-index: 8;
		left: 50%;
		bottom: calc(var(--nav-room, 4rem) + 4.4rem);
		transform: translateX(-50%);
		width: min(22rem, calc(100vw - 32px));
		padding: 0.9rem 1rem 0.8rem;
		border-radius: 18px;
		font-size: 0.85rem;
		box-shadow: 0 14px 40px rgb(38 56 44 / 0.25);
	}
	.tour b {
		display: block;
		margin: 0.15rem 0 0.25rem;
		font-size: 1rem;
	}
	.tour p {
		margin: 0 0 0.5rem;
		line-height: 1.4;
	}
	.tour .eyebrow {
		margin: 0;
	}
	.tour.down::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: -7px;
		width: 14px;
		height: 14px;
		background: inherit;
		transform: translateX(-50%) rotate(45deg);
	}
	.tour .goal {
		height: 0.35rem;
		margin: 0.1rem 0 0.25rem;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.12);
		overflow: hidden;
	}
	.tour .goal span {
		display: block;
		height: 100%;
		background: #3d7a4a;
		transition: width 0.4s;
	}
	.tour .small {
		font-size: 0.74rem;
		opacity: 0.7;
	}
	.tour .dots {
		display: flex;
		gap: 0.3rem;
		margin-bottom: 0.6rem;
	}
	.tour .dots i {
		flex: 1;
		height: 0.25rem;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.15);
	}
	.tour .dots i.on {
		background: #3d7a4a;
	}
	.tour .dots i.now {
		background: #24452f;
	}
	.tour .buttons {
		margin: 0;
		align-items: center;
		display: flex;
		gap: 0.5rem;
	}
	.tour .buttons .grow {
		flex: 1;
	}
	/* the arrival plays without the game's controls round it */
	.cinema :is(.tools, .topstats, .topright, .card, .mintbar, .tag, .fab, .brand) {
		display: none !important;
	}
	.bars {
		position: absolute;
		z-index: 8;
		left: 0;
		width: 100%;
		height: 11vh;
		background: #000;
		pointer-events: none;
	}
	.bars.top {
		top: 0;
	}
	.bars.bottom {
		bottom: 0;
	}
	.fade-in {
		position: absolute;
		inset: 0;
		z-index: 9;
		background: #000;
		pointer-events: none;
		animation: fadeout 2.4s ease-out forwards;
	}
	@keyframes fadeout {
		to { opacity: 0; }
	}
	.title {
		position: absolute;
		z-index: 9;
		left: 50%;
		bottom: calc(11vh + 2.2rem);
		transform: translateX(-50%);
		width: min(40rem, calc(100vw - 32px));
		text-align: center;
		color: #fff8ec;
		text-shadow: 0 2px 18px rgb(0 0 0 / 0.55), 0 1px 3px rgb(0 0 0 / 0.5);
		pointer-events: none;
		animation: titlein var(--dur) ease-in-out forwards;
	}
	.title p {
		margin: 0;
		font-family: var(--font-display, Georgia, serif);
		font-size: clamp(1.25rem, 3.2vw, 2rem);
		line-height: 1.25;
		letter-spacing: 0.01em;
	}
	.title small {
		display: block;
		margin-top: 0.5rem;
		font-size: clamp(0.85rem, 1.6vw, 1.05rem);
		opacity: 0.9;
	}
	.title.big {
		bottom: 50%;
		transform: translate(-50%, 50%);
	}
	.title.big p {
		font-size: clamp(2.2rem, 7vw, 4.4rem);
		letter-spacing: 0.04em;
	}
	@keyframes titlein {
		0% { opacity: 0; filter: blur(4px); }
		18% { opacity: 1; filter: blur(0); }
		82% { opacity: 1; filter: blur(0); }
		100% { opacity: 0; filter: blur(2px); }
	}
	.title.big {
		animation-name: titlebig;
	}
	@keyframes titlebig {
		0% { opacity: 0; letter-spacing: 0.2em; }
		25% { opacity: 1; letter-spacing: 0.06em; }
		100% { opacity: 1; letter-spacing: 0.04em; }
	}
	.skip {
		position: absolute;
		z-index: 10;
		right: 1rem;
		top: calc(11vh + 0.6rem);
		color: #fff8ec !important;
		opacity: 0.8;
	}
	.skip.all {
		right: auto;
		left: 1rem;
	}
	.demo {
		position: absolute;
		z-index: 12;
		left: 50%;
		transform: translateX(-50%);
		top: calc(0.6rem + env(safe-area-inset-top, 0px));
		padding: 0.35rem 0.9rem;
		border-radius: 999px;
		font-size: 0.8rem;
		white-space: nowrap;
		max-width: calc(100vw - 2rem);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hint {
		animation: hint 1.6s ease-in-out infinite;
	}
	@keyframes hint {
		0%, 100% { box-shadow: 0 0 0 0 rgb(61 122 74 / 0.55); }
		50% { box-shadow: 0 0 0 8px rgb(61 122 74 / 0); }
	}
	.mintbar {
		position: absolute;
		z-index: 7;
		left: 50%;
		bottom: calc(var(--nav-room, 4rem) + 0.4rem);
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.7rem 1.3rem;
		border: 0;
		border-radius: 999px;
		background: #24452f;
		color: #fff;
		font: inherit;
		font-weight: 600;
		white-space: nowrap;
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.28);
		cursor: pointer;
	}
	.mintbar .heart {
		color: #ff8a9b;
	}
	.mintbar small {
		margin-left: 0.3rem;
		font-weight: 400;
		opacity: 0.8;
	}
	.mintbar:disabled {
		background: rgb(250 248 242 / 0.94);
		color: #6b7a6f;
		cursor: default;
	}
	.clock {
		padding: 0.5rem 0.8rem;
		border-radius: 999px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.tools {
		position: absolute;
		z-index: 2;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		left: calc(1rem + env(safe-area-inset-left, 0px));
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		width: 8rem;
	}
	.tools > button {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 0.7rem;
		border-radius: 999px;
		text-align: left;
	}
	.tools .ic {
		width: 1rem;
		text-align: center;
		opacity: 0.75;
	}
	.tools button.on {
		background: #24452f;
		color: #f4f1e8;
	}
	.badge {
		margin-left: auto;
		min-width: 1.2rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: #c87a4f;
		color: #fff;
		font-size: 0.7rem;
		text-align: center;
	}
	.speednote {
		margin: 0.2rem 0 0;
		padding: 0 0.4rem;
		font-size: 0.66rem;
		line-height: 1.25;
		text-shadow: 0 1px 2px rgb(255 255 255 / 0.6);
	}
	.tag {
		position: absolute;
		z-index: 1;
		transform: translate(-50%, -100%);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.25rem 0.6rem;
		border-radius: 10px;
		font-size: 0.72rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.tag small {
		font-weight: 400;
		font-size: 0.66rem;
		opacity: 0.75;
	}
	.tag.me {
		background: #24452f;
		color: #f4f1e8;
	}
	.card {
		position: absolute;
		z-index: 3;
		right: calc(1rem + env(safe-area-inset-right, 0px));
		top: calc(4.6rem + env(safe-area-inset-top, 0px));
		width: 19rem;
		max-height: calc(100dvh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
		padding: 0.8rem 0.9rem;
		border-radius: 16px;
	}
	.card.wide {
		width: 26rem;
	}
	.close {
		position: absolute;
		top: 0.4rem;
		right: 0.5rem;
		border: 0;
		background: none;
		font-size: 1.2rem;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.6;
	}
	h2 {
		margin: 0.15rem 0 0.3rem;
		font-size: 1.15rem;
	}
	h3 {
		margin: 0.2rem 0;
		font-size: 0.95rem;
	}
	.about {
		margin: 0 0 0.6rem;
		font-size: 0.78rem;
		line-height: 1.4;
		opacity: 0.85;
	}
	.small {
		font-size: 0.75rem;
	}
	.wares {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
		margin: 0.5rem 0;
	}
	.wares div {
		display: flex;
		flex-direction: column;
		padding: 0.45rem 0.6rem;
		border-radius: 10px;
		background: rgb(31 42 35 / 0.06);
	}
	.wares span {
		font-size: 0.68rem;
		opacity: 0.65;
	}
	.wares b {
		font-size: 1.05rem;
		font-variant-numeric: tabular-nums;
	}
	.wares b.small {
		font-size: 0.85rem;
	}
	dl {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.7rem;
		margin: 0.4rem 0 0.6rem;
		font-size: 0.8rem;
	}
	dt {
		opacity: 0.65;
	}
	dt.changed {
		opacity: 1;
		font-weight: 600;
		color: #c87a4f;
	}
	dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.settings dd input {
		width: 5.5rem;
		text-align: right;
	}
	.bad {
		color: #b5523a;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}
	.buttons.col {
		flex-direction: column;
	}
	.buttons button,
	.row button {
		padding: 0.5rem 0.8rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: #fff;
	}
	.buttons button.primary {
		background: #24452f;
		border-color: #24452f;
		color: #f4f1e8;
	}
	button.danger {
		color: #b5523a;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	button.link {
		padding: 0.2rem 0;
		border: 0;
		background: none;
		color: #24452f;
		text-decoration: underline;
		font-size: 0.78rem;
	}
	.row {
		display: flex;
		gap: 0.35rem;
	}
	.row input {
		flex: 1 1 4rem;
		min-width: 3rem;
	}
	.row select {
		flex: 1 1 9rem;
		min-width: 0;
	}
	input,
	select,
	textarea {
		padding: 0.4rem 0.55rem;
		border: 1px solid rgb(31 42 35 / 0.18);
		border-radius: 10px;
		background: #fff;
		color: inherit;
		font: inherit;
		font-size: 0.82rem;
	}
	.full {
		width: 100%;
		box-sizing: border-box;
		margin-bottom: 0.35rem;
	}
	.payout {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 0.3rem;
		align-items: center;
		margin-bottom: 0.4rem;
		padding-bottom: 0.4rem;
		border-bottom: 1px solid rgb(31 42 35 / 0.08);
	}
	.payout input,
	.payout select {
		min-width: 0;
	}
	.coopdraft {
		display: grid;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}
	.coopdraft input.changed {
		outline: 2px solid #d7a53a;
	}
	.draft {
		margin: 0.4rem 0 0.6rem;
		padding: 0.6rem;
		border-radius: 12px;
		background: rgb(31 42 35 / 0.05);
	}
	.mip {
		margin-top: 0.5rem;
		padding: 0.55rem 0.65rem;
		border-radius: 12px;
		border: 1px solid rgb(31 42 35 / 0.1);
		background: #fff;
	}
	.mip header {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
	}
	.mip p {
		margin: 0.2rem 0;
		font-size: 0.78rem;
	}
	.changes {
		opacity: 0.75;
	}
	.status {
		padding: 0 0.45rem;
		border-radius: 999px;
		background: #f0c49a;
		font-size: 0.68rem;
	}
	.accepted .status {
		background: #b9d4b3;
	}
	.rejected .status,
	.withdrawn .status {
		background: rgb(31 42 35 / 0.1);
	}
	.mip:not(.open) {
		opacity: 0.75;
	}
	.sigs {
		display: flex;
		gap: 0.7rem;
	}
	.sigs .ok {
		color: #3d7a4a;
		font-weight: 600;
	}
	.ledger {
		max-height: 40dvh;
		overflow-y: auto;
	}
	.subs {
		margin-bottom: 0.6rem;
	}
	.line.total {
		border-top: 1px solid rgb(31 42 35 / 0.25);
		font-weight: 600;
	}
	.line {
		display: grid;
		grid-template-columns: 5.2rem 1fr auto;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.4rem 0;
		border-top: 1px solid rgb(31 42 35 / 0.08);
		font-size: 0.76rem;
	}
	.when {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}
	.amt {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.amt.plus {
		color: #3d7a4a;
	}
	.amt.minus {
		color: #b5523a;
	}
	.error {
		margin: 0.6rem 0 0;
		padding: 0.45rem 0.6rem;
		border-radius: 10px;
		background: rgb(200 122 79 / 0.18);
		font-size: 0.78rem;
	}
	.fab {
		display: none;
	}
	.arrow {
		align-self: center;
		padding: 0 0.3rem;
		opacity: 0.6;
	}
	.coop {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		width: 100%;
		margin-top: 0.45rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid rgb(31 42 35 / 0.1);
		border-radius: 12px;
		background: #fff;
		text-align: left;
	}
	.coop:hover {
		border-color: #24452f;
	}
	.coop-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.mind {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.72rem;
		opacity: 0.8;
	}
	.assets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.asset {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.07);
		font-size: 0.72rem;
	}
	.treasury {
		font-size: 0.72rem;
		opacity: 0.65;
	}
	.back {
		display: block;
		margin-bottom: 0.3rem;
	}
	.asset-list {
		margin: 0.3rem 0 0.6rem;
		padding: 0;
		list-style: none;
	}
	.asset-list li {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin-bottom: 0.35rem;
		padding: 0.5rem 0.6rem;
		border-radius: 10px;
		background: rgb(31 42 35 / 0.05);
	}
	.asset-list li > span {
		font-size: 0.7rem;
		opacity: 0.6;
	}
	.asset-list small {
		font-size: 0.72rem;
		opacity: 0.75;
	}
	.asset-list dl {
		margin: 0.3rem 0;
	}
	.toast {
		position: absolute;
		z-index: 3;
		left: 50%;
		bottom: calc(var(--nav-room, 4rem) + 0.6rem);
		transform: translateX(-50%);
		background: rgb(250 248 242 / 0.94);
	}
	.loading {
		position: absolute;
		inset: 0;
		z-index: 7;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		background: #24452f;
		color: #f2efe7;
		text-align: center;
		padding: 1rem;
	}
	.loading .eyebrow {
		color: #f0c49a;
		opacity: 1;
	}
	.loading strong {
		font-family: var(--font-display, serif);
		font-size: clamp(2rem, 5vw, 3.2rem);
		font-weight: 400;
	}

	/* ── a phone, upright or on its side: the tools behind one action button, the card sliding in ── */
	@media (max-width: 720px), (max-height: 500px) {
		.fab {
			display: flex;
			align-items: center;
			justify-content: center;
			position: absolute;
			z-index: 6;
			right: max(8px, env(safe-area-inset-right, 0px));
			bottom: var(--nav-foot, 8px);
			width: var(--nav-height, 52px);
			height: var(--nav-height, 52px);
			padding: 0;
			border: 1px solid rgb(255 255 255 / 0.5);
			border-radius: 999px;
			background: rgb(250 248 242 / 0.94);
			box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
		}
		.fab svg {
			width: 1.35rem;
			height: 1.35rem;
			fill: none;
			stroke: currentColor;
			stroke-width: 2;
			stroke-linecap: round;
		}
		.fab.on {
			background: #24452f;
			color: #f4f1e8;
		}
		.tools {
			display: none;
		}
		.tools.open {
			display: flex;
			z-index: 6;
			top: auto;
			left: auto;
			right: max(8px, env(safe-area-inset-right, 0px));
			bottom: calc(var(--nav-room, 4rem) + 0.2rem);
			width: 10rem;
		}
		.speednote,
		.clock:not(.m) {
			display: none;
		}
		.clock.m {
			display: inline-flex;
			align-items: center;
			padding: 0.35rem 0.7rem;
			font-size: 0.85rem;
		}
		.brand {
			padding: 0.4rem 0.7rem;
		}
	}

	/* ── upright: the numbers across under the top bar, the card a sheet from the foot, at most half the screen ── */
	@media (max-width: 720px) and (min-height: 501px) {
		.topstats {
			top: calc(3.6rem + env(safe-area-inset-top, 0px));
			left: 0.5rem;
			right: 0.5rem;
			transform: none;
			justify-content: center;
		}
		.card,
		.card.wide {
			top: auto;
			left: 0;
			right: 0;
			bottom: 0;
			width: auto;
			max-height: 50dvh;
			padding: 0.8rem 1rem calc(var(--nav-room, 4rem) + 3.6rem);
			border-radius: 18px 18px 0 0;
			border-bottom: 0;
			box-shadow: 0 -8px 28px rgb(0 0 0 / 0.16);
			animation: sheet 240ms ease-out;
			overscroll-behavior: contain;
		}
		.ledger {
			max-height: none;
		}
	}

	/* ── on its side: the card an aside down the right, the action button on the left ── */
	@media (max-height: 500px) {
		.fab {
			right: auto;
			left: max(8px, env(safe-area-inset-left, 0px));
		}
		.tools.open {
			right: auto;
			left: max(8px, env(safe-area-inset-left, 0px));
		}
		.topstats {
			top: calc(3.2rem + env(safe-area-inset-top, 0px));
			left: calc(0.5rem + env(safe-area-inset-left, 0px));
			transform: none;
		}
		.card,
		.card.wide {
			top: calc(3.2rem + env(safe-area-inset-top, 0px));
			right: 0;
			bottom: 0;
			width: calc(min(19rem, 50vw - 5.5rem) + env(safe-area-inset-right, 0px));
			max-height: none;
			border-radius: 16px 0 0 0;
			border-right: 0;
			border-bottom: 0;
			animation: aside 240ms ease-out;
		}
	}
	@keyframes sheet {
		from {
			transform: translateY(100%);
		}
	}
	@keyframes aside {
		from {
			transform: translateX(100%);
		}
	}
</style>
