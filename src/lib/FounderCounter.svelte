<!--
	How many founders are building Maia City, live: the count from the API (the same one /join shows), counted up
	when it changes, and the Fibonacci ladder it climbs — 1, 2, 3, 5, 8 … to 1,346,269, a million and more — one
	segment a milestone, the next one filling as founders join.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { founderCount } from '$lib/auth/client';

	/** The milestones: the Fibonacci numbers from 1 to the thirty-first, 1,346,269, each once. */
	const MILESTONES = (() => {
		const out = [1];
		let [a, b] = [1, 2];
		while (b <= 1346269) {
			out.push(b);
			[a, b] = [b, a + b];
		}
		return out;
	})();

	// Day 01 is one founder: what the page shows until (and unless) the API answers
	let count = $state(1);
	const shown = new Tween(0, { duration: 1400, easing: cubicOut });

	onMount(() => {
		shown.target = count;
		const read = () =>
			founderCount()
				.then((c) => {
					if (typeof c?.count === 'number' && c.count > 0) count = c.count;
					shown.target = count;
				})
				.catch(() => {});
		read();
		// live enough: a new founder shows up within half a minute
		const timer = setInterval(read, 30_000);
		return () => clearInterval(timer);
	});

	const reached = $derived(MILESTONES.filter((m) => m <= count).length);
	const next = $derived(MILESTONES[reached] ?? null);
	const previous = $derived(MILESTONES[reached - 1] ?? 0);
	// how far the next segment has filled on the way to its milestone
	const part = $derived(next ? (count - previous) / (next - previous) : 0);
	const fmt = (n) => Math.round(n).toLocaleString('en-US');
</script>

<div class="counter">
	<p class="line">
		<span class="live"><span class="dot"></span>Live</span>
		<span class="count"><strong>{fmt(shown.current)}</strong> {count === 1 ? 'founder is' : 'founders are'} building Maia City</span>
		{#if next}<span class="next">Next milestone <strong>{fmt(next)}</strong></span>{/if}
	</p>
	<div
		class="ladder"
		role="progressbar"
		aria-label="Founders on the Fibonacci ladder to 1,346,269"
		aria-valuemin="0"
		aria-valuemax={MILESTONES.length}
		aria-valuenow={reached}
		aria-valuetext="{fmt(count)} founders, milestone {reached} of {MILESTONES.length}"
	>
		{#each MILESTONES as m, i}
			<span
				class="step"
				class:done={i < reached}
				class:filling={i === reached}
				style:--fill={i === reached ? part : 0}
				title={fmt(m)}
			></span>
		{/each}
	</div>
	<p class="ends">
		<span>1</span>
		<span>Fibonacci milestone {reached} of {MILESTONES.length}</span>
		<span>{fmt(MILESTONES.at(-1))}</span>
	</p>
</div>

<style>
	.counter {
		margin-top: clamp(1.25rem, 3vh, 2rem);
		padding: 1rem 1.15rem 0.85rem;
		border: 1px solid rgb(255 250 240 / 0.22);
		border-radius: var(--radius);
		background: rgb(16 32 30 / 0.38);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		font-family: var(--font-body);
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem 1.1rem;
		margin: 0 0 0.8rem;
		font-size: 0.95rem;
		line-height: 1.3;
	}

	.live {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.68rem;
		font-weight: 500;
		letter-spacing: 0.22em;
		text-transform: uppercase;
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #7ee08a;
		box-shadow: 0 0 0 0 rgb(126 224 138 / 0.7);
		animation: pulse 2s ease-out infinite;
	}

	@keyframes pulse {
		to {
			box-shadow: 0 0 0 0.6rem rgb(126 224 138 / 0);
		}
	}

	.count strong {
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--mustard);
	}

	.next {
		margin-left: auto;
		font-size: 0.85rem;
		opacity: 0.85;
	}

	.next strong {
		font-weight: 600;
	}

	/* one segment a milestone: gold when reached, the next one filling */
	.ladder {
		display: grid;
		grid-template-columns: repeat(30, 1fr);
		gap: 3px;
	}

	.step {
		position: relative;
		height: 8px;
		overflow: hidden;
		border-radius: 2px;
		background: rgb(255 250 240 / 0.2);
	}

	.step.done {
		background: var(--mustard);
	}

	.step.filling::after {
		content: '';
		position: absolute;
		inset: 0;
		width: max(calc(var(--fill) * 100%), 2px);
		background: var(--mustard);
		animation: breathe 1.6s ease-in-out infinite alternate;
	}

	@keyframes breathe {
		from {
			opacity: 0.45;
		}
	}

	.ends {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin: 0.5rem 0 0;
		font-size: 0.7rem;
		letter-spacing: 0.06em;
		opacity: 0.75;
	}

	@media (prefers-reduced-motion: reduce) {
		.dot,
		.step.filling::after {
			animation: none;
		}
	}

	@media (max-width: 760px) {
		.next {
			margin-left: 0;
		}

		.ladder {
			gap: 2px;
		}
	}
</style>
