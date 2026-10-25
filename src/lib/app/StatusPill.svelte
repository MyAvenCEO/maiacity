<!--
	WHAT A PAGE WAITS FOR, centred just above the nav pill (Samuel 2026-10-20: "The loading progress should be above
	center the navpill"), on every app page, a full-screen world too, clear of the HUD a game draws at its top: avenDB
	updates announced by its peers ($lib/avendb/sync.svelte.js), with missing log counts; else the asset files the page
	reads, or that it waits for while avenDB's server doesn't answer ($lib/assets/vault.js `recipes`). It shows once
	something takes a moment, and fades once nothing does; tapped, it says how far each is. Nothing here is an error: a
	file still on its way is loading, never missing (the page's own banner tells what really is, ./VaultRecipes.svelte).
-->
<script>
	// @ts-nocheck — plain JS
	import { fade } from 'svelte/transition';
	import { session } from '$lib/avendb/session.svelte.js';
	import { sync, watchSync } from '$lib/avendb/sync.svelte.js';
	import { peerStatus } from '$lib/avendb/sync-status.js';
	import { watchRecipes } from '$lib/assets/vault.js';
	import { viewStatus } from '$lib/avendb/view-status.js';
	import { watchActiveReads } from '$lib/avendb/active-reads.js';
	import { foot, FOOT } from './foot.js';

	/** how long something must take before the pill shows, and how long it stays once nothing does (ms) */
	const SHOW = 400;
	const HIDE = 900;

	/** the asset files the page reads now, and how many of them wait for the server */
	let reads = $state({ total: 0, pending: 0, local: 0 });
	$effect(() => watchActiveReads(value => reads = value));
	let files = $state({ reading: 0, waiting: 0 });
	$effect(() => watchRecipes((r) => (files = { reading: r.reading ?? 0, waiting: r.waiting ?? 0 })));

	$effect(() => {
		if (session.phase !== 'open') return;
		void session.device;
		return watchSync();
	});

	/** what the page waits for now: avenDB syncing, the server answering again, or its files */
	const peers = $derived(peerStatus(sync));
	const now = $derived(peers.active ? 'sync' : files.waiting > 0 ? 'wait' : files.reading > 0 ? 'files' : session.phase === 'open' ? 'sync' : '');
	/** what the pill shows: `now`, once it held for `SHOW` (or nothing once nothing held for `HIDE`) */
	let shown = $state('');
	$effect(() => {
		const want = now;
		if (want === shown) return;
		const t = setTimeout(() => (shown = want), want ? SHOW : HIDE);
		return () => clearTimeout(t);
	});
	let open = $state(false);
	$effect(() => {
		if (!shown) open = false;
	});

	const n = (/** @type {number} */ x) => x.toLocaleString('en');
	const covered = $derived(Math.max(0, sync.logs - sync.behind));
	const background = $derived(!sync.known ? 'Sync · checking' : !sync.peers ? 'Sync · offline' : sync.behind > 0 ? `Sync ${n(covered)}/${n(sync.logs)}` : sync.pulling > 0 ? 'Sync · checking updates' : sync.logs > 0 ? 'Sync current' : 'Sync · checking');
	const view = $derived(viewStatus(reads, files));
	const label = $derived(view.state === 'local' ? 'Local view' : view.state === 'unknown' ? 'View checking' : view.state === 'unavailable' ? 'View unavailable' : files.waiting > 0 ? `View · ${n(files.waiting)} files waiting` : files.reading > 0 ? `View · ${n(files.reading)} files loading` : `View · ${n(reads.pending)} reads loading`);
	const details = $derived([
		`${n(sync.peers)} peers · ${n(sync.pulling)} active transfers`,
		`${n(sync.behind)} logs remaining · ${n(files.waiting + files.reading)} files pending`
	]);
	const busy = $derived(sync.behind > 0 || sync.pulling > 0 || view.state === 'loading' || view.state === 'waiting');
	const fraction = $derived(busy ? null : sync.known && sync.peers > 0 && sync.logs > 0 ? 1 : 0);
	/** the ring: how far the sync is, or a turning arc while it can't say */
	const R = 7;
	const ROUND = 2 * Math.PI * R;
</script>

{#if shown}
	<div class="status" use:foot={FOOT.status} transition:fade={{ duration: 200 }}>
		{#if open}
			<ul class="details" role="list">
				{#each details as d (d)}<li>{d}</li>{/each}
			</ul>
		{/if}
		<button class="pill" onclick={() => (open = !open)} aria-expanded={open} aria-live="polite" title="Incoming sync and current local reads">
			<svg class="sync-ring" class:turning={fraction === null} viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
				<circle cx="9" cy="9" r={R} class="track" />
				<circle cx="9" cy="9" r={R} class="done" stroke-dasharray="{fraction === null ? ROUND / 4 : fraction * ROUND} {ROUND}" />
			</svg>
			<span class="labels"><span>{label}</span><span class="separator" aria-hidden="true">·</span><span class="background">{background}</span></span>
		</button>
	</div>
{/if}

<style>
	.labels { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.3rem; }
	.background { opacity: 0.75; }
	.separator { opacity: 0.4; }
	/* in the app's foot stack, nearest the nav pill ($lib/app/foot.js) */
	.status {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		pointer-events: none;
	}

	.pill,
	.details {
		pointer-events: auto;
		border: 1px solid var(--line);
		background: rgb(250 248 242 / 0.94);
		box-shadow: 0 6px 20px rgb(38 56 44 / 0.16);
		backdrop-filter: blur(10px);
		color: var(--ink);
	}

	.pill {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.25rem 0.6rem;
		max-width: calc(100vw - 2rem);
		border-radius: 999px;
		font: inherit;
		font-size: 0.68rem;
		letter-spacing: 0.02em;
		white-space: normal;
		text-align: left;
		cursor: pointer;
	}

	.details {
		margin: 0;
		padding: 0.55rem 0.8rem;
		border-radius: 12px;
		font-size: 0.74rem;
		line-height: 1.4;
		list-style: none;
		max-width: 22rem;
	}

	.details li + li {
		margin-top: 0.25rem;
	}

	.sync-ring {
		flex: none;
		transform: rotate(-90deg);
	}

	.sync-ring circle {
		fill: none;
		stroke-width: 2.4;
	}

	.track {
		stroke: rgb(38 56 44 / 0.14);
	}

	.done {
		stroke: var(--brand-green, #24452f);
		stroke-linecap: round;
		transition: stroke-dasharray 0.6s ease;
	}

	.turning {
		animation: turn 1s linear infinite;
	}

	@keyframes turn {
		from {
			transform: rotate(-90deg);
		}
		to {
			transform: rotate(270deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.turning {
			animation: none;
		}
	}
</style>
