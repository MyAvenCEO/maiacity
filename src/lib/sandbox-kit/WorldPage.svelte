<!--
	The page of a world you walk, the same for every one: the world full screen, its bar along the top (./WorldBar.svelte),
	how to walk at the foot (./WalkHint.svelte), the phone's joystick ($lib/touch/TouchStick), and, while it comes up,
	either a cover (a photo, the world's name and a bar filling step by step, fading out once it is in) or, without one,
	a small pill saying what it is doing. The page hands it `mount`, which raises the world in the stage and answers it
	with `move`, `look` and `dispose`; the page keeps that handle itself for anything else it asks of the world.

	Whatever else the page shows over the world (a card beside it) goes in as its children; `notice`, asked a few times a
	second, is a line at the foot (a dome ahead opening its doors). Used by Sandbox 3 and 4 (the dome cell and its food
	forest) and the tired land.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import WalkHint from './WalkHint.svelte';
	import WorldBar from './WorldBar.svelte';

	/**
	 * @typedef {{ move: (x: number, y: number, hurry: boolean) => void, look: (dx: number, dy: number) => void, dispose: () => void }} Walked
	 *   a world you walk, as `mount` answers it
	 * @typedef {{ image: string, eyebrow: string, title: string, size: string, steps: number, first?: string, counts?: (label: string) => boolean }} Cover
	 *   the cover while the world comes up: its photo, its name over a line on what it is, and the bar, full after `steps`
	 *   steps; `first`, the step it says before the world has said any; `counts`, whether a step the world reports moves the
	 *   bar (a step that only tells how far on it is in its own words does not)
	 */
	/**
	 * @type {{
	 *   mount: (stage: HTMLDivElement, onProgress: (label: string) => void) => Promise<Walked>,
	 *   title: string,
	 *   subtitle?: string,
	 *   keys?: string,
	 *   cover?: Cover | null,
	 *   waiting?: string,
	 *   ground?: string,
	 *   notice?: (() => string | null) | null,
	 *   taps?: string,
	 *   label?: string,
	 *   onpointerdown?: (e: PointerEvent) => void,
	 *   onpointerup?: (e: PointerEvent) => void,
	 *   children?: import('svelte').Snippet
	 * }}
	 */
	let {
		mount,
		title,
		subtitle = '',
		keys,
		cover = null,
		waiting = 'Loading the world…',
		ground = '#1f2a23',
		notice = null,
		taps = '.bar a, .bar button',
		label,
		onpointerdown,
		onpointerup,
		children
	} = $props();

	/** @type {HTMLDivElement | undefined} */
	let stage = $state();
	/** @type {Walked | null} */
	let world = null;
	let destroyed = false;
	// with a cover: whether it is still up, fading, the step it is on and how many are done; without: the pill's words
	let loading = $state(true);
	let fading = $state(false);
	let step = $state('');
	let done = $state(0);
	/** null until the world has said anything, then '' once it is up */
	let status = $state(/** @type {string | null} */ (null));
	/** the line at the foot, as `notice` last said it */
	let note = $state(/** @type {string | null} */ (null));
	/** @type {ReturnType<typeof setInterval> | undefined} */
	let noticeTimer;

	async function raise() {
		const w = await mount(/** @type {HTMLDivElement} */ (stage), (said) => {
			if (!cover) return void (status = said === 'ready' ? '' : `${said}…`);
			if (said === 'ready') return;
			step = said;
			if (cover.counts?.(said) ?? true) done += 1;
		});
		if (destroyed) return w.dispose();
		world = w;
		if (!cover) return;
		done = cover.steps;
		fading = true;
		setTimeout(() => (loading = false), 1100);
	}

	// a cover is painted before the world starts its work, two frames on, so it is there at once
	onMount(() => {
		if (notice) noticeTimer = setInterval(() => (note = notice()), 300);
		if (cover) requestAnimationFrame(() => requestAnimationFrame(raise));
		else raise();
	});
	onDestroy(() => {
		destroyed = true;
		clearInterval(noticeTimer);
		world?.dispose();
	});
</script>

<div class="world" style:background={ground}>
	<div class="stage" bind:this={stage} role={label ? 'application' : undefined} aria-label={label} {onpointerdown} {onpointerup}></div>
	<WorldBar {title} {subtitle} />
	{#if !cover && status !== ''}<p class="status">{status ?? waiting}</p>{/if}
	<WalkHint {keys} />
	<!-- on a phone: the joystick walks, any other finger on the world looks round -->
	<TouchStick move={(x, y, hurry) => world?.move(x, y, hurry)} look={(dx, dy) => world?.look(dx, dy)} {stage} {taps} />
	{@render children?.()}
	{#if note}<p class="notice">{note}</p>{/if}

	{#if cover && loading}
		<div class="loading" class:opening={fading} style:background={ground} role="status" aria-live="polite">
			<img src={cover.image} alt="" />
			<div class="shade"></div>
			<div class="label">
				<p class="eyebrow">{cover.eyebrow}</p>
				<strong>{cover.title}</strong>
				<span class="size">{cover.size}</span>
				<div class="progress"><span style:width="{Math.min(100, (done / cover.steps) * 100)}%"></span></div>
				<span class="step">{fading ? 'Welcome' : `${step || (cover.first ?? 'Letting in the light')}…`}</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.world {
		position: fixed;
		inset: 0;
	}
	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
	}
	/* what the world is doing while it comes up, without a cover */
	.status {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		margin: 0;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.7);
		color: #2c2a1e;
		font-size: 0.85rem;
		z-index: 2;
	}
	/* at the foot, above the walk hint and the app's nav pill (--nav-room, src/app.css) */
	.notice {
		position: absolute;
		bottom: calc(3.8rem + var(--nav-room));
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
	.loading {
		position: absolute;
		inset: 0;
		z-index: 3;
		overflow: hidden;
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

	/* ── on a phone: above the joystick ($lib/touch/TouchStick; --stick-room, src/app.css) ── */
	@media (hover: none) and (pointer: coarse) {
		.notice {
			bottom: calc(var(--stick-room) + 3rem);
		}
	}

	/* ── a narrow screen ── */
	@media (max-width: 640px) {
		.notice {
			max-width: calc(100vw - 2rem);
			white-space: normal;
			text-align: center;
			font-size: 0.75rem;
		}
	}
</style>
