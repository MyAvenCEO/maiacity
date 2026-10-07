<!--
	The one layout of every turntable of the app (the biomes, the 3D models, the actors, the plants), on a phone, a
	tablet and a desktop alike: the list to pick from ($lib/app/PickList.svelte), the thing itself on its canvas, and
	round it what the page gives it to say and do, in three places —

	  bar      what it does, the row of chips the page is most used by (the actors' moves, the plants' stages)
	  panel    the finer controls (a joint's turn, the biome's layers, the seed id, the variants)
	  readout  what it is: its name, its note, its measure, how to turn it

	and anything else floating over the canvas itself as its children (a joystick, a hint, a button).

	Where they go is said here once, for every page:
	  - a desktop or a tablet: the list down the left; over the canvas the bar across the top, the panel down the right
	    and the readout at the foot on the left, in a grid, so they never lie over each other, all clear of the nav pill;
	  - a phone upright: the list folded to one line at the top (tap it for the whole list), the canvas, and under it the
	    bar, the panel and the readout one after another, scrolling clear of the nav pill — nothing over the thing;
	  - a tablet upright: the list down the left, the canvas, and under it the bar, then the readout and the panel side
	    by side;
	  - a phone on its side: the list down the left, the canvas, and the bar, the panel and the readout down the right.
	`full` gives the canvas the whole of it (a walk inside a model): only the bar stays, over it.
-->
<script>
	import PickList from './PickList.svelte';
	import { enter } from './immersive.svelte';
	import { onMount } from 'svelte';

	/**
	 * @type {{
	 *   name: string,
	 *   picks: import('svelte').ComponentProps<typeof PickList>,
	 *   canvas?: HTMLDivElement,
	 *   stage?: HTMLDivElement,
	 *   full?: boolean,
	 *   bar?: import('svelte').Snippet,
	 *   panel?: import('svelte').Snippet,
	 *   readout?: import('svelte').Snippet,
	 *   children?: import('svelte').Snippet
	 * }}
	 */
	let { name, picks, canvas = $bindable(), stage = $bindable(), full = false, bar, panel, readout, children } = $props();

	/**
	 * Which side the notch is on, a phone on its side: iOS keeps the same room on both sides then (its safe-area insets
	 * are alike, left and right), but only the notch's side needs it — the page runs to the screen's edge on the other.
	 * Turned to the left (the angle 90) the notch is on the left, turned to the right (270, or -90) on the right.
	 * @type {'left' | 'right' | ''}
	 */
	let notch = $state('');
	const turned = () => {
		const angle = screen.orientation?.angle ?? Number(/** @type {any} */ (window).orientation ?? 0);
		notch = angle === 90 ? 'left' : angle === 270 || angle === -90 ? 'right' : '';
	};

	onMount(() => {
		turned();
		screen.orientation?.addEventListener('change', turned);
		window.addEventListener('orientationchange', turned);
		window.addEventListener('resize', turned);
		// full screen in the app: the nav pill over it, no strip kept for the status bar (the page keeps clear of the notch)
		const leave = enter();
		return () => {
			screen.orientation?.removeEventListener('change', turned);
			window.removeEventListener('orientationchange', turned);
			window.removeEventListener('resize', turned);
			leave();
		};
	});
</script>

