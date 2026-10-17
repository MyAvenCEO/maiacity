<!--
	A dashboard group opened (the Sandboxes, Game Assets, My Data): its places as a list, a picture on each row, and on
	a wide screen an aside on the left that shows the picture of the row under the pointer (or in focus) large.
	Only the places this founder may open are listed: those whose capability they hold, a draft only for an admin.
	A game is published or withdrawn here by whoever's device acts for the Maia City COOP vault, whose Public share on
	the game is what publishing it is ($lib/app/games.svelte.js).
-->
<script>
	import { onMount } from 'svelte';
	import { me } from '$lib/auth/client';
	import { holds, isAdmin, published, released } from '$lib/app/places';
	import { cityOf, loadGames, publish } from '$lib/app/games.svelte.js';
	import { session } from '$lib/avendb/session.svelte.js';
	import { asset } from '$lib/media/url';
	import Icon from '$lib/app/Icon.svelte';

	/** @type {{ group: import('$lib/app/places').Group, lede?: string }} */
	let { group, lede = group.note } = $props();

	/** @type {import('$lib/auth/client').Founder | null} */
	let founder = $state(null);
	let ready = $state(false);
	onMount(async () => {
		founder = await me().catch(() => null);
		ready = true;
	});
	onMount(() => void loadGames());
	// the Maia City COOP vault, where this device acts for it: only then a game here can be published or withdrawn
	const hasGames = $derived(group.items.some((p) => p.game));
	// an admin's tab alone opens avenDB here: nobody else could act for the vault
	$effect(() => (hasGames && isAdmin(founder) ? session.boot() : undefined));
	const city = $derived(hasGames ? cityOf(session.world) : null);

	const items = $derived(group.items.filter((p) => holds(founder, p) && released(founder, p)));
	/** the row the aside shows: the one under the pointer or in focus, else the first */
	let shown = $state(/** @type {string | null} */ (null));
	const preview = $derived(items.find((p) => p.href === shown) ?? items[0]);
</script>

<svelte:head>
	<title>{group.label} · maiaCITY</title>
</svelte:head>

<main class="group">
	<header>
		<h1>{group.label}</h1>
		{#if lede}<p class="lede">{lede}</p>{/if}
	</header>

	<div class="split">
		<aside class="preview" aria-hidden="true">
			{#if preview}
				<div class="shot">
					{#if preview.cover}<img src={asset(preview.cover)} alt="" />{:else}<span class="nocover"><Icon name={preview.icon} size={48} /></span>{/if}
					{#if !published(preview)}<span class="draft">Draft</span>{/if}
				</div>
				<b>{preview.label}</b>
				<span>{preview.note}</span>
			{/if}
		</aside>

		<ul class="list">
			{#each items as p (p.href)}
				<li>
					<a
						href={p.href}
						class:on={preview?.href === p.href}
						onpointerenter={() => (shown = p.href)}
						onfocus={() => (shown = p.href)}
					>
						<span class="thumb">
							{#if p.cover}<img src={asset(p.cover)} alt="" loading="lazy" />{:else}<span class="nocover"><Icon name={p.icon} size={22} /></span>{/if}
						</span>
						<span class="text">
							<b>{p.label}{#if !published(p)}<em>Draft</em>{/if}</b>
							<span>{p.note}</span>
						</span>
						<span class="go" aria-hidden="true">›</span>
					</a>
					{#if city && p.game}
						{@const on = published(p)}
						<button class="publish" class:on disabled={!!session.doing} onclick={() => publish(p.game, !on)} title={on ? 'Everyone may watch and read it: withdraw it' : 'Only the admins open it: publish it to everyone'}>{on ? 'Withdraw' : 'Publish'}</button>
					{/if}
				</li>
			{:else}
				{#if ready}<li class="empty">Nothing here for you yet.</li>{/if}
			{/each}
		</ul>
	</div>
	{#if city && session.error}<p class="err">{session.error}</p>{/if}
</main>

<style>
	.group {
		max-width: 64rem;
		margin: 0 auto;
		padding: 2.5rem clamp(1rem, 4vw, 2rem) 7rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 4.5vw, 3rem);
	}

	.lede {
		margin: 0.5rem 0 0;
		color: var(--ink-soft);
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
		gap: 1.6rem;
		margin-top: 2rem;
		align-items: start;
	}

	/* the aside: the shown row's picture, large, staying in view while the list scrolls */
	.preview {
		position: sticky;
		top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.shot {
		position: relative;
		overflow: hidden;
		aspect-ratio: 4 / 3;
		border-radius: 18px;
		background: var(--ink);
	}

	.shot img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.preview b {
		margin-top: 0.5rem;
		font-family: var(--font-display);
		font-size: 1.4rem;
		font-weight: 500;
	}

	.preview > span {
		font-size: 0.9rem;
		color: var(--muted);
	}

	.nocover {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		background: linear-gradient(160deg, #4f7a5a, #24452f);
		color: rgb(255 255 255 / 0.8);
	}

	.draft,
	em {
		padding: 0.12rem 0.55rem;
		border-radius: 999px;
		background: var(--mustard);
		color: var(--ink);
		font-size: 0.66rem;
		font-style: normal;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.draft {
		position: absolute;
		top: 0.7rem;
		left: 0.7rem;
	}

	em {
		margin-left: 0.55rem;
		vertical-align: 0.2em;
		font-family: var(--font-body, inherit);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.list li > a {
		flex: 1;
		min-width: 0;
	}

	.publish {
		flex: none;
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.publish:not(.on) {
		border-color: var(--mustard);
		background: var(--mustard);
	}

	.publish:disabled {
		opacity: 0.5;
	}

	.err {
		color: #a03224;
	}

	.list a {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.55rem 0.9rem 0.55rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--paper);
		color: var(--ink);
		text-decoration: none;
		transition: border-color 150ms ease, box-shadow 150ms ease;
	}

	.list a.on,
	.list a:hover {
		border-color: var(--mustard);
		box-shadow: 0 6px 18px rgb(38 56 44 / 0.08);
	}

	.thumb {
		flex: none;
		overflow: hidden;
		width: 5.5rem;
		aspect-ratio: 4 / 3;
		border-radius: 10px;
		background: var(--ink);
	}

	.thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.text {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.text b {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 500;
	}

	.text > span {
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		font-size: 0.84rem;
		color: var(--muted);
	}

	.go {
		font-size: 1.6rem;
		color: var(--muted);
	}

	.empty {
		color: var(--muted);
	}

	/* a phone: no aside, the picture on each row is the preview */
	@media (max-width: 760px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
		.preview {
			display: none;
		}
	}
</style>
