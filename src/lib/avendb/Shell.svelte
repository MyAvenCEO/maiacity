<!--
	The person's avenDB once this browser is unlocked, laid out as a chat app's servers: a bar of vault marks on the
	left, the person's own first, then every vault this browser knows, each a context to switch to; beside it the picked
	vault's name and its pages, as a database studio lists them: its notes, its todos, its articles, its stories (each
	content piece from its idea to every platform, on a board by stage), its Library of files, films, pictures, PDFs and
	songs, its flows, the stages its entries go through, and its functions, what runs as an entry moves from one to the
	next; its database (the query console, the table editor, its schemas and lenses, its history, every signed edit, and
	the device's jobs, what it syncs in the background); then its settings (About, Owners and devices, and Sharing, the
	one place that says who it is shared with); and the page picked in the middle. Each page has an address of its own
	(`#todos`), and so has each note (`#notes/` and its entry), which opens as a docs app opens a document, on the whole
	screen, and each article (`#articles/` and its entry), to read, and to edit as a note (`/edit`). The device picks
	who the person acts as in each vault, with no switch to flip (its world's `acting`): in a vault their vault owns,
	directly or through owners of owners, they act as it, as its owners need no cap there; elsewhere as the vault of
	theirs that holds the strongest cap over it, whose caps then decide what the page shows and what it may do. At the
	foot, in the middle above the app's own buttons, what the page is doing, and why not. Marks of the vaults none of
	theirs holds anything in are faded.
-->
<script>
	import { enter } from '$lib/app/immersive.svelte';
	import AccessRequest from './AccessRequest.svelte';
	import Article from './Article.svelte';
	import Articles from './Articles.svelte';
	import Flows from './Flows.svelte';
	import Functions from './Functions.svelte';
	import Database from './Database.svelte';
	import Icon from './Icon.svelte';
	import Jobs from './Jobs.svelte';
	import Library from './Library.svelte';
	import Mark from './Mark.svelte';
	import NewVaults from './NewVaults.svelte';
	import Note from './Note.svelte';
	import Notes from './Notes.svelte';
	import Settings from './Settings.svelte';
	import Stories from './Stories.svelte';
	import Story from './Story.svelte';
	import Todos from './Todos.svelte';
	import { acting, KINDS, list, nameOf, signerName } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, doing: string, error: string, thisName: string,
	 *   link: string, qr: string, sockets?: string[] | null,
	 *   requests?: import('./vaults.js').AccessRequestView[] }}
	 */
	let { world, api, doing, error, thisName, link, qr, sockets = null, requests = [] } = $props();

	/** the vault the person looks at: their own until they pick another */
	let picked = $state('');
	let adding = $state(false);

	/** The vault's pages, in its list: each a group's, by its address, name and icon. */
	const NAV = /** @type {const} */ ([
		[
			'',
			[
				['notes', 'Notes', 'note'],
				['todos', 'Todos', 'todo'],
				['articles', 'Articles', 'article'],
				['stories', 'Stories', 'story'],
				['library', 'Library', 'library'],
				['flows', 'Flows', 'flow'],
				['functions', 'Functions', 'fn']
			]
		],
		[
			'Database',
			[
				['query', 'Query', 'search'],
				['tables', 'Table editor', 'table'],
				['schemas', 'Schemas', 'schema'],
				['lenses', 'Lenses', 'lens'],
				['history', 'History', 'history'],
				['jobs', 'Jobs', 'jobs']
			]
		],
		[
			'Settings',
			[
				['about', 'About', 'info'],
				['members', 'Owners & devices', 'users'],
				['sharing', 'Sharing', 'share']
			]
		]
	]);
	/** @typedef {(typeof NAV)[number][1][number]} PageItem */
	const PAGES = NAV.flatMap(([, items]) => /** @type {readonly PageItem[]} */ (items));
	/** @typedef {PageItem[0]} Page */
	/** the pages that show a vault as its owners see it, whoever acts */
	const SETTINGS = /** @type {Page[]} */ (['about', 'members', 'sharing']);
	/** the pages older addresses name, by the page that shows the same now */
	const MOVED = /** @type {Record<string, string>} */ ({ access: 'sharing', sync: 'sharing', cells: 'sharing', shares: 'sharing' });

	/**
	 * The page an address names: `#todos`, a note's `#notes/` and its entry, an article's `#articles/` and its entry, to
	 * read, and with `/edit`, to edit as a note, a story's `#stories/` and its entry; else the notes.
	 * @param {string} hash
	 */
	function parse(hash) {
		const [at, entry, edit] = hash.replace(/^#/, '').split('/');
		const page = MOVED[at] ?? at;
		const known = PAGES.find(([id]) => id === page)?.[0] ?? 'notes';
		const opens = ['notes', 'articles', 'stories'].includes(known) && /^[0-9a-f]{64}$/.test(entry ?? '');
		return { page: known, entry: opens ? entry : '', edit: opens && known === 'articles' && edit === 'edit' };
	}

	let route = $state(parse(typeof location === 'undefined' ? '' : location.hash));
	const tab = $derived(route.page);

	const busy = $derived(!!doing);
	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const context = $derived(byId.has(picked) ? picked : world.mine);
	const actor = $derived(acting(world, context).as);
	const mine = $derived(byId.get(world.mine));
	const rest = $derived(world.vaults.filter((v) => v.id !== world.mine));
	const here = $derived(/** @type {import('./vaults.js').VaultView} */ (byId.get(context) ?? mine));
	const as = $derived(byId.get(actor) ?? mine);

	// the page is the screen, as a chat app's is: it doesn't scroll, each of its columns does (the app keeps no room at
	// its foot for its nav pill, which floats over the columns' own)
	$effect(() => enter());

	/** Go to the page at address `to`: `todos`, or a note's `notes/` and its entry. @param {string} to */
	function go(to) {
		location.hash = to;
	}

	/** Open note `entry`, on the whole screen. @param {string} entry */
	const open = (entry) => go(`notes/${entry}`);

	/** Open article `entry` to read, on the whole screen. @param {string} entry */
	const openArticle = (entry) => go(`articles/${entry}`);

	/** Open story `entry`, on the whole screen. @param {string} entry */
	const openStory = (entry) => go(`stories/${entry}`);

	// a note opens in its vault: its notes are where its back arrow goes
	$effect(() => {
		const entry = route.entry;
		const of = entry ? world.entries.find((e) => e.entry === entry)?.vault : undefined;
		if (of) picked = of;
	});

	/** Who owns vault `v`, as a line. @param {import('./vaults.js').VaultView} v */
	function owners(v) {
		if (v.id === world.mine) return 'Your vault: your passkey is its root.';
		const names = v.owners.map((o) => ('vault' in o ? nameOf(byId.get(o.vault)) : signerName(world, o.signer)));
		return `Owned by ${list(names)}.`;
	}
</script>

<svelte:window onhashchange={() => (route = parse(location.hash))} />

<div class="shell" class:reading={!!route.entry}>
	{#if route.entry}
		{#key `${route.entry}${route.page}${route.edit}`}
			{#if route.page === 'stories'}
				<Story {world} {actor} {api} {busy} entry={route.entry} />
			{:else if route.page === 'articles' && !route.edit}
				<Article {world} {actor} {api} entry={route.entry} />
			{:else if route.page === 'articles'}
				<Note {world} {actor} {api} {busy} entry={route.entry} back="#articles/{route.entry}" backTo="The article" />
			{:else}
				<Note {world} {actor} {api} {busy} entry={route.entry} />
			{/if}
		{/key}
	{:else}
	<nav class="bar" aria-label="Vaults">
		{#each [mine, ...rest] as v, i (v?.id)}
			{#if v}
				{@const out = !acting(world, v.id).reaches}
				{#if i === 1}<hr />{/if}
				<button
					class="slot"
					class:on={v.id === context}
					title="{nameOf(v)} · {KINDS[v.kind]}{out ? ' · none of your vaults holds anything in it' : ''}"
					aria-label={nameOf(v)}
					aria-current={v.id === context ? 'true' : undefined}
					onclick={() => (picked = v.id)}
				>
					<Mark vault={v} dim={out} />
				</button>
			{/if}
		{/each}
		<button class="slot add" title="New vaults your vault owns" aria-label="New vaults" onclick={() => (adding = true)}>+</button>
	</nav>

	<aside class="aside">
		<header>
			<small>{KINDS[here.kind]}</small>
			<h1>{nameOf(here)}</h1>
			<p class="soft">{owners(here)}</p>
		</header>
		<nav class="tabs-list" aria-label="{nameOf(here)}'s pages">
			{#each NAV as [group, items] (group)}
				{#if group}<small class="group">{group}</small>{/if}
				{#each items as [id, label, icon] (id)}
					<a class="item" class:on={tab === id} href="#{id}" aria-current={tab === id ? 'page' : undefined}>
						<Icon name={icon} />
						<span>{label}</span>
					</a>
				{/each}
			{/each}
		</nav>
		<p class="pq">
			<span class="chip ok" title="Every edit counts by its SLH-DSA signature alone, and every key is sealed post-quantum"
				>Post-quantum only</span
			>
		</p>
	</aside>

	<section class="main">
		<header class="main-head">
			<h2>{PAGES.find(([id]) => id === tab)?.[1]}</h2>
			<p class="soft">
				{#if context === world.mine}
					As <b>{nameOf(mine)}</b>.
				{:else if actor === context}
					As <b>{nameOf(mine)}</b>, its owner: you see and change all of it.
				{:else if !SETTINGS.includes(tab)}
					As <b>{nameOf(as)}</b>: you see what {nameOf(here)} shares with {nameOf(as)}.
				{:else}
					As <b>{nameOf(as)}</b>. {nameOf(here)}'s settings show every share and device, as its owners see them.
				{/if}
			</p>
		</header>
		<AccessRequest {world} {requests} {busy} ongrant={api.grant} ondeny={api.deny} />
		{#if tab === 'notes'}
			<Notes {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={open} />
		{:else if tab === 'articles'}
			<Articles {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={openArticle} />
		{:else if tab === 'stories'}
			<Stories {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={openStory} />
		{:else if tab === 'todos'}
			<Todos {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} />
		{:else if tab === 'library'}
			<Library {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} />
		{:else if tab === 'flows'}
			<Flows {world} vault={context} {actor} />
		{:else if tab === 'functions'}
			<Functions {world} vault={context} />
		{:else if tab === 'jobs'}
			<Jobs {world} vault={context} {actor} {api} />
		{:else if tab === 'about' || tab === 'members' || tab === 'sharing'}
			<Settings {world} vault={context} {actor} {api} {busy} {tab} {thisName} {link} {qr} {sockets} />
		{:else}
			<Database {world} vault={context} {actor} {api} view={tab} onopen={open} onview={go} />
		{/if}
	</section>
	{/if}

	<div class="toasts">
		{#if doing}<p class="toast" role="status">{doing}…</p>{/if}
		{#if error}<p class="toast bad" role="alert">{error}</p>{/if}
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

	/* a note open, on the whole screen */
	.shell.reading {
		grid-template-columns: minmax(0, 1fr);
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

	/* a group's name over its pages, as a database studio heads its sidebar's sections */
	.tabs-list .group {
		padding: 1rem 0.6rem 0.3rem;
		color: var(--soft);
		font-size: 0.68rem;
		font-weight: 600;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		box-sizing: border-box;
		padding: 0.42rem 0.6rem;
		border-radius: 8px;
		font-size: 0.9rem;
		color: inherit;
		text-decoration: none;
		cursor: pointer;
	}

	.item :global(svg) {
		flex: none;
		color: var(--soft);
	}

	.item.on :global(svg) {
		color: var(--accent);
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
	.toasts {
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

		.tabs-list .group {
			display: none;
		}

		.shell.reading {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
		}

		.pq {
			display: none;
		}
	}
</style>
