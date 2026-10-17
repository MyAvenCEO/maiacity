<!--
	The person's avenDB once this browser is unlocked: the vault it is looked at in, the person's own or any other this
	browser knows, picked from an item of the app's nav pill beside You, with a menu of its own, apart from the account
	signed in to the app ($lib/app/pill.svelte.js `pillContext`); first its home, on the whole screen, each of its pages an
	app on a phone's home screen, by group (`#home`, or no address); then the picked vault's name and its pages, as a database studio lists them: its sparks (each an open canvas of
	artifacts, text notes and other sparks, and the notes written before them), its artifacts (one source fact each: a
	link, a picture, a clip, a YouTube video), its todos, its articles, its stories (each
	content piece from its idea to every platform, on a board by stage), its Library of files, films, pictures, PDFs and
	songs, its flows, the stages its entries go through, and its functions, what runs as an entry moves from one to the
	next; its database (the query console, the table editor, its schemas and lenses, its history, every signed edit, and
	the device's jobs, what it syncs in the background); then its settings (About, Owners and devices, and Sharing, the
	one place that says who it is shared with); and the page picked in the middle. Each page has an address of its own
	(`#todos`), and so has each spark and note (`#notes/` and its entry), which opens as a docs app opens a document, on the whole
	screen, each artifact (`#artifacts/` and its entry), and each article (`#articles/` and its entry), to read, and to edit as a note (`/edit`). The device picks
	who the person acts as in each vault, with no switch to flip (its world's `acting`): in a vault their vault owns,
	directly or through owners of owners, they act as it, as its owners need no cap there; elsewhere as the vault of
	theirs that holds the strongest cap over it, whose caps then decide what the page shows and what it may do. At the
	foot, in the middle above the app's own buttons, what the page is doing, and why not. Marks of the vaults none of
	theirs holds anything in are faded. Over it all, the HITL cards (./Hitl.svelte): the changes waiting for the yes of
	the vault looked at, each vault in the nav pill with a bubble of how many wait in it; and the consent screen, for
	every access request a vault of theirs was asked, and every owner add one of theirs asked for that waits on their
	passkey to finish it (./AccessRequest.svelte); and in a vault they don't act for, Ask for access, which opens the
	form that asks it (./Ask.svelte) in a drawer.
-->
<script>
	import { enter } from '$lib/app/immersive.svelte';
	import { pillContext } from '$lib/app/pill.svelte.js';
	import AccessRequest from './AccessRequest.svelte';
	import Article from './Article.svelte';
	import Artifact from './Artifact.svelte';
	import Artifacts from './Artifacts.svelte';
	import { retagging } from './artifacts.js';
	import Ask from './Ask.svelte';
	import Articles from './Articles.svelte';
	import Flows from './Flows.svelte';
	import Hitl from './Hitl.svelte';
	import Functions from './Functions.svelte';
	import Database from './Database.svelte';
	import Icon from './Icon.svelte';
	import Jobs from './Jobs.svelte';
	import Library from './Library.svelte';
	import NewVaults from './NewVaults.svelte';
	import Note from './Note.svelte';
	import Panel from './Panel.svelte';
	import Settings from './Settings.svelte';
	import Sparks from './Sparks.svelte';
	import Stories from './Stories.svelte';
	import Story from './Story.svelte';
	import Todos from './Todos.svelte';
	import { may } from './ops.js';
	import { acting, count, hue, initials, KINDS, list, nameOf, signerName } from './vaults.js';
	import { wordsFilling } from './youtube.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, doing: string, error: string, thisName: string,
	 *   link: string, qr: string, sockets?: string[] | null,
	 *   requests?: import('./vaults.js').AccessRequestView[], asks?: import('./vaults.js').Requests,
	 *   drives?: import('./native.js').Drives | null }}
	 */
	let {
		world,
		api,
		doing,
		error,
		thisName,
		link,
		qr,
		sockets = null,
		requests = [],
		asks = { asked: [], made: [] },
		drives = null
	} = $props();

	/** the vault the person looks at: their own until they pick another */
	let picked = $state('');
	let adding = $state(false);
	/** whether the drawer that asks the vault looked at for access is open */
	let asking = $state(false);
	/** on a phone, whether the vault's pages slide in from the left */
	let pages = $state(false);
	/** how many changes wait for each vault's yes (./Hitl.svelte), for the bubbles on the vaults in the nav pill */
	let waiting = $state(/** @type {Record<string, number>} */ ({}));

	/** The vault's pages, in its list: each a group's, by its address, name and icon; on its home, each an app. */
	const NAV = /** @type {const} */ ([
		[
			'',
			[
				['sparks', 'Sparks', 'spark'],
				['artifacts', 'Artifacts', 'artifact'],
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
	/** each group's name on the home screen, where every group has one */
	const HEADS = /** @type {Record<string, string>} */ ({ '': 'Workspace' });
	/** each group's colour on the home screen: its apps' tiles */
	const TINTS = /** @type {Record<string, string>} */ ({ '': 'work', Database: 'data', Settings: 'set' });
	/** @typedef {(typeof NAV)[number][1][number]} PageItem */
	const PAGES = NAV.flatMap(([, items]) => /** @type {readonly PageItem[]} */ (items));
	/** @typedef {PageItem[0]} Page */
	/** the pages that show a vault as its owners see it, whoever acts */
	const SETTINGS = /** @type {Page[]} */ (['about', 'members', 'sharing']);
	/** the pages older addresses name, by the page that shows the same now */
	const MOVED = /** @type {Record<string, string>} */ ({
		access: 'sharing',
		sync: 'sharing',
		cells: 'sharing',
		shares: 'sharing',
		notes: 'sparks'
	});

	/**
	 * The page an address names: `#todos`, a spark's or a note's `#notes/` and its entry, an article's `#articles/` and
	 * its entry, to read, and with `/edit`, to edit as a note (and with a story's entry after it, from that story's
	 * Writing tab, which its back arrow goes back to), a story's `#stories/` and its entry, and the stage whose tab it
	 * opens on after it, where it names one; else, as with none or `#home`, the vault's home.
	 * @param {string} hash
	 */
	function parse(hash) {
		const [at, entry, edit, from] = hash.replace(/^#/, '').split('/');
		const page = MOVED[at] ?? at;
		const known = /** @type {Page | 'home'} */ (PAGES.find(([id]) => id === page)?.[0] ?? 'home');
		const hex = (/** @type {string | undefined} */ x) => /^[0-9a-f]{64}$/.test(x ?? '');
		const opens = ['sparks', 'artifacts', 'articles', 'stories'].includes(known) && hex(entry);
		const editing = opens && known === 'articles' && edit === 'edit';
		const story = editing && hex(from) ? from : '';
		return { page: known, entry: opens ? entry : '', edit: editing, story, step: opens && known === 'stories' ? (edit ?? '') : '' };
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

	// the auto tags (./artifacts.js `retagging`): each artifact a spark holds, and each Library file it shows, carries
	// `sparks`, and `stories` once a story grows from such a spark, kept up as the world changes by whichever page
	// looks at the vault, where the acting vault may tag them; the same ops are never tried twice in a row
	let tagged = '';
	$effect(() => {
		const ops = retagging(world, context, actor);
		if (busy || !ops.length) return;
		const key = JSON.stringify([actor, ops]);
		if (key === tagged) return;
		tagged = key;
		may(api, actor, ops).then((verdicts) => {
			const go = ops.filter((_, i) => verdicts[i] === true);
			if (!go.length || doing) return;
			api.run(`Tagging ${count(go.length, 'piece')} by the sparks and stories that hold them`, { op: 'batch', as: actor, ops: go });
		});
	});

	// a YouTube video's words (./youtube.js): the newest done task of the studio's `youtube` rule an artifact hasn't
	// taken yet fills what it has empty, once, by whichever page looks at the vault where the acting vault may write it
	let filled = '';
	$effect(() => {
		const [w, vault, as] = [world, context, actor];
		if (busy) return;
		wordsFilling(w, vault, as, api).then((ops) => {
			const key = JSON.stringify([as, ops]);
			if (!ops.length || key === filled) return;
			filled = key;
			return may(api, as, ops).then((verdicts) => {
				const go = ops.filter((_, i) => verdicts[i] === true);
				if (!go.length || doing) return;
				const videos = new Set(go.map((o) => /** @type {any} */ (o).entry)).size;
				api.run(`Taking YouTube’s words into ${count(videos, 'artifact')}`, { op: 'batch', as, ops: go });
			});
		});
	});

	// the vaults to look at it in, the person's own first, as an item of the app's nav pill beside You, with a menu of
	// its own: avenDB's vaults apart from the account signed in to the app
	$effect(() =>
		pillContext({
			title: 'avenDB vaults',
			get list() {
				return [mine, ...rest]
					.filter((v) => !!v)
					.map((v) => ({
						id: v.id,
						label: nameOf(v),
						sub: KINDS[v.kind],
						text: initials(v),
						colour: `hsl(${hue(v.id)} 38% 42%)`,
						shape: v.kind,
						badge: waiting[v.id] ?? 0
					}));
			},
			get current() {
				return context;
			},
			pick: (id) => {
				picked = id;
				if (route.entry) go(route.page);
			},
			add: { label: 'New vaults…', go: () => (adding = true) }
		})
	);

	// the page is the screen, as a chat app's is: it doesn't scroll, each of its columns does (the app keeps no room at
	// its foot for its nav pill, which floats over the columns' own)
	$effect(() => enter());

	/** Go to the page at address `to`: `todos`, or a note's `notes/` and its entry. @param {string} to */
	function go(to) {
		location.hash = to;
	}

	/** Open spark or note `entry`, on the whole screen. @param {string} entry */
	const open = (entry) => go(`notes/${entry}`);

	/** Open article `entry` to read, on the whole screen. @param {string} entry */
	const openArticle = (entry) => go(`articles/${entry}`);

	/** Open story `entry`, on the whole screen. @param {string} entry */
	const openStory = (entry) => go(`stories/${entry}`);

	// a note opens in its vault: its sparks are where its back arrow goes
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

<svelte:window onhashchange={() => ((route = parse(location.hash)), (pages = false))} />

<div class="shell" class:reading={!!route.entry}>
	{#if route.entry}
		{#key `${route.entry}${route.page}${route.edit}`}
			{#if route.page === 'stories'}
				<Story {world} {actor} {api} {busy} entry={route.entry} step={route.step} />
			{:else if route.page === 'artifacts'}
				<Artifact {world} {actor} {api} {busy} entry={route.entry} />
			{:else if route.page === 'articles' && !route.edit}
				<Article {world} {actor} {api} entry={route.entry} />
			{:else if route.page === 'articles' && route.story}
				<Note {world} {actor} {api} {busy} entry={route.entry} back="#stories/{route.story}/writing" backTo="The story" />
			{:else if route.page === 'articles'}
				<Note {world} {actor} {api} {busy} entry={route.entry} back="#articles/{route.entry}" backTo="The article" />
			{:else}
				<Note {world} {actor} {api} {busy} entry={route.entry} />
			{/if}
		{/key}
	{:else if tab === 'home'}
		<!-- the vault's home: each of its pages an app, by group, as a phone's home screen shows them -->
		<section class="main home">
			<header class="home-head">
				<small>{KINDS[here.kind]}</small>
				<h1>{nameOf(here)}</h1>
				<p class="soft">{owners(here)}</p>
				{#if !here.via}<button class="btn" onclick={() => (asking = true)}>Ask for access</button>{/if}
			</header>
			<AccessRequest {world} {requests} asked={asks.asked} made={asks.made} {api} {busy} ongrant={api.grant} ondeny={api.deny} />
			{#each NAV as [group, items] (group)}
				<section class="apps" aria-labelledby="apps-{TINTS[group]}">
					<h2 class="group" id="apps-{TINTS[group]}">{HEADS[group] ?? group}</h2>
					<div class="grid">
						{#each items as [id, label, icon] (id)}
							<a class="app" href="#{id}">
								<span class="tile {TINTS[group]}"><Icon name={icon} size={26} /></span>
								<span class="label">{label}</span>
							</a>
						{/each}
					</div>
				</section>
			{/each}
			<p class="pq">
				<span class="chip ok" title="Every edit counts by its SLH-DSA signature alone, and every key is sealed post-quantum"
					>Post-quantum only</span
				>
			</p>
		</section>
	{:else}

	{#if pages}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="scrim" onclick={() => (pages = false)}></div>
	{/if}
	<!-- on a phone: the vault's pages, from a round button at the foot of the screen, left of the nav pill -->
	<button
		class="pages"
		aria-pressed={pages}
		aria-label="{nameOf(here)}'s pages"
		onclick={() => (pages = !pages)}><Icon name="library" size={20} /></button
	>
	<aside class="aside" class:open={pages}>
		<header>
			<small>{KINDS[here.kind]}</small>
			<h1>{nameOf(here)}</h1>
			<p class="soft">{owners(here)}</p>
		</header>
		<nav class="tabs-list" aria-label="{nameOf(here)}'s pages">
			<a class="item" href="#home"><Icon name="apps" /><span>Home</span></a>
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
					{#if !here.via}<button class="link" onclick={() => (asking = true)}>Ask for access</button>{/if}
				{:else}
					As <b>{nameOf(as)}</b>. {nameOf(here)}'s settings show every share and device, as its owners see them.
				{/if}
			</p>
		</header>
		<AccessRequest {world} {requests} asked={asks.asked} made={asks.made} {api} {busy} ongrant={api.grant} ondeny={api.deny} />
		{#if tab === 'sparks'}
			<Sparks {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={open} onstory={openStory} />
		{:else if tab === 'articles'}
			<Articles {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={openArticle} />
		{:else if tab === 'stories'}
			<Stories {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={openStory} />
		{:else if tab === 'todos'}
			<Todos {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} />
		{:else if tab === 'artifacts'}
			<Artifacts {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={open} />
		{:else if tab === 'library'}
			<Library {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} />
		{:else if tab === 'flows'}
			<Flows {world} vault={context} {actor} />
		{:else if tab === 'functions'}
			<Functions {world} vault={context} />
		{:else if tab === 'jobs'}
			<Jobs {world} vault={context} {actor} {api} />
		{:else if tab === 'about' || tab === 'members' || tab === 'sharing'}
			<Settings {world} vault={context} {actor} {api} {busy} {tab} {thisName} {link} {qr} {sockets} {drives} {asks} />
		{:else}
			<Database {world} vault={context} {actor} {api} view={tab} onopen={open} onview={go} />
		{/if}
	</section>
	{/if}

	<div class="toasts">
		{#if doing}<p class="toast" role="status">{doing}…</p>{/if}
		{#if error}<p class="toast bad" role="alert">{error}</p>{/if}
	</div>

	<Hitl {world} {api} vault={context} {busy} oncounts={(c) => (waiting = c)} />

	{#if adding}<NewVaults {world} {api} {busy} onclose={() => (adding = false)} />{/if}
	{#if asking && !here.via}
		<Panel title="Ask for access" sub={nameOf(here)} onclose={() => (asking = false)}>
			<p class="soft ask-lead">
				Ask {nameOf(here)} to share with your aven or a vault of yours. Its owners answer on their consent screen, and
				you see their answer here once it syncs.
			</p>
			<Ask {world} {api} {busy} made={asks.made} to={here.id} />
		</Panel>
	{/if}
</div>

<style>
	/* the screen, never scrolled: each column scrolls on its own */
	.shell {
		display: grid;
		grid-template-columns: 15.5rem minmax(0, 1fr);
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
	}

	/* a note open, on the whole screen */
	.shell.reading {
		grid-template-columns: minmax(0, 1fr);
	}

	.aside,
	.main {
		min-height: 0;
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	/* wider, the vault's pages stand in their column: no button to slide them in */
	.pages {
		display: none;
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

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	.ask-lead {
		margin: 0 0 0.8rem;
		line-height: 1.45;
	}

	/* the vault's home, on the whole screen: its pages as apps, in a column no wider than a few rows of them */
	.home {
		grid-column: 1 / -1;
		padding-bottom: calc(var(--nav-room, 5rem) + 3rem);
	}

	.home > * {
		max-width: 46rem;
		margin-inline: auto;
	}

	.home-head small {
		color: var(--accent);
		font-size: 0.72rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.home-head h1 {
		margin: 0.2rem 0 0.3rem;
		font-family: var(--font-body);
		font-size: 1.6rem;
		font-weight: 650;
		font-variation-settings: normal;
		letter-spacing: -0.01em;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	.home-head p {
		margin: 0 0 0.6rem;
		font-size: 0.86rem;
	}

	.apps .group {
		margin: 1.4rem 0 0.8rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
		gap: 1.1rem 0.5rem;
	}

	/* a page as an app: a small round-cornered tile, its name under it */
	.app {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
		-webkit-tap-highlight-color: transparent;
	}

	.tile {
		display: grid;
		place-items: center;
		width: 3.6rem;
		height: 3.6rem;
		border-radius: 1rem;
		color: #fff;
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			0 2px 6px rgb(30 45 38 / 0.18);
		transition: transform 120ms ease;
	}

	.tile.work {
		background: linear-gradient(160deg, #3d8577, #2a5f55);
	}

	.tile.data {
		background: linear-gradient(160deg, #4b6a92, #344e70);
	}

	.tile.set {
		background: linear-gradient(160deg, #8a8478, #67625a);
	}

	.app:hover .tile {
		transform: translateY(-2px);
	}

	.app:active .tile {
		transform: scale(0.94);
	}

	.app:focus-visible {
		outline: none;
	}

	.app:focus-visible .tile {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.label {
		max-width: 100%;
		font-size: 0.74rem;
		line-height: 1.25;
		text-align: center;
		overflow-wrap: anywhere;
	}

	.home .pq {
		padding: 2rem 0 0;
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
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
		}

		/* the vault's pages slide in from the left, over a scrim, from the round button at the foot */
		.aside {
			position: fixed;
			top: 0;
			bottom: 0;
			left: 0;
			z-index: 41;
			box-sizing: border-box;
			width: min(19rem, 84vw);
			overflow-y: auto;
			overscroll-behavior: contain;
			padding: calc(1.2rem + env(safe-area-inset-top, 0px)) 0.8rem calc(var(--nav-room, 5rem) + 1rem);
			box-shadow: 0 0 40px rgb(0 0 0 / 0.18);
			visibility: hidden;
			transform: translateX(-100%);
			transition:
				transform 240ms ease,
				visibility 0s linear 240ms;
		}

		.aside.open {
			visibility: visible;
			transform: none;
			transition: transform 240ms ease;
		}

		.scrim {
			position: fixed;
			inset: 0;
			z-index: 40;
			background: rgb(20 28 24 / 0.28);
		}

		.pages {
			display: grid;
			place-items: center;
			position: fixed;
			bottom: var(--nav-foot, 8px);
			left: max(12px, env(safe-area-inset-left, 0px));
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

		.pages[aria-pressed='true'] {
			border-color: var(--accent);
			background: var(--accent);
			color: #fff;
		}

		/* clear of the notch and the status bar, now that nothing stands above it */
		.main {
			padding-top: calc(1rem + env(safe-area-inset-top, 0px));
		}

		.shell.reading {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
		}

		.pq {
			display: none;
		}

		/* four apps a row, as a phone's home screen shows them */
		.grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 1rem 0.25rem;
		}

		.tile {
			width: 3.4rem;
			height: 3.4rem;
			border-radius: 0.95rem;
		}

		.label {
			font-size: 0.7rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.aside {
			transition: none;
		}
	}
</style>
