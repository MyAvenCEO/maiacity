<!--
	THE VIEW PROBE (/app/views/probe/) — every way out of a view, tried from inside views made to do harm
	($lib/sandbox/view/probe.js), each shown by the real view host ($lib/sandbox/ViewHost.svelte) as any view a vault
	holds is: the view's frame, its engine and its worker, frozen and checked as they ship. The asset box's lab
	(/app/assets/box/) does the same for the box. Every attempt must be refused or stopped:
	- what the view's script tries in its worker (the network, storage, cookies, code from strings, the page's DOM,
	  navigating, opening windows, the MCP Apps methods a view is refused) it says itself, as a view may;
	- what reaches the page outside the view's port, what the page keeps of it, a frame that loads again, a script or
	  logic that never stops, a script that works without end in bursts (past its budget of work, though it names an
	  engine from before the budget), a scene too heavy for the device (its frames spaced out, never stopped), and a
	  view made for an engine no page has (never started), the page sees for itself;
	- what its markup reaches out to only the canary can tell: `?canary=<address>` aims every attempt there, and
	  scripts/probes.mjs (headless Chromium, in CI before every deploy) listens there, clicks what the view drew, and
	  fails on anything that arrived. Opened by hand, the attempts aim at this site's /__view-probe/, which counts nothing.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import ViewHost from '$lib/sandbox/ViewHost.svelte';
	import { CLICKS, HEAVY, HTML_TRIES, PAGE_SAYS, SECRET, UNKNOWN_ENGINE, WORKER_TRIES, burnView, heavyView, hostileView, logicViews, spinView, unknownEngineView } from '$lib/sandbox/view/probe.js';

	/** how long the views have to say everything and be stopped (ms), and how long stray effects have to land after */
	const DEADLINE = 40000;
	const SETTLE = 1000;
	// where every attempt aims: the runner's canary (a plain web address), else this site's own
	const given = new URLSearchParams(location.search).get('canary') ?? '';
	const canary = /^https?:\/\/[\w.-]+(:\d{1,5})?(\/[\w-]+)*\/?$/.test(given) ? given.replace(/\/$/, '') : `${location.origin}/__view-probe`;

	const hostile = hostileView(canary);
	const spin = spinView();
	const burn = burnView();
	const heavy = heavyView();
	const unknown = unknownEngineView();
	const logic = logicViews();
	const VIEWS = [hostile, spin, burn, heavy, unknown, ...logic];

	// the page's own secret, in its cookie and its DOM: a view that reads either reached the page
	const secret = crypto.randomUUID();
	document.cookie = `${SECRET}=${secret}; path=/; SameSite=Strict`;

	/** what the hostile view's script said of each attempt */
	let said = $state({});
	/** what each view's host said went wrong, and when (ms from the start) */
	let errors = $state(Object.fromEntries(VIEWS.map((v) => [v.id, []])));
	/** whatever reached the page outside a view's port */
	let escapes = $state([]);
	let checks = $state([]);
	let results = $state(null);
	let line = $state('The views are trying every way out…');
	let holder;

	const t0 = performance.now();
	const ms = () => Math.round(performance.now() - t0);
	const passed = $derived(checks.filter((c) => c.ok).length);
	const has = (id, re) => errors[id].find((e) => re.test(e.message));
	/** what the engine says of a view's script past its budget of work */
	const BUDGET = /kept its worker at work/;
	/** the heavy scene's frames: how many it drew, how many came spaced out, and how far apart two came at most (ms) */
	const heavyFrames = () => {
		try {
			return JSON.parse(said[HEAVY] ?? '{}');
		} catch {
			return {};
		}
	};
	/** its frames spaced out: five of them (one by chance, as the machine waits, is no pace) */
	const PACED = 5;
	/**
	 * what the logic host says of logic it stopped: QuickJS's own limits (its work, its memory, its time), or the box's
	 * ten seconds, where one native step of it (a big array filled while its memory runs out) outlasts them
	 */
	const LOGIC_STOPPED = /ran too long|took more than|ran longer than|out of memory/;
	/** what the host says of a view made for an engine no page has */
	const NO_ENGINE = new RegExp(`made for view engine ${UNKNOWN_ENGINE}, which this page does not have`);

	const onevent = (e) => {
		if (e?.name === 'log' && typeof e.value?.probe === 'string') said[e.value.probe] = String(e.value.said);
		else if (JSON.stringify(e ?? null).includes('maia-probe-escape')) escapes = [...escapes, `an event: ${JSON.stringify(e).slice(0, 120)}`];
	};
	const onerror = (id) => (message) => (errors[id] = [...errors[id], { at: ms(), message: String(message) }]);

	/** a view's frame, among those this page holds */
	const fromView = (source) => [...(holder?.querySelectorAll('iframe') ?? [])].some((f) => f.contentWindow === source);

	/** whether the views are through: every attempt said, and the views that never stop stopped */
	const through = () =>
		WORKER_TRIES.every((t) => said[t]) && said['(done)'] && has(spin.id, /held its worker/) && has(burn.id, BUDGET) && heavyFrames().spaced >= PACED && has(unknown.id, NO_ENGINE) && logic.every((v) => has(v.id, LOGIC_STOPPED));

	/** what of the views this page keeps: its cookies, its storage, its databases and caches */
	async function kept() {
		const found = [];
		if (document.cookie.includes('maia-view-probe')) found.push('a cookie');
		for (const [name, store] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) if (store.getItem('maia-view-probe') != null) found.push(name);
		if (indexedDB.databases && (await indexedDB.databases()).some((d) => d.name === 'maia-view-probe')) found.push('a database');
		if (globalThis.caches && (await caches.keys()).includes('maia-view-probe')) found.push('a cache');
		return found;
	}

	async function finish(gap) {
		const add = (name, ok, note) => (checks = [...checks, { name, ok, note }]);
		const tried = WORKER_TRIES.filter((t) => !PAGE_SAYS.includes(t));
		const open = tried.filter((t) => said[t]?.startsWith('OPEN'));
		const silent = tried.filter((t) => !said[t]);
		add('Its script gets out no way', !open.length && !silent.length, open.length ? `open: ${open.map((t) => `${t} (${said[t]})`).join('; ')}` : silent.length ? `no word of: ${silent.join(', ')}` : `${tried.length} ways out of its worker, every one refused`);
		add('The page answers what a view may ask', said['(the page answers a ping)'] === 'answered', `a ping, ${said['(the page answers a ping)'] ?? 'never asked'}: so tools/call, resources/read, ui/open-link and the rest were refused, not lost`);
		add('Nothing reaches the page outside its port', !escapes.length && !!said[PAGE_SAYS[0]], escapes.length ? escapes.join('; ') : 'its worker posted to its frame and forged its engine’s messages; an inline handler posted to the page: none of it came through');
		const src = has(hostile.id, /no script from an address/);
		add('A script from an address is refused', !!src, src ? `the engine said: ${src.message}` : 'the engine never said so');
		const left = VIEWS.filter((v) => has(v.id, /tried to leave its box/));
		add('No view’s frame loads again', !left.length, left.length ? `left its box: ${left.map((v) => v.title).join(', ')}` : 'each frame loaded once, its engine alone');
		const stopped = has(spin.id, /held its worker/);
		add('A script that never yields is stopped', !!stopped, stopped ? `after ${(stopped.at / 1000).toFixed(1)} s: ${stopped.message}` : 'it was never stopped');
		// it answers every ping between its bursts, so only its budget of work can stop it
		const spent = has(burn.id, BUDGET);
		const held = has(burn.id, /held its worker/);
		// and it names view engine 2, from before the budget: it runs on the floor all the same
		add('A script that works without end, in bursts, is stopped by its budget', !!spent && !held, spent ? `after ${(spent.at / 1000).toFixed(1)} s, though it names view engine ${burn.engine}: ${spent.message}${held ? `; but first: ${held.message}` : ''}` : held ? `only as one that held its worker: ${held.message}` : 'it was never stopped');
		const none = has(unknown.id, NO_ENGINE);
		add('A view made for an engine no page has does not start', !!none, none ? none.message : 'it was never refused');
		// its frames spaced out past half its budget, never stopped
		const frames = heavyFrames();
		const ended = has(heavy.id, BUDGET) ?? has(heavy.id, /held its worker/);
		add('A scene too heavy for the device slows down and goes on', frames.spaced >= PACED && !ended, ended ? `it was stopped after ${(ended.at / 1000).toFixed(1)} s: ${ended.message}` : frames.frames ? `${frames.frames} frames of 300 ms of work each, ${frames.spaced} of them spaced out (400 ms or more apart, at most ${frames.widest})` : 'it never drew');
		for (const v of logic) {
			const e = has(v.id, LOGIC_STOPPED);
			add(`${v.title} is stopped`, !!e, e ? `after ${(e.at / 1000).toFixed(1)} s: ${e.message}` : 'it was never stopped');
		}
		add('The page goes on meanwhile', gap < 1000, `the page’s clock never waited more than ${Math.round(gap)} ms`);
		const found = await kept();
		add('This page keeps nothing of a view', !found.length, found.length ? `found: ${found.join(', ')}` : 'no cookie, storage, database or cache of a view’s');
		document.cookie = `${SECRET}=; path=/; max-age=0`;
		results = { canary, ms: ms(), said: { ...said }, checks, escapes, errors, html: HTML_TRIES, clicks: CLICKS };
		line = checks.every((c) => c.ok) ? 'Every check passed.' : 'Some checks failed.';
	}

	onMount(() => {
		// anything a view's frame posts to this window is outside its port, and so is anything that names the escape
		const heard = (e) => {
			let text = '';
			try {
				text = JSON.stringify(e.data) ?? '';
			} catch {}
			if (fromView(e.source) || text.includes('maia-probe-escape')) escapes = [...escapes, `a message to the page: ${text.slice(0, 120)}`];
		};
		addEventListener('message', heard);
		// the page's clock: how long it ever waited while the views ran
		let [last, gap] = [performance.now(), 0];
		const clock = setInterval(() => {
			const now = performance.now();
			gap = Math.max(gap, now - last);
			last = now;
		}, 50);
		const wait = setInterval(() => {
			if (results || (!through() && ms() < DEADLINE)) return;
			clearInterval(wait);
			line = 'Every view has had its say: checking what came of it…';
			setTimeout(() => {
				clearInterval(clock);
				finish(gap);
			}, SETTLE);
		}, 200);
		return () => {
			removeEventListener('message', heard);
			clearInterval(clock);
			clearInterval(wait);
			document.cookie = `${SECRET}=; path=/; max-age=0`;
		};
	});
