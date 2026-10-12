<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Law 4, told as a story in five steps: Anna invests one HEART into the solar COOP; it is converted and gone; one new
	// SOLARmind appears, half in Anna's wallet and half in the treasury; the treasury pays another COOP with it; Anna
	// switches on her lamp and a little SOLARmind flows back. Coin areas are to scale.
	import { onMount } from 'svelte';
	import { runClock, watchNarrow, HEART, ease, arc } from './anim.js';

	const STEP = 3.4, REST = 1.4, N = 5, CYCLE = N * STEP + REST;
	// wide: two rows of three; narrow: three rows of two (Anna and her wallet and lamp on the left, the COOPs on the right)
	const LAYOUT = {
		wide: { w: 680, h: 326, ANNA: [86, 92], COOP: [330, 92], LAMP: [584, 92], WALLET: [86, 246], TREASURY: [330, 246], PANEL: [584, 246] },
		narrow: { w: 360, h: 420, ANNA: [90, 62], COOP: [270, 62], LAMP: [90, 344], WALLET: [90, 200], TREASURY: [270, 200], PANEL: [270, 344] }
	};
	const SPOT = (p) => [p[0] - 46, p[1]];
	const STEPS = [
		'Anna invests one AnnaHEART into the solar COOP.',
		'The HEART is converted and gone. One new SOLARmind appears.',
		'Half goes to Anna’s wallet, half to the COOP’s treasury. It is the same SOLARmind.',
		'The treasury is working capital: the COOP pays the panel COOP with it.',
		'Anna switches on her lamp. She spends a little SOLARmind, and it flows back to the treasury.'
	];
	const PAY = 0.2, USE = 0.1;

	let box, still = false;
	let narrow = $state(false);
	const L = $derived(narrow ? LAYOUT.narrow : LAYOUT.wide);
	let t = $state(0);
	let offset = $state(N * STEP - 0.01);
	const c = $derived((t + offset) % CYCLE);
	const step = $derived(Math.min(N - 1, Math.floor(c / STEP)));
	const k = $derived(ease(Math.min(1, (c - step * STEP) / (STEP * 0.7))));
	const at = (i) => (step > i ? 1 : step === i ? k : 0);
	const done = (i) => (step > i || (step === i && k >= 1) ? 1 : 0);

	const wallet = $derived(0.5 * done(2) - USE * done(4));
	const treasury = $derived(0.5 * done(2) - PAY * done(3) + USE * done(4));
	const panel = $derived(PAY * done(3));
	const r = (a) => 21 * Math.sqrt(Math.max(0, a));
	const toward = (a, b, d) => {
		const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy);
		return [a[0] + (dx / n) * d, a[1] + (dy / n) * d];
	};
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
<svg viewBox="0 0 {L.w} {L.h}" class:narrow role="img" aria-label="Follow one HEART in five steps. Anna invests one AnnaHEART into the solar COOP. It is converted and gone, and one new SOLARmind appears. Half goes to Anna's wallet and half to the COOP's treasury. The treasury pays the panel COOP with it. Anna switches on her lamp and a little SOLARmind flows back to the treasury.">
	<!-- flows that stay drawn once they happened -->
	<line x1={toward(L.COOP, L.LAMP, 44)[0]} y1={toward(L.COOP, L.LAMP, 44)[1]} x2={toward(L.LAMP, L.COOP, 34)[0]} y2={toward(L.LAMP, L.COOP, 34)[1]} stroke="#d99a2b" stroke-width="2" stroke-dasharray="5 5" opacity={at(4) * 0.9} stroke-dashoffset={-t * 20} />

	<!-- Anna -->
	<g transform="translate({L.ANNA[0]} {L.ANNA[1]})">
		<circle cy="-14" r="11" fill="#26382c" />
		<path d="M-17 22 C-17 0 17 0 17 22 Z" fill="#26382c" />
		<text y="44" text-anchor="middle" class="node">Anna</text>
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
		<circle r="30" fill="#f2c94c" opacity={at(4) * 0.35} />
		<path d="M-10 4 A13 13 0 1 1 10 4 L7 14 H-7 Z" fill={at(4) > 0.5 ? '#f2c94c' : 'var(--paper)'} stroke="var(--ink)" stroke-width="1.4" />
		<rect x="-6" y="16" width="12" height="5" rx="1.5" fill="var(--ink)" />
		<text y="44" text-anchor="middle" class="node">Anna’s lamp</text>
	</g>

	<!-- the three holdings -->
	{#each [[L.WALLET, wallet, 'Anna’s wallet', 'her share and her right to use'], [L.TREASURY, treasury, 'COOP treasury', 'working capital'], [L.PANEL, panel, 'panel COOP', 'paid for panels']] as [p, a, name, sub]}
		<g transform="translate({p[0]} {p[1]})">
			<rect x="-72" y="-30" width="144" height="60" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.2" />
			{#if a > 0.001}
				<circle cx="-46" r={r(a)} fill="#d9a520" opacity="0.85" />
				<text x="-24" y="4" class="amt">{a.toFixed(2)} SOLARmind</text>
			{/if}
			<text y="48" text-anchor="middle" class="node">{name}</text>
			<text y="63" text-anchor="middle" class="sub">{sub}</text>
		</g>
	{/each}

	<!-- what moves in this step -->
	{#if step === 0}
		{@const [x, y] = arc([L.ANNA[0] + 24, L.ANNA[1]], [L.COOP[0] - 30, L.COOP[1]], k, -40)}
		<path d={HEART} fill="#c8744f" transform="translate({x} {y}) scale(2.2)" />
	{:else if step === 1}
		<path d={HEART} fill="#c8744f" transform="translate({L.COOP[0]} {L.COOP[1]}) scale({2.2 * (1 - k)})" opacity={1 - k} />
		<circle cx={L.COOP[0]} cy={L.COOP[1]} r={r(1) * k} fill="#d9a520" stroke="var(--paper)" stroke-width="2" />
		<text x={L.COOP[0]} y={L.COOP[1] + 4} text-anchor="middle" class="amt" opacity={k}>1.00</text>
	{:else if step === 2 && k < 1}
		{@const [ax, ay] = arc(L.COOP, SPOT(L.WALLET), k, -10)}
		{@const [bx, by] = lerp(L.COOP, SPOT(L.TREASURY), k)}
		<circle cx={ax} cy={ay} r={r(0.5)} fill="#d9a520" stroke="var(--paper)" stroke-width="2" />
		<circle cx={bx} cy={by} r={r(0.5)} fill="#d9a520" stroke="var(--paper)" stroke-width="2" />
	{:else if step === 3 && k < 1}
		{@const [x, y] = lerp(SPOT(L.TREASURY), SPOT(L.PANEL), k)}
		<circle cx={x} cy={y} r={r(PAY)} fill="#d9a520" stroke="var(--paper)" stroke-width="2" />
	{:else if step === 4 && k < 1}
		{@const [x, y] = arc(SPOT(L.WALLET), SPOT(L.TREASURY), k, 40)}
		<circle cx={x} cy={y} r={r(USE)} fill="#d9a520" stroke="var(--paper)" stroke-width="2" />
	{/if}
	{#if step === 1 || (step === 0 && k > 0.98)}
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
		font-size: 11px;
		font-weight: 600;
		fill: #26382c;
		font-variant-numeric: tabular-nums;
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
		min-height: 2.6em;
	}
</style>
