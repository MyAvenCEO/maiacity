<!--
	The transport, one quiet line: to the start, play and pause (Space), the clock — then full screen, the grade
	preview (Edit), with world clips "Prepare playback", and the timeline's zoom. The keys are in the ? tooltip.
-->
<script>
	import { clockText } from './studio.svelte.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	async function playFullscreen() {
		await s.screen?.requestFullscreen().catch(() => {});
		if (!s.playing) await s.play();
	}
	const keys = $derived(s.tab === 'edit' ? 'Space play · B or ⌘K cuts at the playhead · I / O mark the source · Delete removes · ← → nudge' : 'Space play · click a clip to select it');
</script>

<div class="transport">
	<button class="ic" onclick={() => s.seek(0)} aria-label="To the start" title="To the start">⏮</button>
	<button class="ic play" onclick={s.toggle} aria-label={s.playing ? 'Pause' : 'Play'} title="{s.playing ? 'Pause' : 'Play'} (Space)">{s.playing ? '❚❚' : '▶'}</button>
	<span class="time">{clockText(s.time)}<span> / {clockText(s.end)}</span></span>

	<span class="grow"></span>

	{#if s.worldClips.length}
		<button class="pill" onclick={() => s.preparePlayback(20000)} disabled={s.world.state !== 'ready' || s.preparing} title="Load every world shot this timeline touches, and keep it loaded">
			{s.preparing ? 'Preparing…' : s.world.state === 'ready' ? '◎ Prepare' : s.world.state === 'loading' ? 'World…' : 'Stand-ins'}
		</button>
	{/if}
	<button class="ic" onclick={() => s.undo()} disabled={!s.past.length} aria-label="Revert" title="Revert the last change (⌘Z)">↶</button>
	<button class="ic" onclick={() => s.redo()} disabled={!s.future.length} aria-label="Reapply" title="Reapply (⇧⌘Z)">↷</button>
	{#if s.canEdit}
		<button class="ic" onclick={() => s.splitAtPlayhead()} aria-label="Cut at the playhead" title="Cut the selected clip at the playhead (B or ⌘K; Alt: without its linked sound)">✂</button>
	{/if}
	<button class="ic" onclick={playFullscreen} aria-label="Play full screen" title="Play full screen">⛶</button>
	<label class="zoom" title="Zoom the timeline">
		<span aria-hidden="true">−</span>
		<input type="range" min="8" max="200" step="1" bind:value={s.pxPerSec} aria-label="Zoom" />
		<span aria-hidden="true">+</span>
	</label>
	<span class="keys" title={keys}>?</span>
</div>

<style>
	.transport {
		grid-area: transport;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.8rem;
		white-space: nowrap;
		background: var(--panel);
	}

	.ic {
		display: grid;
		place-items: center;
		width: 1.8rem;
		height: 1.8rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		font-size: 0.8rem;
		color: var(--ink);
		cursor: pointer;
	}

	.ic:hover {
		background: var(--hover);
	}

	.ic:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.ic.play {
		width: 2rem;
		height: 2rem;
		background: var(--accent);
		font-size: 0.72rem;
		color: var(--on-accent);
	}

	.time {
		margin-left: 0.2rem;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}

	.time span {
		color: var(--dim);
	}

	.grow {
		flex: 1;
	}

	.pill {
		padding: 0.18rem 0.65rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.72rem;
		color: var(--dim);
		cursor: pointer;
	}

	.pill:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.zoom {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
		color: var(--dim);
	}

	.zoom input {
		width: 6.5rem;
		accent-color: var(--accent);
	}

	.keys {
		display: grid;
		place-items: center;
		width: 1.2rem;
		height: 1.2rem;
		border: 1px solid var(--edge);
		border-radius: 50%;
		font-size: 0.66rem;
		color: var(--dim);
		cursor: help;
	}

	@media (max-width: 900px) {
		.zoom,
		.keys {
			display: none;
		}
	}
</style>
