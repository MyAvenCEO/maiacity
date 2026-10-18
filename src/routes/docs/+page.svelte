<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { isDoc } from '$lib/universe/posts.js';
	import { loadFeed, stream } from '$lib/universe/stream.svelte.js';

	// Every document is a story of the Maia City vault, owned by the Maia City COOP and versioned in avenDB, and its doc
	// post, which everyone reads ($lib/avendb/docs.js). The two with live figures keep their own pages, one tile each
	// here; the skills, all of them one tile, open in their own viewer (./skills).
	const docs = [
		{
			href: `${base}/docs/avendb`,
			kind: 'Architecture',
			title: 'avenDB',
			text: 'The user-owned, local-first, post-quantum database under maiaCITY: what the server can and cannot see, vaults, CRDT entries with history, shares, schemas and lenses, sync between your devices, and terabytes of media backed up to a sealed bucket.',
			updated: '13 October 2026',
			tags: ['local-first', 'CRDT', 'iroh', 'post-quantum']
		},
		{
			href: `${base}/theos`,
			art: 'theos',
			kind: 'Paper',
			title: 'theOS',
			text: 'The civilization scale operating system of Abundism: a macroeconomic and system-engineering framework for a post-labour economy, with HEARTS as the unit of account, liquidity owned by the City COOP, and a floor where no one starves and no one has to work to survive.',
			updated: '17 October 2026',
			tags: ['economics', 'HEARTS', 'COOP', 'post-labour']
		},
		{
			href: `${base}/docs/skills`,
			art: 'skills',
			kind: 'Skills',
			title: 'Skills',
			text: 'What our agents know and follow, one skill each: the film crew, the asset producers, iroh and more, written in the Maia City vault, versioned in avenDB, and read here by everyone.',
			tags: ['agents', 'film crew', 'assets', 'how we work']
		}
	];

	onMount(() => {
		if (stream.feed === 'idle') loadFeed();
	});

	/** the doc posts everyone reads, by the section of each */
	const docPosts = $derived(stream.posts.filter(isDoc));
	const skillCount = $derived(docPosts.filter((p) => p.tags.some((t) => t.startsWith('doc:skill/'))).length);
	const inVault = (slug) =>
		slug === 'skills' ? skillCount > 0 : docPosts.some((p) => p.md && p.tags.includes(`doc:${slug === 'theos' ? 'paper' : 'docs'}/${slug}`));
</script>

<svelte:head>
	<title>Docs · maiaCITY</title>
	<meta name="description" content="How maiaCITY is built: the architecture documents behind it." />
</svelte:head>

