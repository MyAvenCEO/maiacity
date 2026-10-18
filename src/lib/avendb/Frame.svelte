<!--
	One layout for every avenDB view (Samuel 2026-10-18: "standardize this across all our avenDB views", the spark page
	its model): on the left the view's own navigation, its lists, tabs and filters (`nav`); the view in the middle; on
	the right the single source of truth of what it shows, its versions, variants, edit history and details (`aside`).
	A view gives the sides it has. Each column scrolls on its own, the page never does. Narrower, the right side slides
	in from a round button at the bottom right; narrower still, the left one from a round button at the bottom left,
	either side of the app's nav pill, over a scrim. On a phone a link in the left side, or a button marked `data-pick`,
	closes it once picked.

	The left side's rows look one way in every view, as these classes give them: `nav-search` (a search field),
	`nav-group` (a small-capital heading over a group of rows) and `nav-item` (a row: an icon, its label, a count in a
	`<small>` at its end; `on` where it is the one picked, with `aria-current` or `aria-pressed`).

	Over the middle column stands the head of the page the view is on, as the page around it gives it (./Shell.svelte's
	`HEAD`): the vault it is in, the view's name and who the person acts as. A view on the whole screen, as a spark is,
	gives `bare` and has a head of its own; a view that lays out its middle edge to edge, as a canvas or a player does,
	gives `flush`, and the middle keeps no margin round it.
-->
<script module>
	/** the context key under which the page around a view gives the head over its middle column */
	export const HEAD = Symbol('avendb head');
</script>

<script>
	import { getContext } from 'svelte';
	import Icon from './Icon.svelte';

	/** @typedef {import('svelte').ComponentProps<typeof Icon>['name']} IconName */
	/**
	 * @type {{ nav?: import('svelte').Snippet, aside?: import('svelte').Snippet, children?: import('svelte').Snippet,
	 *   navLabel?: string, asideLabel?: string, navIcon?: IconName, asideIcon?: IconName, bare?: boolean,
	 *   flush?: boolean, open?: '' | 'nav' | 'aside' }}
	 */
	let {
		nav,
		aside,
		children,
		navLabel = 'Pick what it shows',
		asideLabel = 'Versions, history and details',
		navIcon = 'board',
		asideIcon = 'history',
		bare = false,
		flush = false,
		open = $bindable('')
	} = $props();

	/** @type {{ head: import('svelte').Snippet | null } | undefined} */
	const page = getContext(HEAD);
	const head = $derived(bare ? null : (page?.head ?? null));

	/** On a phone: a link or a picking button in the left side closes it. @param {MouseEvent} e */
	function picked(e) {
		const at = /** @type {Element | null} */ (e.target);
		if (open === 'nav' && at?.closest('a[href], [data-pick]')) open = '';
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = '')} onhashchange={() => (open = '')} />

