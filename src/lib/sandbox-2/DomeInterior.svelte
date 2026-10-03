<!--
	Stepping inside a dome: a full-screen, walkable interior (interior/interior.ts)
	over the island. Drag or click to look, WASD or the arrows to walk, Shift to
	hurry, Esc and the nav pill's back to come back out ($lib/app/back.svelte.js). On a phone, as in every sandbox: a
	joystick in the lower left walks, any other finger on the world looks round
	($lib/touch/TouchStick).

	While the dome is built, the valley of domes from Day 03 fills the screen,
	slowly drawing closer, with the step being done and a progress bar; when the
	dome is ready it fades away.
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import { onDestroy, onMount } from 'svelte';
	import { DOMES, type DomeKind, type InteriorHandle } from './interior/interior';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WalkHint, WorldBar } from '$lib/sandbox-kit';
	import { wayBack } from '$lib/app/back.svelte';

	let {
		kind,
		place,
		onclose,
		entry,
		onleave
	}: { kind: DomeKind; place: string; onclose: () => void; entry?: number; onleave?: (door: number) => void } = $props();

	let stage = $state<HTMLDivElement>();
	let handle: InteriorHandle | null = null;
	let destroyed = false;
	/** closed → opening (the picture fades) → open (gone) */
	let doors = $state<'closed' | 'opening' | 'open'>('closed');
	let step = $state('Opening the doors');
	let done = $state(0);
	const STEPS = 5;
	const spec = $derived(DOMES[kind]);
	/** standing in the factory's lift: which floor, so the panel can say how to ride it */
	let lift = $state<{ floor: number; name: string; top: number } | null>(null);
	const liftTimer = setInterval(() => (lift = handle?.lift() ?? null), 200);

	onMount(() => {
		// let the closed doors paint before the heavy build starts
		requestAnimationFrame(() =>
			requestAnimationFrame(async () => {
				const { mountInterior } = await import('./interior/interior');
				const h = await mountInterior(
					stage!,
					kind,
					(label) => {
						if (label === 'ready') return;
						step = label;
						done += 1;
					},
					{ entry, onLeave: onleave }
				);
				if (destroyed) return h.dispose();
				handle = h;
				done = STEPS;
				doors = 'opening';
				setTimeout(() => (doors = 'open'), 1100);
			})
		);
	});
	onDestroy(() => {
		clearInterval(liftTimer);
		destroyed = true;
		handle?.dispose();
	});

	// while it is open, the nav pill's way back steps out of it
	$effect(() => wayBack('Back outside', () => onclose()));

	const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.pointerLockElement && onclose();
</script>

<svelte:window onkeydown={onKey} />

