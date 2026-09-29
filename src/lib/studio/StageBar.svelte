<!--
	The working steps, as DaVinci Resolve's pages: Edit (picture and sound, on proxies), Grade (colour, on the
	originals, once the edit is locked), Render (the deliveries). Beside them, where the timeline stands — edit → locked
	→ graded → rendered — its version, and the one step to take next.
-->
<script>
	import { STAGES } from './studio.svelte.js';

	/** @typedef {import('./studio.svelte.js').Tab} Tab */
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	/** @type {{ id: Tab, label: string, key: string }[]} */
	const TABS = [
		{ id: 'edit', label: 'Edit', key: '1' },
		{ id: 'grade', label: 'Grade', key: '2' },
		{ id: 'render', label: 'Render', key: '3' }
	];
	/** @param {import('$lib/auth/client').TimelineStage} st */
	const reached = (st) => STAGES.indexOf(st) <= STAGES.indexOf(s.stage);
	/** @param {Tab} t */
	function go(t) {
		if (t === 'grade' && !s.locked) return;
		if (t !== 'edit') s.stop();
		s.tab = t;
	}
</script>

<nav class="stagebar" aria-label="Working steps">
	<div class="tabs" role="tablist">
		{#each TABS as t (t.id)}
			<button
				role="tab"
				aria-selected={s.tab === t.id}
				class:on={s.tab === t.id}
				disabled={t.id === 'grade' && !s.locked}
				title={t.id === 'grade' && !s.locked ? 'Lock the edit first: grading happens on the locked cut' : `${t.label} (Alt+${t.key})`}
				onclick={() => go(t.id)}>{t.label}</button
			>
		{/each}
	</div>
	<ol class="stages" aria-label="Stage">
		{#each STAGES as st, i (st)}
			<li class:done={reached(st)} class:here={s.stage === st}>{#if i}<span class="arrow">→</span>{/if}{st}</li>
		{/each}
	</ol>
	<span class="ver" title="The edit's version: +1 every time it is unlocked">v{s.version}</span>
	<span class="grow"></span>
	{#if !s.locked}
		<button class="act" onclick={() => s.lock()} disabled={!s.clips.length} title="Lock picture and sound; the Grade tab opens">🔒 Lock the edit</button>
	{:else}
		{#if s.stage === 'locked'}
			<button class="act" onclick={() => s.markGraded()} title="The grade is done">✓ Mark graded</button>
		{:else if s.stage === 'graded'}
			<button class="ghost small" onclick={() => s.markGraded(false)}>Grade again</button>
		{/if}
		<button class="ghost small" onclick={() => s.unlock()} title="Open the edit again, as version {s.version + 1}; clip grades are kept">Unlock (v{s.version + 1})</button>
	{/if}
</nav>

<style>
	.stagebar {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		width: 100%;
	}

	.tabs {
		display: flex;
		padding: 2px;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
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
		background: var(--ink);
		color: #fff;
	}

	.tabs button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.stages {
		display: flex;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.72rem;
		color: #b3b8ae;
	}

	.stages li.done {
		color: var(--dim);
	}

	.stages li.here {
		font-weight: 600;
		color: var(--ink);
	}

	.stages li.here::after {
		content: '';
		display: inline-block;
		width: 0.4rem;
		height: 0.4rem;
		margin-left: 0.25rem;
		border-radius: 50%;
		background: var(--accent);
		vertical-align: middle;
	}

	.arrow {
		margin-right: 0.25rem;
		color: #cfd3c9;
	}

	.ver {
		padding: 0 0.4rem;
		border-radius: 4px;
		background: var(--ink);
		font-size: 0.68rem;
		font-weight: 600;
		color: #fff;
	}


	.grow {
		flex: 1;
	}

	.act {
		padding: 0.32rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #fff;
		cursor: pointer;
	}

	.act:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
