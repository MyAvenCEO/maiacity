<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Figure 14: MIND goes round. New MIND (24 HEARTS a day convert) reaches people and treasuries; treasuries pay people
	// for their Avens' work items; people spend at the COOPs, so the MIND comes back. At each sale, Law 5's share branches
	// off at once to the holders, and only the rest reaches the treasury. A little melts in each place. Arrow widths are shares of a person's income, and gold MIND coins travel along each arrow at a
	// rate in proportion to its flow. Two worlds: the dynamic world (wants that keep growing) and the earlier static one.
	import { onMount } from 'svelte';
	import { runClock, watchNarrow, HEART } from './anim.js';
	import { ROUND_TRIP, ROUND_TRIP_STATIC, ofIncome, flowSum, fmt, RATE, UIA_DAY } from './model.js';

	const GOLD = '#d9a520', MELT = '#8a8578';
	// wide: new MIND on top, people left, treasuries right, the pools at the bottom right, the melt as a band below.
	// SALE is the point where each payment splits: Law 5's share back to the holders, the rest on to the treasury.
	// narrow: the same, taller, so that it reads on a phone held upright
	const LAYOUT = {
		wide: { w: 680, h: 420, NEW: [340, 78], nr: 24, PEOPLE: [130, 210], TREAS: [550, 210], R: 46, POOLS: [612, 322], pr: 20, band: 386, poolsLabel: [640, 326, 'start'],
			SALE: [340, 150], divName: 'dividends, at each sale',
			bend: { own: 34, coop: -34, buy: -18, keep: -18, work: -50, div: -10 }, at: { buy: [-38, -142], work: [158, 24], div: -2, meltP: 100, meltT: 80, tenth: 38 },
			lab: { own: [214, 112, 'end'], coop: [466, 112, 'start'], buy: [340, 126, 'middle'], work: [340, 278, 'middle'], div: [300, 214, 'middle'], meltP: [132, 352, 'start'], meltT: [546, 352, 'end'] } },
		narrow: { w: 360, h: 620, NEW: [180, 84], nr: 22, PEOPLE: [78, 270], TREAS: [282, 270], R: 42, POOLS: [326, 432], pr: 17, band: 570, poolsLabel: [358, 472, 'end'],
			SALE: [180, 205], divName: 'dividends',
			bend: { own: 40, coop: -40, buy: -12, keep: -12, work: -56, div: -8 }, at: { buy: [-50, -130], work: [160, 30], div: -5, meltP: 100, meltT: 80, tenth: 40 },
			lab: { own: [8, 140, 'start'], coop: [354, 140, 'end'], buy: [180, 178, 'middle'], work: [180, 344, 'middle'], div: [204, 242, 'middle'], meltP: [84, 520, 'start'], meltT: [276, 520, 'end'] } }
	};

	// the flows of one world, R a person a day
	const flowsOf = (rt) => ({
		own: rt.people.in.own,
		coop: rt.treasuries.in.own + rt.pools.in.tenth,
		tenth: rt.pools.in.tenth,
		work: rt.people.in.items + rt.people.in.proposals,
		div: rt.people.in.dividends,
		buy: rt.people.out.buying,
		keep: rt.people.out.buying - rt.people.in.dividends,
		meltP: rt.people.out.melt,
		meltT: rt.treasuries.out.melt,
		meltX: rt.pools.out.melt
	});
	const WORLDS = {
		dyn: { label: 'Dynamic world', rt: ROUND_TRIP },
		stat: { label: 'Static world', rt: ROUND_TRIP_STATIC }
	};
	const pctOf = (v, rt) => `${fmt(ofIncome(v, rt) * 100)} %`;
	const D = flowsOf(ROUND_TRIP), S = flowsOf(ROUND_TRIP_STATIC);
	const aria = `MIND goes round. New MIND from the HEARTS that people invest reaches their wallets and the COOP treasuries. Treasuries pay people for their Avens' work items. People spend at the COOPs, so the MIND comes back. At each sale, the Law 5 share goes at once to the holders, and only the rest reaches the treasury. A little melts in each place. In the dynamic world, people spend ${pctOf(D.buy, ROUND_TRIP)} of their income and ${pctOf(D.meltP, ROUND_TRIP)} melts in their wallets. In the static world, they spend ${pctOf(S.buy, ROUND_TRIP_STATIC)} and ${pctOf(S.meltP, ROUND_TRIP_STATIC)} melts.`;

	let box;
	let narrow = $state(false);
	let world = $state('dyn');
	let t = $state(3);
	const L = $derived(narrow ? LAYOUT.narrow : LAYOUT.wide);
	const rt = $derived(WORLDS[world].rt);
	const F = $derived(flowsOf(rt));
	const share = (v) => v / flowSum(rt.people.in);

	const rim = (c, r, deg) => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
	// the control point of a bent path, as in anim.js's arc()
	const ctrl = (a, b, bend) => {
		const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
		return [(a[0] + b[0]) / 2 - (dy / len) * bend, (a[1] + b[1]) / 2 + (dx / len) * bend];
	};
	const qp = (a, m, b, p) => {
		const q = 1 - p;
		return [q * q * a[0] + 2 * q * p * m[0] + p * p * b[0], q * q * a[1] + 2 * q * p * m[1] + p * p * b[1]];
	};
	// one arrow: its path (stopping short of the tip), its head, its length, and its width
	function arrow(a, b, bend, flow, melt = false, tip = true) {
		const w = 1.5 + 22 * share(flow);
		const m = ctrl(a, b, bend);
		const tx = b[0] - m[0], ty = b[1] - m[1], tl = Math.hypot(tx, ty) || 1;
		const ux = tx / tl, uy = ty / tl, hl = tip ? Math.max(9, w * 0.9) : 0, hw = w / 2 + 5;
		const base = [b[0] - ux * hl, b[1] - uy * hl];
		const m2 = ctrl(a, base, bend);
		let len = 0, prev = a;
		for (let i = 1; i <= 16; i++) {
			const p = qp(a, m2, base, i / 16);
			len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
			prev = p;
		}
		const head = tip ? `M${b[0]},${b[1]} L${base[0] - uy * hw},${base[1] + ux * hw} L${base[0] + uy * hw},${base[1] - ux * hw} Z` : '';
		return { a, m: m2, b: base, d: `M${a[0]},${a[1]} Q${m2[0]},${m2[1]} ${base[0]},${base[1]}`, head, len, w, n: Math.max(1, Math.round(share(flow) * 18)), melt };
	}

	const A = $derived.by(() => {
		const { NEW, nr, PEOPLE, TREAS, R, POOLS, pr, band, bend, at, SALE } = L;
		return {
			own: arrow(rim(NEW, nr + 3, 180 - 25), rim(PEOPLE, R + 4, -80), bend.own, F.own),
			coop: arrow(rim(NEW, nr + 3, 25), rim(TREAS, R + 4, -100), bend.coop, F.coop),
			buy: arrow(rim(PEOPLE, R + 3, at.buy[0]), SALE, bend.buy, F.buy, false, false),
			keep: arrow(SALE, rim(TREAS, R + 4, at.buy[1]), bend.keep, F.keep),
			div: arrow(SALE, rim(PEOPLE, R + 4, at.div), bend.div, F.div),
			work: arrow(rim(TREAS, R + 3, at.work[0]), rim(PEOPLE, R + 4, at.work[1]), bend.work, F.work),
			tenth: arrow(rim(TREAS, R + 3, at.tenth), rim(POOLS, pr + 4, -90), 0, F.tenth),
			meltP: arrow(rim(PEOPLE, R + 3, at.meltP), [rim(PEOPLE, R, at.meltP)[0], band - 2], 0, F.meltP, true),
			meltT: arrow(rim(TREAS, R + 3, at.meltT), [rim(TREAS, R, at.meltT)[0], band - 2], 0, F.meltT, true),
			meltX: arrow(rim(POOLS, pr + 3, 90), [POOLS[0], band - 2], 0, F.meltX, true)
		};
	});

	const SPEED = 46; // px a second
	const coins = (ar) =>
		Array.from({ length: ar.n }, (_, i) => {
			const p = ((t * SPEED) / ar.len + i / ar.n) % 1;
			const [x, y] = qp(ar.a, ar.m, ar.b, p);
			return { x, y, o: ar.melt ? 1 - p : 1 };
		});

	const LABELS = $derived([
		['own', 'ownership', pctOf(F.own, rt)],
		['coop', 'the COOP’s half', ''],
		['buy', 'spent at COOPs', pctOf(F.buy, rt)],
		['work', 'Aven work items', pctOf(F.work, rt)],
		['div', L.divName, pctOf(F.div, rt)],
		['meltP', 'melts', pctOf(F.meltP, rt)],
		['meltT', 'melts', pctOf(F.meltT, rt)]
	]);

	onMount(() => {
		const a = runClock(box, (s) => (t = s), 3);
		const b = watchNarrow(box, (n) => (narrow = n));
		return () => (a(), b());
	});
