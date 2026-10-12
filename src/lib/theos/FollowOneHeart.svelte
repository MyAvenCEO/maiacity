<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Laws 4 and 5, told as a story in five steps: Anna invests one HEART into the solar COOP; it converts and is gone;
	// one new SOLARmind appears, half in Anna's wallet (her ownership) and half in the treasury (working capital); Anna
	// pays for her lamp's power in SOLARmind, and at that moment a fifth of the sale goes to every SOLARmind holder as a
	// dividend (Law 5), the rest to the treasury; the treasury pays it out again, through proposals: a tenth of its half
	// drips into the pool, the panel COOP gets its own PANELmind through the pool, and Mia gets SOLARmind for her Aven's
	// work proposal. Coin areas are to scale.
	import { onMount } from 'svelte';
	import { runClock, watchNarrow, HEART, ease, arc } from './anim.js';

	const STEP = 4.2, REST = 1.6, N = 5, CYCLE = N * STEP + REST;
	// wide: Anna, the holders, the COOP, the lamp and Mia above; the wallet, the treasury, the pool and the panel COOP
	// below. narrow: two columns, the people on the left, the COOP's side on the right, the holders beside Anna
	const LAYOUT = {
		wide: { w: 680, h: 336, ANNA: [64, 84], HOLD: [186, 84], COOP: [310, 84], LAMP: [440, 84], MIA: [570, 84], WALLET: [80, 250], TREASURY: [310, 250], POOL: [460, 250], PANEL: [600, 250], box: 132 },
		narrow: { w: 360, h: 600, ANNA: [52, 70], HOLD: [150, 70], COOP: [280, 70], WALLET: [90, 212], TREASURY: [270, 212], LAMP: [90, 352], POOL: [270, 352], MIA: [80, 500], PANEL: [270, 500], box: 150 }
	};
	const SPOT = (p) => [p[0] - 40, p[1]];
	const STEPS = [
		'Anna invests one AnnaHEART into the solar COOP.',
		'The HEART converts and is gone for good. One new SOLARmind appears.',
		'Half goes to Anna’s wallet: she now owns part of the COOP. Half goes to the treasury: the COOP’s working capital. It is the same SOLARmind.',
		'Anna switches on her lamp and pays 0.10 SOLARmind for the power. At that moment a fifth of it, 0.02, goes to everyone who holds SOLARmind, as a dividend (Law 5). Anna holds some too, so a little comes back to her. The other 0.08 goes to the treasury.',
		'The treasury pays it out again. A tenth of its half drips into the pool. The panel COOP gets 0.20 through the pool, as its own PANELmind. Mia gets 0.15 for her Aven’s work proposal.'
	];
	const USE = 0.1, DIV = 0.02, DRIP = 0.05, PAY = 0.2, WORK = 0.15;
	const GOLD = '#d9a520', STEEL = '#7d97ad';

	let box, still = false;
	let narrow = $state(false);
	const L = $derived(narrow ? LAYOUT.narrow : LAYOUT.wide);
	let t = $state(0);
	let offset = $state(N * STEP - 0.01);
	const c = $derived((t + offset) % CYCLE);
	const step = $derived(Math.min(N - 1, Math.floor(c / STEP)));
	const raw = $derived(Math.min(1, (c - step * STEP) / (STEP * 0.75)));
	const k = $derived(ease(raw));
	const done = (i) => (step > i || (step === i && raw >= 1) ? 1 : 0);
	// steps 4 and 5 have two moves each. Step 4: Anna's payment to the COOP, then the dividend out to the holders.
	// Step 5: SOLARmind out of the treasury (into the pool and to Mia), then PANELmind out of the pool
	const k1 = $derived(ease(Math.min(1, raw * 2)));
	const k2 = $derived(ease(Math.max(0, raw * 2 - 1)));
	const into = $derived(step > 4 ? 1 : step === 4 ? k1 : 0);
	const out = $derived(step === 4 ? k2 : 0);
	const lit = $derived(step >= 3 ? (step === 3 ? k1 : 1) : 0);

	const wallet = $derived(0.5 * done(2) - USE * done(3));
	const treasury = $derived(0.5 * done(2) + (USE - DIV) * done(3) - (DRIP + PAY + WORK) * (into >= 1 ? 1 : 0));
	const held = $derived(DIV * done(3));
	const panel = $derived(step === 4 && raw >= 1 ? PAY : 0);
	const mia = $derived(WORK * (into >= 1 ? 1 : 0));
	const r = (a) => 21 * Math.sqrt(Math.max(0, a));
	const lerp = (a, b, p) => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];

	function go(i) {
		offset = i * STEP + (still ? STEP - 0.01 : 0.01) - t;
	}

	onMount(() => {
		still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		offset = 0;
		const a = runClock(box, (s) => (t = s), N * STEP - 0.01);
		const b = watchNarrow(box, (n) => (narrow = n));
		return () => (a(), b());
	});
