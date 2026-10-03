<!--
	The bar along the top of a world you walk, the same in every one: the world's name with a line on where it is, and
	the time of its sky (./SkyControl.svelte). The way back is the app's nav pill ($lib/app/NavPill.svelte; a world
	open over a page closes with it through $lib/app/back.svelte.js). See-through pills; the world shows through and
	goes on under the gaps between them (a finger there looks round).

	A phone keeps the screen for the world: on a short screen (on its side) the pills are slimmer and the bar sits
	closer to the edge; on a narrow one (upright) the name drops its line. Either way it keeps clear of the notch and of
	a home-screen app's status bar (env(safe-area-inset-*)).

	Its buttons sit in `.bar`, so a page's TouchStick takes them with taps=".bar a, .bar button".
-->
<script>
	import SkyControl from './SkyControl.svelte';

	/** @type {{ title: string, subtitle?: string }} */
	let { title, subtitle = '' } = $props();
</script>

<div class="bar">
	<div class="title"><strong>{title}</strong>{#if subtitle}<span>{subtitle}</span>{/if}</div>
	<SkyControl class="time" />
</div>

<style>
	.bar {
		position: absolute;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: calc(1rem + env(safe-area-inset-left, 0px));
		right: calc(1rem + env(safe-area-inset-right, 0px));
		z-index: 2;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		pointer-events: none;
	}
	/* see-through pills: the world shows through, blurred (as ./SkyControl.svelte) */
	.title {
		padding: 0.55rem 0.9rem;
		border: 1px solid rgb(255 255 255 / 0.35);
		border-radius: 999px;
		background: rgb(250 248 242 / 0.55);
		-webkit-backdrop-filter: blur(12px) saturate(1.2);
		backdrop-filter: blur(12px) saturate(1.2);
		font: inherit;
		font-size: 0.85rem;
		color: #1f2a23;
		text-decoration: none;
		white-space: nowrap;
		pointer-events: auto;
	}
	/* the name gives way first: it ends in … rather than pushing the time off the screen */
	.title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title span {
		margin-left: 0.4rem;
		color: #7b857a;
	}
	.bar :global(.time) {
		flex: none;
		margin-left: auto;
		pointer-events: auto;
	}

	/* ── a phone: slimmer pills, closer to the edge ── */
	@media (max-width: 640px), (max-height: 500px) {
		.bar {
			top: calc(0.5rem + env(safe-area-inset-top, 0px));
			left: calc(0.5rem + env(safe-area-inset-left, 0px));
			right: calc(0.5rem + env(safe-area-inset-right, 0px));
			gap: 0.35rem;
		}
		.title {
			padding: 0.4rem 0.75rem;
			font-size: 0.75rem;
			line-height: 1.3;
		}
	}

	/* ── upright: the name alone ── */
	@media (max-width: 640px) {
		.title span {
			display: none;
		}
	}
</style>
