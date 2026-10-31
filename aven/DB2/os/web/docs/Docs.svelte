<script>
	// avenOS's docs (aven/DB2/brain): #/docs is the dashboard, one item per package; #/docs/<package> its page, the story
	// and its slides; #/docs/glossary the glossary, and #/docs/glossary/<word> one term in it. Readable on every host
	// without signing in, as public as the repo: main.js routes #/docs here before any vault's route, so no vault is
	// ever named `docs`.
	import MainNav from './MainNav.svelte';
	import Node from './Node.svelte';
	import { glossary, packages, page, slide } from './brain.js';

	let { home = '#/' } = $props();

	const read = () => location.hash.replace(/^#\/?docs\/?/, '').split('/').filter(Boolean);
	let route = $state(read());
	$effect(() => {
		const follow = () => (route = read());
		addEventListener('hashchange', follow);
		return () => removeEventListener('hashchange', follow);
	});

	const part = $derived(packages.find((p) => p.id === route[0]));
	const words = glossary();
	const story = $derived(part?.page && part.id !== 'glossary' ? page(part.page) : []);
	const slides = $derived(part?.page ? (part.slides ?? []).map((id) => slide(part.id, id)) : []);
	const textOf = (node) => (typeof node === 'string' ? node : node[2].map(textOf).join(''));
	// the index on the left: this page's sections, then the other docs
	const sections = $derived(
		route[0] === 'glossary'
			? words.tree.filter((n) => n[0] === 'h2').map((n) => ({ href: `#/docs/glossary/${n[1][0][1]}`, id: n[1][0][1], name: textOf(n) }))
			: slides.map((s, i) => ({ href: `#/docs/${part.id}/${s.id}`, id: s.id, name: textOf(s.text[0] ?? ''), n: i + 1 })),
	);
	const others = packages.filter((p) => p.page);
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
	// a slide asked for by name: scroll to it; any other page opens at its top
	$effect(() => {
		if (route[0] === 'glossary') return;
		const entry = route[1] && document.getElementById(`slide-${route[1]}`);
		if (entry) entry.scrollIntoView({ block: 'start' });
		else scrollTo(0, 0);
	});
</script>

<div class="brain" data-view="docs" data-docs={route[0] ?? 'dashboard'}>
	<header class="top">
		<MainNav {home} docs />
		{#if part}<span class="crumb">/ {part.name}</span>{/if}
	</header>

	{#if !route.length}
		<main class="dashboard">
			<p class="kicker">avenBRAIN</p>
			<h1>Docs</h1>
			<p class="lead">How the whole system works, told from the ground up for someone with no background. One idea per slide.</p>
			<ul class="grid">
				{#each packages as item (item.id)}
					<li class="item" data-tone={item.id} data-testid={`doc-${item.id}`}>
						{#if item.page}
							<a href={`#/docs/${item.id}`}>
								<span class="facets"></span>
								<span class="state">{item.slides ? `${item.slides.length} slide${item.slides.length === 1 ? '' : 's'}` : 'Read'}</span>
								<strong>{item.name}</strong>
								<span class="what">{item.what}</span>
							</a>
						{:else}
							<div class="off">
								<span class="facets"></span>
								<span class="state">Coming</span>
								<strong>{item.name}</strong>
								<span class="what">{item.what}</span>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</main>
	{:else if part?.page}
		<div class="layout">
			<aside class="index" aria-label="Contents">
				<details open={wide}>
					<summary>Contents</summary>
					<p class="index-head">{part.name}</p>
					<ol class:numbered={route[0] !== 'glossary'}>
						{#each sections as item (item.id)}
							<li><a href={item.href} aria-current={route[1] === item.id ? 'true' : undefined}>{item.name}</a></li>
						{/each}
					</ol>
					<p class="index-head">Docs</p>
					<ul>
						<li><a href="#/docs">All docs</a></li>
						{#each others as other (other.id)}
							<li><a href={`#/docs/${other.id}`} aria-current={other.id === part.id ? 'page' : undefined}>{other.name}</a></li>
						{/each}
					</ul>
				</details>
			</aside>
			{#if route[0] === 'glossary'}
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
							{#each s.tree as node, i (i)}<Node {node} />{/each}
							<div class="prose">
								{#each s.text as node, i (i)}<Node {node} />{/each}
							</div>
						</section>
					{/each}
				</main>
			{/if}
		</div>
	{:else}
		<main class="prose">
			<p class="kicker">{part ? 'Coming' : 'Not here'}</p>
			<h1>{part ? part.name : 'No such page'}</h1>
			<p>{part ? `${part.what}. Its page comes once avenID's has found the style and the language.` : 'This page is not in the docs.'}</p>
			<p><a href="#/docs">All docs</a></p>
		</main>
	{/if}
</div>

<style>
	.brain {
		min-height: 100vh;
		color: var(--brain-ink);
		background: var(--brain-cream);
	}

	.top {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 64px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--brain-gold);
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

	.kicker,
	.state {
		margin: 0;
		color: var(--brain-quiet);
		font: 600 12px/1.3 var(--brain-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin: 6px 0 8px;
		font: 500 clamp(34px, 6vw, 48px) / 1.1 var(--brain-serif);
	}

	.lead {
		max-width: 60ch;
		margin: 0 0 28px;
		font-size: 17px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
		gap: 16px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item > a,
	.item > .off {
		position: relative;
		display: grid;
		gap: 4px;
		height: 100%;
		padding: 64px 18px 18px;
		overflow: hidden;
		color: inherit;
		text-decoration: none;
		background: var(--brain-panel);
		border: 1px solid var(--brain-gold);
		border-radius: var(--brain-radius);
		box-shadow: var(--brain-lift);
	}

	.item > a:hover {
		border-color: var(--brain-path);
	}

	.item > .off {
		background: transparent;
		box-shadow: none;
		border-style: dashed;
	}

	.item strong {
		font: 500 22px/1.2 var(--brain-serif);
	}

	.what {
		color: var(--brain-quiet);
		font-size: 14px;
	}

	/* each package's mark: a band of low-poly facets in its colour, lit from the top left */
	.facets {
		position: absolute;
		inset: 0 0 auto;
		height: 46px;
		clip-path: polygon(0 0, 100% 0, 100% 62%, 74% 100%, 46% 70%, 18% 92%, 0 64%);
		background: linear-gradient(115deg, var(--light) 0 38%, var(--mid) 38% 70%, var(--deep) 70%);
	}

	.off .facets {
		opacity: 0.45;
	}

	[data-tone] {
		--light: var(--brain-ochre-light);
		--mid: var(--brain-ochre);
		--deep: var(--brain-ochre-deep);
	}
	[data-tone='id'],
	[data-tone='actors'] {
		--light: var(--brain-teal-light);
		--mid: var(--brain-teal);
		--deep: var(--brain-teal-deep);
	}
	[data-tone='db'],
	[data-tone='runtimes'] {
		--light: var(--brain-terracotta-light);
		--mid: var(--brain-terracotta);
		--deep: var(--brain-terracotta-deep);
	}
	[data-tone='peer'],
	[data-tone='sandbox'] {
		--light: var(--brain-conifer-light);
		--mid: var(--brain-conifer);
		--deep: var(--brain-conifer-deep);
	}
	[data-tone='os'] {
		--light: var(--brain-glass);
		--mid: var(--brain-glass-deep);
		--deep: var(--brain-teal-deep);
	}
	[data-tone='architecture'] {
		--light: var(--brain-sage-light);
		--mid: var(--brain-sage);
		--deep: var(--brain-conifer);
	}

	/* a page with its index: the index on the left, the page centred, a matching gutter on the right */
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

	.index {
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

	.index summary {
		display: none;
		cursor: pointer;
	}

	.index-head {
		margin: 0 0 8px;
		color: var(--brain-quiet);
		font: 600 11px/1.3 var(--brain-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.index ol,
	.index ul {
		display: grid;
		gap: 2px;
		margin: 0 0 24px;
		padding: 0;
		list-style: none;
	}

	.index ol.numbered {
		counter-reset: slide;
	}

	.index ol.numbered li {
		counter-increment: slide;
	}

	.index a {
		display: flex;
		gap: 8px;
		padding: 5px 10px;
		color: var(--brain-ink);
		line-height: 1.35;
		text-decoration: none;
		border-radius: 8px;
	}

	.index ol.numbered a::before {
		content: counter(slide);
		min-width: 1.2em;
		color: var(--brain-quiet);
		font-variant-numeric: tabular-nums;
	}

	.index a:hover {
		background: var(--brain-facet);
	}

	.index a[aria-current] {
		background: var(--brain-plot);
		box-shadow: inset 3px 0 0 var(--brain-path);
	}

	/* narrower than both columns: the index is a folded list above the page */
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

		.index {
			position: static;
			justify-self: stretch;
			width: auto;
			max-height: none;
			padding: 20px 0 0;
		}

		.index details {
			padding: 10px 14px;
			background: var(--brain-panel);
			border: 1px solid var(--brain-gold);
			border-radius: var(--brain-radius);
		}

		.index summary {
			display: list-item;
			font: 600 12px/1.6 var(--brain-sans);
			letter-spacing: 0.12em;
			text-transform: uppercase;
		}

		.index details[open] summary {
			margin-bottom: 10px;
		}
	}

	.slide-page {
		margin: 40px 0 0;
		scroll-margin-top: 16px;
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

	.prose :global(h1) {
		margin: 6px 0 12px;
	}

	.prose :global(h2) {
		margin: 36px 0 10px;
		font: 500 26px/1.2 var(--brain-serif);
	}

	.prose :global(h3) {
		margin: 24px 0 8px;
		font: 500 20px/1.25 var(--brain-serif);
	}

	.prose :global(a) {
		color: var(--brain-teal-deep);
		text-decoration-color: var(--brain-gold);
		text-underline-offset: 3px;
	}

	.prose :global(code) {
		padding: 1px 5px;
		font-size: 0.88em;
		background: var(--brain-facet);
		border-radius: 5px;
	}

	.prose :global(li) {
		margin: 6px 0;
		padding: 2px 8px;
		border-radius: 8px;
		scroll-margin-top: 80px;
	}

	.prose :global(li.here) {
		background: var(--brain-plot);
		box-shadow: inset 3px 0 0 var(--brain-path);
	}

	.prose :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 14px;
	}

	.prose :global(th),
	.prose :global(td) {
		padding: 6px 10px;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--brain-facet-deep);
	}

	.prose :global(th) {
		font: 600 12px/1.3 var(--brain-sans);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border-bottom-color: var(--brain-gold);
	}

	.prose :global(blockquote) {
		margin: 16px 0;
		padding: 2px 16px;
		border-left: 3px solid var(--brain-gold);
	}
</style>