<div class="frame" class:bare class:has-nav={!!nav} class:has-aside={!!aside}>
	{#if open}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="scrim" onclick={() => (open = '')}></div>
	{/if}

	{#if nav}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<nav class="side left" class:open={open === 'nav'} aria-label={navLabel} onclick={picked}>
			<button class="shut" aria-label="Close" onclick={() => (open = '')}><Icon name="close" size={16} /></button>
			{@render nav()}
		</nav>
	{/if}

	<section class="middle" class:flush>
		{#if head}{@render head()}{/if}
		{@render children?.()}
	</section>

	{#if aside}
		<aside class="side right" class:open={open === 'aside'} aria-label={asideLabel}>
			<button class="shut" aria-label="Close" onclick={() => (open = '')}><Icon name="close" size={16} /></button>
			{@render aside()}
		</aside>
	{/if}

	<!-- narrower: each side's own round button, either side of the nav pill -->
	{#if nav}
		<button class="drawer left" aria-pressed={open === 'nav'} aria-label={navLabel} onclick={() => (open = open === 'nav' ? '' : 'nav')}
			><Icon name={navIcon} size={20} /></button
		>
	{/if}
	{#if aside}
		<button class="drawer right" aria-pressed={open === 'aside'} aria-label={asideLabel} onclick={() => (open = open === 'aside' ? '' : 'aside')}
			><Icon name={asideIcon} size={20} /></button
		>
	{/if}
</div>

<style>
	/* the view's columns, as tall as the screen, each scrolling on its own */
	.frame {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		height: 100%;
		min-height: 0;
	}

	.frame.has-nav {
		grid-template-columns: 15.5rem minmax(0, 1fr);
	}

	.frame.has-aside {
		grid-template-columns: minmax(0, 1fr) 21rem;
	}

	.frame.has-nav.has-aside {
		grid-template-columns: 15.5rem minmax(0, 1fr) 21rem;
	}

	.side,
	.middle {
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.middle {
		padding: calc(1.4rem + env(safe-area-inset-top, 0px)) clamp(1rem, 3vw, 2.4rem) 10rem;
	}

	.middle.flush {
		padding: 0;
	}

	.side {
		padding: calc(1.2rem + env(safe-area-inset-top, 0px)) 0.8rem 7rem;
		background: #efebe3;
	}

	/* under a head of the page's own, the notch is the head's to clear */
	.bare .side {
		padding-top: 1.2rem;
	}

	.side.left {
		border-right: 1px solid var(--edge);
	}

	.side.right {
		padding-inline: 1rem;
		border-left: 1px solid var(--edge);
		background: #f7f4ee;
	}

	/* the left side's rows, one look in every view */
	.left :global(.nav-search) {
		width: 100%;
		box-sizing: border-box;
		margin: 0 0 0.6rem;
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		font-size: 0.85rem;
	}

	.left :global(.nav-group) {
		display: block;
		margin: 0;
		padding: 1rem 0.6rem 0.3rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.left :global(.nav-group:first-of-type) {
		padding-top: 0.2rem;
	}

	.left :global(.nav-item) {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		box-sizing: border-box;
		margin: 0;
		padding: 0.42rem 0.6rem;
		border: 0;
		border-radius: 8px;
		background: none;
		font: inherit;
		font-size: 0.88rem;
		color: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	.left :global(.nav-item > span) {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.left :global(.nav-item > small) {
		flex: none;
		color: var(--soft);
		font-size: 0.74rem;
		font-variant-numeric: tabular-nums;
	}

	.left :global(.nav-item svg) {
		flex: none;
		color: var(--soft);
	}

	.left :global(.nav-item:hover) {
		background: rgb(0 0 0 / 0.05);
	}

	.left :global(.nav-item.on) {
		background: #fff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
		font-weight: 600;
	}

	.left :global(.nav-item.on svg) {
		color: var(--accent);
	}

	.left :global(.nav-item:disabled) {
		opacity: 0.5;
		cursor: default;
	}

	/* the toggles, the close buttons and the scrim show only where the sides slide in */
	.drawer,
	.shut,
	.scrim {
		display: none;
	}

	/* round, as tall as the nav pill and at its foot */
	.drawer {
		place-items: center;
		position: fixed;
		bottom: var(--nav-foot, 14px);
		z-index: 50;
		box-sizing: border-box;
		width: var(--nav-height, 52px);
		height: var(--nav-height, 52px);
		padding: 0;
		border: 1px solid var(--line, var(--edge));
		border-radius: 50%;
		background: rgb(250 248 242 / 0.94);
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
		backdrop-filter: blur(10px);
		color: inherit;
		cursor: pointer;
	}

	.drawer.left {
		left: max(12px, env(safe-area-inset-left, 0px));
	}

	.drawer.right {
		right: max(12px, env(safe-area-inset-right, 0px));
	}

	.drawer[aria-pressed='true'] {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: rgb(20 28 24 / 0.28);
	}

	.shut {
		place-items: center;
		float: right;
		width: 2rem;
		height: 2rem;
		margin: -0.3rem -0.3rem 0 0.3rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		color: inherit;
		cursor: pointer;
	}

	/* narrower: the right side slides in from the right */
	@media (max-width: 1100px) {
		.frame.has-aside {
			grid-template-columns: minmax(0, 1fr);
		}

		.frame.has-nav.has-aside {
			grid-template-columns: 15.5rem minmax(0, 1fr);
		}

		.side.right {
			position: fixed;
			top: 0;
			right: 0;
			bottom: 0;
			z-index: 41;
			width: min(22rem, 86vw);
			border-left: 0;
			box-shadow: 0 0 40px rgb(0 0 0 / 0.18);
			visibility: hidden;
			transform: translateX(100%);
			transition:
				transform 240ms ease,
				visibility 0s linear 240ms;
		}

		.bare .side.right {
			padding-top: calc(1.2rem + env(safe-area-inset-top, 0px));
		}

		.side.right.open {
			visibility: visible;
			transform: none;
			transition: transform 240ms ease;
		}

		.drawer.right,
		.right .shut {
			display: grid;
		}

		.scrim {
			display: block;
		}
	}

	/* a phone: the left side slides in from the left too */
	@media (max-width: 760px) {
		.frame.has-nav,
		.frame.has-nav.has-aside {
			grid-template-columns: minmax(0, 1fr);
		}

		.side.left {
			position: fixed;
			top: 0;
			left: 0;
			bottom: 0;
			z-index: 41;
			width: min(19rem, 84vw);
			padding-bottom: calc(var(--nav-room, 5rem) + 1rem);
			border-right: 0;
			box-shadow: 0 0 40px rgb(0 0 0 / 0.18);
			visibility: hidden;
			transform: translateX(-100%);
			transition:
				transform 240ms ease,
				visibility 0s linear 240ms;
		}

		.bare .side.left {
			padding-top: calc(1.2rem + env(safe-area-inset-top, 0px));
		}

		.side.left.open {
			visibility: visible;
			transform: none;
			transition: transform 240ms ease;
		}

		.drawer.left,
		.left .shut {
			display: grid;
		}

		.middle:not(.flush) {
			padding-top: calc(1rem + env(safe-area-inset-top, 0px));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.side {
			transition: none !important;
		}
	}
</style>
