<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Law 1: every person gets 24 HEARTS a day, one for every hour, in a currency of their own. Three clocks run through
	// the same day; each hour drops one HEART into its owner's dial. At midnight the day's HEARTS leave to be invested.
	import { onMount } from 'svelte';
	import { runClock, watchNarrow, HEART, ease } from './anim.js';

	const DAY = 9, OUT = 1.6, R = 66;
	const PEOPLE = [
		{ name: 'Samuel', color: '#c8744f' },
		{ name: 'Anna', color: '#b5523b' },
		{ name: 'Mia', color: '#d98a5f' }
	];
	// wide: three dials in a row; narrow: two above, one below
	const LAYOUT = {
		wide: { w: 680, h: 270, at: [[115, 112], [340, 112], [565, 112]], foot: 262 },
		narrow: { w: 360, h: 470, at: [[90, 102], [270, 102], [180, 316]], foot: 462 }
	};
	const slot = (i) => {
		const a = -Math.PI / 2 + (i / 24) * Math.PI * 2;
		return [Math.cos(a) * R, Math.sin(a) * R];
	};

	let box;
	let narrow = $state(false);
	const L = $derived(narrow ? LAYOUT.narrow : LAYOUT.wide);
	let t = $state(DAY - 0.01);
	const c = $derived(t % (DAY + OUT));
	const hours = $derived(c < DAY ? (c / DAY) * 24 : 24);
	const out = $derived(c < DAY ? 0 : ease((c - DAY) / OUT));
	const count = $derived(Math.min(24, Math.floor(hours)));

	onMount(() => {
		const a = runClock(box, (s) => (t = s), DAY - 0.01);
		const b = watchNarrow(box, (n) => (narrow = n));
		return () => (a(), b());
	});
</script>

<div class="scroll" bind:this={box}>
<svg viewBox="0 0 {L.w} {L.h}" class:narrow role="img" aria-label="Three clocks run through one day. Every hour drops one HEART into each person's dial, in their own currency: SamuelHEARTS, AnnaHEARTS, MiaHEARTS. At midnight the 24 HEARTS leave to be invested into COOPs.">
	{#each PEOPLE as p, n}
		<g transform="translate({L.at[n][0]} {L.at[n][1]})">
			<circle r={R + 14} fill="var(--paper)" stroke="var(--ink)" stroke-width="1.2" opacity="0.9" />
			{#each Array(24) as _, i}
				{@const [x, y] = slot(i)}
				{#if i < count}
					{@const pop = Math.max(0, 1 - (hours - i) * 2)}
					{@const tx = x + (0 - x) * out}
					{@const ty = y + (R + 52 - y) * out}
					<path d={HEART} fill={p.color} opacity={1 - out} transform="translate({tx} {ty}) scale({1 + pop * 0.8})" />
				{:else}
					<circle cx={x} cy={y} r="1.6" fill="var(--ink-soft)" opacity="0.5" />
				{/if}
			{/each}
			{#if out === 0}
				{@const a = -Math.PI / 2 + (hours / 24) * Math.PI * 2}
				<line x1={Math.cos(a) * 40} y1={Math.sin(a) * 40} x2={Math.cos(a) * (R - 12)} y2={Math.sin(a) * (R - 12)} stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round" />
			{/if}
			<text y="8" text-anchor="middle" class="big" fill={p.color}>{count}</text>
			<text y="26" text-anchor="middle" class="sub">of 24 today</text>
			<text y={R + 36} text-anchor="middle" class="node" fill={p.color}>{p.name}HEARTS</text>
		</g>
	{/each}
	<text x={L.w / 2} y={L.foot} text-anchor="middle" class="sub" opacity={0.4 + out * 0.6}>
		{out > 0 ? 'midnight: the day’s HEARTS leave to be invested into COOPs' : 'one HEART for every hour lived · only its owner can invest it'}
	</text>
</svg>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}

	svg {
		min-width: 520px;
		display: block;
		width: 100%;
		height: auto;
		font-family: var(--font-body);
	}

	svg.narrow {
		min-width: 0;
	}

	.big {
		font-size: 30px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.node {
		font-size: 14px;
		font-weight: 600;
	}

	.sub {
		font-size: 11.5px;
		fill: var(--ink-soft);
	}
</style>
