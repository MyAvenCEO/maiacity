<!--
	The working steps, as DaVinci Resolve's pages: Ingest and Library (the files), 3D (the world), Edit (picture and
	sound, on proxies), Grade (colour: every shot's balance, then the look), Render (the deliveries). No lock for now:
	every step works on the cut as it stands.
-->
<script>
	/** @typedef {import('./studio.svelte.js').Tab} Tab */
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	/** @type {{ id: Tab, label: string, key: string }[]} */
	const TABS = [
		{ id: 'ingest', label: 'Ingest', key: '1' },
		{ id: 'library', label: 'Library', key: '2' },
		{ id: 'script', label: 'Script', key: '3' },
		{ id: '3d', label: '3D', key: '4' },
		{ id: 'edit', label: 'Edit', key: '5' },
		{ id: 'audio', label: 'Audio', key: '6' },
		{ id: 'grade', label: 'Grade', key: '7' },
		{ id: 'render', label: 'Render', key: '8' },
		{ id: 'deliverables', label: 'Deliverables', key: '9' },
		{ id: 'processes', label: 'Processes', key: '0' }
	];
	/** @param {Tab} t */
	function go(t) {
		if (t !== 'edit' && t !== '3d' && t !== 'audio' && t !== 'script') s.stop();
		s.tab = t;
	}
</script>

<nav class="stagebar" aria-label="Working steps">
	<div class="tabs" role="tablist">
		{#each TABS as t (t.id)}
			<button role="tab" aria-selected={s.tab === t.id} class:on={s.tab === t.id} title="{t.label} (Alt+{t.key})" onclick={() => go(t.id)}>{t.label}</button>
		{/each}
	</div>
</nav>

<style>
	.stagebar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
		width: 100%;
	}

	.tabs {
		display: flex;
		padding: 2px;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--bg);
	}

	.tabs button {
		min-width: 5.2rem;
		padding: 0.28rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--dim);
		cursor: pointer;
	}

	.tabs button.on {
		background: var(--sel);
		color: var(--ink);
	}
</style>
