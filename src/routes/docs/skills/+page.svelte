<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// The skills, one item of the Docs page (Samuel 2026-10-18: "all skills combined are just one docs item"), read in
	// the layout every avenDB view has ($lib/avendb/Frame.svelte): on the left every skill, with a search; in the middle
	// the one picked, as its doc post gives it; on the right its details, its files and its outline. Each skill is a
	// story of the Maia City vault with its doc post ($lib/avendb/docs.js), so what shows here is what avenDB holds.
	// ?s=<skill> opens one.
	import { onMount, tick } from 'svelte';
	import { base } from '$app/paths';
	import Frame from '$lib/avendb/Frame.svelte';
	import Icon from '$lib/avendb/Icon.svelte';
	import { render } from '$lib/avendb/article.js';
	import { ago, isDoc, postHref } from '$lib/universe/posts.js';
	import { loadFeed, stream } from '$lib/universe/stream.svelte.js';

	/** a skill post's folder name, from its tag `doc:skill/<name>` */
	const slugOf = (p) => (p.tags.find((t) => t.startsWith('doc:skill/')) ?? '').slice('doc:skill/'.length);
	const skills = $derived(stream.posts.filter((p) => isDoc(p) && slugOf(p)).sort((a, b) => slugOf(a).localeCompare(slugOf(b))));

	let picked = $state('');
	let query = $state('');
	let open = $state('');
	let article = $state();

	const shown = $derived(skills.filter((p) => !query.trim() || `${slugOf(p)} ${p.text}`.toLowerCase().includes(query.trim().toLowerCase())));
	const skill = $derived(skills.find((p) => slugOf(p) === picked) ?? skills[0]);
	const html = $derived(skill ? render(skill.md.replace(/^\s*# .+\n+/, ''), () => '') : '');
	// its first paragraph, which says what it is for
	const about = $derived(skill ? (skill.md.split(/\n\s*\n/).find((b) => b.trim() && !/^[#>|`-]/.test(b.trim())) ?? '').trim() : '');
	// the files it is written in: SKILL.md, then each one a line `*path*` heads ($lib/avendb/docs.js `readable`)
	const files = $derived(skill ? ['SKILL.md', ...[...skill.md.matchAll(/^---\n\n\*([^*\n]+\.md)\*$/gm)].map((m) => m[1])] : []);
	const outline = $derived(skill ? [...skill.md.matchAll(/^(#{2,3}) (.+)$/gm)].map((m) => ({ deep: m[1].length === 3, text: m[2].replace(/[*`]/g, '') })) : []);
	const words = $derived(skill ? skill.md.split(/\s+/).filter(Boolean).length : 0);

	function pick(name) {
		picked = name;
		history.pushState(null, '', `?s=${name}`);
		tick().then(() => article?.closest('.middle')?.scrollTo({ top: 0 }));
	}
	/** a heading of the outline, by its place among the article's headings, scrolled to */
	function goTo(i) {
		article?.querySelectorAll('h2, h3')[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		open = '';
	}
	const fromUrl = () => (picked = new URLSearchParams(location.search).get('s') ?? '');
	onMount(() => {
		fromUrl();
		if (stream.feed === 'idle') loadFeed();
		addEventListener('popstate', fromUrl);
		return () => removeEventListener('popstate', fromUrl);
	});
</script>

<svelte:head>
	<title>{skill ? `${slugOf(skill)} · ` : ''}Skills · Docs · maiaCITY</title>
	<meta name="description" content="What our agents know and follow, one skill each, written in the Maia City vault and versioned in avenDB." />
</svelte:head>

<main class="wrap">
	<a class="back" href="{base}/docs/">← Docs</a>
	<div class="viewer">
		<Frame bind:open navLabel="Every skill" asideLabel="Its files and outline" navIcon="library" asideIcon="info">
			{#snippet nav()}
				<p class="nav-group">Skills</p>
				<input class="nav-search" type="search" placeholder="Search the skills…" bind:value={query} />
				{#each shown as p (p.entry)}
					<button class="nav-item" class:on={p === skill} aria-current={p === skill ? 'page' : undefined} data-pick onclick={() => pick(slugOf(p))}>
						<Icon name="article" size={15} /><span>{slugOf(p)}</span>
					</button>
				{:else}
					<p class="soft">{skills.length ? 'No skill has those words.' : ''}</p>
				{/each}
			{/snippet}

			{#if skill}
				<article class="skill" bind:this={article}>
					<p class="eyebrow">Skill · in avenDB</p>
					<h1>{slugOf(skill)}</h1>
					<div class="body">{@html html}</div>
				</article>
			{:else}
				<p class="soft">
					{stream.feed === 'failed' ? 'avenDB can’t be reached right now.' : stream.feed === 'done' ? 'No skill is published yet.' : 'Loading the skills from avenDB…'}
				</p>
			{/if}

			{#snippet aside()}
				{#if skill}
					<p class="nav-group">About</p>
					<p class="about">{about.replace(/[*`]/g, '')}</p>
					<dl>
						<dt>Owner</dt><dd>Maia City COOP</dd>
						<dt>Kept in</dt><dd>avenDB, versioned</dd>
						{#if skill.ago != null}<dt>Updated</dt><dd>{skill.ago === 0 ? 'now' : ago(skill.ago)}</dd>{/if}
						<dt>Length</dt><dd>{words.toLocaleString('en')} words</dd>
					</dl>
					<a class="post" href={postHref(base, skill)}>Open as a post</a>
					<p class="nav-group">Files</p>
					<ul class="files">
						{#each files as f (f)}<li>{f}</li>{/each}
					</ul>
					{#if outline.length}
						<p class="nav-group">Outline</p>
						<ul class="outline">
							{#each outline as h, i (i)}
								<li class:deep={h.deep}><button onclick={() => goTo(i)}>{h.text}</button></li>
							{/each}
						</ul>
					{/if}
				{/if}
			{/snippet}
		</Frame>
	</div>
</main>

<style>
	main {
		padding-block: 1.5rem 3rem;
	}
	.back {
		display: inline-block;
		margin-bottom: 0.9rem;
		color: var(--ink-soft);
		text-decoration: none;
		font-size: 0.9rem;
	}
	/* the frame's columns scroll on their own inside a box as tall as the screen under the site's header */
	.viewer {
		--soft: rgb(0 0 0 / 0.55);
		--edge: rgb(0 0 0 / 0.1);
		--accent: #2f6d62;
		height: calc(100dvh - 9.5rem);
		min-height: 28rem;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--paper);
	}
	.skill h1 {
		margin: 0.4rem 0 1.2rem;
		font-size: clamp(2.2rem, 5vw, 3.4rem);
		overflow-wrap: anywhere;
	}
	.body {
		max-width: 46rem;
		line-height: 1.6;
	}
	.body :global(pre) {
		overflow-x: auto;
		padding: 0.8rem 1rem;
		border-radius: 10px;
		background: var(--cream);
		font-size: 0.85rem;
	}
	.body :global(table) {
		display: block;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	.body :global(th),
	.body :global(td) {
		padding: 0.35rem 0.6rem;
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: top;
	}
	.body :global(hr) {
		margin: 2.5rem 0 1rem;
		border: 0;
		border-top: 1px solid var(--line);
	}
	.soft {
		padding: 0 0.6rem;
		color: var(--ink-soft);
		font-size: 0.9rem;
	}
	.about {
		margin: 0 0 0.8rem;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--ink-soft);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.3rem 0.9rem;
		margin: 0 0 1rem;
		font-size: 0.85rem;
	}
	dt {
		color: var(--soft);
	}
	dd {
		margin: 0;
	}
	.post {
		display: inline-block;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		background: var(--brand-green);
		color: var(--cream);
		font-size: 0.85rem;
		text-decoration: none;
	}
	.files,
	.outline {
		margin: 0;
		padding: 0 0.6rem;
		list-style: none;
		font-size: 0.85rem;
	}
	.files li {
		padding: 0.2rem 0;
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}
	.outline button {
		padding: 0.25rem 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.outline button:hover {
		color: var(--accent);
	}
	.outline .deep {
		padding-left: 0.9rem;
		color: var(--ink-soft);
	}
	@media (max-width: 760px) {
		main {
			padding-block: 1rem 1.5rem;
		}
		.viewer {
			height: calc(100dvh - 8rem);
		}
	}
</style>
