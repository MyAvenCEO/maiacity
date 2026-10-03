<!--
	Where a story is, once it is out: its main link (the film on YouTube, or the article), and each post's own link on
	its platform — typed in, or filled by the upload step (Zernio's platformPostUrl).
-->
<script>
	import ChannelGlyph from '$lib/admin/ChannelGlyph.svelte';
	import { dateLabel, postLabel } from '$lib/admin/board';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */

	/** @type {{ item: ContentItem, onchange: (patch: Partial<ContentItem>) => void }} */
	let { item, onchange } = $props();

	const posts = $derived(item.posts ?? []);
	/** @param {number} k @param {string} url */
	const setUrl = (k, url) => onchange({ posts: posts.map((p, i) => (i === k ? { ...p, url: url.trim() || undefined } : p)) });
</script>

<div class="out">
	<label class="main">
		<span>The link</span>
		<div class="row">
			<input type="url" value={item.link ?? ''} placeholder="https://www.youtube.com/watch?v=…" onchange={(e) => onchange({ link: e.currentTarget.value.trim() || null })} />
			{#if item.link}<a href={item.link} target="_blank" rel="noopener">Open ↗</a>{/if}
		</div>
	</label>

	{#if posts.length}
		<ul class="posts">
			{#each posts as p, k (k)}
				{@const when = p.scheduled_at ?? item.scheduled_at}
				<li>
					<p class="where"><ChannelGlyph platform={p.platform} /> <b>{postLabel(p)}</b>{#if when}<small>{dateLabel(when)}</small>{/if}</p>
					<div class="row">
						<input type="url" value={p.url ?? ''} placeholder="Its link, once it is out" aria-label="{postLabel(p)}: its link" onchange={(e) => setUrl(k, e.currentTarget.value)} />
						{#if p.url}<a href={p.url} target="_blank" rel="noopener">Open ↗</a>{/if}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">No posts: only the main link.</p>
	{/if}
</div>

<style>
	.out {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
		max-width: 48rem;
	}

	.main > span {
		display: block;
		margin-bottom: 0.3rem;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
		font: inherit;
		font-size: 0.9rem;
		color: var(--ink);
	}

	a {
		font-size: 0.82rem;
		white-space: nowrap;
		color: var(--terracotta);
	}

	.posts {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.where {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.3rem;
		font-size: 0.85rem;
	}

	.where small {
		margin-left: 0.4rem;
		color: var(--muted);
	}

	.empty {
		margin: 0;
		font-size: 0.9rem;
		color: var(--muted);
	}
</style>
