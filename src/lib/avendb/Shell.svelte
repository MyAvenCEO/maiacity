<!--
	The person's avenDB once this browser is unlocked, laid out as a chat app's servers: a bar of vault marks on the
	left, the person's own first, then every vault this browser knows, each a context to switch to; beside it the picked
	vault's name and its list (its notes and todos, then its settings: About, Owners and devices, Access, Sync); and its
	notes and todos or the settings picked, in the middle. At the foot, in the middle above the app's own buttons, the
	vault the person acts as: their own, or any vault their vault owns, whose caps then decide what the page shows and
	what it may do, as on a device of that vault alone. Marks of the vaults the acting vault holds nothing in are faded.
-->
<script>
	import { enter } from '$lib/app/immersive.svelte';
	import Board from './Board.svelte';
	import Mark from './Mark.svelte';
	import NewVaults from './NewVaults.svelte';
	import Settings from './Settings.svelte';
	import { KINDS, list, nameOf, reaches } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, doing: string, error: string, thisName: string,
	 *   link: string, qr: string }}
	 */
	let { world, api, doing, error, thisName, link, qr } = $props();

	/** the vault the person picked to act as, and the one to look at: their own until they pick another */
	let enacted = $state('');
	let picked = $state('');
	/** @type {'board' | 'about' | 'members' | 'access' | 'sync'} */
	let tab = $state('board');
	let switching = $state(false);
	let adding = $state(false);

	const TABS = /** @type {const} */ ([
		['board', 'Notes & todos'],
		['about', 'About'],
		['members', 'Owners & devices'],
		['access', 'Access'],
		['sync', 'Sync']
	]);

	const busy = $derived(!!doing);
	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	// a vault this browser no longer knows or acts for leaves the person on their own
	const actor = $derived(byId.get(enacted)?.via ? enacted : world.mine);
	const context = $derived(byId.has(picked) ? picked : world.mine);
	const mine = $derived(byId.get(world.mine));
	const rest = $derived(world.vaults.filter((v) => v.id !== world.mine));
	const actors = $derived(world.vaults.filter((v) => v.via !== null));
	const here = $derived(/** @type {import('./vaults.js').VaultView} */ (byId.get(context) ?? mine));
	const as = $derived(byId.get(actor) ?? mine);

	// the page is the screen, as a chat app's is: it doesn't scroll, each of its columns does (the app keeps no room at
	// its foot for its nav pill, which floats over the columns' own)
	$effect(() => enter());

	/** Act as vault `id`, and look at its own. @param {string} id */
	function enact(id) {
		[enacted, picked, tab, switching] = [id, id, 'board', false];
	}

	/** Who owns vault `v`, as a line. @param {import('./vaults.js').VaultView} v */
	function owners(v) {
		if (v.id === world.mine) return 'Your vault: your passkey is its root.';
		const names = v.owners.map((o) => ('vault' in o ? nameOf(byId.get(o.vault)) : 'a passkey'));
		return `Owned by ${list(names)}.`;
	}

	/** How the person acts as vault `v`. @param {import('./vaults.js').VaultView} v */
	const through = (v) =>
		v.id === world.mine ? 'You' : `${KINDS[v.kind]}, through ${list((v.via ?? []).map((o) => nameOf(byId.get(o))))}`;
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (switching = false)} />

