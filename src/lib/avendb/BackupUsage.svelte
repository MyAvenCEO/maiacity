<!--
	BackupUsage: how much of the person's backup avenDB's server keeps, against their limit, as the server weighed it
	last (avendb/spec/AvenDB/Quota.lean, `POST /feed/backup`): "Backup full: 5 GB of 5 GB, Traveler". The limit is by the
	cap group of Maia City they hold, Traveler or Citizen; Maia City's owners and Admin holders have none. Their edits
	are always kept; once their files reach the limit the server keeps no new one, and drops nothing it kept. The server
	answers a pass this device signs for it (the `api_pass` op), never a key of the page's.
-->
<script>
	import { onMount } from 'svelte';
	import { feed } from './server.js';
	import { session } from './session.svelte.js';

	/** the service the device's pass names to read its backup (avendb's `quota::BACKUP_AUDIENCE`) */
	const AUDIENCE = 'avenDB backup';

	/** @typedef {{ used: number | null, limit: number | null, group: string | null, refused: number, full: boolean }} Standing */
	let standing = $state(/** @type {Standing | null} */ (null));
	let why = $state('');

	/** `bytes` as a person reads them, in decimal units as the limits are set. @param {number} bytes */
	function sized(bytes) {
		const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
		let i = 0;
		while (bytes >= 1000 && i < units.length - 1) [bytes, i] = [bytes / 1000, i + 1];
		return `${i ? +bytes.toFixed(bytes < 10 ? 1 : 0) : bytes} ${units[i]}`;
	}

	/** Asks the server what it keeps for the person, by a pass this device signs for it. */
	async function load() {
		if (session.phase !== 'open') return;
		why = '';
		try {
			const got = await session.ask({ op: 'api_pass', audience: AUDIENCE });
			if (!got?.ok?.pass) throw new Error(got?.why || 'This device made no pass.');
			const r = await fetch(`${feed()}/backup`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pass: got.ok.pass })
			});
			const body = await r.json().catch(() => ({}));
			if (r.status === 429) throw new Error('The server is busy: try again in a minute.');
			if (!r.ok) throw new Error(body.error || `The server answered ${r.status}.`);
			standing = body;
		} catch (e) {
			why = /** @type {Error} */ (e).message;
		}
	}

	onMount(load);

	const share = $derived(
		standing?.limit && standing.used != null ? Math.min(1, standing.used / standing.limit) : 0
	);
	const said = $derived.by(() => {
		if (!standing) return '';
		const { used, limit, group, full } = standing;
		if (used == null) return 'The server hasn’t weighed your backup yet.';
		if (limit == null) return `Backup: ${sized(used)}, with no limit`;
		const of = `${sized(used)} of ${sized(limit)}${group ? `, ${group}` : ''}`;
		return full ? `Backup full: ${of}` : `Backup: ${of}`;
	});
</script>

<div class="usage" aria-live="polite">
	{#if standing}
		<p class:full={standing.full}>{said}</p>
		{#if standing.limit != null && standing.used != null}
			<div
				class="bar"
				role="meter"
				aria-label="Backup used"
				aria-valuemin="0"
				aria-valuemax={standing.limit}
				aria-valuenow={Math.min(standing.used, standing.limit)}
			>
				<span style:width="{share * 100}%" class:full={standing.full}></span>
			</div>
		{/if}
		{#if standing.full}
			<p class="soft">
				Your entries are still backed up. New files stay on your devices until there is room; nothing the server
				kept is dropped.
			</p>
		{/if}
	{:else if why}
		<p class="soft">Backup size unknown: {why}</p>
	{/if}
</div>

<style>
	.usage {
		margin: 0.5rem 0 0.75rem;
	}
	.usage p {
		margin: 0.25rem 0;
	}
	.soft {
		opacity: 0.75;
	}
	p.full {
		color: var(--danger, #c0392b);
		font-weight: 600;
	}
	.bar {
		height: 0.5rem;
		border-radius: 999px;
		background: var(--line, rgba(127, 127, 127, 0.25));
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent, #3b82f6);
	}
	.bar span.full {
		background: var(--danger, #c0392b);
	}
</style>
