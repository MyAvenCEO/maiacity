<!--
	One file, large, in the place of the grid: a picture fit to the room, a video or a sound to play. A voice take
	shows its words, and lights each one as it is spoken when the take knows its timings. The keys (← → Esc) are the
	page's; the buttons here do the same.
-->
<script lang="ts">
	import type { MediaItem } from './facets';
	import { label, raw, sub, thumb, type Parsed } from './facets';
	import Video709 from './Video709.svelte';
	import { captionWordsOf } from '$lib/studio/transcript.js';

	type Measure = { w?: number; h?: number; d?: number };
	type Word = { word: string; start: number; end: number };

	let {
		m,
		p,
		index,
		total,
		onprev,
		onnext,
		onback,
		onmeasure
	}: {
		m: MediaItem;
		p: Parsed;
		/** where it sits in the list on screen, or -1 when the filters no longer hold it */
		index: number;
		total: number;
		onprev: () => void;
		onnext: () => void;
		onback: () => void;
		onmeasure: (hash: string, got: Measure) => void;
	} = $props();

	let time = $state(0);
	// its words as the captions read them: the transcript (the one truth), else a voice take's own timing
	const words = $derived(captionWordsOf(m as never) as Word[]);
	const said = $derived(typeof m.meta?.text === 'string' ? m.meta.text : '');
</script>

<section class="viewer" aria-label={label(m, p)}>
	<header>
		<button class="ghost" onclick={onback} title="Esc">← Back to the grid</button>
		<span class="title">
			<b>{label(m, p)}</b>
			<span>{sub(m, p)}</span>
		</span>
		<span class="step">
			<button class="ghost" onclick={onprev} disabled={index <= 0} aria-label="Previous" title="←">←</button>
			<span class="pos">{index >= 0 ? `${index + 1} / ${total}` : `– / ${total}`}</span>
			<button class="ghost" onclick={onnext} disabled={index >= total - 1} aria-label="Next" title="→">→</button>
		</span>
	</header>

	<div class="stage" class:sound={m.kind === 'audio'} class:clear={/png|webp|gif/.test(m.mime)}>
		{#key m.hash}
			{#if m.kind === 'image'}
				<img
					src={thumb(m)}
					alt={label(m, p)}
					onload={(e) => {
						const img = e.currentTarget as HTMLImageElement;
						onmeasure(m.hash, { w: img.naturalWidth, h: img.naturalHeight });
					}}
				/>
			{:else if m.kind === 'video'}
				<!-- drawn colour-true, as QuickTime and the studio's frames show it (the webview's own <video> shows BT.709 darker) -->
				<Video709 src={raw(m.hash)} onmeta={(w, h, d) => onmeasure(m.hash, { w, h, d })} />
			{:else if m.kind === 'audio'}
				<div class="listen">
					<audio
						src={raw(m.hash)}
						controls
						autoplay
						bind:currentTime={time}
						onloadedmetadata={(e) => onmeasure(m.hash, { d: e.currentTarget.duration })}
					></audio>
					{#if words.length}
						<p class="words">
							{#each words as w, i (i)}<span class:now={time >= w.start && time < w.end} class:past={time >= w.end}>{w.word}</span>{' '}{/each}
						</p>
					{:else if said}
						<p class="words">{said}</p>
					{/if}
				</div>
			{:else}
				<a class="quiet" href={raw(m.hash)} target="_blank" rel="noopener">Open the file ↗</a>
			{/if}
		{/key}
	</div>
</section>

<style>
	.viewer {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		height: 100%;
		min-height: 0;
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}

	.title {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.title b,
	.title span {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.title b {
		font-weight: 600;
	}

	.title span {
		font-size: 0.78rem;
		color: var(--muted);
	}

	.step {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.pos {
		min-width: 4.5rem;
		font-size: 0.8rem;
		text-align: center;
		color: var(--muted);
	}

	.ghost {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		font: inherit;
		font-size: 0.82rem;
		color: var(--ink);
		cursor: pointer;
	}

	.ghost:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.stage {
		position: relative;
		display: grid;
		flex: 1;
		place-items: center;
		min-height: 0;
		border-radius: 14px;
		background: var(--cream);
		overflow: hidden;
	}

	/* the picture or film takes the whole room it is given and never more, at its own shape: pinned to the stage,
	   so a tall or a square file can never stretch it */
	.stage img {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: none;
	}

	/* a picture with transparent parts (a hook layer: white words) on a checkerboard, so it can be seen */
	.stage.clear {
		background: repeating-conic-gradient(#3b413c 0 25%, #2d322e 0 50%) 0 0 / 16px 16px;
	}

	.listen {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.4rem;
		width: min(40rem, 90%);
		max-height: 100%;
		padding: 2rem 0;
		overflow: auto;
	}

	.listen audio {
		width: 100%;
	}

	.words {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.1rem, 2vw, 1.5rem);
		line-height: 1.5;
		text-align: center;
		color: var(--ink-soft);
	}

	.words span {
		transition: color 0.1s ease;
	}

	.words .past {
		color: var(--ink);
	}

	.words .now {
		color: var(--ink);
		background: linear-gradient(transparent 62%, var(--mustard) 62%);
	}

	.quiet {
		font-size: 0.9rem;
		color: var(--terracotta);
	}
</style>
