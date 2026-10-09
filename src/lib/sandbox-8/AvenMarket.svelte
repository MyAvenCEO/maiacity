<!--
	avenCITY Sandbox 7 — avens trading ($lib/sandbox-8). Five blobs in a 2D valley, each with 125,000 HEARTS and a territory
	that grows 2 of the 5 goods. They walk to each other and trade at their own prices; every morning each one's prices are
	decided by Liquid's decision model d1:free (or a local rule when Liquid is out of reach). Survive, and end with the most HEARTS.
-->
<script>
	import { onMount } from 'svelte';
	import { createWorld, step, ranking, MARKET, ROT, MINT_PER_DAY, DECAY_PER_YEAR, GOODS, GOOD_LABEL, GOOD_COLOUR, NEED, WORLD, DAY_S, START_HEARTS } from './economy.js';
	import PriceChart from './PriceChart.svelte';
	import { stateFor, questionsFor, askLiquid, localAnswers, applyAnswers, LIQUID_MODEL, TOOLS } from './brain.js';

	const SPEEDS = [
		{ k: 1, label: 'Real time' },
		{ k: 24, label: '1 day = 1 h' },
		{ k: 1440, label: '1 day = 1 min' },
		{ k: 8640, label: '1 month = 5 min' }
	];

	let world = createWorld();
	let speed = $state(8640);
	let paused = $state(false);
	let tab = $state('market');
	let selected = $state(0);
	let panelOpen = $state(true);
	let snap = $state(snapshot());
	let calls = $state({ asked: 0, answered: 0, failed: 0, lastError: /** @type {string} */ ('') });

	/** @type {HTMLCanvasElement} */
	let canvas;
	/** @type {HTMLDivElement} */
	let stageEl;

	/** @param {number} n */
	function fmt(n) {
		return Math.round(n).toLocaleString('en-US');
	}
	/** @param {number} f a markup factor, as ±% against the market */
	function pctOf(f) {
		const p = Math.round((f - 1) * 100);
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
			series: tab === 'prices' ? Object.fromEntries(GOODS.map((g) => { const all = world.market[g].series; const every = Math.max(1, Math.ceil(all.length / 300)); return [g, all.filter((/** @type {any} */ _p, /** @type {number} */ i) => i % every === 0 || i === all.length - 1).map((/** @type {any} */ p) => ({ ...p }))]; })) : {},
			month: Math.floor((world.day - 1) / 30) + 1,
			board: ranking(world).map((o) => ({ id: o.id, name: o.name, colour: o.colour, hearts: o.hearts, health: o.health, alive: o.alive, diedOn: o.diedOn, grows: o.grows, source: o.brain.last?.source ?? '—', pending: o.brain.pending })),
			market: Object.fromEntries(
				GOODS.map((g) => {
					const m = world.market[g];
					// the real-time average: every trade of this good in the last 24 in-game hours, weighted by units
					const recent = world.trades.filter((/** @type {any} */ t) => t.good === g && world.t - t.t < DAY_S);
					const units = recent.reduce((/** @type {number} */ n, /** @type {any} */ t) => n + t.qty, 0);
					const avg = units ? Math.round(recent.reduce((/** @type {number} */ n, /** @type {any} */ t) => n + t.qty * t.price, 0) / units) : null;
					return [g, { avg, units, rotted: world.rotted[g], price: m.price, open: m.open, supply: m.supply, demand: m.demand, history: m.history.slice(-30).concat(m.price), sells: m.sells.map((/** @type {any} */ o) => ({ ...o })), wants: m.wants.map((/** @type {any} */ o) => ({ ...o })) }];
				})
			),
			aven: {
				...a,
				stock: { ...a.stock },
				harvest: { ...a.harvest },
				ask: { ...a.ask },
				markup: { ...a.markup },
				bid: { ...a.bid },
				ledger: a.ledger.slice(-80).reverse(),
				brain: { ...a.brain }
			}
		};
	}

	/** the morning: every living aven decides its prices for the day */
	function morning() {
		for (const a of world.avens) {
			if (!a.alive || a.brain.pending) continue;
			a.brain.pending = true;
			calls.asked++;
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), 20000);
			const myWorld = world;
			askLiquid(stateFor(world, a), questionsFor(world, a), { signal: ctrl.signal })
				.then((answers) => {
					if (myWorld !== world || !a.alive) return;
					calls.answered++;
					a.brain.error = null;
					applyAnswers(world, a, answers, 'liquid');
				})
				.catch((/** @type {any} */ e) => {
					if (myWorld !== world) return;
					calls.failed++;
					calls.lastError = e?.name === 'AbortError' ? 'timed out' : e?.message || 'unreachable';
					a.brain.error = calls.lastError;
					if (a.alive) applyAnswers(world, a, localAnswers(world, a), 'local');
				})
				.finally(() => {
					clearTimeout(timer);
					a.brain.pending = false;
				});
		}
	}

	function reset() {
		world = createWorld();
		calls = { asked: 0, answered: 0, failed: 0, lastError: '' };
		morning();
		snap = snapshot();
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
			// the two crops as fields, last night's harvest written in each
			a.grows.forEach((/** @type {string} */ g, /** @type {number} */ i) => {
				const ang = -Math.PI / 2 + (i ? 0.9 : -0.9);
				const fx = t.x + Math.cos(ang) * t.r * 0.62,
					fy = t.y + Math.sin(ang) * t.r * 0.62;
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
				ctx.font = '600 11px system-ui, sans-serif';
				ctx.fillText(`${GOOD_LABEL[g]} /day`, fx, fy + 30);
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
			ctx.fillText(`${a.name}'s land`, t.x, t.y + t.r + 18);
		}

		// the market square in the middle: a paved round with stalls in the five goods' colours
		ctx.fillStyle = light > 0.5 ? '#efe6d2' : '#5b5546';
		ctx.strokeStyle = '#a8916088';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(MARKET.x, MARKET.y, MARKET.r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		GOODS.forEach((g, i) => {
			const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
			const sx = MARKET.x + Math.cos(ang) * MARKET.r * 0.78,
				sy = MARKET.y + Math.sin(ang) * MARKET.r * 0.78;
			ctx.fillStyle = GOOD_COLOUR[g];
			ctx.beginPath();
			ctx.roundRect(sx - 9, sy - 6, 18, 12, 3);
			ctx.fill();
		});
		ctx.fillStyle = light > 0.5 ? '#6b5a3a' : '#e8dcc0';
		ctx.font = '700 13px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('MARKET', MARKET.x, MARKET.y + 4);

		// trades just made: a ring and a coloured spark where they met
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
			ctx.fillText(a.alive ? `${a.name} · ${fmt(a.hearts)} ♥` : `${a.name} †`, a.x, a.y - r - 12);
			if (a.brain.pending) {
				ctx.font = '11px system-ui, sans-serif';
				ctx.fillText('thinking…', a.x, a.y + r + 18);
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
		morning();
		let last = performance.now();
		let lastSnap = 0;
		let raf = 0;
		const frame = (/** @type {number} */ now) => {
			const dtReal = Math.min(250, now - last);
			last = now;
			if (!paused) {
				let game = (dtReal / 1000) * speed;
				while (game > 0) {
					const d = Math.min(120, game);
					game -= d;
					if (step(world, d)) morning();
				}
			}
			draw(now);
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
		if (e.kind === 'price') return `${e.source === 'liquid' ? 'Liquid' : 'local rule'}: ${e.changes.length ? e.changes.join('; ') : 'kept every price'}`;
		if (e.kind === 'death') return 'died';
		if (e.kind === 'rot') return `rotted: ${Object.entries(e.rotted).map(([g, n]) => `${n} ${GOOD_LABEL[g]}`).join(', ')}`;
		if (e.kind === 'grow') return `${e.note === 'bad' ? 'bad' : 'rich'} harvest: ${e.qty} ${GOOD_LABEL[e.good]} (usually ${e.cap})`;
		return e.kind;
	};
</script>

<div class="market" class:open={panelOpen}>
	<header>
		<div class="title">
			<b>Sandbox 7 · Avens trading</b>
			<span>Day {snap.day} · {snap.time} · month {snap.month}</span>
		</div>
		<div class="controls">
			<button onclick={() => (paused = !paused)}>{paused ? '▶ Play' : '❚❚ Pause'}</button>
			<select bind:value={speed} aria-label="Speed">
				{#each SPEEDS as sp (sp.k)}<option value={sp.k}>{sp.label}</option>{/each}
			</select>
			<button onclick={reset}>Reset</button>
			<button class="panel-btn" onclick={() => (panelOpen = !panelOpen)}>{panelOpen ? 'Hide books' : 'Books'}</button>
		</div>
	</header>

	<div class="stage" bind:this={stageEl}>
		<canvas bind:this={canvas} onpointerdown={onPointer}></canvas>
		<div class="ticker" aria-label="Prices">
			{#each GOODS as g (g)}
				<span><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]} <b>{snap.market[g].price}</b> <small>avg {snap.market[g].avg ?? '—'}</small></span>
			{/each}
		</div>
	</div>

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
							<span class="delta" class:up={row.hearts >= START_HEARTS}>{row.alive ? `${row.hearts >= START_HEARTS ? '+' : ''}${fmt(row.hearts - START_HEARTS)}` : ''}</span>
						</button>
					</li>
				{/each}
			</ol>
			<p class="brain">HEARTS: every aven mints {MINT_PER_DAY} a day; every HEART decays {Math.round(DECAY_PER_YEAR * 100)}% a year.</p>
			<p class="brain">
				Brains: Liquid {LIQUID_MODEL} · {calls.answered} of {calls.asked} answered{#if calls.failed}&nbsp;· {calls.failed} unanswered, decided by the stand-in rule ({calls.lastError}){/if}
			</p>
		</section>

		<nav class="tabs">
			<button class:on={tab === 'market'} onclick={() => (tab = 'market')}>Market</button>
			<button class:on={tab === 'prices'} onclick={() => (tab = 'prices')}>Prices</button>
			<button class:on={tab === 'ledger'} onclick={() => (tab = 'ledger')}>{snap.aven.name}'s ledger</button>
		</nav>

		{#if tab === 'prices'}
		<section>
			<PriceChart series={snap.series} now={snap.t} />
			<table class="avgs">
				<thead><tr><th>Good</th><th>Market</th><th>Avg traded, 24 h</th><th>Units, 24 h</th></tr></thead>
				<tbody>
					{#each GOODS as g (g)}<tr><td><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]}</td><td class="num">{snap.market[g].price}</td><td class="num">{snap.market[g].avg ?? '—'}</td><td class="num">{snap.market[g].units}</td></tr>{/each}
				</tbody>
			</table>
		</section>
		{:else if tab === 'market'}
		<section class="market-board">
			<p class="sub">Live: who sells and who wants what, right now. The market price leans up when more is wanted than offered, down when more is offered, and follows each day's trades.</p>
			{#each GOODS as g (g)}
				{@const m = snap.market[g]}
				{@const change = m.open ? Math.round(((m.price - m.open) / m.open) * 100) : 0}
				{@const lo = Math.min(...m.history)}
				{@const hi = Math.max(...m.history)}
				<div class="good">
					<div class="good-head">
						<span><em style:background={GOOD_COLOUR[g]}></em><b>{GOOD_LABEL[g]}</b></span>
						<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
							<polyline fill="none" stroke={GOOD_COLOUR[g]} stroke-width="2" points={m.history.map((/** @type {number} */ p, /** @type {number} */ i) => `${(i / Math.max(1, m.history.length - 1)) * 100},${22 - ((p - lo) / Math.max(1, hi - lo)) * 20}`).join(' ')} />
						</svg>
						<span class="num" title="market price"><b>{m.price}</b> ♥ <small class:up={change > 0} class:down={change < 0}>{change > 0 ? '+' : ''}{change}%</small></span>
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
				{snap.aven.alive ? `${fmt(snap.aven.hearts)} HEARTS · health ${snap.aven.health}` : `died on day ${snap.aven.diedOn}`} · keeps {snap.aven.reserveDays} days in stock<br />minted +{fmt(snap.aven.minted)} · decayed −{fmt(snap.aven.decayed)} so far
			</p>
			<div class="scroll"><table>
				<thead><tr><th>Good</th><th title="needed a day">Need</th><th title="grows a day on average, and last night's harvest">Grows</th><th title="share that rots each night">Rots</th><th>Stock</th><th title="market price">Mkt</th><th title="sells at, against the market">Sells</th><th title="pays up to, against the market">Pays</th></tr></thead>
				<tbody>
					{#each GOODS as g (g)}
						<tr>
							<td><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]}</td>
							<td class="num">{NEED[g]}</td>
							<td class="num">{#if snap.aven.produce[g] != null}{snap.aven.produce[g]}<small>last {snap.aven.harvest[g]}</small>{/if}</td>
							<td class="num">{ROT[g] ? `${Math.round(ROT[g] * 100)}%` : '—'}</td>
							<td class="num">{snap.aven.stock[g]}</td>
							<td class="num">{snap.market[g].price}</td>
							<td class="num">{#if snap.aven.ask[g] != null}{snap.aven.ask[g]}<small>{pctOf(snap.aven.markup[g])}</small>{/if}</td>
							<td class="num">{#if snap.aven.bid[g] != null}{snap.aven.bid[g]}<small>{pctOf(snap.aven.markup[g])}</small>{/if}</td>
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
