<!--
	avenCITY Sandbox 4 — a whole dome cell in one world: the master dome, six
	large domes, six medium domes, the paths and streams between them and the
	food forest round it all (interior/village.ts). Walk up to any dome and its
	full inside is built into the village as you come; walk in through its door
	with nothing to wait for.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import type { VillageHandle } from '$lib/sandbox-2/interior/village';
	import { gameClock } from '../../../../game/time';

	let stage: HTMLDivElement;
	let village: VillageHandle | null = null;
	let destroyed = false;
	let loading = $state(true);
	let fading = $state(false);
	let step = $state('Letting in the light');
	let done = $state(0);
	const STEPS = 8;
	/** the dome being opened as you walk up to it */
	let opening = $state<string | null>(null);
	const openingTimer = setInterval(() => (opening = village?.opening() ?? null), 300);
	let clock = $state(gameClock().label);
	const clockTimer = setInterval(() => (clock = gameClock().label), 1000);

	/* the sky kept at day while the clock runs on; every visit starts on the real sky */
	let alwaysDay = $state(false);
	/** when a finger last flipped it, so a click the browser makes of the same press is not a second flip */
	let dayTouched = 0;
	const toggleDay = () => {
		alwaysDay = !alwaysDay;
		village?.alwaysDay(alwaysDay);
	};
	const clickDay = () => {
		if (performance.now() - dayTouched > 800) toggleDay();
	};

	/* on a phone: the joystick walks (push it to the rim to hurry), any other finger on the
	   world looks round. Touch events, each finger by its own identifier, so both work at once.
	   The joystick floats: a thumb set down anywhere in the lower left brings the ring to it,
	   the knob stays under the thumb wherever it goes, and past the rim the ring is drawn
	   after it. So the knob can never be anywhere but under the thumb. */
	let root: HTMLDivElement;
	let stickEl: HTMLDivElement;
	let knobEl: HTMLSpanElement;
	let hurrying = $state(false);
	let stickFinger: number | null = null;
	/** where the ring rests, where it is now (under the thumb's first touch, drawn after it), its radius */
	let stick = { homeX: 0, homeY: 0, x: 0, y: 0, r: 64 };
	let lookFinger: { id: number; x: number; y: number } | null = null;
	/** a finger on the bar's links: followed when it lifts where it came down */
	const taps = new Map<number, { el: HTMLElement; x: number; y: number }>();
	/** the lower left, where a thumb takes the joystick (only on a phone, where the ring shows) */
	const inStickZone = (t: Touch) => stickEl.offsetWidth > 0 && t.clientX < innerWidth * 0.45 && t.clientY > innerHeight * 0.4;
	const stickTo = (t: Touch) => {
		let x = t.clientX - stick.x;
		let y = t.clientY - stick.y;
		const d = Math.hypot(x, y);
		// past the rim, the ring is drawn after the thumb
		if (d > stick.r) {
			stick.x += (x * (d - stick.r)) / d;
			stick.y += (y * (d - stick.r)) / d;
			x = t.clientX - stick.x;
			y = t.clientY - stick.y;
		}
		stickEl.style.transform = `translate(${stick.x - stick.homeX}px, ${stick.y - stick.homeY}px)`;
		knobEl.style.transform = `translate(${x}px, ${y}px)`;
		// full walking pace three quarters of the way out, a hurry with the knob on the rim
		const m = Math.min(1, Math.hypot(x, y) / stick.r);
		const pace = m < 0.08 ? 0 : Math.min(1, m / 0.75);
		const n = Math.hypot(x, y) || 1;
		hurrying = m > 0.95;
		village?.move((x / n) * pace, (-y / n) * pace, hurrying);
	};
	const stickRelease = () => {
		stickFinger = null;
		stickEl.style.transform = '';
		knobEl.style.transform = '';
		hurrying = false;
		village?.move(0, 0, false);
	};
	const onTouchStart = (e: TouchEvent) => {
		let ours = false;
		for (const t of Array.from(e.changedTouches)) {
			const el = t.target as Element;
			const tap = el.closest?.('.bar a, .bar button') as HTMLElement | null;
			if (tap?.classList.contains('daylight')) {
				// the switch flips as the finger comes down: no click to wait for, which a browser
				// will not make while another finger is down, nor if the press is taken from it
				dayTouched = performance.now();
				toggleDay();
				ours = true;
			} else if (tap) {
				taps.set(t.identifier, { el: tap, x: t.clientX, y: t.clientY });
				ours = true;
			} else if (stickFinger === null && (stickEl.contains(el) || (stage.contains(el) && inStickZone(t)))) {
				stickFinger = t.identifier;
				stickEl.style.transform = '';
				const box = stickEl.getBoundingClientRect();
				const homeX = box.left + box.width / 2, homeY = box.top + box.height / 2;
				stick = { homeX, homeY, x: t.clientX, y: t.clientY, r: box.width / 2 };
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
				village?.look(t.clientX - lookFinger.x, t.clientY - lookFinger.y);
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
		requestAnimationFrame(() =>
			requestAnimationFrame(async () => {
				const { mountVillage } = await import('$lib/sandbox-2/interior/village');
				const v = await mountVillage(
					stage,
					(label) => {
						if (label === 'ready') return;
						step = label;
						done += 1;
					}
				);
				if (destroyed) return v.dispose();
				village = v;
				done = STEPS;
				fading = true;
				setTimeout(() => (loading = false), 1100);
			})
		);
	});
	onDestroy(() => {
		destroyed = true;
		clearInterval(clockTimer);
		clearInterval(openingTimer);
		document.removeEventListener('gesturestart', noPinch);
		village?.dispose();
	});
</script>

<svelte:head>
	<title>avenCITY Sandbox 4 · A dome cell · maiaCITY</title>
	<meta name="description" content="Walk a whole maiaCITY dome cell: the master dome, six large domes and six medium domes, with paths, streams and a food forest between them. Step into any of them." />
</svelte:head>

<div class="village" bind:this={root}>
	<div class="stage" bind:this={stage}></div>
	<div class="bar">
		<a class="out" href="{base}/games">← Games</a>
		<div class="title"><strong>avenCITY Sandbox 4</strong><span>A dome cell · thirteen domes</span></div>
		<div class="clock" title="In-game time: a game hour passes every two real minutes">{clock}</div>
		<button
			class="daylight"
			class:on={alwaysDay}
			aria-label="Always day"
			aria-pressed={alwaysDay}
			title={alwaysDay ? 'Kept at day — tap for the real sky again' : 'The real sky: sun and moon follow the clock — tap to keep it day'}
			onclick={clickDay}
		>
			{#if alwaysDay}
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg>
				<span>Day</span>
			{:else}
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
				<span>Real sky</span>
			{/if}
		</button>
	</div>
	<p class="help">
		<span class="keys">Drag to look · WASD to walk · Shift to hurry · walk through any door to step inside</span>
		<span class="touch">Swipe to look · thumb down lower left to walk · to the rim to hurry</span>
	</p>
	<div class="stick" class:hurrying bind:this={stickEl}>
		<span class="knob" bind:this={knobEl}></span>
	</div>
	{#if opening}<p class="opening">The {opening.toLowerCase()} ahead is opening its doors…</p>{/if}

	{#if loading}
		<div class="loading" class:opening={fading} role="status" aria-live="polite">
			<img src="{base}/day-03-what-a-dome-looks-like/xsN9RYb5ExZtsNYtHDNra_qkM0bNfT.jpg" alt="" />
			<div class="shade"></div>
			<div class="label">
				<p class="eyebrow">avenCITY Sandbox 4</p>
				<strong>A dome cell</strong>
				<span class="size">the master dome, six large domes, six medium domes</span>
				<div class="progress"><span style:width="{Math.min(100, (done / STEPS) * 100)}%"></span></div>
				<span class="step">{fading ? 'Welcome' : `${step}…`}</span>
			</div>
		</div>
	{/if}

</div>

<style>
	.village {
		position: fixed;
		inset: 0;
		background: #1f2a23;
	}
	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
	}
	.opening {
		position: absolute;
		bottom: calc(3.8rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.6);
		border: 1px solid rgb(255 255 255 / 0.35);
		-webkit-backdrop-filter: blur(12px) saturate(1.2);
		backdrop-filter: blur(12px) saturate(1.2);
		color: #1f2a23;
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.bar {
		position: absolute;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: 1rem;
		right: 1rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		z-index: 2;
	}
	/* see-through pills: the world shows through, blurred */
	.out,
	.title,
	.clock,
	.daylight {
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.35);
		-webkit-backdrop-filter: blur(12px) saturate(1.2);
		backdrop-filter: blur(12px) saturate(1.2);
		font-size: 0.85rem;
		color: #1f2a23;
		text-decoration: none;
	}
	.daylight {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.2s ease;
	}
	.daylight svg {
		width: 1.05em;
		height: 1.05em;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.daylight.on {
		background: rgb(240 196 154 / 0.7);
	}
	.title span {
		margin-left: 0.4rem;
		color: #7b857a;
	}
	.clock {
		font-variant-numeric: tabular-nums;
	}
	.help {
		position: absolute;
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.45);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		color: #f2efe7;
		font-size: 0.8rem;
		white-space: nowrap;
	}
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
		animation: closer 20s ease-out forwards;
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
	.help .touch,
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
		inset: -1.25rem;
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
		}
		.help .keys {
			display: none;
		}
		.help .touch {
			display: inline;
		}
		.help {
			top: calc(4.2rem + env(safe-area-inset-top, 0px));
			bottom: auto;
		}
		.opening {
			bottom: calc(11rem + env(safe-area-inset-bottom, 0px));
		}
		.stick {
			will-change: transform;
		}
	}
	/* a phone on its side: Safari's address bar sits at the top, and once it has shrunk, a tap
	   near the top edge opens it again instead of reaching the page; so the bar stands clear of it */
	@media (hover: none) and (pointer: coarse) and (orientation: landscape) {
		.bar {
			top: calc(2.6rem + env(safe-area-inset-top, 0px));
		}
		.help {
			top: calc(5.8rem + env(safe-area-inset-top, 0px));
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
		.clock,
		.daylight {
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
		/* just the sun or moon on a phone */
		.daylight {
			margin-left: 0;
			padding: 0.5rem 0.6rem;
		}
		.daylight span {
			display: none;
		}
		.help,
		.opening {
			max-width: calc(100vw - 2rem);
			white-space: normal;
			text-align: center;
			font-size: 0.75rem;
		}
		.help {
			width: max-content;
		}
	}
</style>