<main class="wrap">
	<section class="intro">
		<p class="eyebrow">How it is built</p>
		<h1>Docs</h1>
		<p class="lede">The architecture behind maiaCITY, written down as it is built and kept up to date as it changes.</p>
	</section>

	<ul class="grid">
		{#each docs as doc (doc.href)}
			<li>
				<a href={doc.href}>
					<div class="art" aria-hidden="true">
						{#if doc.art === 'theos'}
							<!-- one COOP at the centre, a heart (HEARTS) inside, its members around it, each linked in -->
							<svg viewBox="0 0 240 120">
								<path class="ctl" d="M120 60 L70 30 M120 60 L170 30 M120 60 L70 90 M120 60 L170 90 M120 60 L40 60 M120 60 L200 60" />
								<circle class="dev" cx="70" cy="30" r="11" />
									<circle class="dev" cx="170" cy="30" r="11" />
									<circle class="dev" cx="70" cy="90" r="11" />
									<circle class="dev" cx="170" cy="90" r="11" />
									<circle class="dev" cx="40" cy="60" r="11" />
									<circle class="dev" cx="200" cy="60" r="11" />
									<circle class="bkt" cx="120" cy="60" r="24" />
									<path class="heart" d="M120 71 C104 61 108 49 115 49 C118 49 120 52 120 54 C120 52 122 49 125 49 C132 49 136 61 120 71 Z" />
								</svg>
							{:else if doc.art === 'skills'}
							<!-- a list of skills on the left, the one picked open beside it -->
							<svg viewBox="0 0 240 120">
								<rect class="dev" x="30" y="14" width="56" height="92" rx="8" />
								<path class="ctl" d="M40 32 H76 M40 48 H70 M40 80 H72 M40 96 H66" />
								<rect class="srv" x="36" y="57" width="44" height="14" rx="4" />
								<rect class="bkt" x="98" y="14" width="112" height="92" rx="8" />
								<path class="ctl" d="M112 34 H170 M112 52 H196 M112 66 H190 M112 80 H196 M112 94 H160" />
							</svg>
							{:else}
						<svg viewBox="0 0 240 120">
							<rect class="dev" x="14" y="16" width="70" height="40" rx="9" />
							<rect class="dev" x="14" y="68" width="70" height="40" rx="9" />
							<rect class="srv" x="112" y="34" width="56" height="56" rx="10" />
							<path class="bkt" d="M190 40 v44 a20 6 0 0 0 40 0 v-44" />
							<ellipse class="bkt" cx="210" cy="40" rx="20" ry="6" />
							<path class="ctl" d="M84 36 L112 52 M84 88 L112 72 M49 56 V68" />
							<path class="bytes" d="M168 62 H190" />
						</svg>
						{/if}
					</div>
					<p class="eyebrow">
						{doc.kind}{#if doc.updated}&ensp;·&ensp;updated {doc.updated}{/if}{#if doc.art === 'skills' && skillCount}&ensp;·&ensp;{skillCount} skills{/if}{#if inVault(doc.href.split('/').filter(Boolean).at(-1))}&ensp;·&ensp;in avenDB{/if}
					</p>
					<h2>{doc.title}</h2>
					<p class="text">{doc.text}</p>
					<ul class="tag-list">
						{#each doc.tags as tag (tag)}
							<li>{tag}</li>
						{/each}
					</ul>
				</a>
			</li>
		{/each}
	</ul>

</main>

<style>
	main {
		padding-block: 4rem 6rem;
	}
	h1 {
		margin-top: 0.75rem;
		font-size: clamp(3.5rem, 9vw, 6.5rem);
	}
	.lede {
		max-width: 46ch;
		margin: 1.25rem 0 0;
		font-size: 1.15rem;
		color: var(--ink-soft);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
		gap: 1.5rem;
		margin: 3rem 0 0;
		padding: 3rem 0 0;
		border-top: 1px solid var(--line);
		list-style: none;
	}
	.grid a {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		height: 100%;
		padding: 1.25rem;
		border-radius: var(--radius);
		background: var(--paper);
		text-decoration: none;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}
	.grid a:hover {
		transform: translateY(-3px);
		box-shadow: 0 14px 34px rgb(38 56 44 / 0.1);
	}
	.grid a:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 3px;
	}
	.art {
		aspect-ratio: 2 / 1;
		border-radius: calc(var(--radius) - 8px);
		background: var(--cream);
		display: grid;
		place-items: center;
		padding: 1rem;
		margin-bottom: 0.25rem;
	}
	.art svg {
		width: 100%;
		height: 100%;
	}
	.dev {
		fill: color-mix(in srgb, var(--sage) 35%, var(--paper));
		stroke: var(--ink);
		stroke-width: 1.5;
	}
	.srv {
		fill: color-mix(in srgb, var(--sage) 60%, var(--paper));
		stroke: var(--ink);
		stroke-width: 2;
	}
	.bkt {
		fill: color-mix(in srgb, var(--mustard) 45%, var(--paper));
		stroke: var(--ink);
		stroke-width: 1.5;
	}
	.ctl {
		stroke: var(--ink);
		stroke-width: 2;
		fill: none;
	}
	.bytes {
		stroke: var(--terracotta);
		stroke-width: 5;
		stroke-linecap: round;
	}
	.heart {
		fill: var(--terracotta);
	}
	h2 {
		font-size: clamp(1.9rem, 3vw, 2.4rem);
	}
	.text {
		flex: 1;
		margin: 0;
		color: var(--ink-soft);
	}
	.tag-list li {
		background: color-mix(in srgb, var(--sage) 40%, var(--paper));
	}
</style>
