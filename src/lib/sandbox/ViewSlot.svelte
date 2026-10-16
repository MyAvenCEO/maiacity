<!--
	A SLOT — one of a page's panels a view may take the place of (Sandbox 7's Board, Activity, Prices, Avens and Stats;
	MaiaCity V1's COOPs, Ledger and Rules) or stand over (V1's panels with moves: the view on top, the panel's buttons
	below it). The page's own panel is the slot's default: it shows while no view stands there, and stays one tap away
	while one does. The view shows through the one view host (./ViewHost.svelte), so a slot asks nothing of whoever
	made it. A page never makes a slot where a person decides (accepting, signing, a setting), so a view can't dress up
	a choice.
-->
<script module>
	// which slots show the page's own panel instead of their view, for this visit: by slot and view
	const builtIn = $state({});
	/** does the view `card` show in `slot` (not put aside for the page's own panel)? For a heading the page draws */
	export const standing = (slot, card) => Boolean(card) && !builtIn[`${slot}:${card.id}`];
</script>

<script>
	// @ts-nocheck — plain JS
	import ViewHost from './ViewHost.svelte';
	import { viewOfCard } from './view-host.js';

	/**
	 * slot: its name (the key a view card's data.slot gives); card: the view standing there, or null; data: what the
	 * view is handed; where: the slot in words; over: the view stands over the panel instead of taking its place
	 */
	let { slot, card = null, data = undefined, where = 'here', over = false, height = 400, onevent = () => {}, children } = $props();
	const key = $derived(card ? `${slot}:${card.id}` : '');
	const shown = $derived(standing(slot, card));
	const frame = $derived(card ? viewOfCard(card, height) : null);
</script>

{#if shown}
	<div class="view-slot">
		{#key frame}<ViewHost view={frame} {data} {onevent} onerror={(m) => console.warn(`view ${card.id}:`, m)} />{/key}
		<p class="slot-note">
			A MIP stood the screen “{card.name}” in {where}{over ? '; it only shows, every move stays a button below it' : ''}.
			<button class="slot-link" onclick={() => (builtIn[key] = true)}>{over ? 'Hide it' : 'Show the built-in screen'}</button>
		</p>
	</div>
{:else if card}
	<p class="slot-note"><button class="slot-link" onclick={() => (builtIn[key] = false)}>Show the screen “{card.name}”</button></p>
{/if}
{#if !shown || over}{@render children?.()}{/if}

<style>
	.view-slot {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.slot-note {
		margin: 4px 0 8px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--muted, #6b6b6b);
	}
	.slot-link {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--accent, #2f6f5e);
		text-decoration: underline;
		cursor: pointer;
	}
</style>
