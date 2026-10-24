<!--
	THE MAIA CITY VAULT'S RECIPES ON A PAGE — what a page that builds assets shows of where its recipes come from
	($lib/assets/vault.js, with no repo fallback: Samuel 2026-10-17). While they load, that they do, the page held back
	(`hold`), so a world's first build finds them; a feed that can't be reached, or a vault that holds none, in the page's
	place, saying why, with a way to ask again; and once the page stands, one line over it, naming every ref a build
	asked for that the vault doesn't hold or holds otherwise, every one whose file never came however long the page
	waited for it (with a way to load the page again), and every entry of it the reader refused, so we see what still
	needs porting. A file still on its way is none of them: the app's status pill shows it loading
	($lib/app/StatusPill.svelte). The app's layout holds every asset page behind it (`ASSET_PAGES`); a film's world and an
	asset's own page are held behind it too.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { loadRecipes, recipes, reloadRecipes, watchRecipes } from './vault.js';

	/**
	 * @type {{ children: import('svelte').Snippet, hold?: boolean }} `hold`: the page waits for the recipes and shows
	 *   what failed of them (an asset page); without it, the page only
	 */
	let { children, hold = true } = $props();

	const copy = (/** @type {typeof recipes} */ r) => ({ ...r, refused: [...r.refused], missed: [...r.missed], unread: [...r.unread] });
	let state = $state.raw(copy(recipes));
	let open = $state(false);
	onMount(() => watchRecipes((r) => (state = copy(r))));
	$effect(() => {
		if (hold) void loadRecipes();
	});

	const told = $derived(hold ? [...state.missed, ...state.unread, ...state.refused.map((r) => `refused: ${r}`)] : []);
	const failed = $derived(state.missed.length + state.unread.length);
	const said = $derived(
		[failed && `${failed} ${failed === 1 ? 'asset' : 'assets'} couldn't load`, state.refused.length && `${state.refused.length} ${state.refused.length === 1 ? 'entry' : 'entries'} refused`].filter(Boolean).join(' · ')
	);
</script>

{#if !hold || state.phase === 'ready'}
	{@render children()}
{:else if state.phase === 'failed'}
	<div class="gate" role="alert">
		<h1>The assets can't be built</h1>
		<p class="why">{state.error}</p>
		<p class="soft">Every recipe comes from the Maia City vault in avenDB; nothing is built from the repo instead.</p>
		<button class="pill-btn" onclick={() => reloadRecipes()}>Try again</button>
	</div>
{:else}
	<div class="gate" role="status">
		<p class="soft">{state.waiting ? "Waiting for recipes to sync into local avenDB…" : 'Loading the asset recipes from the Maia City vault…'}</p>
	</div>
{/if}
{#if told.length}
	<aside class="banner" role="alert" aria-label="Recipes the Maia City vault could not give">
		<button onclick={() => (open = !open)} aria-expanded={open}>{said} · {open ? 'hide' : 'details'}</button>
		{#if open}
			<ul>
				{#each told as t (t)}<li>{t}</li>{/each}
			</ul>
			{#if state.unread.length}<button class="again" onclick={() => location.reload()}>Load the page again</button>{/if}
		{/if}
	</aside>
{/if}

<style>
	.gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		min-height: 100svh;
		padding: calc(2rem + env(safe-area-inset-top, 0px)) 1rem calc(2rem + env(safe-area-inset-bottom, 0px));
		text-align: center;
	}

	.gate h1 {
		margin: 0;
		font-size: clamp(1.8rem, 5vw, 2.6rem);
	}

	.why {
		max-width: 36rem;
		margin: 0;
		color: #b3261e;
		overflow-wrap: anywhere;
	}

	.soft {
		max-width: 32rem;
		margin: 0;
		font-size: 0.9rem;
		color: var(--muted, #6b6b6b);
	}

	/* over whatever the page draws, a full-screen world too, and clear of the status bar of the pinned app */
	.banner {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 0.5rem);
		left: 50%;
		z-index: 60;
		transform: translateX(-50%);
		max-width: min(calc(100vw - 2rem), 40rem);
		border: 1px solid rgb(179 38 30 / 0.3);
		border-radius: 14px;
		background: #fff6f2;
		color: #8c1d18;
		font-size: 0.82rem;
		box-shadow: 0 4px 18px rgb(31 42 35 / 0.14);
	}

	.banner button {
		display: block;
		width: 100%;
		padding: 0.35rem 0.9rem;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}

	.banner ul {
		max-height: 40svh;
		margin: 0;
		padding: 0 0.9rem 0.6rem 1.8rem;
		overflow: auto;
		overflow-wrap: anywhere;
	}

	.banner li + li {
		margin-top: 0.3rem;
	}

	.banner .again {
		width: auto;
		margin: 0 0.9rem 0.6rem;
		padding: 0.3rem 0.8rem;
		border: 1px solid rgb(179 38 30 / 0.3);
		border-radius: 999px;
	}
</style>
