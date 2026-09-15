<script lang="ts">
	import { categoryById } from './categories';
	import type { InspirationMeta } from './types';

	let { entry, shape = 'card' }: { entry: InspirationMeta; shape?: 'card' | 'arch' } = $props();

	const colors = $derived(entry.categories.map((id) => categoryById(id).color));
</script>

<div
	class="art {shape}"
	style:--a={colors[0] ?? 'var(--sand, #dccfae)'}
	style:--b={colors[1] ?? 'var(--mustard)'}
	aria-hidden="true"
>
	{#if entry.youtubeId}
		<img src="https://i.ytimg.com/vi/{entry.youtubeId}/hq720.jpg" alt="" loading="lazy" />
	{:else}
		<span class="orb one"></span>
		<span class="orb two"></span>
	{/if}
</div>

<style>
	.art {
		position: relative;
		overflow: hidden;
		background: var(--a);
	}

	.card {
		aspect-ratio: 16 / 9;
		border-radius: var(--radius) var(--radius) 0 0;
	}

	.arch {
		aspect-ratio: 5 / 6;
		border-radius: 999px 999px var(--radius) var(--radius);
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.orb {
		position: absolute;
		aspect-ratio: 1;
		border-radius: 50%;
	}

	.one {
		width: 75%;
		right: -20%;
		bottom: -45%;
		background: var(--b);
	}

	.two {
		width: 40%;
		left: 10%;
		top: 15%;
		background: rgb(250 248 242 / 0.4);
	}
</style>