<div class="shell">
	<nav class="bar" aria-label="Vaults">
		{#each [mine, ...rest] as v, i (v?.id)}
			{#if v}
				{@const out = !reaches(world, v.id, actor)}
				{#if i === 1}<hr />{/if}
				<button
					class="slot"
					class:on={v.id === context}
					title="{nameOf(v)} · {KINDS[v.kind]}{out ? ` · ${nameOf(as)} holds nothing in it` : ''}"
					aria-label={nameOf(v)}
					aria-current={v.id === context ? 'true' : undefined}
					onclick={() => (picked = v.id)}
				>
					<Mark vault={v} dim={out} />
					{#if v.id === actor}<i class="acting" title="You act as it"></i>{/if}
				</button>
			{/if}
		{/each}
		{#if actor === world.mine}
			<button class="slot add" title="New vaults your vault owns" aria-label="New vaults" onclick={() => (adding = true)}>+</button>
		{/if}
	</nav>

	<aside class="aside">
		<header>
			<small>{KINDS[here.kind]}</small>
			<h1>{nameOf(here)}</h1>
			<p class="soft">{owners(here)}</p>
		</header>
		<nav class="tabs-list" aria-label="{nameOf(here)}'s lists">
			{#each TABS as [id, label] (id)}
				<button class="item" class:on={tab === id} onclick={() => (tab = id)}>{label}</button>
			{/each}
		</nav>
		{#if world.pqOnly}
			<p class="pq">
				<span class="chip ok" title="Only the post-quantum halves of every signature and key count">Post-quantum only</span>
			</p>
		{/if}
	</aside>

	<section class="main">
		<header class="main-head">
			<h2>{TABS.find(([id]) => id === tab)?.[1]}</h2>
			<p class="soft">
				As <b>{nameOf(as)}</b>{#if actor === context}.{:else if tab === 'board'}, looking at {nameOf(here)}'s vault: you
					see what {nameOf(as)}'s caps allow.{:else}. {nameOf(here)}'s settings show every cap and device, as its owners
					see them.{/if}
			</p>
		</header>
		{#if tab === 'board'}
			<Board {world} vault={context} {actor} {api} {busy} onaccess={() => (tab = 'access')} onact={enact} />
		{:else}
			<Settings {world} vault={context} {actor} {api} {busy} {tab} {thisName} {link} {qr} />
		{/if}
	</section>

	<div class="switcher">
		{#if doing}<p class="toast" role="status">{doing}…</p>{/if}
		{#if error}<p class="toast bad" role="alert">{error}</p>{/if}
		{#if switching}
			<div class="menu" role="menu" aria-label="Act as">
				<small>Act as</small>
				{#each actors as v (v.id)}
					<button role="menuitemradio" aria-checked={v.id === actor} class:on={v.id === actor} onclick={() => enact(v.id)}>
						<Mark vault={v} size={30} />
						<span class="who"><b>{nameOf(v)}</b><small>{through(v)}</small></span>
					</button>
				{/each}
			</div>
		{/if}
		<button class="pill" class:other={actor !== world.mine} aria-expanded={switching} onclick={() => (switching = !switching)}>
			<Mark vault={as} size={30} />
			<span class="who"><small>Acting as</small><b>{nameOf(as)}</b></span>
			<span class="chev" aria-hidden="true">{switching ? '▾' : '▴'}</span>
		</button>
	</div>

	{#if adding}<NewVaults {world} {api} {busy} onclose={() => (adding = false)} />{/if}
</div>

<style>
	/* the screen, never scrolled: each column scrolls on its own */
	.shell {
		display: grid;
		grid-template-columns: 76px 15.5rem minmax(0, 1fr);
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
	}

	.bar,
	.aside,
	.main {
		min-height: 0;
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.bar {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.55rem;
		padding: calc(0.9rem + env(safe-area-inset-top, 0px)) 0 7rem;
		background: #e6e0d4;
	}

	.bar hr {
		width: 2rem;
		margin: 0.1rem 0;
		border: 0;
		border-top: 2px solid rgb(0 0 0 / 0.12);
	}

	.slot {
		position: relative;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}

	/* the picked vault's marker, at the bar's edge, as a chat app marks the server open */
	.slot::before {
		position: absolute;
		left: -16px;
		width: 5px;
		height: 0;
		border-radius: 0 4px 4px 0;
		background: #1f2a23;
		content: '';
		transition: height 0.15s ease;
	}

	.slot:hover::before {
		height: 12px;
	}

	.slot.on::before {
		height: 36px;
	}

	.slot :global(.mark) {
		transition: transform 0.15s ease;
	}

	.slot:hover :global(.mark) {
		transform: scale(1.06);
	}

	.acting {
		position: absolute;
		right: -2px;
		bottom: -2px;
		width: 14px;
		height: 14px;
		border: 3px solid #e6e0d4;
		border-radius: 50%;
		background: var(--ok);
	}

	.add {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: #fff;
		color: var(--ok);
		font-size: 1.5rem;
		line-height: 1;
	}

	.add:hover {
		background: var(--ok);
		color: #fff;
	}

	.aside {
		padding: calc(1.3rem + env(safe-area-inset-top, 0px)) 0.8rem 7rem;
		border-right: 1px solid var(--edge);
		background: #efebe3;
	}

	.aside header {
		padding: 0 0.5rem 0.8rem;
	}

	.aside small {
		color: var(--accent);
		font-size: 0.72rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	/* a vault's name in the body's face, which keeps the capitals of names like avenALICE plain */
	.aside h1 {
		margin: 0.2rem 0 0.3rem;
		font-family: var(--font-body);
		font-size: 1.3rem;
		font-weight: 650;
		font-variation-settings: normal;
		letter-spacing: -0.01em;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	.aside p {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
	}

	.tabs-list {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.item {
		width: 100%;
		padding: 0.42rem 0.6rem;
		border: 0;
		border-radius: 8px;
		background: none;
		font: inherit;
		font-size: 0.9rem;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}

	.item:hover {
		background: rgb(0 0 0 / 0.05);
	}

	.item.on {
		background: #fff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
		font-weight: 600;
	}

	.pq {
		padding: 1rem 0.5rem 0;
	}

	.main {
		min-width: 0;
		padding: calc(1.4rem + env(safe-area-inset-top, 0px)) clamp(1rem, 3vw, 2.4rem) 10rem;
	}

	.main-head h2 {
		margin: 0 0 0.2rem;
		font-size: 1.5rem;
	}

	.main-head p {
		margin: 0 0 1.2rem;
	}

	/* at the foot, in the middle, just above the app's own nav pill (--nav-room, src/app.css) */
	.switcher {
		position: fixed;
		left: 50%;
		bottom: var(--nav-room, 5rem);
		z-index: 45;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		max-width: calc(100vw - 2rem);
		transform: translateX(-50%);
	}

	.pill {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0.9rem 0.35rem 0.4rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: #fff;
		box-shadow: 0 6px 22px rgb(0 0 0 / 0.14);
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.pill.other {
		border-color: var(--accent);
		background: #d6e8e4;
	}

	.who {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		line-height: 1.2;
		text-align: left;
	}

	.who small {
		color: var(--soft);
		font-size: 0.7rem;
	}

	.chev {
		color: var(--soft);
		font-size: 0.8rem;
	}

	.menu {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 17rem;
		max-height: 60vh;
		overflow-y: auto;
		padding: 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 10px 34px rgb(0 0 0 / 0.18);
	}

	.menu > small {
		padding: 0.1rem 0.5rem 0.3rem;
		color: var(--soft);
		font-size: 0.72rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.menu button {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.5rem;
		border: 0;
		border-radius: 10px;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.menu button:hover,
	.menu button.on {
		background: #efebe3;
	}

	.toast {
		max-width: min(40rem, calc(100vw - 2rem));
		margin: 0;
		padding: 0.5rem 0.9rem;
		border-radius: 12px;
		background: #23302a;
		color: #eef0e8;
		font-size: 0.86rem;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
	}

	.toast.bad {
		background: #6b2c1c;
	}

	@media (max-width: 760px) {
		.shell {
			grid-template-columns: 1fr;
			grid-template-rows: auto auto 1fr;
		}

		.bar {
			z-index: 30;
			flex-direction: row;
			overflow-x: auto;
			overflow-y: hidden;
			padding: calc(0.6rem + env(safe-area-inset-top, 0px)) 0.8rem 0.6rem;
		}

		.bar hr {
			width: 0;
			height: 2rem;
			border-top: 0;
			border-left: 2px solid rgb(0 0 0 / 0.12);
		}

		.slot::before {
			display: none;
		}

		.slot.on :global(.mark) {
			outline: 3px solid #1f2a23;
			outline-offset: 2px;
		}

		.aside {
			max-height: 40dvh;
			padding: 1rem 0.8rem 0.6rem;
			border-right: 0;
			border-bottom: 1px solid var(--edge);
		}

		.main {
			padding-top: 1.2rem;
		}

		.tabs-list {
			flex-direction: row;
			overflow-x: auto;
		}

		.item {
			width: auto;
			white-space: nowrap;
		}

		.pq {
			display: none;
		}
	}
</style>
