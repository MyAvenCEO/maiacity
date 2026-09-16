<script lang="ts">
	import type { LegalBlock } from '$lib/legal';

	let { data } = $props();
	const doc = $derived(data.doc);

	const isList = (b: LegalBlock): b is { items: string[] } => 'items' in b;

	// bare URLs in a line become links, as on aven.ceo
	const URL_RE = /(https?:\/\/[\w-]+(?:\.[\w-]+)+[^\s„“”"'<>]*[\w/])/g;
	const parts = (line: string) =>
		line
			.split(URL_RE)
			.filter((p) => p !== '')
			.map((p) => (/^https?:\/\//.test(p) ? { text: p, href: p } : { text: p }));
</script>

<svelte:head>
	<title>{doc.title.replaceAll('­', '')} · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet line(text: string)}
	{#each parts(text) as p}
		{#if p.href}<a href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>{:else}{p.text}{/if}
	{/each}
{/snippet}

<main class="wrap">
	<article lang={doc.lang}>
		<p class="eyebrow">{doc.lang === 'de' ? 'Rechtliches' : 'Legal'}</p>
		<h1>{doc.title}</h1>

		{#each doc.sections as section}
			{#if section.title}
				<svelte:element this={`h${section.level ?? 2}`}>{section.title}</svelte:element>
			{/if}
			{#each section.blocks as block}
				{#if isList(block)}
					<ul>
						{#each block.items as item}<li>{@render line(item)}</li>{/each}
					</ul>
				{:else}
					<p>
						{#if block.lead}<strong>{block.lead}</strong><br />{/if}
						{#each block.lines as l, i}{#if i > 0}<br />{/if}{@render line(l)}{/each}
					</p>
				{/if}
			{/each}
		{/each}
	</article>
</main>

<style>
	main {
		padding-block: 3rem 4rem;
	}

	article {
		max-width: 44rem;
		margin: 0 auto;
		overflow-wrap: anywhere;
	}

	h1 {
		margin: 0.75rem 0 2rem;
		font-size: clamp(2.2rem, 5vw, 3.2rem);
	}

	article :global(h2) {
		margin: 2.5rem 0 0.75rem;
		padding-bottom: 0.4rem;
		border-bottom: 1px solid var(--line);
		font-size: 1.4rem;
	}

	article :global(h3),
	article :global(h4),
	article :global(h5) {
		margin: 1.75rem 0 0.5rem;
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: 0;
	}

	p,
	ul {
		margin: 0.75rem 0 0;
		line-height: 1.65;
		color: var(--ink-soft);
	}

	ul {
		padding-left: 1.2rem;
	}

	strong {
		color: var(--ink);
	}

	a {
		text-decoration-color: var(--line);
		text-underline-offset: 3px;
	}
</style>
