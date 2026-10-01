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
	import CueCard from '$lib/studio/CueCard.svelte';
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
		// revert and reapply: ⌘Z, ⇧⌘Z
		else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), e.shiftKey ? s.redo() : s.undo());
		// the blade: B, or ⌘K as in the other editors — the selected clip (and its sound) cut at the playhead (Alt: alone)
		else if ((e.code === 'KeyB' && !e.metaKey && !e.ctrlKey) || (e.code === 'KeyK' && (e.metaKey || e.ctrlKey))) (e.preventDefault(), s.splitAtPlayhead(e.altKey));
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
				<div class="side" data-tauri-drag-region>
					<a class="back" href="{base}/app/">← Dashboard</a>
					<strong>Studio</strong>
				</div>
				<div class="title" data-tauri-drag-region>
					{#if s.current && s.tab !== 'ingest' && s.tab !== 'library'}
						<h2>{s.current.name}</h2>
						{#if s.current.description}<p title={s.current.description}>{s.current.description}</p>{/if}
					{/if}
				</div>
				<div class="side end" data-tauri-drag-region>
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
			</div>
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
			<!-- the sound on the timeline itself: each clip's level, fades and loudness on it; the selected clip's EQ in the
			     inspector -->
			<div class="monitors">
				<ProgramMonitor {s} label="Program · sound" />
			</div>
			<Inspector {s} />
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
		<CueCard {s} />
		<!-- the working steps, along the window's bottom edge -->
		<footer class="tabs"><StageBar {s} /></footer>
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

	/* the editing room: dark marine, and the whole window */
	.studio {
		color-scheme: dark;
		/* marine blues, from the deep to the surface */
		--abyss: #03080f; /* around the picture */
		--bg: #07121f; /* the deepest ground: the timeline's lanes, wells */
		--lane: #09172a; /* a lane under a track */
		--panel: #0b1a2c; /* the panels: bin, inspector, track heads */
		--chrome: #0d2035; /* the bars: top bar, tab bar, ruler */
		--raised: #10243b; /* buttons, inputs, cards */
		--hover: #16304d; /* hover, open, elevated */
		--sel: #24507c; /* a chosen tab or toggle */
		--chosen: rgb(232 168 58 / 0.2); /* a chosen row or item: the accent, faint */
		--edge: #1f3d5f; /* lines */
		--edge-strong: #2e5a86;
		/* text */
		--ink: #e6eef7;
		--ink-soft: #b4c4d6;
		--dim: #8ba1b9;
		--on-ink: #07121f; /* text on a light (ink) fill */
		/* accents */
		--accent: #e8a83a; /* amber: selection, the grade */
		--on-accent: #1c1305;
		--rec: #ff5a4c; /* the playhead, record */
		--cyan: #4cc9d9; /* secondary highlights */
		--ok: #6fd3a0;
		--ok-bg: rgb(80 200 140 / 0.15);
		--ok-line: #3f8f68;
		--warn: #f0bd62;
		--warn-bg: rgb(232 168 58 / 0.16);
		--warn-line: #8a6a2e;
		--bad: #f78f76;
		--bad-bg: rgb(240 110 80 / 0.17);
		--bad-line: #8a4a3c;
		--info: #93b3ef;
		--info-bg: rgb(110 150 230 / 0.18);
		--violet: #bda8f0;
		--violet-bg: rgb(160 130 230 / 0.2);
		/* the site's own tokens, re-tuned for the dark room (the shared media pieces inside read them) */
		--cream: var(--panel);
		--paper: var(--raised);
		--line: var(--edge);
		--muted: var(--dim);
		--terracotta: #ec8a62;
		--mustard: #efb54d;
		--sage: #9fc28f;
		position: fixed;
		inset: 0;
		z-index: 200;
		display: grid;
		grid-template-columns: 19rem 1fr 17rem;
		grid-template-rows: auto minmax(0, 1fr) auto minmax(11rem, auto) auto;
		grid-template-areas:
			'bar bar bar'
			'bin monitor inspector'
			'bin transport transport'
			'bin timeline timeline'
			'tabs tabs tabs';
		gap: 1px;
		background: var(--edge);
		color: var(--ink);
		font-size: 0.85rem;
	}

	/* Grade: the program; the layers over V1 on the timeline, full width */
	.studio.tab-grade {
		grid-template-columns: 1fr;
		grid-template-rows: auto minmax(0, 1fr) auto auto auto;
		grid-template-areas:
			'bar'
			'monitor'
			'transport'
			'timeline'
			'tabs';
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
			'timeline timeline'
			'tabs tabs';
	}

	/* Audio: the program and, beside it, the selected clip (its EQ) over the sound tracks, which carry the levels */
	.studio.tab-audio {
		grid-template-columns: 1fr 19rem;
		grid-template-rows: auto minmax(0, 1fr) auto minmax(14rem, auto) auto;
		grid-template-areas:
			'bar bar'
			'monitor inspector'
			'transport transport'
			'timeline timeline'
			'tabs tabs';
	}

	/* Ingest and Library: one panel under the bar, no transport or timeline */
	.studio.tab-ingest,
	.studio.tab-library,
	.studio.tab-deliverables {
		grid-template-columns: 1fr;
		grid-template-rows: auto minmax(0, 1fr) auto;
		grid-template-areas:
			'bar'
			'main'
			'tabs';
	}

	/* the working steps, centred along the bottom edge */
	.tabs {
		grid-area: tabs;
		padding: 0.35rem 1rem 0.45rem;
		background: var(--chrome);
	}

	.bar {
		grid-area: bar;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		/* the window's title bar is ours (overlay): the traffic lights sit at its top left */
		padding: 0.45rem 1rem 0.4rem 5.4rem;
		background: var(--chrome);
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
	/* three columns of equal sides: the title always in the window's middle */
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 44rem) minmax(0, 1fr);
	}

	.side {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		min-width: 0;
	}

	.side.end {
		justify-content: flex-end;
	}

	.title {
		min-width: 0;
		text-align: center;
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
		color: var(--ok);
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
		color: var(--bad);
		cursor: pointer;
	}

	.grow {
		flex: 1;
	}

	.rpill {
		padding: 0.3rem 0.8rem;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent) var(--p), #9c7c46 var(--p));
		font: inherit;
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--on-accent);
		cursor: pointer;
	}

	/* shared by every panel: controls take the room's ink, not the system's — a default only (no weight of its own:
	   a control's own colour, a light pill's dark text, always wins) */
	:global(:where(.studio) :where(button, input, select, textarea)) {
		color: inherit;
	}

	/* every slider in the room: a thin marine track, an amber thumb — never the system's white */
	.studio :global(input[type='range']) {
		appearance: none;
		height: 14px;
		background: transparent;
		accent-color: var(--accent);
		cursor: ew-resize;
	}

	.studio :global(input[type='range']::-webkit-slider-runnable-track) {
		height: 4px;
		border-radius: 2px;
		background: var(--edge);
	}

	.studio :global(input[type='range']::-webkit-slider-thumb) {
		appearance: none;
		width: 12px;
		height: 12px;
		margin-top: -4px;
		border: 2px solid var(--bg);
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 1px var(--edge-strong);
	}

	.studio :global(input[type='range']:hover::-webkit-slider-thumb),
	.studio :global(input[type='range']:focus-visible::-webkit-slider-thumb) {
		box-shadow: 0 0 0 3px rgb(232 168 58 / 0.3);
	}

	.studio :global(.ghost) {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
		font: inherit;
		font-size: 0.78rem;
		color: var(--ink);
		cursor: pointer;
	}

	.studio :global(.ghost:hover:not(:disabled)) {
		background: var(--hover);
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
		color: var(--bad);
	}

	/* the shared media pieces (Tile, Viewer, Details from admin/media) inside the dark room: what the tokens don't reach */
	.studio :global(.tile:hover),
	.studio :global(.tile:focus-visible) {
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
	}

	.studio :global(.tile .play) {
		background: rgb(0 0 0 / 0.6);
		color: var(--ink);
	}

	.studio :global(.tile .role) {
		background: rgb(7 18 31 / 0.85);
	}

	.studio :global(.tile .role.old),
	.studio :global(.details .bad) {
		color: var(--bad);
	}

	.studio :global(.details button.chip:hover) {
		border-color: var(--accent);
		background: var(--chosen);
		color: var(--ink);
	}

	.studio :global(.details .confirm) {
		color: var(--warn);
	}

	.studio :global(.details .confirm button:not(.no)) {
		color: var(--on-ink);
	}

	.studio :global(.viewer .stage) {
		background: var(--abyss);
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
		background: var(--raised);
		font: inherit;
		font-size: 0.78rem;
		color: var(--ink);
	}

	@media (max-width: 900px) {
		.studio,
		.studio.tab-grade,
		.studio.tab-render {
			grid-template-columns: 1fr;
			grid-template-rows: auto 30vh auto minmax(10rem, 1fr) 30vh auto;
			grid-template-areas: 'bar' 'monitor' 'transport' 'timeline' 'bin' 'tabs';
		}

		/* source above program */
		.studio:has(.monitors.split) {
			grid-template-rows: auto 64vh auto minmax(10rem, 1fr) 30vh auto;
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
