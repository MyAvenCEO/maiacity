<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Laws 2 and 3: HEARTS buy no goods and earn no interest; they can only be invested into COOPs, and anyone can found
	// a new COOP at any time. Anna sends HEARTS out; the ones aimed at a shop or a savings account stop at the wall, the
	// ones aimed at COOPs land. Halfway through, a new COOP is founded and starts receiving HEARTS too.
	import { onMount } from 'svelte';
	import { runClock, watchNarrow, HEART, arc } from './anim.js';

	const CYCLE = 12, FLY = 1.2;
	const KIND = {
		SOLAR: { color: '#d99a2b', label: 'SOLAR COOP' },
		AGRI: { color: '#5f8f4a', label: 'AGRI COOP' },
		HABITAT: { color: '#8a7a5a', label: 'HABITAT COOP' },
		NEW: { color: '#7a5aa8', label: 'a new COOP' },
		GOODS: { blocked: true, label: 'buy goods' },
		INTEREST: { blocked: true, label: 'earn interest' }
	};
	// wide: Anna on the left, COOPs on the right; narrow: Anna on top between the walls, COOPs below
	const LAYOUT = {
		wide: {
			w: 680, h: 300, anna: [78, 150], stop: 0.78, below: false, law3: [592, 196],
			at: { SOLAR: [430, 62], AGRI: [430, 150], HABITAT: [430, 238], NEW: [592, 150], GOODS: [258, 46], INTEREST: [258, 262] },
			bend: { NEW: -95, GOODS: 0, INTEREST: 0 }, wall: { GOODS: -70, INTEREST: -70 }, law2: [[258, 20], [258, 236]]
		},
		narrow: {
			w: 360, h: 400, anna: [180, 66], stop: 0.42, below: true, law3: [180, 376],
			at: { SOLAR: [60, 214], AGRI: [180, 214], HABITAT: [300, 214], NEW: [180, 330], GOODS: [62, 66], INTEREST: [298, 66] },
			bend: { NEW: -70, GOODS: 0, INTEREST: 0, AGRI: 0 }, wall: { GOODS: 70, INTEREST: -70 }, law2: [[62, 36], [298, 36]]
		}
	};
	const BORN = 4.6, GONE = 11.4;
	const PATTERN = ['SOLAR', 'AGRI', 'GOODS', 'HABITAT', 'AGRI', 'SOLAR', 'INTEREST', 'HABITAT'];
	const SENDS = Array.from({ length: 26 }, (_, i) => {
		const at = i * 0.4, k = PATTERN[i % PATTERN.length];
		return [at, at > BORN + 0.6 && at < GONE - FLY - 0.6 && i % 3 === 0 ? 'NEW' : k];
	});

	let box;
	let narrow = $state(false);
	const L = $derived(narrow ? LAYOUT.narrow : LAYOUT.wide);
	const T = $derived(Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, { ...v, at: L.at[k], bend: L.bend[k] }])));
	let t = $state(7.5);
	const c = $derived(t % CYCLE);
	const newOn = $derived(Math.max(0, Math.min(1, (c - BORN) / 0.6, (CYCLE - c) / (CYCLE - GONE))));
	const flying = $derived(
		SENDS.map(([at, k]) => ({ k, p: (c - at) / FLY, ...T[k] })).filter((h) => h.p > 0 && h.p < (h.blocked ? L.stop + 0.27 : 1))
	);
	const pulse = (k) => {
		let best = 9;
		for (const [at, kk] of SENDS) if (kk === k && c - at - FLY >= 0) best = Math.min(best, c - at - FLY);
		return 1 + 0.18 * Math.exp(-best * 5);
	};
	const stopped = (k) => SENDS.some(([at, kk]) => kk === k && c - at > FLY * (L.stop - 0.06) && c - at < FLY * (L.stop + 0.8));

	onMount(() => {
		const a = runClock(box, (s) => (t = s), 7.5);
		const b = watchNarrow(box, (n) => (narrow = n));
		return () => (a(), b());
	});
</script>

<div class="scroll" bind:this={box}>
<svg viewBox="0 0 {L.w} {L.h}" class:narrow role="img" aria-label="Anna sends out her HEARTS. Those aimed at buying goods or earning interest stop at a wall. Those aimed at COOPs arrive. Halfway through, someone founds a new COOP without asking anyone, and it starts receiving HEARTS as well.">
	<!-- the walls of law 2 -->
	{#each ['GOODS', 'INTEREST'] as k}
		{@const b = T[k]}
		<g transform="translate({b.at[0]} {b.at[1]})">
			<rect x="-58" y="-15" width="116" height="30" rx="6" fill="var(--paper)" stroke="var(--ink-soft)" stroke-dasharray="4 3" />
			<text y="4" text-anchor="middle" class="sub">{b.label}</text>
			<g opacity={stopped(k) ? 1 : 0.25}>
				<path d="M{L.wall[k] - 5} -8 l10 10 m0 -10 l-10 10" stroke="#b5523b" stroke-width="2.2" stroke-linecap="round" transform="translate(0 2)" />
			</g>
		</g>
	{/each}
	{#each L.law2 as [x, y]}
		<text {x} {y} text-anchor="middle" class="law">Law 2: HEARTS cannot</text>
	{/each}

	<!-- Anna -->
	<g transform="translate({L.anna[0]} {L.anna[1]})">
		<circle cy="-14" r="11" fill="#26382c" />
		<path d="M-17 22 C-17 0 17 0 17 22 Z" fill="#26382c" />
		<text y="44" text-anchor="middle" class="node">Anna</text>
		<text y="60" text-anchor="middle" class="sub">her AnnaHEARTS</text>
	</g>

	<!-- the COOPs -->
	{#each ['SOLAR', 'AGRI', 'HABITAT', 'NEW'] as k}
		{@const b = T[k]}
		<g transform="translate({b.at[0]} {b.at[1]})" opacity={k === 'NEW' ? newOn : 1}>
			<circle r="24" fill={b.color} opacity="0.85" transform="scale({pulse(k)})" stroke={k === 'NEW' ? 'var(--ink)' : 'none'} stroke-dasharray="3 3" />
			{#if k === 'NEW' && !L.below}<text y="-34" text-anchor="middle" class="node">{b.label}</text>
			{:else if L.below && k !== 'NEW'}<text y="44" text-anchor="middle" class="node">{b.label}</text>
			{:else}<text x="34" y="5" class="node">{b.label}</text>{/if}
		</g>
	{/each}
	<g opacity={newOn}>
		<text x={L.law3[0]} y={L.law3[1]} text-anchor="middle" class="law">Law 3: founded by anyone,</text>
		<text x={L.law3[0]} y={L.law3[1] + 15} text-anchor="middle" class="law">without permission</text>
	</g>

	<!-- the HEARTS in flight -->
	{#each flying as h}
		{@const p = h.blocked ? Math.min(h.p, L.stop) : h.p}
		{@const [x, y] = arc(L.anna, h.at, p, h.bend ?? -30)}
		<path d={HEART} fill="#c8744f" transform="translate({x} {y}) scale(1.4)" opacity={h.blocked && h.p > L.stop ? Math.max(0, 1 - (h.p - L.stop) * 4) : 1} />
	{/each}
</svg>
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

	.law {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		fill: var(--terracotta, #c8744f);
	}
</style>
