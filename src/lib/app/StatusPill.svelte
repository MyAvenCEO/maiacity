<script>
	// @ts-nocheck — plain JS
	import { fade } from 'svelte/transition';
	import { session } from '$lib/avendb/session.svelte.js';
	import { sync, watchSync } from '$lib/avendb/sync.svelte.js';
	import { peerStatus, liveSync } from '$lib/avendb/sync-status.js';
	import { watchRecipes } from '$lib/assets/vault.js';
	import { viewStatus } from '$lib/avendb/view-status.js';
	import { watchActiveReads } from '$lib/avendb/active-reads.js';
	import { screenSlot } from './screen-slots.js';

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

	/** a clock of a second while a sync runs, so "last page 4 s ago" and "waiting on … for 12 s" move with time too */
	let clock = $state(Date.now());
	$effect(() => {
		if (!peers.active) return;
		clock = Date.now();
		const t = setInterval(() => (clock = Date.now()), 1000);
		return () => clearInterval(t);
	});
	/** what a running sync does now: the edits it takes, from which peer, or what it waits on and for how long */
	const live = $derived(liveSync(sync, Math.max(clock, sync.at)));

	const n = (/** @type {number} */ x) => x.toLocaleString('en');
	const covered = $derived(Math.max(0, sync.logs - sync.behind));
	const view = $derived(viewStatus(reads, files));
	/**
	 * Collapsed, one short line: the one thing that matters now, a number only where it says something (Samuel
	 * 2026-10-26: "way more compact … reduced to the actual sync / offline / online numbers"). In order: not known yet,
	 * offline, every peer reconnecting (counted by what it told last, so the numbers hold), a sync running (the logs in of how many, the edits it took, or what it waits on: `liveSync`), files coming, the view unavailable, synced.
	 */
	const line = $derived(
		!sync.known ? 'Connecting'
		: !sync.peers ? 'Offline'
		: sync.reconnecting >= sync.peers ? 'Reconnecting'
		: live ? live.line
		: files.waiting + files.reading > 0 ? `${n(files.waiting + files.reading)} files`
		: view.state === 'unavailable' ? 'Not on this device'
		: 'Synced'
	);
	const offline = $derived(sync.known && !sync.peers);
	/** open, each number by its name: the ones that are not nought, and always the peers */
	const details = $derived(/** @type {[string, string][]} */ ([
		['Peers', !sync.known ? '…' : sync.reconnecting ? `${n(sync.peers - sync.reconnecting)} connected · ${n(sync.reconnecting)} reconnecting` : n(sync.peers)],
		...(sync.behind > 0 ? [['Logs left', `${n(sync.behind)} of ${n(sync.logs)}`]] : []),
		...(sync.pulling > 0 && !live?.rows.some(([k]) => k === 'Transfers') ? [['Transfers', n(sync.pulling)]] : []),
		...(live?.rows ?? []),
		...(files.waiting + files.reading > 0 ? [['Files', `${n(files.reading)} loading · ${n(files.waiting)} waiting`]] : []),
		['View', view.state === 'local' ? 'on this device' : view.state === 'unavailable' ? 'not on this device' : view.state === 'unknown' ? 'checking' : 'loading']
	]));
	const busy = $derived(!sync.known || sync.pulling > 0 || view.state === 'loading' || view.state === 'waiting');
	/** the ring: the share of logs in while syncing, full when synced, empty offline, a turning arc while it can't say */
	const fraction = $derived(offline ? 0 : sync.behind > 0 && sync.logs > 0 ? covered / sync.logs : busy ? null : sync.logs > 0 ? 1 : null);
	/** the ring: how far the sync is, or a turning arc while it can't say */
	const R = 7;
	const ROUND = 2 * Math.PI * R;
</script>

{#if shown}
	<div class="status" use:screenSlot={'right'} transition:fade={{ duration: 200 }}>
		{#if open}
			<dl class="details">
				{#each details as [k, v], i (i)}<dt>{k}</dt><dd>{v}</dd>{/each}
			</dl>
		{/if}
		<button class="pill" onclick={() => (open = !open)} aria-expanded={open} aria-live="polite" class:offline title="Sync with your other devices">
			<svg class="sync-ring" class:turning={fraction === null} viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
				<circle cx="9" cy="9" r={R} class="track" />
				<circle cx="9" cy="9" r={R} class="done" stroke-dasharray="{fraction === null ? ROUND / 4 : fraction * ROUND} {ROUND}" />
			</svg>
			<span>{line}</span>
		</button>
	</div>
{/if}

<style>
	/* The shared top-right slot owns placement; details open below it. */
	.status {
		display: flex;
		flex-direction: column-reverse;
		align-items: flex-end;
		gap: 6px;
		position: relative;
		pointer-events: none;
	}

	.pill,
	.details {
		pointer-events: auto;
		border: 1px solid var(--line);
		background: var(--overlay-paper, rgb(250 248 242 / .75));
		box-shadow: 0 6px 20px rgb(38 56 44 / 0.16);
		backdrop-filter: blur(10px);
		color: var(--ink);
	}

	.pill {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.28rem 0.7rem 0.28rem 0.45rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.74rem;
		letter-spacing: 0.02em;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		text-align: left;
		cursor: pointer;
		/* never past the screen's edge, however long what it says (a phone, 2026-10-28) */
		max-width: calc(100vw - 32px);
		min-width: 0;
	}

	.pill span {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.details {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.2rem 0.8rem;
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 12px;
		font-size: 0.7rem;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
		/* the names and numbers wrap inside the screen rather than run off its left edge */
		width: max-content;
		max-width: min(22rem, calc(100vw - 32px));
	}

	.details dt {
		opacity: 0.65;
		white-space: nowrap;
	}

	.details dd {
		margin: 0;
		text-align: right;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.offline {
		opacity: 0.8;
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
