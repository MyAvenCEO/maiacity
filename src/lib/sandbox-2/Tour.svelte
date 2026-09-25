<!--
	The first-time tour: one short hint at a time, pinned to the thing to do
	next, until the player is a citizen of a city. The page decides the step
	from the game's own state; this only draws the bubble next to its target
	(an element marked data-tour="…") and follows it as the layout moves.
-->
<script lang="ts" module>
	export type TourStep = { target: string; title: string; text: string; final?: boolean };
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	let { step, onskip, ondone }: { step: TourStep | null; onskip: () => void; ondone: () => void } = $props();

	let box = $state<{ top: number; left: number; below: boolean; arrow: number } | null>(null);
	let timer: ReturnType<typeof setInterval>;

	const WIDTH = 300;

	function place() {
		if (!step) return (box = null);
		const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
		if (!el) return (box = null);
		const r = el.getBoundingClientRect();
		if (!r.width && !r.height) return (box = null);
		const below = r.bottom + 180 < window.innerHeight;
		const centre = r.left + r.width / 2;
		const left = Math.max(12, Math.min(window.innerWidth - WIDTH - 12, centre - WIDTH / 2));
		box = { top: below ? r.bottom + 14 : r.top - 14, left, below, arrow: Math.max(16, Math.min(WIDTH - 16, centre - left)) };
	}

	onMount(() => {
		place();
		timer = setInterval(place, 250);
	});
	onDestroy(() => clearInterval(timer));

	$effect(() => {
		void step;
		place();
	});
</script>

{#if step && box}
	<div
		class="tip"
		class:below={box.below}
		style:top="{box.top}px"
		style:left="{box.left}px"
		style:width="{WIDTH}px"
		style:--arrow="{box.arrow}px"
		role="dialog"
		aria-label={step.title}
	>
		<strong>{step.title}</strong>
		<p>{step.text}</p>
		<div class="actions">
			{#if step.final}
				<button class="go" onclick={ondone}>Got it</button>
			{:else}
				<button class="skip" onclick={onskip}>Skip the tour</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.tip {
		position: fixed;
		z-index: 30;
		padding: 0.9rem 1rem 0.75rem;
		border-radius: 14px;
		background: #1f2a23;
		color: #f2efe7;
		box-shadow: 0 18px 40px -18px rgb(31 42 35 / 0.8);
		font-size: 0.86rem;
		line-height: 1.45;
		transform: translateY(-100%);
		animation: rise 0.35s ease-out;
	}
	.tip.below {
		transform: none;
	}
	/* the arrow, pointing at the target */
	.tip::after {
		content: '';
		position: absolute;
		left: calc(var(--arrow) - 7px);
		bottom: -7px;
		border: 7px solid transparent;
		border-bottom: 0;
		border-top-color: #1f2a23;
	}
	.tip.below::after {
		bottom: auto;
		top: -7px;
		border: 7px solid transparent;
		border-top: 0;
		border-bottom-color: #1f2a23;
	}
	strong {
		display: block;
		margin-bottom: 0.25rem;
		color: #f0a47c;
		font-size: 0.78rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	p {
		margin: 0;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.55rem;
	}
	button {
		border: 0;
		border-radius: 999px;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.skip {
		padding: 0.2rem 0.4rem;
		background: none;
		color: #a9b0a6;
		text-decoration: underline;
	}
	.go {
		padding: 0.4rem 0.9rem;
		background: #f0a47c;
		color: #1f2a23;
		font-weight: 600;
	}
	@keyframes rise {
		from {
			opacity: 0;
			margin-top: 6px;
		}
	}
</style>
