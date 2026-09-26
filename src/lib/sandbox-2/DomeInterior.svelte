<!--
	Stepping inside a dome: a full-screen, walkable interior (interior/interior.ts)
	over the island. Drag or click to look, WASD or the arrows to walk, Shift to
	hurry, Esc and the button to come back out. On a phone, as in Sandbox 4: a
	joystick in the lower left walks, any other finger on the world looks round.

	While the dome is built, the valley of domes from Day 03 fills the screen,
	slowly drawing closer, with the step being done and a progress bar; when the
	dome is ready it fades away.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { DOMES, type DomeKind, type InteriorHandle } from './interior/interior';
	import { gameClock } from '../../../game/time';

	let {
		kind,
		place,
		onclose,
		entry,
		onleave
	}: { kind: DomeKind; place: string; onclose: () => void; entry?: number; onleave?: (door: number) => void } = $props();

	let stage: HTMLDivElement;
	let handle: InteriorHandle | null = null;
	let destroyed = false;
	/** closed → opening (the picture fades) → open (gone) */
	let doors = $state<'closed' | 'opening' | 'open'>('closed');
	let step = $state('Opening the doors');
	let done = $state(0);
	const STEPS = 5;
	const spec = $derived(DOMES[kind]);
	/** the in-game clock the sun follows, shown in the corner */
	let clock = $state(gameClock().label);
	/** standing in the factory's lift: which floor, so the panel can say how to ride it */
	let lift = $state<{ floor: number; name: string; top: number } | null>(null);
	const clockTimer = setInterval(() => (clock = gameClock().label), 1000);
	const liftTimer = setInterval(() => (lift = handle?.lift() ?? null), 200);

	/* on a phone: the joystick walks (push it to the rim to hurry), any other finger on the
	   world looks round. Touch events, each finger by its own identifier, so both work at once.
	   The ring stays where it is, in the lower left; the knob goes wherever the thumb goes,
	   past the rim too, so it is always under the thumb. How far out, up to the rim, sets the pace. */
	let root: HTMLDivElement;
	let stickEl: HTMLDivElement;
	let knobEl: HTMLSpanElement;
	let hurrying = $state(false);
	let stickFinger: number | null = null;
	/** the ring's centre and radius, measured as the thumb comes down */
	let stick = { x: 0, y: 0, r: 64 };
	let lookFinger: { id: number; x: number; y: number } | null = null;
	/** a finger on the bar's or the lift's buttons: followed when it lifts where it came down */
	const taps = new Map<number, { el: HTMLElement; x: number; y: number }>();
	const stickTo = (t: Touch) => {
		const x = t.clientX - stick.x;
		const y = t.clientY - stick.y;
		knobEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		// full walking pace three quarters of the way to the rim, a hurry at the rim and beyond
		const d = Math.hypot(x, y);
		const m = Math.min(1, d / stick.r);
		const pace = m < 0.08 ? 0 : Math.min(1, m / 0.75);
		hurrying = m > 0.95;
		handle?.move((x / (d || 1)) * pace, (-y / (d || 1)) * pace, hurrying);
	};
	const stickRelease = () => {
		stickFinger = null;
		knobEl.style.transform = '';
		hurrying = false;
		handle?.move(0, 0, false);
	};
	const onTouchStart = (e: TouchEvent) => {
		let ours = false;
		for (const t of Array.from(e.changedTouches)) {
			// Safari can name the text under the finger rather than its element
			const el = ((t.target as Node).nodeType === Node.TEXT_NODE ? (t.target as Node).parentElement : t.target) as Element;
			const tap = el?.closest?.('.bar button, .lift button') as HTMLElement | null;
			if (tap) {
				taps.set(t.identifier, { el: tap, x: t.clientX, y: t.clientY });
				ours = true;
			} else if (stickFinger === null && stickEl.contains(el)) {
				stickFinger = t.identifier;
				const box = stickEl.getBoundingClientRect();
				stick = { x: box.left + box.width / 2, y: box.top + box.height / 2, r: box.width / 2 };
				stickTo(t);
				ours = true;
			} else if (stage.contains(el)) {
				if (lookFinger === null) lookFinger = { id: t.identifier, x: t.clientX, y: t.clientY };
				ours = true;
			}
		}
		// no scrolling, zooming, long-press menu or second, browser-made click
		if (ours) e.preventDefault();
	};
	const onTouchMove = (e: TouchEvent) => {
		for (const t of Array.from(e.changedTouches)) {
			if (t.identifier === stickFinger) stickTo(t);
			else if (lookFinger && t.identifier === lookFinger.id) {
				handle?.look(t.clientX - lookFinger.x, t.clientY - lookFinger.y);
				lookFinger.x = t.clientX;
				lookFinger.y = t.clientY;
			}
		}
		if (stickFinger !== null || lookFinger) e.preventDefault();
	};
	const onTouchEnd = (e: TouchEvent) => {
		for (const t of Array.from(e.changedTouches)) {
			const tap = taps.get(t.identifier);
			if (tap) {
				taps.delete(t.identifier);
				if (e.type === 'touchend' && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) < 14) tap.el.click();
			} else if (t.identifier === stickFinger) stickRelease();
			else if (lookFinger && t.identifier === lookFinger.id) lookFinger = null;
		}
	};
	const noPinch = (e: Event) => e.preventDefault();

	onMount(() => {
		root.addEventListener('touchstart', onTouchStart, { passive: false });
		root.addEventListener('touchmove', onTouchMove, { passive: false });
		root.addEventListener('touchend', onTouchEnd);
		root.addEventListener('touchcancel', onTouchEnd);
		// Safari's own pinch, which touch-action alone does not always stop
		document.addEventListener('gesturestart', noPinch);
		// let the closed doors paint before the heavy build starts
		requestAnimationFrame(() =>
			requestAnimationFrame(async () => {
				const { mountInterior } = await import('./interior/interior');
				const h = await mountInterior(
					stage,
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
		clearInterval(clockTimer);
		clearInterval(liftTimer);
		document.removeEventListener('gesturestart', noPinch);
		destroyed = true;
		handle?.dispose();
	});

	const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.pointerLockElement && onclose();
</script>

<svelte:window onkeydown={onKey} />

<div class="interior" bind:this={root}>
	<div class="stage" bind:this={stage}></div>
	<div class="bar">
		<button class="out" onclick={onclose}>← Back outside</button>
		<div class="title">
			<strong>{spec.label}</strong>
			<span>{place} · {spec.diameter} m across · {spec.people}</span>
		</div>
		<div class="clock" title="In-game time: a game hour passes every two real minutes">{clock}</div>
	</div>
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
	<p class="help">
		<span class="keys-how">Drag to look · WASD to walk · Shift to hurry{kind === 'factory' ? ' · in the great lift, ↑ and ↓ ride between the five floors' : kind === 'tent' ? ' · the door leads out to the campfire' : spec.gallery ? ' · the stairs lead up to the private rooms and the terrace' : ' · the door leads out into the forest'}</span>
		<span class="touch-how">Swipe to look · joystick to walk · push to the rim to hurry</span>
	</p>
	<div class="stick" class:hurrying bind:this={stickEl}>
		<span class="knob" bind:this={knobEl}></span>
	</div>

	{#if doors !== 'open'}
		<div class="loading" class:opening={doors === 'opening'} role="status" aria-live="polite">
			<img src="{base}/day-03-what-a-dome-looks-like/xsN9RYb5ExZtsNYtHDNra_qkM0bNfT.jpg" alt="" />
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
	.bar {
		position: absolute;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: 1rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		z-index: 2;
	}
	.out,
	.title,
	.clock {
		padding: 0.55rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.9);
		backdrop-filter: blur(10px);
		font: inherit;
		font-size: 0.85rem;
		color: #1f2a23;
	}
	.out {
		cursor: pointer;
	}
	.clock {
		font-variant-numeric: tabular-nums;
	}
	.title span {
		margin-left: 0.4rem;
		color: #7b857a;
	}
	.help {
		position: absolute;
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.75);
		color: #f2efe7;
		font-size: 0.8rem;
		white-space: nowrap;
	}

	/* the lift's panel, bottom centre, above the help line */
	.lift {
		position: absolute;
		left: 50%;
		bottom: calc(4.2rem + env(safe-area-inset-bottom, 0px));
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
		bottom: calc(10vh + env(safe-area-inset-bottom, 0px));
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

	/* ── the touch joystick, only where there is no mouse ── */
	.touch-how,
	.stick {
		display: none;
	}
	.stick {
		position: absolute;
		left: calc(1.5rem + env(safe-area-inset-left, 0px));
		bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
		z-index: 2;
		width: 8rem;
		height: 8rem;
		border-radius: 50%;
		background: rgb(250 248 242 / 0.18);
		border: 1.5px solid rgb(250 248 242 / 0.55);
		backdrop-filter: blur(6px);
		align-items: center;
		justify-content: center;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	/* a thumb landing just outside the ring still takes the knob */
	.stick::before {
		content: '';
		position: absolute;
		inset: -1.5rem;
		border-radius: 50%;
	}
	.stick.hurrying {
		border-color: #f0a47c;
	}
	.knob {
		width: 3.4rem;
		height: 3.4rem;
		border-radius: 50%;
		background: rgb(250 248 242 / 0.9);
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
		pointer-events: none;
		will-change: transform;
	}
	.stick.hurrying .knob {
		background: #f0a47c;
	}
	@media (hover: none) and (pointer: coarse) {
		.stick {
			display: flex;
			will-change: transform;
		}
		.keys-how {
			display: none;
		}
		.touch-how {
			display: inline;
		}
		p.touch-how {
			display: block;
		}
		.help {
			top: calc(4.2rem + env(safe-area-inset-top, 0px));
			bottom: auto;
		}
		/* the lift's panel above the joystick, not over it */
		.lift {
			bottom: calc(11rem + env(safe-area-inset-bottom, 0px));
		}
	}

	/* ── a narrow screen: a shorter bar that fits ── */
	@media (max-width: 640px) {
		.bar {
			left: 0.75rem;
			right: 0.75rem;
			gap: 0.35rem;
		}
		.out,
		.title,
		.clock {
			padding: 0.5rem 0.75rem;
			font-size: 0.8rem;
			white-space: nowrap;
		}
		.title {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.title span {
			display: none;
		}
		.clock {
			margin-left: auto;
		}
		.help {
			max-width: calc(100vw - 2rem);
			width: max-content;
			white-space: normal;
			text-align: center;
			font-size: 0.75rem;
		}
	}
</style>
