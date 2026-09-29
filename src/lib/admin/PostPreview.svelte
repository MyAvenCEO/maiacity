<!--
	How a day's posts will look once they are out: every post derived from the base article, simulated on its platform,
	read only, one stream from top to bottom in the order they go out — each with its time, the launch minute marked.

	The posts are prepared elsewhere (from the article, by the content-derivatives step); here they are only shown the
	way each platform lays them out, each labelled with where and when it goes out. A video is matched to the file it
	uploads by shape and codec, preferring the file rendered from its own cut.
-->
<script lang="ts">
	import { API, fileUrl, type Delivery, type Post } from '$lib/auth/client';
	import ChannelGlyph from './ChannelGlyph.svelte';
	import PostCard from './PostCard.svelte';
	import { PLATFORMS, postLabel } from './board';

	const raw = (hash: string) => fileUrl(hash);

	let {
		posts,
		deliveries,
		article = '',
		when = null,
		image = raw,
		layout = 'stream'
	}: {
		posts: Post[];
		deliveries: Delivery[];
		/** the base article (Markdown), which the journal post publishes */
		article?: string;
		/** when the item goes out, for a post without its own time */
		when?: string | null;
		/** an image's address */
		image?: (hash: string) => string;
		/** one column in the order they go out, or two by two (the Derivatives step) */
		layout?: 'stream' | 'grid';
	} = $props();

	// one stream, in the order it all goes out: by time, then platform
	const sorted = $derived(
		[...posts].sort(
			(a, b) =>
				(a.scheduled_at ?? when ?? '').localeCompare(b.scheduled_at ?? when ?? '') ||
				PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform)
		)
	);
	const at = (p: Post) => p.scheduled_at ?? when;
	// the launch: a minute when several platforms go out together
	const count = $derived(sorted.reduce((m, p) => m.set(at(p) ?? '', (m.get(at(p) ?? '') ?? 0) + 1), new Map<string, number>()));
	const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '–');
	const dayOf = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : 'No date yet';
</script>

{#if sorted.length}
	<ol class="stream" class:grid={layout === 'grid'}>
		{#each sorted as p, i (i)}
			{@const t = at(p)}
			{@const launch = (count.get(t ?? '') ?? 0) > 1}
			{#if layout === 'stream' && (i === 0 || dayOf(t) !== dayOf(at(sorted[i - 1]!)))}<li class="day">{dayOf(t)}</li>{/if}
			<li class="one" class:launch>
				<div class="when">
					<span class="t">{clock(t)}</span>
					{#if launch}<span class="tag">launch</span>{/if}
				</div>
				<div class="post">
					<p class="where">
						<ChannelGlyph platform={p.platform} />
						<b>{postLabel(p)}</b>
					</p>
					<PostCard post={p} {deliveries} {article} when={t} {image} />
				</div>
			</li>
		{/each}
	</ol>
{/if}

<style>
	/* one column, top to bottom: each post's time, then the post as its platform shows it */
	.stream {
		display: grid;
		gap: 1.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.day {
		width: 100%;
		max-width: 40rem;
		margin-inline: auto;
		margin-top: 0.4rem;
		padding-bottom: 0.35rem;
		border-bottom: 1px solid var(--line, #e3ddd0);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	/* one column at every width: the time on top, the post under it */
	.one {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		width: 100%;
		max-width: 40rem;
		margin-inline: auto;
	}

	.when {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.t {
		font-size: 1.05rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.tag {
		align-self: start;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: #f3e3c1;
		font-size: 0.7rem;
		font-weight: 600;
		color: #7a5a1c;
	}

	.one.launch .post {
		padding-left: 0.9rem;
		border-left: 3px solid #e3b35c;
	}

	.post {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
		/* a preview is as wide as its platform shows it, not the whole modal */
		max-width: 38rem;
	}

	.where {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		font-size: 0.8rem;
		color: var(--ink-soft);
	}

	.where b {
		font-weight: 600;
		color: var(--ink);
	}

	/* two by two: the Derivatives step */
	.stream.grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-items: start;
		gap: 2rem 1.6rem;
	}

	.stream.grid .one {
		max-width: none;
	}

	.stream.grid .one.launch .post {
		padding-left: 0;
		border-left: 0;
	}

	@media (max-width: 900px) {
		.stream.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