</script>

<svelte:head><title>View probe · maiaCITY</title></svelte:head>

<main class="app-page">
	<header>
		<p class="eyebrow">The view host</p>
		<h1>Every way out of a view</h1>
		<p class="dim">
			Views made to do harm, each in the real view host as a vault's view would be: a frame with no origin running our
			frozen view engine, its script in a worker. Its script tries every way out; its markup reaches out every way
			markup can; one script never yields, one works without end in bursts (naming an engine from before the budget),
			one draws frames too heavy for the device (which must slow down, not stop), one names an engine no page has, and
			two views' logic never stops. Every attempt aims at
			<code>{canary}/…</code>.
		</p>
		<p class="dim" data-line>{line}</p>
		<span hidden data-secret={secret}>{SECRET}</span>
	</header>

	{#if checks.length}
		<section>
			<h2>Checks · {passed} of {checks.length} passed</h2>
			<ul class="checks">
				{#each checks as c}
					<li class:bad={!c.ok}><b>{c.ok ? '✓' : '✗'} {c.name}</b><small>{c.note}</small></li>
				{/each}
			</ul>
		</section>
	{/if}

	<section>
		<h2>What its script tried</h2>
		<ul class="tries">
			{#each WORKER_TRIES as t}
				<li class:bad={said[t]?.startsWith('OPEN')}><b>{t}</b> {said[t] ?? '…'}</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>What its markup reaches out to</h2>
		<p class="dim small">Only the canary can tell whether any of these arrived: scripts/probes.mjs listens there, and clicks the links and buttons first.</p>
		<ul class="tries">
			{#each Object.entries(HTML_TRIES) as [path, what]}
				<li><b>{what}</b> {canary}/{path}</li>
			{/each}
		</ul>
	</section>

	<section class="views" bind:this={holder}>
		<h2>The views</h2>
		<!-- the heavy scene stays in sight (a frame out of sight draws no animation frames), in a corner the runner's
		     clicks, each in the middle of the window, never land on -->
		{#each VIEWS as v (v.id)}
			<figure class:pinned={v === heavy}>
				<figcaption>{v.title}{#if errors[v.id].length}<small> · {errors[v.id].at(-1).message}</small>{/if}</figcaption>
				<ViewHost view={v} onevent={v === hostile || v === heavy ? onevent : () => {}} onerror={onerror(v.id)} />
			</figure>
		{/each}
	</section>

	{#if results}<pre id="results" hidden>{JSON.stringify(results)}</pre>{/if}
</main>

<style>
	.app-page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.6rem clamp(1rem, 4vw, 2rem) 6rem;
	}
	.dim {
		color: var(--muted);
	}
	.small {
		font-size: 0.85rem;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	h1 {
		margin: 0.2rem 0 0.4rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 2.8rem);
	}
	h2 {
		margin: 1.6rem 0 0.6rem;
		font-family: var(--font-display);
		font-size: 1.3rem;
	}
	code {
		overflow-wrap: anywhere;
	}
	.checks,
	.tries {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.checks li {
		display: grid;
		gap: 0.1rem;
		padding: 0.45rem 0.55rem;
		border-radius: 8px;
		background: #edf2e6;
	}
	.checks li b {
		font-weight: 600;
		color: #2f5a22;
	}
	.checks li.bad {
		background: #f6e1dc;
	}
	.checks li.bad b,
	.tries li.bad b {
		color: #a3312a;
	}
	.checks small,
	.tries {
		color: rgb(31 42 35 / 0.7);
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}
	.tries b {
		color: var(--ink);
		font-weight: 600;
	}
	figure {
		margin: 0 0 1rem;
	}
	figure.pinned {
		position: fixed;
		left: 1rem;
		bottom: 1rem;
		z-index: 5;
		width: min(18rem, calc(100vw - 2rem));
		margin: 0;
		padding: 0.5rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--paper);
	}
	figcaption {
		margin-bottom: 0.3rem;
		font-size: 0.85rem;
		color: var(--ink-soft);
	}
	figcaption small {
		color: var(--muted);
	}
</style>
