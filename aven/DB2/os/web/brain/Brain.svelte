<script>
	// Brain, avenOS's documentation (aven/DB2/brain): #/brain is the dashboard, in three bands (the architecture, the
	// packages, the decisions and the glossary); #/brain/<package> its page, its slides in their place, and
	// #/brain/<package>/<heading> one section of it; #/brain/decisions the decision log, and #/brain/decisions/<id> one
	// decision; #/brain/glossary the glossary, and #/brain/glossary/<word> one term in it. Readable
	// on every host without signing in, as public as the repo: Root.svelte routes #/brain here before any vault's
	// route, so no vault is ever named `brain`.
	import MainNav from './MainNav.svelte';
	import Decisions from './Decisions.svelte';
	import Node from './Node.svelte';
	import { art, decisions, face, glossary, headings, packages, page, slide, textOf } from './brain.js';

	let { home = '#/' } = $props();

	const read = () => location.hash.replace(/^#\/?brain\/?/, '').split('/').filter(Boolean);
	let route = $state(read());
	$effect(() => {
		const follow = () => (route = read());
		addEventListener('hashchange', follow);
		return () => removeEventListener('hashchange', follow);
	});

	const part = $derived(packages.find((p) => p.id === route[0]));
	// The trees come from markdown-runtime, in the runtimes worker: each page shows once its own are drawn. A page
	// markdown-runtime refused says so.
	let words = $state({ tree: [], terms: new Map() });
	let story = $state([]);
	let slides = $state([]);
	let log = $state(null);
	let refused = $state(null);
	$effect(() => {
		const p = part;
		story = [];
		slides = [];
		refused = null;
		if (!p?.page) return;
		const asked =
			p.id === 'glossary'
				? glossary().then((g) => (words = g))
				: p.id === 'decisions'
					? decisions().then((l) => part === p && (log = l))
					: Promise.all([page(p.page), Promise.all((p.slides ?? []).map((id) => slide(p.id, id)))]).then(([s, ss]) => {
							if (part !== p) return;
							story = s;
							slides = ss;
						});
		asked.catch((error) => part === p && (refused = String(error?.message ?? error)));
	});
	// the contents on the left: this page's headings (and a package's slides, numbered, after its story), then the brain
	const sections = $derived(
		route[0] === 'glossary'
			? headings(words.tree).filter((h) => h.level === 2).map((h) => ({ href: `#/brain/glossary/${h.id}`, id: h.id, name: h.name, level: 2 }))
			: route[0] === 'decisions'
				? [...headings(log?.intro ?? []), { id: 'log', name: 'The log', level: 2 }].map((h) => ({ ...h, href: `#/brain/decisions/${h.id}` }))
				: headings(story).map((h) => ({ ...h, href: `#/brain/${part.id}/${h.id}` })),
	);
	const numbered = $derived(slides.map((s, i) => ({ href: `#/brain/${part.id}/${s.id}`, id: s.id, name: textOf(s.text[0] ?? ''), n: i + 1 })));
	const others = packages.filter((p) => p.page);
	// the dashboard's three bands (A203): where to start, the packages, and where to look things up
	const start = packages.filter((p) => p.id === 'architecture');
	const reference = packages.filter((p) => p.id === 'decisions' || p.id === 'glossary');
	const kits = packages.filter((p) => !start.includes(p) && !reference.includes(p));
	// a decision asked for by its id, for the log
	const asked = $derived(route[0] === 'decisions' && route[1] && route[1] !== 'log' && !headings(log?.intro ?? []).some((h) => h.id === route[1]) ? route[1] : null);
	let wide = $state(true);
	$effect(() => {
		const query = matchMedia('(min-width: 1200px)');
		const follow = () => (wide = query.matches);
		follow();
		query.addEventListener('change', follow);
		return () => query.removeEventListener('change', follow);
	});

	// a term asked for by name: scroll to it and mark it, once the glossary is drawn
	$effect(() => {
		if (route[0] !== 'glossary') return;
		const id = route[1]?.startsWith('g-') ? route[1] : (words.terms.get(route[1]) ?? (route[1] ? `term-${route[1]}` : null));
		for (const old of document.querySelectorAll('.brain .here')) old.classList.remove('here');
		const entry = id && document.getElementById(id);
		if (entry) {
			if (!id.startsWith('g-')) entry.classList.add('here');
			entry.scrollIntoView({ block: id.startsWith('g-') ? 'start' : 'center' });
		} else scrollTo(0, 0);
	});
	// a slide or a section asked for by name: scroll to it, once its page is drawn; any other page opens at its top. A
	// decision is the log's own to find.
	$effect(() => {
		if (route[0] === 'glossary' || asked || (part?.slides?.length && !slides.length) || (route[0] === 'decisions' ? !log : part?.page && !story.length)) return;
		const entry = route[1] && (document.getElementById(`slide-${route[1]}`) ?? document.getElementById(route[1]));
		if (entry) entry.scrollIntoView({ block: 'start' });
		else scrollTo(0, 0);
	});
</script>

<div class="brain" data-view="brain" data-brain={route[0] ?? 'dashboard'}>
	<header class="top">
		<MainNav {home} brain />
		{#if part}<span class="crumb">/ {part.name}</span>{/if}
	</header>

	{#if !route.length}
		<main class="dashboard">
			<h1 class="sheet-title">Brain</h1>
			<p class="lead">How avenDB works, in one place: the whole on one page, a page for each part, every decision as it was made, and every word with its one meaning. Open to anyone, signed in or not.</p>
			{#snippet tile(item, wide)}
				<li class="item" class:wide data-testid={`brain-${item.id}`}>
					<svelte:element this={item.page ? 'a' : 'div'} class={item.page ? 'tile open' : 'tile off'} href={item.page ? `#/brain/${item.id}` : undefined}>
						<img class="art" src={art(item.art)} alt="" width="440" height="440" />
						<span class="words">
							<strong>{item.name}</strong>
							<span class="state">{item.page ? (item.slides ? `${item.slides.length} slides` : 'Read') : 'Coming'}</span>
							<span class="what">{item.what}</span>
						</span>
					</svelte:element>
				</li>
			{/snippet}
			<section class="band" aria-labelledby="band-start">
				<h2 class="band-title" id="band-start">Start here</h2>
				<ul class="grid start">{#each start as item (item.id)}{@render tile(item, true)}{/each}</ul>
			</section>
			<section class="band" aria-labelledby="band-parts">
				<h2 class="band-title" id="band-parts">The packages</h2>
				<ul class="grid">{#each kits as item (item.id)}{@render tile(item, false)}{/each}</ul>
			</section>
			<section class="band" aria-labelledby="band-look">
				<h2 class="band-title" id="band-look">Look things up</h2>
				<ul class="grid">{#each reference as item (item.id)}{@render tile(item, false)}{/each}</ul>
			</section>
		</main>
	{:else if part?.page}
		<div class="layout">
			<aside class="contents" aria-label="Contents">
				<details open={wide}>
					<summary>Contents</summary>
					<p class="contents-head">{part.name}</p>
					{#if sections.length}
						<ul class="sections">
							{#each sections as item (item.id)}
								<li class:sub={item.level === 3}><a href={item.href} aria-current={route[1] === item.id ? 'true' : undefined}>{item.name}</a></li>
							{/each}
						</ul>
					{/if}
					{#if numbered.length}
						<p class="contents-head">Slides</p>
						<ol class="numbered">
							{#each numbered as item (item.id)}
								<li><a href={item.href} aria-current={route[1] === item.id ? 'true' : undefined}>{item.name}</a></li>
							{/each}
						</ol>
					{/if}
					<p class="contents-head">Brain</p>
					<ul>
						<li><a href="#/brain">The whole brain</a></li>
						{#each others as other (other.id)}
							<li><a href={`#/brain/${other.id}`} aria-current={other.id === part.id ? 'page' : undefined}>{other.name}</a></li>
						{/each}
					</ul>
				</details>
			</aside>
			{#if refused}
				<main class="prose" data-testid="refused">
					<h1>{part.name}</h1>
					<p>This page wasn't drawn: {refused}</p>
				</main>
			{:else if route[0] === 'decisions'}
				<main class="page" data-testid="decisions-page">
					{#if log}
						<div class="prose">{#each log.intro as node, i (i)}<Node {node} />{/each}</div>
						<Decisions {log} selected={asked} />
						<div class="prose">{#each log.after as node, i (i)}<Node {node} />{/each}</div>
					{/if}
				</main>
			{:else if route[0] === 'glossary'}
				<main class="prose glossary" data-testid="glossary">
					{#each words.tree as node, i (i)}<Node {node} />{/each}
				</main>
			{:else}
				<main class="page">
					<div class="prose">
						{#each story as node, i (i)}<Node {node} />{/each}
					</div>
					{#each slides as s (s.id)}
						<section class="slide-page" id={`slide-${s.id}`} data-testid={`slide-${s.id}`}>
							<div class="face" use:face={s.part}></div>
							<div class="prose">
								<!-- the slide's own headline stands for its text's title -->
								{#each s.text[0]?.[0] === 'h1' ? s.text.slice(1) : s.text as node, i (i)}<Node {node} />{/each}
							</div>
						</section>
					{/each}
				</main>
			{/if}
		</div>
	{:else}
		<main class="prose">
			<h1>{part ? part.name : 'No such page'}</h1>
			<p>{part ? `${part.what}. Its page comes once avenID's has found the style and the language.` : 'This page is not in the brain.'}</p>
			<p><a href="#/brain">The whole brain</a></p>
		</main>
	{/if}
</div>

<style>
	/* an illustrated asset sheet: a warm cream ground, bold navy type */
	.brain {
		min-height: 100vh;
		color: var(--brain-navy);
		background: var(--brain-cream);
	}

	.top {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 64px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--brain-line);
	}

	.crumb {
		overflow: hidden;
		color: var(--brain-quiet);
		font-size: 15px;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	main {
		max-width: 1040px;
		margin: 0 auto;
		padding: 32px 16px 80px;
	}

	.sheet-title,
	.prose :global(h1) {
		margin: 4px 0 12px;
		font: 800 clamp(30px, 5vw, 42px) / 1.1 var(--brain-sans);
		letter-spacing: -0.015em;
	}

	.lead {
		max-width: 60ch;
		margin: 0 0 32px;
		color: var(--brain-quiet);
		font-size: 17px;
	}

	/* the dashboard: three bands, each package as a drawing with its name under it, as on an asset sheet */
	.band {
		margin: 0 0 40px;
	}

	.band-title {
		margin: 0 0 16px;
		padding-bottom: 8px;
		font: 800 13px/1.3 var(--brain-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		border-bottom: 1px solid var(--brain-line);
	}

	.grid.start {
		grid-template-columns: 1fr;
	}

	.wide .tile {
		grid-template-columns: auto 1fr;
		align-items: center;
		justify-items: start;
		gap: 4px 24px;
		padding: 16px 24px;
		text-align: left;
		background: var(--brain-card);
		border: 1px solid var(--brain-line);
	}

	.wide .what {
		max-width: 52ch;
		font-size: 16px;
	}

	.words {
		display: grid;
		gap: 4px;
		justify-items: inherit;
	}

	@media (max-width: 560px) {
		.wide .tile {
			grid-template-columns: 1fr;
			justify-items: center;
			text-align: center;
		}
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
		gap: 28px 20px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tile {
		display: grid;
		justify-items: center;
		align-content: start;
		gap: 4px;
		height: 100%;
		padding: 8px 8px 16px;
		color: inherit;
		text-align: center;
		text-decoration: none;
		border-radius: var(--brain-radius);
		transition: background 0.15s;
	}

	.tile.open:hover {
		background: var(--brain-card);
	}

	.art {
		width: 150px;
		height: 150px;
		margin-bottom: -6px;
	}

	.off .art {
		opacity: 0.55;
		filter: saturate(0.6);
	}

	.tile strong {
		font: 800 17px/1.2 var(--brain-sans);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.state {
		color: var(--brain-ochre-ink);
		font: 700 12px/1.3 var(--brain-sans);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.what {
		max-width: 26ch;
		color: var(--brain-quiet);
		font-size: 14px;
	}

	/* a page with its contents: the contents on the left, the page centred, a matching gutter on the right */
	.layout {
		display: grid;
		grid-template-columns: minmax(240px, 1fr) minmax(0, 860px) minmax(240px, 1fr);
		gap: 32px;
	}

	.layout > main {
		grid-column: 2;
		width: 100%;
		min-width: 0;
		margin: 0;
	}

	.contents {
		grid-column: 1;
		justify-self: end;
		width: min(240px, 100%);
		position: sticky;
		top: 0;
		align-self: start;
		max-height: 100vh;
		overflow-y: auto;
		padding: 32px 0 32px 16px;
		font-size: 14px;
	}

	.contents summary {
		display: none;
		cursor: pointer;
	}

	.contents-head {
		margin: 0 0 8px;
		padding-left: 10px;
		font: 800 12px/1.3 var(--brain-sans);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.contents ol,
	.contents ul {
		display: grid;
		gap: 2px;
		margin: 0 0 24px;
		padding: 0;
		list-style: none;
	}

	.contents ol.numbered {
		counter-reset: slide;
	}

	.contents ol.numbered li {
		counter-increment: slide;
	}

	.contents a {
		display: flex;
		gap: 8px;
		padding: 6px 10px;
		color: var(--brain-navy);
		line-height: 1.35;
		text-decoration: none;
		border-radius: 10px;
	}

	.contents ol.numbered a::before {
		content: counter(slide);
		min-width: 1.2em;
		color: var(--brain-ochre-ink);
		font-weight: 700;
	}

	.contents li.sub a {
		padding-left: 24px;
		font-size: 13px;
	}

	.contents a:hover {
		background: var(--brain-card);
	}

	.contents a[aria-current] {
		font-weight: 700;
		background: var(--brain-card);
	}

	/* narrower than both columns: the contents are a folded list above the page */
	@media (max-width: 1199px) {
		.layout {
			display: block;
			max-width: 1040px;
			margin: 0 auto;
			padding: 0 16px;
		}

		.layout > main {
			padding-left: 0;
			padding-right: 0;
		}

		.contents {
			position: static;
			justify-self: stretch;
			width: auto;
			max-height: none;
			padding: 20px 0 0;
		}

		.contents details {
			padding: 12px 16px;
			background: var(--brain-card);
			border-radius: var(--brain-radius);
		}

		.contents summary {
			display: list-item;
			font: 800 13px/1.6 var(--brain-sans);
			letter-spacing: 0.08em;
			text-transform: uppercase;
		}

		.contents details[open] summary {
			margin-bottom: 10px;
		}
	}

	.slide-page {
		margin: 40px 0 0;
		scroll-margin-top: 16px;
	}

	/* a slide's place, kept while face-runtime runs its part, so the page doesn't move when it is drawn */
	.slide-page .face {
		aspect-ratio: 16 / 9;
	}

	.slide-page .prose {
		margin-top: 20px;
	}

	/* Markdown, as the brain writes it */
	.prose {
		max-width: 72ch;
		font-size: 16px;
		line-height: 1.65;
		overflow-wrap: anywhere;
	}

	.glossary {
		max-width: 920px;
	}

	.prose :global(h2),
	.prose :global(h3) {
		scroll-margin-top: 16px;
	}

	.prose :global(h2) {
		margin: 36px 0 10px;
		font: 800 22px/1.25 var(--brain-sans);
	}

	.prose :global(h3) {
		margin: 24px 0 8px;
		font: 800 17px/1.3 var(--brain-sans);
	}

	.prose :global(a) {
		color: var(--brain-teal-ink);
		text-decoration-color: var(--brain-ochre);
		text-decoration-style: dotted;
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}

	.prose :global(code) {
		padding: 1px 5px;
		font-size: 0.88em;
		background: var(--brain-line);
		border-radius: 4px;
	}

	.prose :global(li) {
		margin: 6px 0;
		padding: 2px 8px;
		border-radius: 8px;
		scroll-margin-top: 80px;
	}

	.prose :global(li.here) {
		background: var(--brain-card);
		box-shadow: inset 3px 0 0 var(--brain-ochre);
	}

	/* a wide table scrolls inside its own box, never the page; its cells keep their words whole */
	.prose :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 14px;
		overflow-wrap: normal;
	}

	.prose :global(td) {
		min-width: 8ch;
	}

	.prose :global(td:last-child),
	.prose :global(td:nth-child(2)) {
		min-width: 16ch;
	}

	.prose :global(pre) {
		max-width: 100%;
		overflow-x: auto;
	}

	.prose :global(th),
	.prose :global(td) {
		padding: 6px 10px;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--brain-line);
	}

	.prose :global(th) {
		font: 800 12px/1.3 var(--brain-sans);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-bottom: 2px solid var(--brain-navy);
	}

	.prose :global(blockquote) {
		margin: 16px 0;
		padding: 2px 16px;
		border-left: 3px solid var(--brain-ochre);
	}
</style>