<main class="turntable {name}" class:full class:notch-left={notch === 'left'} class:notch-right={notch === 'right'}>
	<PickList {...picks} />
	<section class="view">
		<div class="stage" bind:this={stage}>
			<div class="canvas" bind:this={canvas}></div>
			{@render children?.()}
		</div>
		<div class="deck">
			{#if bar}<div class="card bar">{@render bar()}</div>{/if}
			{#if panel && !full}<div class="card panel">{@render panel()}</div>{/if}
			{#if readout && !full}<div class="card readout">{@render readout()}</div>{/if}
		</div>
	</section>
</main>

<style>
	.turntable {
		position: fixed;
		inset: 0;
		/* clear of the notch (on its side only, below) — otherwise edge to edge; the nav pill keeps clear of the home bar */
		padding: env(safe-area-inset-top, 0px) 0 0;
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: minmax(0, 1fr);
		background: #f4f1eb;
		color: #1f2a23;
		font-size: 0.85rem;
	}

	.notch-left {
		padding-left: env(safe-area-inset-left, 0px);
	}

	.notch-right {
		padding-right: env(safe-area-inset-right, 0px);
	}

	.view {
		position: relative;
		min-width: 0;
		min-height: 0;
	}

	.stage {
		position: absolute;
		inset: 0;
	}

	.canvas {
		position: absolute;
		inset: 0;
		cursor: grab;
		touch-action: none;
	}

	/* a desktop or a tablet: over the canvas, in a grid — the bar across the top, the panel down the right, the readout
	   at the foot on the left, above the nav pill (--nav-room, src/app.css) */
	.deck {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: auto minmax(0, 1fr);
		grid-template-areas:
			'bar bar'
			'readout panel';
		gap: 0.75rem 1rem;
		padding: 1rem 1rem var(--nav-room);
		pointer-events: none;
	}

	.card {
		min-width: 0;
		padding: 0.6rem 0.8rem;
		border-radius: 12px;
		background: rgb(255 255 255 / 0.8);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		pointer-events: auto;
	}

	/* a place the page has nothing for just now takes no room */
	.card:not(:has(*)) {
		display: none;
	}

	.bar {
		grid-area: bar;
		justify-self: stretch;
	}

	.panel {
		grid-area: panel;
		align-self: start;
		width: 15rem;
		max-height: 100%;
		overflow: auto;
		overscroll-behavior: contain;
	}

	.readout {
		grid-area: readout;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		align-self: end;
		justify-self: start;
		max-width: 32rem;
		max-height: 100%;
		overflow: auto;
	}

	/* nothing over a walk but its bar, and that only as wide as it is */
	.full .bar {
		justify-self: end;
		padding: 0;
		background: none;
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
	}

	/* the shared look of what the pages put in it: small capitals for a heading, round chips that press dark (the least
	   specific of rules, so a page's own look of a chip wins) */
	:where(.turntable) :global(.label) {
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	:where(.turntable) :global(button) {
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	:where(.turntable) :global(.chip) {
		padding: 0.3rem 0.65rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
		white-space: nowrap;
	}

	:where(.turntable) :global(.chip.on) {
		background: #1f2a23;
		border-color: #1f2a23;
		color: #fff;
	}

	:where(.turntable) :global(.chips) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.readout :global(small) {
		opacity: 0.6;
	}

	/* a phone upright: the list folded at the top, the canvas, and under it the deck, nothing over the thing */
	@media (max-width: 720px) {
		.turntable {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}

		.turntable:not(.full) .view {
			display: flex;
			flex-direction: column;
		}

		.turntable:not(.full) .stage {
			position: relative;
			inset: auto;
			flex: 1 1 auto;
			min-height: 38vh;
		}

		.turntable:not(.full) .deck {
			position: relative;
			inset: auto;
			flex: 0 1 auto;
			max-height: 52%;
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
			padding: 0.6rem 0.75rem calc(var(--nav-room) + 0.25rem);
			overflow: auto;
			overscroll-behavior: contain;
			border-top: 1px solid rgb(0 0 0 / 0.08);
			pointer-events: auto;
		}

		.turntable:not(.full) .card {
			flex: none;
			align-self: stretch;
			width: auto;
			max-width: none;
			max-height: none;
			overflow: visible;
			background: #fff;
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}

		/* the bar's chips in one row, scrolling sideways */
		.turntable:not(.full) .bar :global(.chips) {
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
			margin: -0.2rem -0.8rem;
			padding: 0.2rem 0.8rem;
		}

		.turntable:not(.full) .bar :global(.chips)::-webkit-scrollbar {
			display: none;
		}

		.turntable:not(.full) .bar :global(.chip) {
			flex: none;
		}

		.turntable.full .deck {
			padding-top: 0.75rem;
		}
	}

	/* a tablet upright: the list down the left still, but the deck under the canvas, as on a phone — the bar across, the
	   readout and the panel side by side under it */
	@media (min-width: 721px) and (max-width: 1100px) and (orientation: portrait) {
		.turntable:not(.full) .view {
			display: flex;
			flex-direction: column;
		}

		.turntable:not(.full) .stage {
			position: relative;
			inset: auto;
			flex: 1 1 auto;
			min-height: 45vh;
		}

		.turntable:not(.full) .deck {
			position: relative;
			inset: auto;
			flex: 0 1 auto;
			max-height: 45%;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-rows: auto auto;
			padding: 0.75rem 1rem calc(var(--nav-room) + 0.25rem);
			overflow: auto;
			overscroll-behavior: contain;
			border-top: 1px solid rgb(0 0 0 / 0.08);
			pointer-events: auto;
		}

		.turntable:not(.full) .card {
			align-self: start;
			justify-self: stretch;
			width: auto;
			max-width: none;
			max-height: none;
			overflow: visible;
			background: #fff;
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
	}

	/* a phone on its side: the list down the left, the canvas, and the deck down the right */
	@media (max-height: 500px) and (min-width: 721px) {
		.turntable:not(.full) .view {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 13.5rem;
		}

		.turntable:not(.full) .stage {
			position: relative;
			inset: auto;
		}

		.turntable:not(.full) .deck {
			position: relative;
			inset: auto;
			display: flex;
			flex-direction: column;
			gap: 0.35rem;
			padding: 0.35rem 0.35rem var(--nav-room);
			font-size: 0.75rem;
			overflow: auto;
			overscroll-behavior: contain;
			border-left: 1px solid rgb(0 0 0 / 0.08);
			pointer-events: auto;
		}

		.turntable:not(.full) .card {
			flex: none;
			align-self: stretch;
			width: auto;
			max-width: none;
			max-height: none;
			overflow: visible;
			padding: 0.45rem 0.55rem;
			border-radius: 10px;
			background: #fff;
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}

		/* compact: small chips, the bar's in one row scrolling sideways */
		.turntable:not(.full) .deck :global(.chips) {
			gap: 0.25rem;
		}

		.turntable:not(.full) .deck :global(.chip) {
			padding: 0.2rem 0.5rem;
		}

		.turntable:not(.full) .deck :global(.label) {
			font-size: 0.62rem;
		}

		.turntable:not(.full) .bar :global(.chips) {
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
			margin: -0.2rem -0.55rem;
			padding: 0.2rem 0.55rem;
		}

		.turntable:not(.full) .bar :global(.chips)::-webkit-scrollbar {
			display: none;
		}

		.turntable:not(.full) .bar :global(.chip) {
			flex: none;
		}
	}
</style>