</script>

<div bind:this={box}>
<svg viewBox="0 0 {L.w} {L.h}" role="img" aria-label={aria}>
	<!-- the melt: a faded sink under everything -->
	<rect x="16" y={L.band} width={L.w - 32} height="26" rx="8" fill={MELT} opacity="0.14" />
	<text x={L.w / 2} y={L.band + 17} text-anchor="middle" class="sub">melt, {fmt(RATE * 100)} % a year: gone for good</text>

	<!-- the arrows, widths as shares of a person's income -->
	{#each Object.entries(A) as [k, ar] (k)}
		<path d={ar.d} fill="none" stroke={ar.melt ? MELT : GOLD} stroke-width={ar.w} stroke-linecap="butt" opacity={ar.melt ? 0.32 : 0.36} />
		<path d={ar.head} fill={ar.melt ? MELT : GOLD} opacity={ar.melt ? 0.5 : 0.7} />
	{/each}

	<!-- MIND coins, travelling at rates in proportion to the flows -->
	{#each Object.entries(A) as [k, ar] (k)}
		{#each coins(ar) as c, i (i)}
			<circle cx={c.x} cy={c.y} r={narrow ? 3.3 : 3.8} fill={ar.melt ? MELT : GOLD} stroke="var(--paper)" stroke-width="1" opacity={c.o} />
		{/each}
	{/each}

	<!-- each sale: the payment splits here, Law 5's share back to the holders, the rest on to the treasury -->
	<circle cx={L.SALE[0]} cy={L.SALE[1]} r="5.5" fill={GOLD} stroke="var(--ink)" stroke-width="1.2" />

	<!-- the places -->
	<g transform="translate({L.NEW[0]} {L.NEW[1]})">
		<circle r={L.nr} fill={GOLD} opacity="0.9" />
		<path d={HEART} fill="#c8744f" transform="scale(2)" />
		<text y={-L.nr - 22} text-anchor="middle" class="node">New MIND</text>
		<text y={-L.nr - 8} text-anchor="middle" class="sub">{UIA_DAY} HEARTS a day convert</text>
	</g>
	{#each [[L.PEOPLE, 'People’s', 'wallets'], [L.TREAS, 'COOP', 'treasuries']] as [p, a, b] (a)}
		<g transform="translate({p[0]} {p[1]})">
			<circle r={L.R} fill="var(--paper)" stroke="var(--ink)" stroke-width="1.4" />
			<text y="-2" text-anchor="middle" class="node">{a}</text>
			<text y="14" text-anchor="middle" class="node">{b}</text>
		</g>
	{/each}
	<g transform="translate({L.POOLS[0]} {L.POOLS[1]})">
		<circle r={L.pr} fill="var(--paper)" stroke="#5b8fa8" stroke-width="1.6" />
		<path d="M-11 -2 q4 -4 7.5 0 t7.5 0 t7.5 0 M-11 5 q4 -4 7.5 0 t7.5 0 t7.5 0" fill="none" stroke="#5b8fa8" stroke-width="1.4" stroke-linecap="round" transform="translate(-0.5 0)" />
	</g>
	<text x={L.poolsLabel[0]} y={L.poolsLabel[1]} text-anchor={L.poolsLabel[2]} class="sub">pools</text>

	<!-- what each arrow carries, as a share of a person's income -->
	{#each LABELS as [k, name, v] (k)}
		{@const [x, y, anchor] = L.lab[k]}
		<text {x} {y} text-anchor={anchor} class="lab">{name}{#if v}<tspan class="amt" dx="4">{v}</tspan>{/if}</text>
	{/each}
</svg>
<div class="controls">
	<div class="tog" role="group" aria-label="Which world">
		{#each Object.entries(WORLDS) as [k, w] (k)}
			<button class:on={world === k} aria-pressed={world === k} onclick={() => (world = k)}>{w.label}</button>
		{/each}
	</div>
	<p>Arrow widths are shares of a person’s income.</p>
</div>
</div>

<style>
	svg {
		display: block;
		width: 100%;
		height: auto;
		font-family: var(--font-body);
	}

	.node {
		font-size: 13.5px;
		font-weight: 600;
		fill: var(--ink);
	}

	.sub {
		font-size: 11.5px;
		fill: var(--ink-soft);
	}

	.lab {
		font-size: 12px;
		fill: var(--ink-soft);
	}

	.amt {
		font-weight: 600;
		fill: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		margin-top: 0.5rem;
		font-family: var(--font-body);
	}

	.controls p {
		margin: 0;
		font-size: 0.8rem;
		color: var(--ink-soft);
	}

	.tog {
		display: inline-flex;
		border: 1px solid var(--ink-soft);
		border-radius: 999px;
		overflow: hidden;
	}

	.tog button {
		padding: 0.3rem 0.8rem;
		border: 0;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.tog button.on {
		background: #d9a520;
		color: #26382c;
		font-weight: 600;
	}
</style>
