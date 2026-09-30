<!--
	The studio: a small post-production room for the journal films, over the media library, in three working steps —
	like DaVinci Resolve's pages — sharing one timeline:

	  Edit    picture and sound, on HD log proxies seen through the view transform, and the live world for world clips
	          (a shot as data, drawn by Sandbox 4's film mode on the timeline's clock). The library sits on the left;
	          drag a file onto a track (or double-click it to drop it at the playhead); a click shows it in the source
	          monitor, where I and O mark the part to use. Clips move by hand; a world clip opens its keyframe lanes.
	          Space plays; the captions follow the voice clips word by word. "Lock the edit" ends the step.
	  Grade   on the locked cut: conform status (originals, world plates per shape), the film's look and each clip's
	          grade as ASC CDL in ACEScct, presets, scopes, and each delivery shape's framing. Grades are data.
	  Render  the render queue and the last render's deliveries per shape (QC, loudness), each viewable.

	Every change is saved to the timeline a moment after it is made. The pieces live in src/lib/studio/.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import Bin from '$lib/studio/Bin.svelte';
	import Deliveries from '$lib/studio/Deliveries.svelte';
	import Ingest from '$lib/studio/Ingest.svelte';
	import Inspector from '$lib/studio/Inspector.svelte';
	import Library from '$lib/studio/Library.svelte';
	import Script from '$lib/studio/Script.svelte';
	import TimelinePicker from '$lib/studio/TimelinePicker.svelte';
	import DeliverablesTab from '$lib/studio/DeliverablesTab.svelte';
	import { forwardConsole, native } from '$lib/native';
	import ProgramMonitor from '$lib/studio/ProgramMonitor.svelte';
	import RenderQueue from '$lib/studio/RenderQueue.svelte';
	import SourceMonitor from '$lib/studio/SourceMonitor.svelte';
	import StageBar from '$lib/studio/StageBar.svelte';
	import Timeline from '$lib/studio/Timeline.svelte';
	import Transport from '$lib/studio/Transport.svelte';
	import { Studio } from '$lib/studio/studio.svelte';

	const s = new Studio();
	let studio = $state<HTMLElement | null>(null);

	// the studio lives in maiaCITY Studio, the Mac app, only: its media functions never run in a browser
	let inApp = $state<boolean | null>(null);

	// the timeline opens the first time a tab that shows it is opened
	$effect(() => {
		if (s.phase === 'ready' && s.tab !== 'ingest' && s.tab !== 'library') void s.openLater();
	});

	// if anything goes wrong on the way in, say what — a gate that only ever says "One moment…" hides it
	onMount(() => {
		inApp = native();
		if (!inApp) return;
		forwardConsole(window, 'studio');
		// a link into one tab (?tab=library — the media library's address)
		const tab = new URLSearchParams(location.search).get('tab');
		if (tab === 'ingest' || tab === 'library' || tab === 'render') s.tab = tab;
		const report = (e: ErrorEvent | PromiseRejectionEvent) => {
			s.failed = String('reason' in e ? (e.reason?.stack ?? e.reason) : `${e.message} (${e.filename}:${e.lineno})`);
		};
		addEventListener('error', report);
		addEventListener('unhandledrejection', report);
		const slow = setTimeout(() => s.phase === 'loading' && !s.failed && (s.failed = 'Still waiting after 10 s (the API: /api/me, /api/timelines; the vault on this Mac).'), 10000);
		s.load().catch((e) => (s.failed = (e as Error).stack ?? String(e)));
		// for the tests and the console: the studio's state
		(window as unknown as { __studio?: Studio }).__studio = s;
		return () => (removeEventListener('error', report), removeEventListener('unhandledrejection', report), clearTimeout(slow));
	});
	onDestroy(() => {
		if (typeof window === 'undefined') return; // also runs while the page is prerendered
		s.destroy();
	});

	function onKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('input, textarea, select')) return;
		if (e.altKey && ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].includes(e.code)) {
			e.preventDefault();
			const t = (['ingest', 'library', 'script', '3d', 'edit', 'audio', 'grade', 'render', 'deliverables'] as const)[Number(e.code.slice(-1)) - 1]!;
			s.tab = t;
			return;
		}
		// inside the source player's own controls its keys are its own (Space plays it, arrows step through it)
		if (target?.closest?.('.source audio, .source video')) return;
		if (e.code === 'Space') (e.preventDefault(), s.toggle());
		else if (e.code === 'Home') s.seek(0);
		else if (e.code === 'ArrowLeft') s.seek(s.time - (e.shiftKey ? 1 : 0.1));
		else if (e.code === 'ArrowRight') s.seek(s.time + (e.shiftKey ? 1 : 0.1));
		else if ((e.code === 'Delete' || e.code === 'Backspace') && s.canEdit) {
			// a selected camera key goes first, then the clip
			const c = s.sel;
			if (c?.kind === 'world' && s.selectedKey !== null && s.specOf(c)?.camera.kind === 'keys') {
				e.preventDefault();
				const i = s.selectedKey;
				s.editSpec(c, (sp) => void sp.camera.keys!.splice(i, 1));
				s.selectedKey = null;
			} else if (s.selected) (e.preventDefault(), s.remove(s.selected, e.altKey)); // a linked partner goes too (Alt: this one alone)
		}
	}

	async function fullscreen() {
		if (document.fullscreenElement) await document.exitFullscreen();
		else await studio?.requestFullscreen().catch(() => {});
	}
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
	<title>Studio · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if inApp === false}
	<main class="wrap gate">
		<h1>Studio</h1>
		<p>The studio — ingest, the library, edit, grade and render — lives in <strong>maiaCITY Studio</strong>, the Mac app. Open it there.</p>
	</main>
{:else if s.phase !== 'ready'}
	<main class="wrap gate">
		<h1>Studio</h1>
		{#if s.phase === 'loading'}
			<p>One moment…</p>
			{#if s.failed}<pre class="failed">{s.failed}</pre>{/if}
		{:else if s.phase === 'signed-out'}
			<p>The studio belongs to the admin. <a href="{base}/join/">Sign in</a> first.</p>
		{:else}
			<p>The studio belongs to the admin, and your account is not one.</p>
		{/if}
	</main>
{:else}
	<section class="studio tab-{s.tab}" bind:this={studio} aria-label="Studio">
		<header class="bar" data-tauri-drag-region>
			<div class="row" data-tauri-drag-region>
				<a class="back" href="{base}/app/">← Dashboard</a>
				<strong>Studio</strong>
				<span class="grow"></span>
				{#if s.current && s.tab !== 'ingest' && s.tab !== 'library'}
					<div class="title">
						<h2>{s.current.name}</h2>
						{#if s.current.description}<p title={s.current.description}>{s.current.description}</p>{/if}
					</div>
				{/if}
				<span class="grow"></span>
				{#if s.error}<button class="err" onclick={() => (s.error = '')} title="Dismiss">{s.error}</button>{/if}
				{#if s.notice}<button class="err note" onclick={() => (s.notice = '')} title="{s.notice} (click to dismiss)">{s.notice}</button>{/if}
				{#if s.tab !== 'ingest' && s.tab !== 'library'}<TimelinePicker {s} />{/if}
				{#if s.active && s.tab !== 'render'}
					<button class="rpill" style:--p="{Math.round(s.active.progress * 100)}%" onclick={() => (s.tab = 'render')}>
						{s.active.status === 'queued' ? 'Render waiting…' : `Rendering ${Math.round(s.active.progress * 100)}%`}
					</button>
				{/if}
				<button class="ghost small" onclick={fullscreen} title="Full screen">⛶</button>
			</div>
			<StageBar {s} />
		</header>

		{#if s.tab === 'deliverables'}
			<DeliverablesTab {s} />
		{:else if s.tab === 'ingest'}
			<Ingest />
		{:else if s.tab === 'library'}
			<Library />
		{:else if s.tab === '3d'}
			<!-- the live world: only here — Edit, Grade and Render show each world shot's HD proxy -->
			<Bin {s} />
			<div class="monitors">
				<ProgramMonitor {s} label="3D · the live world" />
			</div>
			<Inspector {s} />
		{:else if s.tab === 'edit'}
			<Bin {s} />
			<div class="monitors" class:split={!!s.preview}>
				<SourceMonitor {s} />
				<ProgramMonitor {s} />
			</div>
			<Inspector {s} />
		{:else if s.tab === 'script'}
			<!-- the script beside the picture, half and half; under both the story's structure and the captions -->
			<Script {s} />
			<div class="monitors">
				<ProgramMonitor {s} label="Program · script" />
			</div>
		{:else if s.tab === 'audio'}
			<!-- the sound on the timeline itself: each clip's level, fades and loudness on it -->
			<div class="monitors">
				<ProgramMonitor {s} label="Program · sound" />
			</div>
		{:else if s.tab === 'grade'}
			<!-- the picture; the grade's layers are on the timeline, over each shot (an agent reads the numbers itself) -->
			<div class="monitors">
				<ProgramMonitor {s} label="Program · {s.shape}" />
			</div>
		{:else}
			<RenderQueue {s} />
			<div class="monitors" class:split={!!s.preview}>
				<SourceMonitor {s} />
				<ProgramMonitor {s} />
			</div>
			<Deliveries {s} />
		{/if}
		{#if s.tab !== 'ingest' && s.tab !== 'library' && s.tab !== 'deliverables'}
			<Transport {s} />
			<Timeline {s} />
		{/if}
	</section>
{/if}

<style>
	.gate {
		padding-block: 3rem 6rem;
	}

	.gate a {
		color: var(--terracotta);
	}

	.failed {
		max-width: 60rem;
		padding: 0.8rem 1rem;
		border-radius: 8px;
		background: #fff3f0;
		font-size: 0.75rem;
		white-space: pre-wrap;
		color: #8a2a12;
	}

	/* the editing room: light, and the whole window */
	.studio {
		--bg: #f6f3ec;
		--panel: #fbfaf6;
		--edge: #e2dccd;
		--ink: #26382c;
		--dim: #7b857a;
		--accent: #d99a2b;
		position: fixed;
		inset: 0;
		z-index: 200;
		display: grid;
		grid-template-columns: 19rem 1fr 17rem;
		grid-template-rows: auto minmax(0, 1fr) auto minmax(11rem, 34vh);
		grid-template-areas:
			'bar bar bar'
			'bin monitor inspector'
			'bin transport transport'
			'bin timeline timeline';
		gap: 1px;
		background: var(--edge);
		color: var(--ink);
		font-size: 0.85rem;
	}

	/* Grade: the program; the layers over V1 on the timeline, full width */
	.studio.tab-grade {
		grid-template-columns: 1fr;
		grid-template-rows: auto minmax(0, 1fr) auto auto;
		grid-template-areas:
			'bar'
			'monitor'
			'transport'
			'timeline';
	}

	.studio.tab-render {
		grid-template-columns: 19rem 1fr 19rem;
	}

	/* Script: the script (left half), the program (right half), the timeline full width under them */
	.studio.tab-script {
		grid-template-columns: 1fr 1fr;
		grid-template-areas:
			'bar bar'
			'bin monitor'
			'transport transport'
			'timeline timeline';
	}

	/* Audio: the program over the sound tracks, which carry the levels themselves */
	.studio.tab-audio {
		grid-template-columns: 1fr;
		grid-template-rows: auto minmax(0, 1fr) auto minmax(14rem, 46vh);
		grid-template-areas:
			'bar'
			'monitor'
			'transport'
			'timeline';
	}

	/* Ingest and Library: one panel under the bar, no transport or timeline */
	.studio.tab-ingest,
	.studio.tab-library,
	.studio.tab-deliverables {
		grid-template-columns: 1fr;
		grid-template-rows: auto minmax(0, 1fr);
		grid-template-areas:
			'bar'
			'main';
	}

	.bar {
		grid-area: bar;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		/* the window's title bar is ours (overlay): the traffic lights sit at its top left */
		padding: 0.45rem 1rem 0.4rem 5.4rem;
		background: var(--panel);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		min-width: 0;
	}

	.back {
		color: var(--dim);
		text-decoration: none;
	}

	.bar strong {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 500;
	}

	/* the open timeline: its name and what it is, once — in the middle of the window, whatever sits beside it */
	.row {
		position: relative;
	}

	.title {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(44rem, 46%);
		text-align: center;
		pointer-events: none;
	}

	.title h2 {
		margin: 0;
		overflow: hidden;
		font-size: 1rem;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.title p {
		margin: 0.05rem 0 0;
		overflow: hidden;
		font-size: 0.76rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--dim);
	}

	.sub {
		font-size: 0.75rem;
		color: var(--dim);
		white-space: nowrap;
	}

	.err.note {
		color: #3e5a2f;
	}

	.err {
		overflow: hidden;
		max-width: 26rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.78rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: #9c3b26;
		cursor: pointer;
	}

	.grow {
		flex: 1;
	}

	.rpill {
		padding: 0.3rem 0.8rem;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent) var(--p), #c4a672 var(--p));
		font: inherit;
		font-size: 0.76rem;
		font-weight: 600;
		color: #fff;
		cursor: pointer;
	}

	/* shared by every panel */
	.studio :global(.ghost) {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.78rem;
		color: var(--ink);
		cursor: pointer;
	}

	.studio :global(.ghost:disabled) {
		opacity: 0.5;
		cursor: default;
	}

	.studio :global(.ghost.small) {
		padding: 0.2rem 0.6rem;
		font-size: 0.72rem;
	}

	.studio :global(.ghost.danger) {
		margin-top: 0.8rem;
		color: #9c3b26;
	}

	/* the monitors: the program alone, or the source beside it; in Grade the program over the scopes */
	.monitors {
		grid-area: monitor;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1px;
		min-width: 0;
		min-height: 0;
		background: var(--edge);
	}

	.monitors.split {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	}

	.monitors.column {
		grid-template-rows: minmax(0, 1fr) minmax(9rem, 30%);
	}

	.bar select {
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: #fff;
		font: inherit;
		font-size: 0.78rem;
		color: var(--ink);
	}

	@media (max-width: 900px) {
		.studio,
		.studio.tab-grade,
		.studio.tab-render {
			grid-template-columns: 1fr;
			grid-template-rows: auto 30vh auto minmax(10rem, 1fr) 30vh;
			grid-template-areas: 'bar' 'monitor' 'transport' 'timeline' 'bin';
		}

		/* source above program */
		.studio:has(.monitors.split) {
			grid-template-rows: auto 64vh auto minmax(10rem, 1fr) 30vh;
		}

		.monitors.split {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
		}

		.studio :global(.inspector),
		.studio :global(.grade),
		.studio :global(.dl) {
			display: none;
		}

		.row {
			flex-wrap: wrap;
		}
	}
</style>
