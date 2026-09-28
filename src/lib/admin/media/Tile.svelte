<!--
	One file in the grid: its picture (a video's first frame, a made-up waveform for a sound), what it is and how it
	is cut. Never its path — a path is only a name.
-->
<script lang="ts">
	import type { MediaItem } from '$lib/auth/client';
	import { bars, first, label, raw, sub, thumb, type Parsed } from './facets';

	let { m, p, onopen }: { m: MediaItem; p: Parsed; onopen: () => void } = $props();

	const role = $derived(first(p, 'role'));

	// a video loads only once it scrolls near — a day can hold a hundred shots — and shows a frame a tenth of the way in
	// (at most 5 s): a film's very start is often black (a fade up, a cold open)
	function lazy(src: string) {
		return (node: HTMLVideoElement) => {
			const io = new IntersectionObserver(
				([e]) => {
					if (!e?.isIntersecting) return;
					node.addEventListener('loadedmetadata', () => (node.currentTime = Math.min(5, (node.duration || 0) * 0.1)), { once: true });
					node.src = src;
					io.disconnect();
				},
				{ rootMargin: '300px' }
			);
			io.observe(node);
			return () => io.disconnect();
		};
	}
	let video = $state<HTMLVideoElement | null>(null);
</script>

<button
	class="tile"
	class:old={p.superseded}
	onclick={onopen}
	onmouseenter={() => video?.play().catch(() => {})}
	onmouseleave={() => video?.pause()}
	title={label(m, p)}
>
	<span class="pic" class:sound={m.kind === 'audio'} class:clear={/png|webp|gif/.test(m.mime)}>
		{#if m.kind === 'image'}
			<img src={thumb(m)} alt="" loading="lazy" draggable="false" />
		{:else if m.kind === 'video'}
			<video bind:this={video} {@attach lazy(raw(m.cid))} crossorigin="use-credentials" preload="metadata" muted playsinline loop></video>
			<span class="play" aria-hidden="true">▶</span>
		{:else if m.kind === 'audio'}
			<span class="wave" aria-hidden="true">
				{#each bars(m.cid) as h, i (i)}<i style:height="{h * 100}%"></i>{/each}
			</span>
		{:else}
			<span class="glyph" aria-hidden="true">▤</span>
		{/if}
		{#if role}<span class="role">{role}</span>{/if}
		{#if p.superseded}<span class="role old">superseded</span>{/if}
	</span>
	<span class="text">
		<span class="nm">{label(m, p)}</span>
		<span class="sub">{sub(m, p)}</span>
	</span>
</button>

<style>
	.tile {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
		background: var(--paper);
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
		transition: transform 0.15s ease, box-shadow 0.15s ease;
	}

	.tile:hover,
	.tile:focus-visible {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgb(38 56 44 / 0.12);
	}

	/* an earlier version, kept: there, but quieter */
	.tile.old {
		opacity: 0.55;
	}

	.pic {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 10;
		overflow: hidden;
		background: var(--cream);
	}

	/* every tile the same shape: the picture pinned inside it, so a tall one cannot stretch the tile */
	.pic img,
	.pic video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* transparent parts (a hook layer) on a checkerboard, shown whole */
	.pic.clear {
		background: repeating-conic-gradient(#3b413c 0 25%, #2d322e 0 50%) 0 0 / 16px 16px;
	}

	.pic.clear img {
		object-fit: contain;
	}

	.play {
		position: absolute;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: rgb(38 56 44 / 0.65);
		color: var(--paper);
		font-size: 0.75rem;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}

	.tile:hover .play {
		opacity: 0;
	}

	.wave {
		display: flex;
		align-items: center;
		gap: 2px;
		width: 78%;
		height: 46%;
	}

	.wave i {
		flex: 1;
		border-radius: 2px;
		background: var(--sage);
	}

	.tile:hover .wave i {
		background: var(--mustard);
	}

	.glyph {
		font-size: 2rem;
		color: var(--muted);
	}

	.role {
		position: absolute;
		top: 0.4rem;
		left: 0.4rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.88);
		font-size: 0.66rem;
		color: var(--ink-soft);
	}

	.role.old {
		left: auto;
		right: 0.4rem;
		color: #9c3b26;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		padding: 0.5rem 0.65rem 0.6rem;
	}

	.nm,
	.sub {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.nm {
		font-size: 0.82rem;
		font-weight: 500;
	}

	.sub {
		font-size: 0.72rem;
		color: var(--muted);
	}
</style>
