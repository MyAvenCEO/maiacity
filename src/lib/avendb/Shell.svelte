<!--
	The person's avenDB once this browser is unlocked: the vault it is looked at in, the person's own or any other this
	browser knows, picked from an item of the app's nav pill beside You, with a menu of its own, apart from the account
	signed in to the app ($lib/app/pill.svelte.js `pillContext`); first its home, on the whole screen, each of its pages an
	app on a phone's home screen, by group (`#home`, or no address); then the picked vault's name and its pages, as a database studio lists them: its sparks (each an open canvas of
	artifacts, text notes and other sparks, and the notes written before them), its artifacts (one source fact each: a
	link, a picture, a clip, a YouTube video), its todos, its stories (each
	content piece from its idea to every platform, on a board by stage), its Library of files, films, pictures, PDFs and
	songs, the Studio (the app's studio, which cuts the footage into films), its flows, the stages its entries go through, and its functions, what runs as an entry moves from one to the
	next; its database (the query console, the table editor, its schemas and lenses, its history, every signed edit, and
	the device's jobs, what it syncs in the background); then its settings (About, Owners and devices, and Sharing, the
	one place that says who it is shared with); and the page picked in the middle. Each page has an address of its own
	(`#todos`), and so has each spark and note (`#notes/` and its entry), which opens as a docs app opens a document, on the whole
	screen, each artifact (`#artifacts/` and its entry), and each story (`#stories/` and its entry), its text edited as a note
	(`/edit`). The device picks
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
	import { setContext } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { wayBack } from '$lib/app/back.svelte.js';
	import { enter } from '$lib/app/immersive.svelte';
	import { pillContext } from '$lib/app/pill.svelte.js';
	import AccessRequest from './AccessRequest.svelte';
	import Artifact from './Artifact.svelte';
	import Artifacts from './Artifacts.svelte';
	import Assets from './Assets.svelte';
	import { retagging } from './artifacts.js';
	import Ask from './Ask.svelte';
	import Flows from './Flows.svelte';
	import Hitl from './Hitl.svelte';
	import Functions from './Functions.svelte';
	import Database from './Database.svelte';
	import Docs from './Docs.svelte';
	import Frame, { HEAD } from './Frame.svelte';
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
	import { NAV, OUT } from './VaultApps.svelte';
	import Dashboard from '$lib/app/Dashboard.svelte';
	import { may } from './ops.js';
	import { session } from './session.svelte.js';
	import { acting, count, KINDS, list, nameOf, pillVaults, signerName } from './vaults.js';
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

	/** the vault the person looks at: their own until they pick another, which every page of the tab shares (the
	 *  session's `vault`), so a page that acts in avenDB elsewhere acts as the person does here */
	const picked = $derived(session.vault);
	let adding = $state(false);
	/** whether the drawer that asks the vault looked at for access is open */
	let asking = $state(false);
	/** how many changes wait for each vault's yes (./Hitl.svelte), for the bubbles on the vaults in the nav pill */
	let waiting = $state(/** @type {Record<string, number>} */ ({}));

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
		notes: 'sparks',
		articles: 'stories'
	});

	/**
	 * The page an address names: `#todos`, a spark's or a note's `#notes/` and its entry, a story's `#stories/` and its
	 * entry, and the stage whose tab it opens on after it, where it names one, or with `/edit`, its text to edit as a
	 * note, whose back arrow goes back to its Writing tab (`#articles/` is an older address of the stories: there are only
	 * stories and their posts now); else, as with none or `#home`, the vault's home.
	 * @param {string} hash
	 */
	function parse(hash) {
		const [at, entry, edit] = hash.replace(/^#/, '').split('/');
		const page = MOVED[at] ?? at;
		const known = /** @type {Page | 'home'} */ (PAGES.find(([id]) => id === page && !OUT[id])?.[0] ?? 'home');
		const hex = (/** @type {string | undefined} */ x) => /^[0-9a-f]{64}$/.test(x ?? '');
		const opens = ['sparks', 'artifacts', 'stories'].includes(known) && hex(entry);
		const editing = opens && known === 'stories' && edit === 'edit';
		return {
			page: known,
			entry: opens ? entry : '',
			edit: editing,
			step: opens && known === 'stories' && !editing ? (edit ?? '') : '',
			// an asset the Assets page shows (`#assets/` and its entry, then the hash of a version or variant of it), in
			// the page, not on the whole screen
			asset: known === 'assets' && hex(entry) ? (entry ?? '') : '',
			recipe: known === 'assets' && hex(entry) && hex(edit) ? (edit ?? '') : '',
			// a doc the Docs page shows (`#docs/` and its entry), in the page
			doc: known === 'docs' && hex(entry) ? (entry ?? '') : ''
		};
	}

	let route = $state(parse(typeof location === 'undefined' ? '' : location.hash));
	const tab = $derived(route.page);
	// a link to the dashboard itself (the nav pill's Home and Back, `/app/` with no hash) is the router's navigation, no
	// hashchange: the page it leads to is read from the address after every navigation too
	afterNavigate(() => (route = parse(location.hash)));

	const busy = $derived(!!doing);
	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const context = $derived(byId.has(picked) ? picked : world.mine);
	const actor = $derived(acting(world, context).as);
	const mine = $derived(byId.get(world.mine));
	const here = $derived(/** @type {import('./vaults.js').VaultView} */ (byId.get(context) ?? mine));
	const as = $derived(byId.get(actor) ?? mine);

	// a page that stops on an error shows the error in its place, the vault bar and the pages kept (no blank screen),
	// and opens again as soon as another page or vault is picked
	let retry = /** @type {(() => void) | null} */ (null);
	$effect(() => {
		void [tab, context];
		const again = retry;
		retry = null;
		again?.();
	});

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
			title: 'Your vaults',
			get list() {
				return pillVaults(world, waiting);
			},
			get current() {
				return context;
			},
			pick: (id) => {
				session.vault = id;
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

	/** Open story `entry`, on the whole screen. @param {string} entry */
	const openStory = (entry) => go(`stories/${entry}`);

	// while a spark, an artifact or a story is open on the whole screen, the nav pill's Back closes it, back to its list
	// (a story's text, to its Writing tab); on a list, Back goes up to the dashboard, which shows these apps (./VaultApps.svelte)
	$effect(() => {
		const { entry, page, edit } = route;
		if (!entry) return;
		const to = page === 'stories' && edit ? `stories/${entry}/writing` : page;
		return wayBack(`Back to ${edit ? 'the story' : PAGES.find(([id]) => id === page)?.[1]}`, () => go(to));
	});

	// a note opens in its vault: its sparks are where its back arrow goes
	$effect(() => {
		const entry = route.entry;
		const of = entry ? world.entries.find((e) => e.entry === entry)?.vault : undefined;
		if (of) session.vault = of;
	});

	// the head over each view's middle column (./Frame.svelte): the vault it is in, back to its home, the view's name
	// and who the person acts as
	setContext(HEAD, {
		get head() {
			return head;
		}
	});

	/** Who owns vault `v`, as a line. @param {import('./vaults.js').VaultView} v */
	function owners(v) {
		if (v.id === world.mine) return 'Your vault: your passkey is its root.';
		const names = v.owners.map((o) => ('vault' in o ? nameOf(byId.get(o.vault)) : signerName(world, o.signer)));
		return `Owned by ${list(names)}.`;
	}
</script>

<svelte:window onhashchange={() => (route = parse(location.hash))} />

{#snippet head()}
	<header class="main-head">
		<a class="crumb" href="#home" title="{nameOf(here)}'s apps"><Icon name="apps" size={14} /><span>{KINDS[here.kind]} · {nameOf(here)}</span></a>
		<h2>{PAGES.find(([id]) => id === tab)?.[1]}</h2>
		<p class="soft">
			{#if context === world.mine}
				As <b>{nameOf(mine)}</b>.
			{:else if actor === context}
				As <b>{nameOf(mine)}</b>, its owner: you see and change all of it.
			{:else if !SETTINGS.includes(/** @type {Page} */ (tab))}
				As <b>{nameOf(as)}</b>: you see what {nameOf(here)} shares with {nameOf(as)}.
				{#if !here.via}<button class="link" onclick={() => (asking = true)}>Ask for access</button>{/if}
			{:else}
				As <b>{nameOf(as)}</b>. {nameOf(here)}'s settings show every share and device, as its owners see them.
			{/if}
		</p>
	</header>
	<AccessRequest {world} {requests} asked={asks.asked} made={asks.made} {api} {busy} ongrant={api.grant} ondeny={api.deny} />
{/snippet}

<div class="shell" class:reading={!!route.entry}>
	{#if route.entry}
		{#key `${route.entry}${route.page}${route.edit}`}
			{#if route.page === 'stories' && route.edit}
				<Note {world} {actor} {api} {busy} entry={route.entry} back="#stories/{route.entry}/writing" backTo="The story" />
			{:else if route.page === 'stories'}
				<Story {world} {actor} {api} {busy} entry={route.entry} step={route.step} />
			{:else if route.page === 'artifacts'}
				<Artifact {world} {actor} {api} {busy} entry={route.entry} />
			{:else}
				<Note {world} {actor} {api} {busy} entry={route.entry} />
			{/if}
		{/key}
	{:else if tab === 'home'}
		<!-- the vault's home: the app's one dashboard, the same for every vault (Samuel 2026-10-18), the consent screen
		     over it while a request waits -->
		<section class="main home">
		<Dashboard>
			<div class="home-asks">
				{#if !here.via}<button class="btn" onclick={() => (asking = true)}>Ask {nameOf(here)} for access</button>{/if}
				<AccessRequest {world} {requests} asked={asks.asked} made={asks.made} {api} {busy} ongrant={api.grant} ondeny={api.deny} />
			</div>
		</Dashboard>
		</section>
	{:else}
		<!-- a view: its own navigation on the left, itself in the middle under the head above, what it shows on the right,
		     each in the one layout every view has (./Frame.svelte) -->
		<svelte:boundary
			onerror={(e, reset) => {
				console.error(e);
				retry = reset;
			}}
		>
			{#if tab === 'sparks'}
				<Sparks {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={open} onstory={openStory} />
			{:else if tab === 'stories'}
				<Stories {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={openStory} />
			{:else if tab === 'todos'}
				<Todos {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} />
			{:else if tab === 'artifacts'}
				<Artifacts {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} onopen={open} />
			{:else if tab === 'docs'}
				<Docs {world} vault={context} {actor} {api} entry={route.doc} onaccess={() => go('sharing')} />
			{:else if tab === 'library'}
				<Library {world} vault={context} {actor} {api} {busy} onaccess={() => go('sharing')} />
			{:else if tab === 'assets'}
				<Assets {world} vault={context} {actor} {api} entry={route.asset} recipe={route.recipe} />
			{:else if tab === 'flows'}
				<Flows {world} vault={context} {actor} />
			{:else if tab === 'functions'}
				<Functions {world} vault={context} />
			{:else if tab === 'jobs'}
				<Jobs {world} vault={context} {actor} {api} />
			{:else if tab === 'about' || tab === 'members' || tab === 'sharing'}
				<Settings {world} vault={context} {actor} {api} {busy} {tab} {thisName} {link} {qr} {sockets} {drives} {asks} />
			{:else if tab !== 'studio'}
				<Database {world} vault={context} {actor} {api} view={tab} onopen={open} onview={go} />
			{/if}
			{#snippet failed(e, reset)}
				<Frame>
					<div class="card" role="alert">
						<p class="error">This page stopped on an error: {e instanceof Error ? e.message : String(e)}</p>
						<button class="btn" onclick={reset}>Try again</button>
					</div>
				</Frame>
			{/snippet}
		</svelte:boundary>
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
	/* the screen, never scrolled: each column of the view on it scrolls on its own (./Frame.svelte) */
	.shell {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
	}

	.main {
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: calc(1.4rem + env(safe-area-inset-top, 0px)) clamp(1rem, 3vw, 2.4rem) 10rem;
	}

	/* the vault the view is in, back to its apps */
	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		max-width: 100%;
		margin: 0 0 0.25rem;
		color: var(--accent);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-decoration: none;
		text-transform: uppercase;
	}

	.crumb span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.crumb:hover span {
		text-decoration: underline;
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

	/* the vault's home, on the whole screen: the app's one dashboard */
	.home {
		grid-column: 1 / -1;
	}

	.home-asks {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.6rem;
		margin-top: 1rem;
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
		/* clear of the notch and the status bar, now that nothing stands above it */
		.main {
			padding-top: calc(1rem + env(safe-area-inset-top, 0px));
		}
	}

</style>