</script>

<div bind:this={box}>
<div class="scroll">
<svg viewBox="0 0 {L.w} {L.h}" class:narrow role="img" aria-label="Follow one HEART in five steps. Anna invests one AnnaHEART into the solar COOP. It converts and is gone, and one new SOLARmind appears. Half goes to Anna's wallet as her ownership, and half to the COOP's treasury as working capital. Anna pays for her lamp's power with a little SOLARmind. At that moment a fifth of the payment goes to everyone who holds SOLARmind as a dividend, and the rest goes to the treasury. The treasury pays it out again: a tenth of its half drips into the pool, the panel COOP receives its own PANELmind through the pool, and Mia receives SOLARmind for her Aven's work proposal.">
	<!-- steps 4 and 5: the power that Anna pays for, from the COOP to her lamp -->
	{#if lit > 0}
		<line x1={L.COOP[0]} y1={L.COOP[1]} x2={L.LAMP[0]} y2={L.LAMP[1]} stroke="#e0b030" stroke-width="3" stroke-dasharray="7 6" stroke-dashoffset={-t * 24} opacity={lit * 0.9} />
	{/if}

	<!-- Anna and Mia -->
	{#each [[L.ANNA, 'Anna', '', '#26382c', 0], [L.MIA, 'Mia', 'her Aven proposed work', '#4f6f5c', mia]] as [p, name, sub, col, a]}
		<g transform="translate({p[0]} {p[1]})">
			<circle cy="-14" r="11" fill={col} />
			<path d="M-17 22 C-17 0 17 0 17 22 Z" fill={col} />
			<text y="44" text-anchor="middle" class="node">{name}</text>
			{#if sub}<text y="59" text-anchor="middle" class="sub">{sub}</text>{/if}
			{#if a > 0.001}
				<circle cx="34" cy="2" r={r(a)} fill={GOLD} opacity="0.88" />
				<text x="46" y="0" class="amt">{a.toFixed(2)}</text>
				<text x="46" y="13" class="unit">SOLARmind</text>
			{/if}
		</g>
	{/each}

	<!-- everyone who holds SOLARmind: people and other COOPs -->
	<g transform="translate({L.HOLD[0]} {L.HOLD[1]})">
		{#each [[-22, 5, 0.78], [22, 5, 0.78], [0, 0, 0.9]] as [dx, dy, s]}
			<g transform="translate({dx} {dy}) scale({s})">
				<circle cy="-14" r="11" fill="#8a9a8f" stroke="var(--paper)" stroke-width="1.5" />
				<path d="M-17 22 C-17 0 17 0 17 22 Z" fill="#8a9a8f" stroke="var(--paper)" stroke-width="1.5" />
			</g>
		{/each}
		<text y="44" text-anchor="middle" class="node">SOLARmind holders</text>
		<text y="59" text-anchor="middle" class="sub">people and other COOPs</text>
		{#if held > 0.001}
			<circle cx="-12" cy="-44" r={r(held) + 1} fill={GOLD} opacity="0.88" />
			<text x="-2" y="-46" class="amt">{held.toFixed(2)}</text>
			<text x="-2" y="-34" class="unit">dividend</text>
		{/if}
	</g>

	<!-- the solar COOP -->
	<g transform="translate({L.COOP[0]} {L.COOP[1]})">
		<circle r="28" fill="var(--paper)" stroke="#d99a2b" stroke-width="3" />
		{#each Array(8) as _, i}
			{@const a = (i / 8) * Math.PI * 2}
			<line x1={Math.cos(a) * 33} y1={Math.sin(a) * 33} x2={Math.cos(a) * 40} y2={Math.sin(a) * 40} stroke="#d99a2b" stroke-width="2.5" stroke-linecap="round" />
		{/each}
		<text y="60" text-anchor="middle" class="node">solar COOP</text>
	</g>

	<!-- Anna's lamp -->
	<g transform="translate({L.LAMP[0]} {L.LAMP[1]})">
		<circle r="30" fill="#f2c94c" opacity={lit * 0.35} />
		<path d="M-10 4 A13 13 0 1 1 10 4 L7 14 H-7 Z" fill={lit > 0.5 ? '#f2c94c' : 'var(--paper)'} stroke="var(--ink)" stroke-width="1.4" />
		<rect x="-6" y="16" width="12" height="5" rx="1.5" fill="var(--ink)" />
		<text y="44" text-anchor="middle" class="node">Anna’s lamp</text>
		<text y="59" text-anchor="middle" class="sub" opacity={lit}>paid in SOLARmind</text>
	</g>

	<!-- the pool: a basket of MINDs that belongs to the protocol -->
	<g transform="translate({L.POOL[0]} {L.POOL[1]})">
		<circle r="30" fill="var(--paper)" stroke="#5b8fa8" stroke-width="1.6" />
		<path d="M-18 -2 q6 -6 12 0 t12 0 t12 0 M-18 8 q6 -6 12 0 t12 0 t12 0" fill="none" stroke="#5b8fa8" stroke-width="1.6" stroke-linecap="round" />
		<text y="48" text-anchor="middle" class="node">pool</text>
		<text y="63" text-anchor="middle" class="sub">{panel > 0 ? 'SOLARmind in,' : 'a basket of MINDs'}</text>
		{#if panel > 0}<text y="77" text-anchor="middle" class="sub">PANELmind out</text>{/if}
	</g>

	<!-- the three holdings -->
	{#each [[L.WALLET, wallet, GOLD, 'SOLARmind', 'Anna’s wallet', 'her ownership'], [L.TREASURY, treasury, GOLD, 'SOLARmind', 'COOP treasury', 'working capital'], [L.PANEL, panel, STEEL, 'PANELmind', 'panel COOP', 'paid in its own MIND']] as [p, a, col, unit, name, sub]}
		<g transform="translate({p[0]} {p[1]})">
			<rect x={-L.box / 2} y="-28" width={L.box} height="56" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.2" />
			{#if a > 0.001}
				<circle cx="-40" r={r(a)} fill={col} opacity="0.88" />
				<text x="-14" y="-2" class="amt">{a.toFixed(2)}</text>
				<text x="-14" y="12" class="unit">{unit}</text>
			{/if}
			<text y="46" text-anchor="middle" class="node">{name}</text>
			<text y="61" text-anchor="middle" class="sub">{sub}</text>
		</g>
	{/each}

	<!-- what moves in this step -->
	{#if step === 0}
		{@const [x, y] = arc([L.ANNA[0] + 24, L.ANNA[1]], [L.COOP[0] - 30, L.COOP[1]], k, -80)}
		<path d={HEART} fill="#c8744f" transform="translate({x} {y}) scale(2.2)" />
	{:else if step === 1}
		<path d={HEART} fill="#c8744f" transform="translate({L.COOP[0]} {L.COOP[1]}) scale({2.2 * (1 - k)})" opacity={1 - k} />
		<circle cx={L.COOP[0]} cy={L.COOP[1]} r={r(1) * k} fill={GOLD} stroke="var(--paper)" stroke-width="2" />
		<text x={L.COOP[0]} y={L.COOP[1] + 4} text-anchor="middle" class="amt" opacity={k}>1.00</text>
	{:else if step === 2 && raw < 1}
		{@const [ax, ay] = arc(L.COOP, SPOT(L.WALLET), k, narrow ? 20 : -10)}
		{@const [bx, by] = lerp(L.COOP, SPOT(L.TREASURY), k)}
		<circle cx={ax} cy={ay} r={r(0.5)} fill={GOLD} stroke="var(--paper)" stroke-width="2" />
		<circle cx={bx} cy={by} r={r(0.5)} fill={GOLD} stroke="var(--paper)" stroke-width="2" />
	{:else if step === 3 && raw < 1}
		{#if k1 < 1}
			{@const [x, y] = arc(SPOT(L.WALLET), SPOT(L.TREASURY), k1, 40)}
			<circle cx={x} cy={y} r={r(USE)} fill={GOLD} stroke="var(--paper)" stroke-width="2" />
		{:else}
			{@const [x, y] = arc(SPOT(L.TREASURY), [L.HOLD[0] - 12, L.HOLD[1] - 44], k2, narrow ? 30 : -30)}
			<circle cx={x} cy={y} r={r(DIV) + 1} fill={GOLD} stroke="var(--paper)" stroke-width="1.5" />
		{/if}
	{:else if step === 4 && raw < 1}
		{#if into < 1}
			{@const [dx, dy] = lerp(SPOT(L.TREASURY), L.POOL, into)}
			{@const [px, py] = arc(SPOT(L.TREASURY), L.POOL, into, narrow ? 30 : -30)}
			{@const [mx, my] = arc(L.TREASURY, [L.MIA[0] + 34, L.MIA[1]], into, narrow ? -40 : -30)}
			<circle cx={dx} cy={dy} r={r(DRIP)} fill={GOLD} stroke="var(--paper)" stroke-width="1.5" />
			<circle cx={px} cy={py} r={r(PAY)} fill={GOLD} stroke="var(--paper)" stroke-width="2" />
			<circle cx={mx} cy={my} r={r(WORK)} fill={GOLD} stroke="var(--paper)" stroke-width="2" />
		{:else}
			{@const [x, y] = lerp(L.POOL, SPOT(L.PANEL), out)}
			<circle cx={x} cy={y} r={r(PAY)} fill={STEEL} stroke="var(--paper)" stroke-width="2" />
		{/if}
	{/if}
	{#if step === 3}
		<text x={L.TREASURY[0]} y={L.TREASURY[1] - 38} text-anchor="middle" class="sub" opacity={k2}>a fifth to every holder</text>
	{/if}
	{#if step === 1 || (step === 0 && raw >= 1)}
		<text x={L.COOP[0]} y={L.COOP[1] - 48} text-anchor="middle" class="sub">converted</text>
	{/if}
</svg>
</div>
<div class="steps">
	{#each STEPS as s, i}
		<button class:on={i === step} onclick={() => go(i)} aria-label="Step {i + 1}">{i + 1}</button>
	{/each}
	<p aria-live="polite">{STEPS[step]}</p>
</div>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}

	svg {
		min-width: 540px;
		display: block;
		width: 100%;
		height: auto;
		font-family: var(--font-body);
	}

	svg.narrow {
		min-width: 0;
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

	.amt {
		font-size: 13px;
		font-weight: 600;
		fill: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.unit {
		font-size: 10.5px;
		fill: var(--ink-soft);
	}

	.steps {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.4rem;
		font-family: var(--font-body);
	}

	.steps button {
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 50%;
		border: 1px solid var(--ink-soft);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.steps button.on {
		background: #d9a520;
		border-color: #d9a520;
		color: #26382c;
		font-weight: 600;
	}

	.steps p {
		flex: 1 1 16rem;
		margin: 0 0 0 0.4rem;
		font-size: 0.92rem;
		color: var(--ink);
		min-height: 3.9em;
	}
</style>
