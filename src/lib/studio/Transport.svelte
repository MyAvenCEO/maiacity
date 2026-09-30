<!--
	The transport: to the start, play and pause (Space), the clock, full screen, the timeline's zoom — and, with world
	clips, "Prepare playback" (every world the timeline touches, loaded and kept before it plays).
-->
<script>
	import { clockText } from './studio.svelte.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	async function playFullscreen() {
		await s.screen?.requestFullscreen().catch(() => {});
		if (!s.playing) await s.play();
	}
</script>

<div class="transport">
	<button class="tbtn" onclick={() => s.seek(0)} aria-label="To the start">⏮</button>
	<button class="tbtn play" onclick={s.toggle} aria-label={s.playing ? 'Pause' : 'Play'}>{s.playing ? '❚❚' : '▶'}</button>
	<span class="time">{clockText(s.time)} <span>/ {clockText(s.end)}</span></span>
	<button class="ghost" onclick={playFullscreen}>⛶ Play full screen</button>
	{#if s.worldClips.length}
		<button class="ghost" onclick={() => s.preparePlayback(20000)} disabled={s.world.state !== 'ready' || s.preparing} title="Load every world shot this timeline touches, and keep it loaded">
			{s.preparing ? 'Preparing…' : s.world.state === 'ready' ? '◎ Prepare playback' : s.world.state === 'loading' ? 'World starting…' : 'World: stand-ins'}
		</button>
	{/if}
	{#if s.tab === 'edit'}
		<label class="opt" title="Show the grade on the proxies (read-only here)"><input type="checkbox" bind:checked={s.previewGrade} /> Grade preview</label>
	{/if}
	<label class="zoom">Zoom <input type="range" min="8" max="200" step="1" bind:value={s.pxPerSec} /></label>
	<span class="hint">
		{#if s.tab === 'edit' && !s.locked}Space play · I / O mark the source · Delete removes · ← → nudge{:else if s.locked && s.tab === 'edit'}Locked: picture and sound do not move{:else}Space play · click a clip to select it{/if}
	</span>
</div>

<style>
	.transport {
		grid-area: transport;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.9rem;
		background: var(--panel);
	}

	.tbtn {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--edge);
		border-radius: 50%;
		background: #fff;
		font-size: 0.78rem;
		color: var(--ink);
		cursor: pointer;
	}

	.tbtn.play {
		width: 2.4rem;
		height: 2.4rem;
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.time {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.95rem;
	}

	.time span {
		color: var(--dim);
	}

	.opt,
	.zoom {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: var(--dim);
	}

	.zoom {
		margin-left: 0.6rem;
	}

	.hint {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--dim);
	}

	@media (max-width: 900px) {
		.hint,
		.zoom {
			display: none;
		}
	}
</style>