<div class="interior">
	<div class="stage" bind:this={stage}></div>
	<WorldBar title={spec.label} subtitle="{place} · {spec.diameter} m across · {spec.people}" />
	{#if lift}
		<div class="lift" role="status" aria-live="polite">
			<p class="where">Floor {lift.floor} · {lift.name}</p>
			<div class="keys">
				<button onclick={() => handle?.liftStep(1)} disabled={lift.floor >= lift.top} aria-label="Up a floor">↑</button>
				<button onclick={() => handle?.liftStep(-1)} disabled={lift.floor <= 0} aria-label="Down a floor">↓</button>
			</div>
			<p class="how keys-how">Press <kbd>↑</kbd> or <kbd>↓</kbd> to ride one floor; the lift stops at every floor. Hold the key to ride on. Walk out through a door when it stops.</p>
			<p class="how touch-how">Tap ↑ or ↓ to ride one floor; the lift stops at every floor. Walk out through a door when it stops.</p>
		</div>
	{/if}
	<WalkHint keys="Drag to look · WASD to walk · Shift to hurry{kind === 'factory' ? ' · in the great lift, ↑ and ↓ ride between the five floors' : kind === 'tent' ? ' · the door leads out to the campfire' : spec.gallery ? ' · the stairs lead up to the private rooms and the terrace' : ' · the door leads out into the forest'}" />
	<TouchStick move={(x, y, hurry) => handle?.move(x, y, hurry)} look={(dx, dy) => handle?.look(dx, dy)} {stage} taps=".bar button, .lift button" />

	{#if doors !== 'open'}
		<div class="loading" class:opening={doors === 'opening'} role="status" aria-live="polite">
			<img src={asset('9e442ce81d3237243f561780fa6d3aeeeb7f1d83ea8e68f3a166650739c398b2.jpg') /* Day 03: a dome from inside */} alt="" />
			<div class="shade"></div>
			<div class="label">
				<p class="eyebrow">Stepping inside</p>
				<strong>{spec.label}</strong>
				<span class="size">{spec.diameter} m across · {spec.people}</span>
				<div class="progress"><span style:width="{Math.min(100, (done / STEPS) * 100)}%"></span></div>
				<span class="step">{doors === 'opening' ? 'Welcome in' : `${step}…`}</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.interior {
		position: absolute;
		inset: 0;
		z-index: 20;
		background: #f2efe7;
	}
	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
	}
	/* the lift's panel, bottom centre, above the help line and the app's nav pill (--nav-room, src/app.css) */
	.lift {
		position: absolute;
		left: 50%;
		bottom: calc(4.2rem + var(--nav-room));
		transform: translateX(-50%);
		z-index: 2;
		width: min(24rem, calc(100vw - 2rem));
		padding: 1rem 1.2rem;
		border-radius: 1rem;
		background: rgb(31 42 35 / 0.72);
		backdrop-filter: blur(8px);
		color: #f2efe7;
		text-align: center;
		pointer-events: none;
	}
	.where {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
	}
	.keys {
		display: flex;
		justify-content: center;
		gap: 0.6rem;
		margin: 0.7rem 0;
	}
	.keys button {
		pointer-events: auto;
		width: 3rem;
		height: 3rem;
		border: 0;
		border-radius: 0.7rem;
		background: #f2efe7;
		color: #1f2a23;
		font-size: 1.4rem;
		cursor: pointer;
	}
	.keys button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.how {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.45;
		color: rgb(242 239 231 / 0.85);
	}
	kbd {
		padding: 0 0.3rem;
		border-radius: 0.25rem;
		background: rgb(242 239 231 / 0.2);
		font: inherit;
	}

	/* the valley of domes, drawing slowly closer while the dome is built */
	.loading {
		position: absolute;
		inset: 0;
		z-index: 3;
		overflow: hidden;
		background: #1f2a23;
		transition: opacity 1s ease;
	}
	.loading.opening {
		opacity: 0;
	}
	.loading img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transform: scale(1.08);
		transform-origin: 45% 45%;
		animation: closer 16s ease-out forwards;
	}
	@keyframes closer {
		to {
			transform: scale(1.22);
		}
	}
	.shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgb(20 26 22 / 0.85) 0%, rgb(20 26 22 / 0.35) 38%, transparent 62%);
	}
	.label {
		position: absolute;
		left: 50%;
		bottom: calc(10vh + var(--nav-room));
		transform: translateX(-50%);
		width: min(34rem, calc(100vw - 3rem));
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45rem;
		color: #f2efe7;
		text-align: center;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.75rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #f0c49a;
	}
	.label strong {
		font-family: var(--font-display, serif);
		font-size: clamp(2.2rem, 5vw, 3.4rem);
		font-weight: 400;
		line-height: 1.05;
		text-shadow: 0 2px 20px rgb(0 0 0 / 0.35);
	}
	.size {
		font-size: 0.95rem;
		color: rgb(242 239 231 / 0.85);
	}
	.progress {
		width: 100%;
		height: 3px;
		margin-top: 1rem;
		border-radius: 3px;
		background: rgb(242 239 231 / 0.25);
		overflow: hidden;
	}
	.progress span {
		display: block;
		height: 100%;
		background: #f0a47c;
		transition: width 0.6s ease;
	}
	.step {
		font-size: 0.85rem;
		color: #f0c49a;
	}

	/* ── on a phone: the lift's words, and its panel above the joystick ── */
	.touch-how {
		display: none;
	}
	@media (hover: none) and (pointer: coarse) {
		.keys-how {
			display: none;
		}
		.touch-how {
			display: inline;
		}
		p.touch-how {
			display: block;
		}
		/* the lift's panel above the joystick, not over it (--stick-room, src/app.css) */
		.lift {
			bottom: calc(var(--stick-room) + 3rem);
		}
	}
</style>
