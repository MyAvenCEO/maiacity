<!--
	How many founders are building Maia City, live: the count from the API (the same one /join shows), counted up
	when it changes, and where it stands on the Fibonacci ladder — 1, 2, 3, 5, 8 … to 1,346,269, a million and
	more — shown as the milestones round the next one, which sits in the middle, its line filling as founders join.
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
	// how far the line into the next milestone has filled
	const part = $derived(next ? (count - previous) / (next - previous) : 1);
	// five milestones round the next one, which always sits in the middle (blanks before the first)
	const around = $derived([-2, -1, 0, 1, 2].map((d) => ({ i: reached + d, m: MILESTONES[reached + d] ?? null })));
	const fmt = (n) => Math.round(n).toLocaleString('en-US');
</script>

<div class="counter">
	<p class="who">
		<span class="dot" aria-hidden="true"></span>
		<strong>{fmt(shown.current)}</strong>
		{count === 1 ? 'founder is' : 'founders are'} building Maia City
	</p>
	<ol
		class="ladder"
		role="progressbar"
		aria-label="Founders on the Fibonacci ladder to 1,346,269"
		aria-valuemin="0"
		aria-valuemax={MILESTONES.length}
		aria-valuenow={reached}
		aria-valuetext="{fmt(count)} founders, next milestone {next ? fmt(next) : 'none'}"
	>
		{#each around as slot, k}
			{#if k > 0 && around[k - 1].m != null && slot.m != null}
				<li
					class="line"
					aria-hidden="true"
					style:--fill={slot.i < reached ? 1 : slot.i === reached ? part : 0}
				></li>
			{:else if k > 0}
				<li class="line blank" aria-hidden="true"></li>
			{/if}
			<li class="mark" class:done={slot.i < reached} class:next={slot.i === reached} class:blank={slot.m == null}>
				{#if slot.i === reached && slot.m != null}<span class="label">Next</span>{/if}
				{slot.m == null ? '' : fmt(slot.m)}
			</li>
		{/each}
	</ol>
</div>

<style>
	/* one compact strip: who is building on the left, the ladder with the next milestone in its middle */
	.counter {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.75rem 1.5rem;
		margin-top: clamp(1rem, 2.5vh, 1.5rem);
		padding: 1rem 1.4rem;
		border: 1px solid rgb(255 250 240 / 0.22);
		border-radius: 999px;
		background: rgb(16 32 30 / 0.38);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		font-family: var(--font-body);
		font-size: 0.9rem;
	}

	.who {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		margin: 0;
		line-height: 1.2;
	}

	.who strong {
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--mustard);
	}

	.dot {
		flex: none;
		align-self: center;
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

	.ladder {
		display: grid;
		grid-template-columns: 2.6rem 2rem 2.6rem 2rem 3.4rem 2rem 2.6rem 2rem 2.6rem;
		align-items: center;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.mark {
		position: relative;
		text-align: center;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		opacity: 0.55;
	}

	.mark.done {
		color: var(--mustard);
		opacity: 1;
	}

	/* the next milestone: the one thing to look at */
	.mark.next {
		padding: 0.2rem 0;
		border: 1.5px solid var(--mustard);
		border-radius: 999px;
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 600;
		opacity: 1;
	}

	.label {
		position: absolute;
		bottom: 100%;
		left: 50%;
		transform: translate(-50%, -0.2rem);
		font-family: var(--font-body);
		font-size: 0.55rem;
		font-weight: 500;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		opacity: 0.8;
	}

	.line {
		height: 2px;
		margin: 0 0.25rem;
		border-radius: 1px;
		background: linear-gradient(
			to right,
			var(--mustard) calc(var(--fill) * 100%),
			rgb(255 250 240 / 0.25) calc(var(--fill) * 100%)
		);
	}

	.line.blank {
		background: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
		}
	}

	@media (max-width: 760px) {
		.counter {
			grid-template-columns: 1fr;
			justify-items: center;
			padding: 0.7rem 1rem 0.8rem;
			border-radius: var(--radius);
		}

		.ladder {
			grid-template-columns: 2.2rem 1.2rem 2.2rem 1.2rem 3rem 1.2rem 2.2rem 1.2rem 2.2rem;
			margin-top: 0.6rem;
		}
	}
</style>
