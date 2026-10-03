<!--
	A story's idea: the brainstorm pad — links, concepts, fragments, the pairs to try — written as Markdown, nothing in
	it decided yet. Every link in it is gathered above, to open in one click.
-->
<script>
	import Pad from './Pad.svelte';
	import { linksIn } from './stories.js';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */

	/** @type {{ item: ContentItem, onchange: (patch: Partial<ContentItem>) => void }} */
	let { item, onchange } = $props();

	const links = $derived(linksIn(item.idea ?? ''));
</script>

<div class="idea">
	{#if links.length}
		<ul class="links" aria-label="The links in the pad">
			{#each links as l (l.url)}
				<li><a href={l.url} target="_blank" rel="noopener" title={l.url}><b>{l.host}</b>{#if l.label}<span>{l.label}</span>{/if}</a></li>
			{/each}
		</ul>
	{/if}
	<Pad
		label="The idea pad, in Markdown"
		value={item.idea ?? ''}
		onchange={(idea) => onchange({ idea })}
		placeholder={'# The idea\n\nLinks, concepts, fragments: anything. Nothing here is decided yet.\n\n- https://…\n- a scene\n- a question'}
	/>
</div>

<style>
	.idea {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.links a {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		max-width: 22rem;
		padding: 0.3rem 0.7rem;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		font-size: 0.78rem;
		white-space: nowrap;
		text-decoration: none;
		color: var(--ink);
	}

	.links a:hover {
		border-color: var(--mustard);
	}

	.links span {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--muted);
	}
</style>
