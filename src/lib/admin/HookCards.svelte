<!--
	A card's hook: its title cards, nothing else — the thumbnail in each ratio it goes out in (16:9, 1:1, 9:16, 5:2),
	side by side at one height. A ratio not rendered yet shows as an empty frame. Read only: the cards are rendered in
	the repo (scripts/film/thumbnail.mjs) and pushed with the day.
-->
<script lang="ts">
	import { API, fileUrl, type Delivery } from '$lib/auth/client';

	let { deliveries = [] }: { deliveries?: Delivery[] } = $props();

	const raw = (hash: string) => fileUrl(hash);
	const RATIOS = ['16:9', '1:1', '9:16', '5:2'];
	// one card per ratio (a render delivers the same card with each cut): the day's own first
	const cardOf = (aspect: string) =>
		deliveries
			.filter((d) => d.kind === 'thumbnail' && d.aspect === aspect)
			.sort((a, b) => Number(b.timeline === 'day') - Number(a.timeline === 'day'))[0];
</script>

<div class="cards">
	{#each RATIOS as r (r)}
		{@const c = cardOf(r)}
		<figure>
			<div class="pic" class:none={!c} style:aspect-ratio={r.replace(':', ' / ')}>
				{#if c}<img src={raw(c.hash)} alt="" loading="lazy" />{/if}
			</div>
			<figcaption>{r}</figcaption>
		</figure>
	{/each}
</div>

<style>
	.cards {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 1rem;
	}

	figure {
		margin: 0;
	}

	/* every ratio at one height, so the shapes read side by side */
	.pic {
		height: 260px;
		overflow: hidden;
		border-radius: 8px;
		background: #1c211e;
	}

	.pic.none {
		border: 1px dashed var(--line, #e3ddd0);
		background: none;
	}

	.pic img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	figcaption {
		margin-top: 0.35rem;
		font-size: 0.78rem;
		color: var(--ink-soft);
	}

	@media (max-width: 900px) {
		.pic {
			height: 160px;
		}
	}
</style>
