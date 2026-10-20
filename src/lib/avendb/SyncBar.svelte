<!--
	HOW FAR avenDB HAS SYNCED, ON EVERY APP PAGE (Samuel 2026-10-20) — a thin bar pinned to the top right, over whatever
	the page draws, a full-screen world too, shown only while this device still lacks edits its peers hold: how many of
	the logs they hold it holds whole (avendb's `synced` op, by the holdings each peer told it). Games, sandboxes and the
	asset viewers read their code off this device once it holds Maia City (game/code/sources/device.js), so the bar shows
	the person what a page waits for. It asks every second while behind, every few seconds once synced, and not at all
	while avenDB is closed or the device is too old to answer. A device that lacks edits it pulls from no peer, and
	whose count stood still for `STILL`, isn't syncing: the bar goes.
-->
<script>
	// @ts-nocheck — plain JS
	import { session } from './session.svelte.js';

	/** how often it asks (ms): while behind, and once synced */
	const EVERY = { behind: 1000, synced: 4000 };

	/** how long a count that pulls from no peer may stand still before the bar goes (ms) */
	const STILL = 30000;

	/** what the device said last: `{ peers, logs, behind, pulling }`, or null; and since when its count stands */
	let synced = $state.raw(null);
	let since = $state(0);
	let now = $state(0);

	$effect(() => {
		if (session.phase !== 'open') return void (synced = null);
		void session.device;
		let stop = false;
		let t;
		const ask = async () => {
			const got = await session.ask({ op: 'synced' }).catch(() => null);
			if (stop) return;
			// a device whose avenDB knows no `synced` shows no bar
			if (!got?.ok) return void (synced = null);
			now = Date.now();
			if (got.ok.behind !== synced?.behind || got.ok.logs !== synced?.logs) since = now;
			synced = got.ok;
			t = setTimeout(ask, synced.behind > 0 ? EVERY.behind : EVERY.synced);
		};
		void ask();
		return () => {
			stop = true;
			clearTimeout(t);
		};
	});

	const shown = $derived(!!synced && synced.behind > 0 && synced.logs > 0 && (synced.pulling > 0 || now - since < STILL));
	const done = $derived(shown ? Math.max(0, synced.logs - synced.behind) / synced.logs : 1);
	const said = $derived(shown ? `avenDB syncing: ${(synced.logs - synced.behind).toLocaleString('en')} of ${synced.logs.toLocaleString('en')}` : '');
</script>

{#if shown}
	<div class="sync" role="progressbar" aria-label="avenDB syncing" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(100 * done)} title={said}>
		<span style:width="{Math.max(4, 100 * done)}%"></span>
	</div>
{/if}

<style>
	.sync {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 6px);
		right: calc(env(safe-area-inset-right, 0px) + 10px);
		z-index: 70;
		width: 96px;
		height: 4px;
		overflow: hidden;
		border-radius: 999px;
		background: rgb(38 56 44 / 0.16);
		box-shadow: 0 0 0 1px rgb(250 248 242 / 0.5);
		pointer-events: auto;
	}

	.sync span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--brand-green, #24452f);
		transition: width 0.6s ease;
	}
</style>
