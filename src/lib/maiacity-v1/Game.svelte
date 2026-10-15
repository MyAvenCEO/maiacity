<!--
	MaiaCity V1: the one shared game, as both players see it, as a game screen like Sandbox 1 and Sandbox 5 — the hex in
	3D under everything ($lib/maiacity-v1/world.js: the tent and the two players, nothing else), the COOPs and what
	they own (the MaiaCity COOP the hex and the AMM pool) as a list in a card, the numbers in pills across the top, the tools down the left, and
	a card on the right for whatever is open (a sheet from the foot on a phone, an aside down the right on its side). The
	wallet is one banking sheet from the foot, opened by the nav pill's green "+": the balance and recent transactions,
	Invest, Cashflow and Swap at its foot, and whose wallet it is picked in the nav pill's You menu.
	The server holds the game (api/src/maiacity-v1.js); the page reads it every few seconds and, in between, runs the
	same rules (game/maiacity-v1/engine.js) forward to the second, so the clock, the melt and the HEARTS growing count
	live. Every move goes to the server. Every decision is a MIP that needs both players' signatures.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { VILLAGE_INFO } from '$lib/models/village.js';
	import { WAYSIDE_INFO } from '$lib/models/wayside.js';
	import { RENTED, SUBLET, COOPS, DAY_MS, act, newGame, MINDS, PAYEES, PAYERS, SEATS, SETTING_LIMITS, SETTING_NAMES, TOKEN_COLOUR, TOKEN_LABEL, advance, calendar, dateOf, dateText, describe, heartsValue, inHearts, mintState, nameOf, invariant, nextPayDay, price, quote, signaturesOf, supply, timeOfMonth, weights } from '../../../game/maiacity-v1/engine.js';
	import { loadGame, resetGame, sendMove, takeSeat } from './store.js';
	import { createWorld } from './world.js';
	import LedgerView from './LedgerView.svelte';
	import { AT_HOME, STORY_INVESTS, story } from './tour.js';
	import { treeNow } from './trees.js';
	import { plantAt } from '$lib/plants/index.js';
	import { SEEDLINGS } from '../../../game/maiacity-v1/engine.js';
	import Frame from '$lib/genui/Frame.svelte';
	import { REPLACES, SLOT_NAMES, slotsOf, viewsOf } from '../../../game/maiacity-v1/views.js';
	import { rents } from '../../../game/maiacity-v1/engine.js';
	import Mark from './Mark.svelte';
	import { pillAccounts, pillCenter } from '$lib/app/pill.svelte.js';

	let game = $state.raw(null);
	let me = $state('');
	let admin = $state(false);
	let skew = 0; // server time minus this browser's
	let tick = $state(Date.now());
	let error = $state('');
	let busy = $state(false);
	let seat = $state('A');
	// what the card shows (the COOPs, the proposals, the rules, a screen); the page opens on the world, the card closed
	let panel = $state(null);
	// the wallet (Samuel 2026-10-14: one banking sheet from the foot, opened by the nav pill's green "+"): its balance and
	// recent transactions, and its Invest, Cashflow and Swap; null while closed. `account` is whose wallet it shows,
	// picked in the nav pill's You menu: '' for the seat's own, else another player, a COOP or the pool
	let wallet = $state(null);
	let account = $state('');
	let tools = $state(false); // the phone's tools, behind the action button
	let walking = $state(false); // walking (or driving the pickup) freely through the world, any time no film plays
	let roamNow = $state({ on: false, near: false, driving: false }); // walking, by the pickup, or at its wheel
	let amount = $state(12);
	let swapToken = $state('MAIA');
	let swapTo = $state('TRIBE');
	let swapAmount = $state(1);
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
	const acct = $derived(account || `player:${seat}`);
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

	$effect(() => {
		const v = view, h = hour; // read first: the world is made after the first run
		world?.update(v, h);
	});
	// the players' first trees as they stand on the game clock now, each named after its planter
	// (an admin's growth preview, Samuel 2026-10-14: my tree shown at any number of watered months, for testing; nothing
	// is saved, and the game's own tree comes back when it ends)
	let growth = $state(null);
	const trees = $derived(view ? SEATS.filter((s) => view.players[s].tree).map((s) => {
		const t = view.players[s].tree;
		return { seat: s, name: t.name, ...treeNow(view, s === seat && growth != null ? { ...t, grown: growth } : t, now) };
	}) : []);
	$effect(() => {
		const t = trees;
		world?.trees(t);
	});
	// the land still to unlock shows its rims as the welcome story reaches it (all of it once the story is done or skipped)
	$effect(() => void (view && world?.reveal(tour ? Math.max(0, ...steps.slice(0, tourAt + 1).map((x) => x.reveal ?? 0)) : 2)));
	// where the story stands in the world: the pickup, the powercube and the players, and what the camera looks at
	// once a second player is in, the BatteryCube and the solar panel stand at home beside the tent
	const where = $derived(tour ?? { ...AT_HOME, battery: view?.players.B.founder ? 'home' : 'store' });
	const otherSeat = $derived(seat === 'A' ? 'B' : 'A');
	$effect(() => {
		if (!view || !world) return;
		const other = view.players[otherSeat]?.founder ? otherSeat : null;
		// whose backpack is down in the tent: mine once my home stands (the pitch told), the other's always (Samuel 2026-10-14)
		const homed = { [seat]: !tour || steps.findIndex((x) => x.id === 'pitch') < tourAt, [otherSeat]: true };
		const spot = player?.tree ?? player?.spot ?? null;
		world.set({ at: where.at, cube: where.cube, tent: where.tent ?? 'up', battery: where.battery ?? 'store', me: seat, other, rides: !!tour && seat === 'B' && (where.at === 'village' || where.at === 'cruise'), hour: where.hour, cruise: where.cruise ?? '', spot: spot && { x: spot.x, z: spot.z }, marked: !!spot, by: where.by ?? '', pick: player?.tree?.plant ?? player?.seedling ?? '', name: player?.tree?.name ?? player?.name ?? '', homed });
		world.touring(!!tour);
		if (where.place) world.focus(growth != null && !tour ? `tree:${seat}` : where.place);
	});
	// the arrival plays by itself the first time; its caption shows over it, with a way to skip
	let playing = $state(''); // the moment the world plays: 'intro', 'drive', 'load'
	let caption = $state(null); // the line the arrival's shot carries: { title, sub, big, dur }
	// the whole story plays as a film (Samuel 2026-10-13): every line of a step's words is its own shot, its voice-over
	// carried by the world's moment; the drives, the loading and the pitching play by themselves; only a move the player makes (mint, invest)
	// waits, and then only a small prompt with its button shows, after its words were told
	let told = $state({}); // the moves whose words were already told this visit
	// the first mint makes the player beam: close on their face, smiling, eyes sparkling (Samuel 2026-10-13); the next
	// step waits for it
	function celebrate() {
		if (!world || playing) return;
		playing = 'joy';
		world.joy().then(() => (playing = ''));
	}
	// the first tree (Samuel 2026-10-14): the spot tapped on the ground, outside the core circle (chosen; the rules say
	// where it may not be), the player walking to it; marked there with a plant stake; the seed sown and watered by the
	// moment, the move going to the game as it ends; after the story, watered once a game month
	let chosen = $state(null);
	const spotWhy = (at) => {
		if (!game || !at) return 'Tap the ground where it grows.';
		try {
			act(game, seat, { type: 'mark', x: at.x, z: at.z }, now);
			return '';
		} catch (e) {
			return e?.message ?? String(e);
		}
	};
	const chosenWhy = $derived(spotWhy(chosen));
	$effect(() => {
		const on = tour?.kind === 'spot' && !playing, at = chosen, ok = !chosenWhy;
		world?.choose({ on, at, ok });
	});
	function onGround(at) {
		if (tour?.kind !== 'spot' || playing) return;
		chosen = at;
		if (!spotWhy(at)) world?.walkTo(at.x, at.z);
	}
	function markIt() {
		if (!world || playing || !chosen || chosenWhy) return;
		const at = chosen;
		playing = 'sticks';
		world.sticks(at).then(() => (playing = ''));
		doMove({ type: 'mark', x: at.x, z: at.z }).then(() => (chosen = null));
	}
	const plantIt = () => doMove({ type: 'plant', v: plantAt(player.seedling)?.version });
	const myTree = $derived(trees.find((x) => x.seat === seat));
	const shownMonths = $derived(growth ?? player?.tree?.grown ?? 0);
	const stepPreview = (d) => (growth = Math.max(0, Math.min(400, shownMonths + d)));
	const growthOf = $derived(`${seat}:${game?.started ?? 0}`);
	$effect(() => void (growthOf, (growth = null))); // a new seat or game ends the preview
	function waterIt() {
		if (!world || playing || !myTree?.due) return;
		playing = 'water';
		world.water(seat).then(() => (playing = ''));
		doMove({ type: 'water' });
	}
	function skipShot() {
		caption = null;
		world?.skip();
	}
	// the film fades in from black at its very start and out to black at its very end; everything between is a cut
	// (the editor's rule, the script 2026-10-14: a fade means time passing or an ending, so it is kept for those)
	// a moment of the story ends the free walk (the world ends it itself as it plays one)
	$effect(() => {
		if (playing && walking) walking = false;
	});
	// one mode (Samuel 2026-10-14: no walk button): once the story is told, the player walks the world whenever no film
	// plays; in the story an arrow key walks them on too (the world says when they walk, onRoam)
	$effect(() => {
		const free = canMove && !tour; // read first: the world comes after the first run
		if (view) world?.freeWalk(free);
	});
	let fadeIn = $state(true);
	let ended = $state(false); // the end faded out: the world fades back in under the player's own page
	$effect(() => {
		// coming back halfway through a chapter, it starts again from its first line: no film till that is settled
		// (resumed, below), or the open step played first and the chapter's start after it
		if (!tour || !world || playing || (!demo && resumed !== started)) return;
		const step = tour;
		fadeIn = step.id === 'arrive';
		if (step.kind === 'intro') {
			playing = 'intro';
			world.intro(step.part, { lines: step.lines }).then(() => ((playing = ''), mark(step.id)));
		} else if (step.kind === 'station' || step.kind === 'drive' || step.kind === 'load' || step.kind === 'build') {
			playing = step.kind;
			// the moment cuts a shot a line and carries the voice-over itself, so each action lands on its words
			const lines = step.lines;
			const moment = step.kind === 'station' ? world.station({ lines }) : step.kind === 'load' ? world.load({ lines, what: step.what }) : step.kind === 'build' ? world.pitch({ lines, what: step.what }) : world.drive(step.leg, { fetch: !!step.fetch, lines });
			moment.then(() => ((playing = ''), mark(step.id)));
		} else if (step.kind === 'sow' && !told[step.id] && player?.seedling) {
			// the seed into the earth and the water over it; the move goes to the game as the moment ends, the film held
			// till it is there (no "Plant it" prompt flashing up between the last shot and the next)
			playing = 'sow';
			world.sow({ lines: step.lines }).then(() => {
				told = { ...told, [step.id]: true };
				Promise.resolve(plantIt()).finally(() => (playing = ''));
			});
		} else if ((step.kind === 'invest' || step.kind === 'mint' || step.kind === 'pick' || step.kind === 'spot') && !told[step.id]) {
			playing = 'scene';
			world.scene(step.place, step).then(() => ((playing = ''), (told = { ...told, [step.id]: true })));
		} else if (step.kind === 'next' || step.kind === 'done') {
			playing = 'scene';
			world.scene(step.place, step).then(() => {
				playing = '';
				if (step.kind === 'done') (ended = true), setTimeout(() => (ended = false), 1600);
				mark(step.id);
			});
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

	// a test run of a seat's whole journey (Samuel 2026-10-13: "Play intro A / B"): the story plays from its first
	// shot for that seat on a fresh game in this browser, the first player already in when it is B's; its moves are made
	// here and never sent, and ending it brings the real game back
	let demo = $state(false);
	let realGame = null;
	function startDemo(s = 'B') {
		if (playing) skipShot();
		if (!demo) realGame = game;
		const g = newGame(now - 60e3);
		g.players.A.founder = s === 'A' ? me : 'demo';
		g.players.A.name = realGame.players.A.name;
		if (s === 'B') (g.players.B.founder = me), (g.players.B.name = realGame.players.B.founder ? realGame.players.B.name : 'Player B');
		// the second's journey comes after the first's: they minted, invested, pitched the tent and planted their first
		// tree (where and what the real first did, if they did), so its plant stake and flag stand on the hex
		let first = g;
		if (s === 'B') {
			const t = realGame.players.A.tree;
			const moves = [{ type: 'mint' }, { type: 'invest', coop: 'maia', amount: STORY_INVESTS.maia }, { type: 'invest', coop: 'village', amount: STORY_INVESTS.village }, { type: 'invest', coop: 'tribe', amount: STORY_INVESTS.tribe }, { type: 'mark', x: t?.x ?? 0, z: t?.z ?? 40 }, { type: 'seedling', plant: SEEDLINGS.some((x) => x.id === t?.plant) ? t.plant : 'apple' }, { type: 'plant', v: t?.v ?? 1 }];
			try {
				moves.forEach((m, i) => (first = act(first, 'A', m, now - 50e3 + i * 1e3)));
			} catch {
				first = g; // the first's journey could not be replayed: the second's starts on its own
			}
		}
		game = first;
		seen = { ...seen, [s]: {} };
		told = {};
		seat = s;
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
		seat = mySeat ?? 'A';
		refresh();
	}

	onMount(() => {
		world = createWorld(canvas, {
			onPick: (name) => {
				// a Village COOP machine opens its own card
				if (name?.startsWith('asset:')) return void ((panel = name), (chose = true), (wallet = null));
				if (!name?.startsWith('player:')) return;
				openWallet('home', name);
			},
			onLabels: (l) => (labels = l),
			onCaption: (c) => (caption = c),
			onGround: (at) => onGround(at),
			onRoam: (r) => ((roamNow = r), (walking = r.on))
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

	let chose = $state(false); // the player opened a card themselves: while the story plays, only then does one show
	function open(name) {
		chose = true;
		panel = panel === name ? null : name;
		tools = false;
		if (panel) wallet = null;
	}

	/** the wallet, open on one of its views ('home', 'all', 'invest', 'cashflow', 'swap'), as `id`'s if given */
	function openWallet(v = 'home', id) {
		if (id !== undefined) account = id === `player:${seat}` ? '' : id;
		wallet = v;
		panel = null;
		tools = false;
		chose = true;
	}
	// one of the wallet's actions; tapped again, it goes back to the balance
	const walletTo = (v) => (wallet = wallet === v ? 'home' : v);
	// a move made in the wallet shows at the top of its recent transactions
	const walletMove = async (action) => {
		if (await doMove(action)) wallet = 'home';
	};

	// whose wallet, as the nav pill lists them: the seat's own first, then the other player, the COOPs and the pool
	// (Mark.svelte's initials and colours)
	const accountOf = (id) => {
		const [kind, k] = id.split(':');
		if (kind === 'player') {
			const p = view.players[k];
			return { id, label: p.founder === me ? `${p.name} (you)` : p.name, sub: p.founder === me ? 'Your wallet' : p.founder ? 'The other player' : 'A free seat', text: (p.name || k).slice(0, 2), colour: `hsl(${k === 'A' ? 28 : 205} 38% 42%)`, shape: 'human', bal: p.wallet, p };
		}
		if (kind === 'coop') {
			const c = view.coops[k];
			return { id, label: c.name, sub: `Treasury · mints ${TOKEN_LABEL[c.mind]}`, text: c.name.replace(/ COOP$/, '').slice(0, 2), colour: TOKEN_COLOUR[c.mind], shape: 'coop', bal: c.treasury, c };
		}
		return { id: 'pool', label: 'AMM pool', sub: 'The MaiaCity COOP’s pool', text: 'AMM', colour: '#8a7a55', shape: 'aven', bal: view.pool };
	};
	const accounts = $derived(view ? [`player:${seat}`, `player:${otherSeat}`, ...Object.keys(COOPS).map((k) => `coop:${k}`), 'pool'].map(accountOf) : []);
	const here = $derived(accounts.find((a) => a.id === acct) ?? accounts[0]);
	// the rent chain of a week, player → Tribe → Village → MaiaCity (engine.js rents): one link per payer and payee,
	// the two players' home rents as one
	const CHAIN = ['players', 'coop:tribe', 'coop:village', 'coop:maia'];
	const chain = $derived.by(() => {
		if (!view) return [];
		const by = new Map();
		for (const r of rents(view)) {
			const from = r.from.startsWith('player:') ? 'players' : r.from;
			const k = `${from}>${r.to}`;
			const l = by.get(k) ?? { from, to: r.to, token: r.token, weekly: 0, each: r.weekly, what: [], payers: [] };
			l.weekly += r.weekly;
			if (!l.what.includes(r.what)) l.what.push(r.what);
			l.payers.push(r.from);
			by.set(k, l);
		}
		return [...by.values()].sort((a, b) => CHAIN.indexOf(a.from) - CHAIN.indexOf(b.from));
	});
	// the slot a MIP's screen may stand in (views.js SLOTS), for each of the wallet's views
	const WALLET_SLOT = { home: 'you', all: 'ledger', invest: 'invest', cashflow: 'ledger', swap: 'swap' };
	const walletCard = $derived(wallet ? (slotted[WALLET_SLOT[wallet]] ?? (wallet === 'home' ? slotted.mint : null)) : null);
	// the nav pill's green "+" opens the wallet, and its You menu switches whose it shows, once the story has shown it
	const pillOn = $derived(!!view && !!player && shows('you'));
	$effect(() => {
		if (!pillOn || playing) return;
		return pillCenter({ label: 'Wallet', get on() { return !!wallet; }, go: () => (wallet ? (wallet = null) : openWallet()) });
	});
	$effect(() => {
		if (!pillOn) return;
		return pillAccounts({ title: 'Wallet of', get list() { return accounts; }, get current() { return here?.id ?? ''; }, pick: (id) => openWallet('home', id) });
	});
	$effect(() => {
		if (playing) wallet = null;
	});

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
	// the tools down the left: the wallet (your HEARTS and MINDs, investing, the cash flow, swapping, every
	// transaction) is the nav pill's "+", not a tool
	const TOOLS = [
		['coops', '◇', 'COOPs'],
		['mips', '✎', 'Proposals'],
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
	/** the rent a COOP pays for an asset another owns, if one rents it */
	const rentOf = (id) => RENTED.find((r) => r.asset === id);
	/** the first-run story ($lib/maiacity-v1/tour.js): one idea a step, for each player at their own seat. The steps
	 *  that only tell remember "Next" in this browser; the moves (mint, invest) are read off the game. */
	let seen = $state({});
	let seenOf = $state(0); // the game start the remembered steps were read for: no story before they are
	const steps = $derived(view && player && mine ? story(view, seat, seen[seat] ?? {}) : []);
	const tourAt = $derived(steps.findIndex((x) => !x.done));
	const tour = $derived(tourAt >= 0 && seenOf && seenOf === started && !seen[seat]?.off ? { ...steps[tourAt], n: tourAt + 1, steps: steps.length } : null);
	// each milestone of the story unlocks the controls and views it talks about (Samuel 2026-10-13): nothing but the
	// world on the road, then the HEARTS and the clock, the mint, with the first invest the COOPs, their MINDs and
	// investing, with the answer the player's own page, the ledger, the seats and the swap; the rest at the end.
	// Without a story, all of it.
	const UNLOCKS = { arrival: ['brand'], hearts: ['hearts', 'clock'], mint: ['mint'], maia: ['invest', 'coops', 'minds'], answer: ['you', 'ledger', 'seats', 'swap'], done: ['all'] };
	const unlocked = $derived.by(() => {
		if (!tour) return null;
		const on = new Set();
		for (const x of steps.slice(0, tourAt + 1)) for (const u of UNLOCKS[x.id] ?? []) on.add(u);
		return on;
	});
	/** a step that only tells (Next, or an intro shot), so it can be told again: not a move read off the game */
	const TOLD = (x) => x.kind === 'next' || x.kind === 'intro';
	const shows = (what) => !unlocked || unlocked.has('all') || unlocked.has(what) || (what.startsWith('view:') && unlocked.has('mips'));
	const mark = (id) => {
		seen = { ...seen, [seat]: { ...(seen[seat] ?? {}), [id]: true } };
		if (!demo) try { localStorage.setItem(storyKey(seat), JSON.stringify(seen[seat])); } catch {}
		if (id === 'done') openWallet();
	};
	// remembered per game: a fresh game (a reset) starts every story from its first step again
	const started = $derived(game?.started ?? 0);
	const storyKey = (s) => `v1-story-${started}-${s}`;
	$effect(() => {
		if (!started) return;
		try { seen = Object.fromEntries(SEATS.map((s) => [s, JSON.parse(localStorage.getItem(storyKey(s)) ?? '{}')])); } catch {}
		seenOf = started;
	});
	// coming back halfway through a chapter (Samuel 2026-10-13: the story began at "They ripen like fruit"), the chapter
	// is told again from its first line: the told steps before the open one in its chapter are unseen once per visit
	let resumed = $state(0);
	$effect(() => {
		if (!tour || resumed === started || demo) return;
		resumed = started;
		const ch = steps[tourAt]?.chapter;
		let i = tourAt;
		while (i > 0 && steps[i - 1].chapter === ch && TOLD(steps[i - 1])) i--;
		if (i === tourAt) return;
		const mine = { ...(seen[seat] ?? {}) };
		for (const x of steps.slice(i, tourAt)) delete mine[x.id];
		seen = { ...seen, [seat]: mine };
	});
	const ownerOf = (id) => (view ? Object.keys(COOPS).map((k) => [k, view.coops[k]]).find(([, c]) => c.assets.some((a) => a.id === id)) : null);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && wallet && (wallet = null)} />

<div class="v1" class:cinema={!!playing}>
	<canvas class="stage" bind:this={canvas}></canvas>
	{#if demo}<div class="demo panel" role="status">Test run · {view?.players[seat].name}’s journey, nothing is saved <button class="link" onclick={endDemo}>End</button></div>
{/if}

	{#if view}
		<!-- the players' names over them in the world: tap one to see them -->
		{#each Object.entries(labels) as [k, l] (k)}
			{#if l.on && k.startsWith('tree:')}
				{@const t = trees.find((x) => x.seat === k.slice(5))}
				{#if t}<div class="tag tree" style="left:{l.x}px;top:{l.y}px">{t.name}<small>{t.label} · {t.now}</small></div>{/if}
			{:else if l.on}
				<button class="tag" class:me={k === `player:${seat}`} style="left:{l.x}px;top:{l.y}px" onclick={() => openWallet('home', k)}>
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
						<button title="Test run this seat's journey in this browser, as long as no one has taken it" onclick={() => startDemo(s)}>{view.players[s].name} · try</button>
					{:else}
						<button class:on={seat === s} onclick={() => ((seat = s), (account = ''))}>{view.players[s].name}{view.players[s].founder === me ? ' · you' : ''}</button>
					{/if}
				{/each}
			</div>{/if}
			{#if !demo && mySeat && !tour}<div class="seg panel intros" title="Replay a seat's whole story on a fresh test game in this browser; nothing is saved"><span>Play intro</span>{#each SEATS as s (s)}<button onclick={() => startDemo(s)}>{s}</button>{/each}</div>{/if}
			{#if shows('clock')}<span class="clock panel" title="The game clock: {speed}, 13 months of 28 days"><small>{dateText(cal)}</small> {cal.weekday} {cal.day} {cal.name} · Y{cal.year} · {pad(Math.floor(hour))}:{pad(Math.floor((hour % 1) * 60))}</span>{/if}
		</div>

		{#if shows('mint')}<nav class="tools" class:open={tools}>
			{#each allTools.filter(([id]) => shows(id)) as [id, ic, label] (id)}
				<button class:on={panel === id} class:hint={tour?.hint === id} onclick={() => open(id)}><span class="ic">{ic}</span>{label}{#if id === 'mips' && openMips.length}<span class="badge">{openMips.length}</span>{/if}</button>
			{/each}
			{#if shows('you')}<p class="speednote">{speed} · pay day in {dur(nextMonth - now)}</p>{/if}
		</nav>{/if}
		{#if canMove && shows('mint') && !tour && !wallet}
			<!-- the universal mint button over the nav pill, once the story is done: in it the story mints by its own button (Samuel 2026-10-13) -->
			<button class="mintbar" class:hint={tour?.hint === 'mintbar'} disabled={busy || mint.amount < 0.001} title={mint.lost > 0.001 ? `${f(mint.lost)} HEARTS grew more than a game month ago and are lost` : 'Mint all that grew since your last mint'} onclick={() => doMove({ type: 'mint' })}>
				<span class="heart">❤︎</span> Mint <b>{f(mint.amount)}</b>{#if mint.starter}<small>incl. starter pack</small>{/if}
			</button>
		{/if}
		{#if canMove && !playing && !(tour && (tour.at === 'van' || tour.at === 'cruise'))}
			<!-- walking freely, any time no film plays (Samuel 2026-10-14): tap the ground to walk there; by the pickup, get
			     in and drive it anywhere -->
			<div class="walkbar">
				{#if walking && (roamNow.near || roamNow.driving)}<button class="walkbtn" onclick={() => world?.board(!roamNow.driving)}>{roamNow.driving ? 'Get out' : 'Get in the pickup'}</button>{/if}
			</div>
			{#if walking}<p class="walkhint">Tap the ground to {roamNow.driving ? 'drive' : 'walk'} there, or use the arrow keys</p>{/if}
		{/if}
		{#if canMove && !tour && !playing && myTree?.due}
			<!-- the first tree waits for its water: once a game month (a real day), a month of its growth each time -->
			<button class="mintbar waterbar" disabled={busy} title="Water {myTree.name}: a game month of growth" onclick={waterIt}><span class="drop">💧</span> Water <b>{myTree.name}</b></button>
		{/if}
		{#if admin && canMove && !tour && !playing && player.tree}
			<!-- the admin's growth preview: step my tree through its watered months (a test; nothing is saved) -->
			<div class="growth panel" role="group" aria-label="Growth preview" title="Admin only: how {myTree?.name ?? 'your tree'} grows, a game month of growth for each watering. A preview, nothing is saved.">
				<span class="what">Growth preview</span>
				<button aria-label="A year back" disabled={shownMonths <= 0} onclick={() => stepPreview(-13)}>«</button>
				<button aria-label="A month back" disabled={shownMonths <= 0} onclick={() => stepPreview(-1)}>‹</button>
				<b>{shownMonths} {shownMonths === 1 ? 'watering' : 'waterings'}</b>
				<button aria-label="A month on" onclick={() => stepPreview(1)}>›</button>
				<button aria-label="A year on" onclick={() => stepPreview(13)}>»</button>
				<small>{myTree?.now ?? ''}</small>
				{#if growth != null}<button class="link" onclick={() => (growth = null)}>End</button>{/if}
			</div>
		{/if}
		{#if ended}<div class="fade-in end" aria-hidden="true"></div>{/if}
		{#if playing}
			<!-- the arrival, as a trailer: black bars, one line of the story a shot, fading in and out -->
			<div class="bars top" aria-hidden="true"></div><div class="bars bottom" aria-hidden="true"></div>
			{#if fadeIn}<div class="fade-in" aria-hidden="true"></div>{/if}
			{#if tour?.kind === 'done' && caption}<div class="fade-out" style="--dur:{caption.dur ?? 12}s" aria-hidden="true"></div>{/if}
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
		{:else if tour && (tour.kind === 'spot' || tour.kind === 'pick' || tour.kind === 'sow')}
			<!-- the first tree (Samuel 2026-10-14): tap where it grows, outside the circle, and mark it; pick one of the seeds
			     from your backpack; and, if the planting did not reach the game, plant it -->
			<div class="tour panel prompt" role="dialog" aria-label={tour.title}>
				<b>{tour.title}</b>
				{#if tour.kind === 'spot'}
					<p class="small">{chosen ? chosenWhy || 'Here. Mark it with your plant stake.' : 'Tap the ground outside the circle, where the homes will not be built.'}</p>
				{:else if tour.kind === 'pick'}
					<div class="picks">
						{#each SEEDLINGS as x (x.id)}
							<button disabled={busy} title="Bears {x.fruit}" onclick={() => doMove({ type: 'seedling', plant: x.id })}>{x.label}</button>
						{/each}
					</div>
				{/if}
				<div class="buttons">
					<button class="link" onclick={() => mark('off')}>Skip the story</button>
					<span class="grow"></span>
					{#if tour.kind === 'spot'}<button class="primary" disabled={busy || !chosen || !!chosenWhy} onclick={markIt}>Mark it</button>{/if}
					{#if tour.kind === 'sow'}<button class="primary" disabled={busy || !player.seedling} onclick={plantIt}>Plant it</button>{/if}
				</div>
			</div>
		{:else if tour && (tour.kind === 'invest' || tour.kind === 'mint')}
			<!-- the story's only stops: a move the player makes, its words already told as the film's voice-over, so only
			     its title and its button show (Samuel 2026-10-13: as little modal text as possible) -->
			<div class="tour panel prompt" role="dialog" aria-label={tour.title}>
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
						<button class="primary" disabled={busy || mint.amount < 0.001} onclick={() => (celebrate(), doMove({ type: 'mint' }))}>Mint {f(mint.amount, 0)} ❤︎</button>
					{/if}
				</div>
			</div>
		{/if}
		{#if shows('mint')}<button class="fab" class:on={tools} aria-label="Tools" onclick={() => (tools = !tools)}>
			<svg viewBox="0 0 24 24"><path d={tools ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
		</button>{/if}

		{#if wallet && here && !playing}
			{@const hv = heartsValue(view)}
			{@const isPlayer = here.id.startsWith('player:')}
			{@const own = here.id === `player:${seat}` && canMove}
			<!-- the wallet: one banking sheet from the foot of the screen, over the nav pill's "+" (Samuel 2026-10-14) -->
			<button class="scrim" aria-label="Close the wallet" onclick={() => (wallet = null)}></button>
			<div class="wallet panel" role="dialog" aria-modal="true" aria-label="Wallet of {here.label}">
				<header class="w-head">
					{#if wallet !== 'home'}<button class="w-back" aria-label="Back to the balance" onclick={() => (wallet = 'home')}>←</button>{/if}
					<Mark {view} id={here.id} size={36} />
					<span class="w-who"><b>{here.label}</b><small>{wallet === 'invest' ? 'Invest your HEARTS' : wallet === 'cashflow' ? 'Cash flow, a week' : wallet === 'swap' ? 'Swap in the pool' : wallet === 'all' ? 'Every transaction' : here.sub}</small></span>
					<button class="w-close" aria-label="Close" onclick={() => (wallet = null)}>×</button>
				</header>
				<div class="w-body">
					{#if walletCard}
						{#if !builtIn[WALLET_SLOT[wallet]]}
							{#key walletCard.id}<Frame view={frameOf(walletCard)} data={screenData} />{/key}
							<p class="small">A MIP stood the screen “{walletCard.name}” here; it only shows, every move stays a button. <button class="link" onclick={() => (builtIn = { ...builtIn, [WALLET_SLOT[wallet]]: true })}>Hide it</button></p>
						{:else}
							<p class="small"><button class="link" onclick={() => (builtIn = { ...builtIn, [WALLET_SLOT[wallet]]: false })}>Show the screen “{walletCard.name}”</button></p>
						{/if}
					{/if}
					{#if wallet === 'home'}
						<p class="w-balance">{f(inHearts(view, here.bal, hv))} <span>❤︎</span></p>
						<p class="w-sub">{isPlayer ? 'Balance, all your HEARTS and MINDs in HEARTS' : here.id === 'pool' ? 'In the pool, in HEARTS' : 'The treasury, in HEARTS'}</p>
						{#if isPlayer && !here.p.founder}
							<p class="about">This seat is waiting: the next person to sign in becomes {here.p.name}.</p>
							{#if mySeat}<button class="primary" onclick={() => startDemo(here.id.slice(7))}>Test run {here.p.name}’s journey</button>{/if}
						{/if}
						{#if own && mint.amount > 0.005 && !tour}
							<div class="w-mint">
								<span><b>+{f(mint.amount)} ❤︎</b> ready to mint{#if mint.lost > 0.001}<small class="bad">{f(mint.lost)} older than {reach} are lost</small>{/if}</span>
								<button class="primary" disabled={busy || mint.amount < 0.001} onclick={() => doMove({ type: 'mint' })}>Mint</button>
							</div>
						{/if}
						<ul class="hold">
							{#if isPlayer}
								{@const hp = here.p}
								<li><span>{hp.name.charAt(0).toLowerCase() + hp.name.slice(1).replace(/\s+/g, '')}HEARTS<small>your right to own, {f(view.settings.heartsPerDay, 0)} a game day</small></span><strong>{f(hp.wallet.HEARTS)} ❤︎</strong></li>
							{/if}
							{#each MINDS.filter((t) => isPlayer || here.bal[t] > 0.005 || here.c?.mind === t) as t (t)}
								<li><span><i class="dot" style="background:{TOKEN_COLOUR[t]}"></i>{TOKEN_LABEL[t]}<small>{total?.[t] ? `${f((here.bal[t] / total[t]) * 100, 1)} % of all ${TOKEN_LABEL[t]}` : '—'}</small></span><strong>{f(here.bal[t] * hv[t])} ❤︎<small>{f(here.bal[t])} {TOKEN_LABEL[t]}</small></strong></li>
							{/each}
							{#if here.bal.EURO > 0.005}<li title="System minted: each player's first mint brings €12,500 in (the euro ingest)"><span>€uro<small>the euro ingest</small></span><strong>{f(here.bal.EURO)} €</strong></li>{/if}
						</ul>
						{#if isPlayer && here.p.arrears > 0.001}<p class="bad small">{f(here.p.arrears)} tribeMIND home rent owed</p>{/if}
						<LedgerView {view} who={here.id} show="tx" limit={5} txTitle="Recent transactions" />
						{#if view.ledger.some((e) => e.from === here.id || e.to === here.id)}<button class="link" onclick={() => (wallet = 'all')}>See every transaction</button>{/if}
					{:else if wallet === 'all'}
						<LedgerView {view} who={here.id} show="tx" tall />
					{:else if wallet === 'invest'}
						{@const into = here.c ? [here.c.id] : Object.keys(COOPS)}
						<p class="w-balance small-b">{f(player.wallet.HEARTS)} <span>❤︎ to invest</span></p>
						<p class="about">Each HEART makes 1 MIND of the COOP: {f(50, 0)} % yours, {f(50 - view.settings.poolShare * 100, 0)} % its treasury, {f(view.settings.poolShare * 100, 0)} % into the city pool.</p>
						{#if canMove}
							<div class="row">
								<input type="number" min="0" step="1" bind:value={amount} aria-label="HEARTS to invest" />
								<button onclick={() => (amount = Math.floor(player.wallet.HEARTS * 1e6) / 1e6)}>All</button>
							</div>
							<div class="buttons col">
								{#each into as id (id)}
									<button class="primary" disabled={busy || !(player.wallet.HEARTS > 0) || !(amount > 0)} onclick={() => walletMove({ type: 'invest', coop: id, amount })}>Invest {f(amount, 0)} ❤︎ into the {view.coops[id].name}</button>
								{/each}
							</div>
						{:else}
							<p class="small">Only {player.name} can invest from this seat.</p>
						{/if}
					{:else if wallet === 'cashflow'}
						<p class="eyebrow">The rent chain · each pay day, a week</p>
						<ol class="chain">
							{#each chain as l (l.from + l.to)}
								{@const on = l.from === here.id || l.to === here.id || l.payers.includes(here.id)}
								<li class:on>
									<span class="c-from">{#if l.from === 'players'}<Mark {view} id="player:{seat}" size={26} /><span>Each player<small>{f(l.each, 0)} {TOKEN_LABEL[l.token]} each</small></span>{:else}<Mark {view} id={l.from} size={26} /><span>{nameOf(view, l.from)}</span>{/if}</span>
									<span class="c-pay"><b>{f(l.weekly, 0)} {TOKEN_LABEL[l.token]}</b><small>{l.what.map((w) => w.replace(/ rent$/, '')).join(', ').toLowerCase()} · ≈ {f(l.weekly * hv[l.token], 0)} ❤︎</small></span>
									<span class="c-to"><Mark {view} id={l.to} size={26} /><span>{nameOf(view, l.to)}</span></span>
								</li>
							{/each}
						</ol>
						<p class="small">{f(view.settings.dividendShare * 100, 0)} % of every rent goes on to the holders of the MIND it is paid in: your dividend.</p>
						<LedgerView {view} who={here.id} show="flow" />
					{:else if wallet === 'swap'}
						<p class="about">A Balancer weighted pool of the MaiaCity COOP: one basket of all three MINDs, weights {MINDS.map((t) => `${f(weights(view)[t] * 100, 0)} %`).join(' / ')}. Any MIND swaps for any other; a {f(view.settings.swapFee * 100, 1)} % fee stays in the pool.</p>
						{#if canMove}
							<div class="swapbox">
								<label><span>You pay<small>you hold {f(player.wallet[swapToken], 3)}</small></span>
									<span class="row"><input type="number" min="0" step="0.1" bind:value={swapAmount} aria-label="Amount to swap" /><select bind:value={swapToken}>{#each MINDS as t (t)}<option value={t}>{TOKEN_LABEL[t]}</option>{/each}</select></span>
								</label>
								<button class="flip" aria-label="Swap the two" onclick={() => ([swapToken, swapTo] = [swapTo, swapToken])}>⇅</button>
								<label><span>You get<small>≈ {f(swapOut * (hv[swapTo] ?? 0), 2)} ❤︎</small></span>
									<span class="row"><output>{f(swapOut, 3)}</output><select bind:value={swapTo}>{#each MINDS.filter((t) => t !== swapToken) as t (t)}<option value={t}>{TOKEN_LABEL[t]}</option>{/each}</select></span>
								</label>
							</div>
							<div class="buttons"><button class="primary wide-b" disabled={busy || !(swapOut > 0)} onclick={() => walletMove({ type: 'swap', token: swapToken, to: swapTo, amount: swapAmount })}>Swap for {f(swapOut, 3)} {TOKEN_LABEL[swapTo]}</button></div>
						{/if}
						<dl>
							{#each MINDS as t (t)}<dt>Pool {TOKEN_LABEL[t]}</dt><dd>{f(view.pool[t], 3)}</dd>{/each}
							{#each MINDS.filter((t) => t !== 'MAIA') as t (t)}<dt>1 {TOKEN_LABEL[t]}</dt><dd>{price(view, t) == null ? 'needs both sides' : `${f(price(view, t), 4)} maiaMIND`}</dd>{/each}
						</dl>
					{/if}
				</div>
				<nav class="w-actions" aria-label="Wallet actions">
					<button class:on={wallet === 'invest'} disabled={!shows('invest')} onclick={() => walletTo('invest')}><span class="w-ic">↗</span>Invest</button>
					<button class:on={wallet === 'cashflow'} onclick={() => walletTo('cashflow')}><span class="w-ic">⇵</span>Cashflow</button>
					<button class:on={wallet === 'swap'} disabled={!shows('swap')} onclick={() => walletTo('swap')}><span class="w-ic">⇄</span>Swap</button>
				</nav>
			</div>
		{/if}

		{#if panel && shows(panel) && (!tour || chose)}
		<aside class="card panel" class:wide={panel === 'mips' || isViewPanel(panel)}>
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
			{:else if panel === 'coops'}
				<p class="eyebrow">Who owns what</p>
				<h2>COOPs</h2>
				<p class="about">Invest your HEARTS into a COOP to own a share of it: its MIND.</p>
				{#each Object.keys(COOPS) as id (id)}
					{@const c = view.coops[id]}
					<button class="coop" onclick={() => (panel = `coop:${id}`)}>
						<span class="coop-head"><b>{c.name}</b><span class="mind"><i style="background:{TOKEN_COLOUR[c.mind]}"></i>{TOKEN_LABEL[c.mind]}</span></span>
						<span class="assets">{#each c.assets as a (a.id)}<span class="asset">{a.name}</span>{/each}</span>
						<span class="treasury">Treasury {[...MINDS.filter((t) => t === c.mind || c.treasury[t] > 0.005).map((t) => `${f(c.treasury[t], 1)} ${TOKEN_LABEL[t]}`), ...(c.treasury.EURO > 0.005 ? [`${f(c.treasury.EURO, 0)} €uro`] : [])].join(' · ')}</span>
					</button>
				{/each}
			{:else if isAssetPanel(panel)}
				{@const id = panel.slice(6)}
				{@const owner = ownerOf(id)}
				{@const a = owner?.[1].assets.find((x) => x.id === id)}
				{@const info = VILLAGE_INFO[id] ?? WAYSIDE_INFO[id] ?? (id === 'tent' ? { name: 'The tent, packed', note: 'the Tribe COOP’s 2-person bell tent, rolled in its bag with its pole, wall poles and pegs, waiting to be pitched' } : id === 'fuel' ? { name: 'Two jerrycans of petrol', note: '2 × 20 litres for the ElectroCube’s petrol engine: about a day of light loads, a few hours at full power' } : null)}
				<p class="eyebrow">Asset · {a?.kind ?? (WAYSIDE_INFO[id] ? 'Wayside' : 'Machine')}</p>
				<h2>{a?.name ?? info?.name ?? info?.model}</h2>
				{#if info}<p class="about">{info.note[0].toUpperCase() + info.note.slice(1)}.</p>{/if}
				<dl>
					{#if owner}<dt>Owner</dt><dd>{owner[1].name}</dd><dt>Ownership</dt><dd>{TOKEN_LABEL[owner[1].mind]} holders</dd>{/if}
					{#if owner && rentOf(id) && owner[0] !== rentOf(id).payer}<dt>Rented to</dt><dd>{view.coops[rentOf(id).payer].name}</dd><dt>Rent</dt><dd>{f(view.settings[rentOf(id).setting] ?? 0)} {TOKEN_LABEL[owner[1].mind]} a week</dd>{/if}
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
							{:else if a.id === 'tent'}
								<small>{f(view.settings.tentRent)} tribeMIND a week, inside the home rent: each player pays {f(view.settings.homeRent)} tribeMIND a week and uses everything.</small>
							{:else if rentOf(a.id) && c.id !== rentOf(a.id).payer}
								<small>Rented to the {view.coops[rentOf(a.id).payer].name} for {f(view.settings[rentOf(a.id).setting] ?? 0)} {TOKEN_LABEL[c.mind]} a week, paid each pay day.</small>
							{/if}
						</li>
					{/each}
				</ul>
				<p class="eyebrow">Treasury</p>
				<dl>
					{#each MINDS as t (t)}<dt>{TOKEN_LABEL[t]}</dt><dd>{f(c.treasury[t])}</dd>{/each}
					{#if c.treasury.EURO > 0}<dt title="System minted: each player's first mint brings €12,500 in (the euro ingest)">€uro</dt><dd>{f(c.treasury.EURO)}</dd>{/if}
					{#if c.id === 'tribe'}<dt>Gets home rent, a week</dt><dd>{f(view.settings.homeRent)} × 2 tribeMIND</dd>{/if}
					{#each RENTED.filter((r) => ownerOf(r.asset)?.[0] === c.id && r.payer !== c.id) as r (r.asset)}<dt>Gets {r.label} rent, a week</dt><dd>{f(view.settings[r.setting] ?? 0)} {TOKEN_LABEL[c.mind]}</dd>{/each}
					{#each RENTED.filter((r) => r.payer === c.id && ownerOf(r.asset) && ownerOf(r.asset)[0] !== c.id) as r (r.asset)}<dt>Pays {r.label} rent, a week</dt><dd>{f(view.settings[r.setting] ?? 0)} {TOKEN_LABEL[ownerOf(r.asset)[1].mind]}</dd>{/each}
					{#each SUBLET.filter((r) => r.payer === c.id) as r (r.key)}<dt>Pays {r.label} rent, a week</dt><dd>{f(view.settings[r.setting] ?? 0)} × 2 {TOKEN_LABEL[view.coops[rentOf(r.asset)?.payer]?.mind ?? 'VILLAGE']}</dd>{/each}
					{#each SUBLET.filter((r) => rentOf(r.asset)?.payer === c.id && r.payer !== c.id) as r (r.key)}<dt>Gets {r.label} rent, a week</dt><dd>{f(view.settings[r.setting] ?? 0)} × 2 {TOKEN_LABEL[c.mind]}</dd>{/each}
					{#each rents(view).filter((r) => r.from === `coop:${c.id}` && r.owed > 0.001) as r (r.what + r.to)}<dt>Owed: {r.what.toLowerCase()}</dt><dd class="bad">{f(r.owed)} {TOKEN_LABEL[r.token]}</dd>{/each}
				</dl>
				<div class="buttons">
					{#if canMove}<button class="primary" onclick={() => openWallet('invest', panel)}>Invest</button>{/if}
					{#if canMove}<button onclick={() => newMip({ from: panel, to: `player:${seat}`, token: c.mind, amount: 1 })}>Propose a payout</button>{/if}
					<button onclick={() => openWallet('home', panel)}>Its wallet</button>
					{#if c.id === 'maia'}<button onclick={() => openWallet('swap', '')}>Swap in the pool</button><button onclick={() => openWallet('home', 'pool')}>The pool’s wallet</button>{/if}
				</div>
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
				<p class="about">One game month {view.settings.hoursPerMonth === 24 ? 'a real day' : `every ${hrs(view.settings.hoursPerMonth)}`}, from year 0, on the 13-month calendar: 13 months of 28 days, Sol first (it begins on 21 March, the new year) and March last. Every month starts on a Sunday. Every balance melts continuously at {f(view.settings.demurrage * 100, 0)} % a year. Every game week ends in a pay day (the 8th, 15th, 22nd and the next 1st, each a Sunday): every rent is paid, a quarter of a month’s, and a payer short of a MIND swaps its others through the pool on its own; what is still missing is owed and paid first next pay day. Every sale pays its owners: {f(view.settings.dividendShare * 100, 0)} % of every rent a COOP is paid goes at once to the holders of its MIND, pro rata. Every setting and every COOP changes only through a MIP with {signaturesOf(view)} signature{signaturesOf(view) === 1 ? '' : 's'}.</p>
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
		bottom: var(--nav-room, 4.5rem); /* just over the nav pill (Samuel 2026-10-13: only a small gap) */
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
	.fade-in.end {
		animation-duration: 1.6s;
	}
	/* the very end: out to black under the last line */
	.fade-out {
		position: absolute;
		inset: 0;
		z-index: 9;
		background: #000;
		opacity: 0;
		pointer-events: none;
		animation: fadeto 1.8s ease-in calc(var(--dur) - 1.8s) forwards;
	}
	@keyframes fadeto {
		to { opacity: 1; }
	}
	/* the admin's growth preview, under the numbers at the top */
	.growth {
		position: absolute;
		z-index: 7;
		top: 4.2rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.5rem;
		border-radius: 999px;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.growth .what {
		margin: 0 0.3rem;
		color: #6b7a6f;
	}
	.growth button:not(.link) {
		width: 1.9rem;
		height: 1.9rem;
		border: 0;
		border-radius: 50%;
		background: rgb(36 69 47 / 0.1);
		font: inherit;
		cursor: pointer;
	}
	.growth button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.growth b {
		min-width: 6.5rem;
		text-align: center;
	}
	.growth small {
		margin-left: 0.2rem;
		color: #6b7a6f;
	}
	/* the walk's buttons, stacked bottom up: beside the tools down the left, clear of them and of the mint button */
	.walkbar {
		position: absolute;
		z-index: 7;
		left: calc(9.6rem + env(safe-area-inset-left, 0px));
		bottom: calc(var(--nav-room, 4rem) + 0.4rem);
		display: flex;
		flex-direction: column-reverse;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.walkbtn {
		padding: 0.7rem 1.2rem;
		border: 1px solid rgb(255 255 255 / 0.5);
		border-radius: 999px;
		background: rgb(250 248 242 / 0.94);
		color: #24452f;
		font: inherit;
		font-weight: 600;
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
		cursor: pointer;
	}
	.walkhint {
		position: absolute;
		z-index: 7;
		left: 50%;
		top: 4.5rem;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.9);
		color: #3a4a3f;
		font-size: 0.85rem;
		white-space: nowrap;
		pointer-events: none;
	}
	.mintbar.waterbar {
		bottom: calc(var(--nav-room, 4rem) + 4.2rem);
		background: #2c5a72;
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
	.intros span {
		align-self: center;
		padding: 0 0.4rem 0 0.7rem;
		font-size: 0.8rem;
		opacity: 0.7;
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
	.tag.tree {
		background: rgb(244 241 232 / 0.85);
		color: #2f5a36;
		pointer-events: none;
	}
	/* the five seedlings as one row of small pills (Samuel 2026-10-13: the big grid looked broken) */
	.tour .picks {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.4rem 0 0.55rem;
	}
	.tour .picks button {
		padding: 0.3rem 0.7rem;
		border: 1px solid rgb(31 42 35 / 0.18);
		border-radius: 999px;
		background: #fff;
		font-size: 0.8rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.tour .picks button:hover:not(:disabled) {
		border-color: #24452f;
		background: #eef3ec;
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

	/* ── the wallet: one banking sheet that pops up from the foot, over the nav pill's "+" ── */
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 8;
		padding: 0;
		border: 0;
		background: rgb(20 30 24 / 0.18);
		cursor: default;
		animation: fade 180ms ease-out;
	}
	.wallet {
		position: absolute;
		z-index: 9;
		left: 0;
		right: 0;
		bottom: calc(var(--nav-room, 4rem) + 0.2rem);
		display: flex;
		flex-direction: column;
		width: min(26rem, calc(100% - 16px));
		max-height: min(42rem, calc(100dvh - var(--nav-room, 4rem) - 5rem));
		margin: 0 auto;
		border-radius: 22px;
		background: rgb(250 248 242 / 0.97);
		box-shadow: 0 18px 50px rgb(20 30 24 / 0.28);
		transform-origin: 50% 100%;
		animation: pop 220ms cubic-bezier(0.2, 0.9, 0.3, 1.1);
		overflow: hidden;
	}
	.w-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.75rem 0.9rem 0.6rem;
		border-bottom: 1px solid rgb(31 42 35 / 0.08);
	}
	.w-who {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		line-height: 1.25;
	}
	.w-who small {
		font-size: 0.72rem;
		opacity: 0.6;
	}
	.w-back,
	.w-close {
		padding: 0.2rem 0.45rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font-size: 1.2rem;
		line-height: 1;
	}
	.w-back:hover,
	.w-close:hover {
		background: rgb(31 42 35 / 0.06);
	}
	.w-body {
		flex: 1 1 auto;
		min-height: 0;
		padding: 0.6rem 1rem 0.8rem;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.w-body :global(.ledger) {
		max-height: none;
	}
	.w-balance {
		margin: 0.3rem 0 0;
		font-family: var(--font-display);
		font-size: 2.3rem;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.w-balance.small-b {
		font-size: 1.7rem;
	}
	.w-balance span {
		font-family: var(--font-body);
		font-size: 1rem;
		opacity: 0.6;
	}
	.w-sub {
		margin: 0.1rem 0 0.7rem;
		font-size: 0.75rem;
		opacity: 0.6;
	}
	.w-mint {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin: 0 0 0.7rem;
		padding: 0.5rem 0.5rem 0.5rem 0.8rem;
		border-radius: 14px;
		background: rgb(36 69 47 / 0.08);
		font-size: 0.85rem;
	}
	.w-mint small {
		display: block;
		font-size: 0.7rem;
	}
	.w-mint button,
	.wallet > .w-body > button.primary {
		padding: 0.45rem 1rem;
		border: 0;
		border-radius: 999px;
		background: var(--brand-green, #24452f);
		color: #f4f1e8;
		font-weight: 600;
	}
	.dot {
		display: inline-block;
		width: 9px;
		height: 9px;
		margin-right: 0.4rem;
		border-radius: 3px;
	}
	.w-actions {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.4rem;
		padding: 0.55rem 0.7rem 0.7rem;
		border-top: 1px solid rgb(31 42 35 / 0.08);
	}
	.w-actions button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.45rem 0.2rem;
		border: 0;
		border-radius: 14px;
		background: rgb(31 42 35 / 0.05);
		font-size: 0.78rem;
		font-weight: 600;
	}
	.w-actions button.on {
		background: var(--brand-green, #24452f);
		color: #f4f1e8;
	}
	.w-ic {
		font-size: 1.05rem;
		line-height: 1;
	}
	.chain {
		margin: 0.4rem 0 0.4rem;
		padding: 0;
		list-style: none;
	}
	.chain li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.55rem;
		border-radius: 12px;
		font-size: 0.78rem;
		line-height: 1.25;
	}
	.chain li + li {
		margin-top: 0.15rem;
	}
	.chain li.on {
		background: rgb(36 69 47 / 0.08);
	}
	.c-from,
	.c-to {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}
	.c-to {
		justify-content: flex-end;
		text-align: right;
		flex-direction: row-reverse;
	}
	.c-from small {
		display: block;
		font-size: 0.66rem;
		opacity: 0.6;
	}
	.c-pay {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.c-pay b::after {
		content: ' →';
	}
	.c-pay small {
		max-width: 8.5rem;
		font-size: 0.64rem;
		opacity: 0.6;
	}
	.swapbox {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
	}
	.swapbox label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.55rem 0.7rem;
		border-radius: 14px;
		background: rgb(31 42 35 / 0.05);
		font-size: 0.78rem;
	}
	.swapbox label > span:first-child {
		display: flex;
		justify-content: space-between;
	}
	.swapbox small {
		opacity: 0.6;
	}
	.swapbox output {
		flex: 1 1 4rem;
		padding: 0.4rem 0.2rem;
		font-size: 1rem;
		font-variant-numeric: tabular-nums;
	}
	.flip {
		align-self: center;
		margin: -0.55rem 0;
		z-index: 1;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 3px solid rgb(250 248 242);
		border-radius: 50%;
		background: #e8e4d8;
	}
	.buttons .wide-b {
		flex: 1;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(28px) scale(0.94);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
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
		/* on a phone the tools are a menu: the walk's buttons in the corner, out of the way while it is open */
		.walkbar {
			left: max(1rem, env(safe-area-inset-left, 0px));
		}
		.tools.open ~ .walkbar {
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
		.wallet {
			max-height: 50dvh;
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
		.wallet {
			max-height: calc(100dvh - var(--nav-room, 4rem) - 1rem);
		}
		.w-balance {
			font-size: 1.8rem;
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
