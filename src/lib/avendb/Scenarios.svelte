<!--
	The plan's scenarios, each played on a Lab of its own (the tile's world stays as it is): every check green or red,
	with what was found where a check failed and the step a scenario stopped at if the rules refused it.
-->
<script>
	import { onMount } from 'svelte';

	/** @type {{ world: import('./tile.js').World }} */
	let { world } = $props();

	/** @type {{ number: string, title: string, phase: string }[]} */
	let list = $state([]);
	/** @type {Record<string, any>} */
	let runs = $state({});
	/** @type {string | null} */
	let running = $state(null);
	let all = $state(false);
	/** @type {string | null} */
	let shown = $state(null);

	onMount(async () => {
		list = await world.scenarios();
	});

	/** @param {string} n */
	async function run(n) {
		running = n;
		try {
			runs[n] = await world.run(n);
		} catch (e) {
			runs[n] = { error: e instanceof Error ? e.message : String(e) };
		}
		running = null;
	}

	async function runAll() {
		all = true;
		for (const s of list) {
			if (!all) break;
			await run(s.number);
		}
		all = false;
	}

	const done = $derived(Object.values(runs));
	const passed = $derived(done.filter((r) => r.passed).length);
</script>

<div class="row bar">
	<button class="btn primary" disabled={!!running} onclick={runAll}>Run every scenario</button>
	{#if all}<button class="btn quiet" onclick={() => (all = false)}>Stop after this one</button>{/if}
	{#if done.length}
		<span class="chip" class:ok={passed === done.length} class:bad={passed < done.length}>{passed} of {done.length} green</span>
	{/if}
	<span class="soft small">Each plays on a world of its own; the first takes longest, while its keys' pairs are made.</span>
</div>

<ol class="scenarios">
	{#each list as s (s.number)}
		{@const r = runs[s.number]}
		<li class:ok={r?.passed} class:bad={r && !r.passed}>
			<div class="row">
				<span class="n">{s.number}</span>
				<button class="title" onclick={() => (shown = shown === s.number ? null : s.number)}>{s.title}</button>
				<span class="chip">{s.phase}</span>
				{#if r?.error}
					<span class="chip bad">error</span>
				{:else if r}
					<span class="chip" class:ok={r.passed} class:bad={!r.passed}>{r.checks.filter((/** @type {any} */ c) => c.ok).length} of {r.checks.length} checks</span>
					<span class="soft small">{(r.ms / 1000).toFixed(1)} s</span>
				{/if}
				<button class="btn" disabled={!!running} onclick={() => run(s.number)}>{running === s.number ? 'Running…' : r ? 'Run again' : 'Run'}</button>
			</div>
			{#if r && (shown === s.number || !r.passed)}
				{#if r.error}
					<p class="error">{r.error}</p>
				{:else}
					<ul class="checks">
						{#each r.checks as c, i (i)}
							<li class:ok={c.ok} class:bad={!c.ok}>
								<span class="mark">{c.ok ? '✓' : '✕'}</span>
								<span>{c.what}{#if !c.ok && c.found}<span class="found"> found: {c.found}</span>{/if}</span>
							</li>
						{/each}
					</ul>
					{#if r.stopped}<p class="error">Stopped: {r.stopped}</p>{/if}
				{/if}
			{/if}
		</li>
	{/each}
</ol>

<style>
	.bar {
		margin-bottom: 0.8rem;
	}

	.small {
		font-size: 0.8rem;
	}

	.scenarios {
		max-width: 64rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.scenarios > li {
		padding: 0.55rem 0.7rem;
		border-left: 3px solid transparent;
		border-bottom: 1px solid var(--edge);
	}

	.scenarios > li.ok {
		border-left-color: var(--ok);
	}

	.scenarios > li.bad {
		border-left-color: var(--bad);
	}

	.n {
		min-width: 2.2rem;
		font-weight: 600;
		color: var(--soft);
	}

	.title {
		flex: 1;
		min-width: 10rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.checks {
		margin: 0.4rem 0 0 2.6rem;
		padding: 0;
		list-style: none;
		font-size: 0.84rem;
	}

	.checks li {
		display: flex;
		gap: 0.5rem;
		padding: 0.12rem 0;
	}

	.mark {
		width: 1rem;
		font-weight: 700;
	}

	.checks li.ok .mark {
		color: var(--ok);
	}

	.checks li.bad .mark,
	.found {
		color: var(--bad);
	}
</style>
