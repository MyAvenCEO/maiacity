<!--
	The timeline switcher, top right on every tab: the open timeline's project and variant as a button; its menu
	lists every timeline by project, its variants under it — one click opens one.
-->
<script>
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	let open = $state(false);
	/** @type {HTMLDivElement | null} */
	let box = $state(null);
	// one heading per project, its variants under it (A, B, …); timelines without a project last
	const groups = $derived.by(() => {
		/** @type {Map<string, typeof s.timelines>} */
		const map = new Map();
		for (const t of s.timelines) map.set(t.project ?? '', [...(map.get(t.project ?? '') ?? []), t]);
		for (const l of map.values()) l.sort((a, b) => (a.variant ?? '').localeCompare(b.variant ?? '', undefined, { numeric: true }));
		return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
	});
	$effect(() => {
		if (!open) return;
		/** @param {PointerEvent} e */
		const away = (e) => box && !box.contains(/** @type {Node} */ (e.target)) && (open = false);
		addEventListener('pointerdown', away);
		return () => removeEventListener('pointerdown', away);
	});
	/** @param {import('$lib/auth/client').Timeline} t */
	async function pick(t) {
		open = false;
		if (t.id !== s.current?.id) await s.openTimeline(t);
	}
</script>

<div class="picker" bind:this={box}>
	<button class="now" onclick={() => (open = !open)} aria-haspopup="menu" aria-expanded={open} title="Open another timeline">
		{#if s.current}{[s.current.project, s.current.variant].filter(Boolean).join(' · ') || s.current.name}{:else}Timelines{/if}
		<span class="caret">▾</span>
	</button>
	{#if open}
		<div class="menu" role="menu">
			{#each groups as [project, list] (project)}
				<p class="proj">{project || 'Other'}</p>
				{#each list as t (t.id)}
					<div class="row" class:on={s.current?.id === t.id}>
						<button role="menuitem" onclick={() => pick(t)}>
							{#if t.variant}<b>{t.variant}</b>{/if}
							<span class="nm">{t.name}</span>
							<span class="tg">{t.description ?? `${t.aspect} · ${t.clips.length} clips`}</span>
						</button>
						<button class="x" onclick={() => s.removeTimeline(t)} aria-label="Delete {t.name}" title="Delete">×</button>
					</div>
				{/each}
			{/each}
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
	}

	.now {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		max-width: 16rem;
		padding: 0.2rem 0.7rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
		font: inherit;
		font-size: 0.76rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--ink);
		cursor: pointer;
	}

	.caret {
		font-size: 0.6rem;
		color: var(--dim);
	}

	.menu {
		position: absolute;
		top: calc(100% + 0.3rem);
		right: 0;
		z-index: 300;
		width: 24rem;
		max-height: 70vh;
		overflow: auto;
		padding: 0.4rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: var(--raised);
		box-shadow: 0 12px 40px rgb(0 0 0 / 0.55);
	}

	.proj {
		margin: 0.5rem 0.4rem 0.2rem;
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.row {
		display: flex;
		align-items: center;
		border-radius: 6px;
	}

	.row.on,
	.row:hover {
		background: var(--hover);
	}

	.row > button:first-child {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0 0.4rem;
		flex: 1;
		min-width: 0;
		padding: 0.3rem 0.4rem;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.row b {
		grid-row: span 2;
		align-self: center;
		padding: 0 0.35rem;
		border-radius: 4px;
		background: var(--accent);
		font-size: 0.68rem;
		color: var(--on-accent);
	}

	.nm {
		overflow: hidden;
		font-size: 0.78rem;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.tg {
		overflow: hidden;
		font-size: 0.68rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--dim);
	}

	.x {
		padding: 0 0.5rem;
		border: 0;
		background: none;
		font-size: 0.9rem;
		color: var(--dim);
		cursor: pointer;
	}
</style>
