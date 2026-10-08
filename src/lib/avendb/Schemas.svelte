<!--
	Schemas: a space's lane as the device holds it. Each schema version by its hash, with its JSON Schema; each lens, the
	two versions it joins and its steps; two versions compared; and, for every entry the device opens, the versions each
	commit was written under. The apps ship their own schemas and lenses, which a space's owners publish into its lane:
	until they do, an app reading a version it doesn't know opens it read-only.
-->
<script>
	import { diffLines, short } from './ui.js';

	/**
	 * @type {{
	 *   world: import('./tile.js').World,
	 *   device: string,
	 *   rev: number,
	 *   act: (a: Record<string, unknown>) => Promise<any>,
	 *   start: { space: string }
	 * }}
	 */
	let { world, device, rev, act, start } = $props();

	/** @type {any[]} */
	let spaces = $state([]);
	let space = $state('');
	/** @type {any} */
	let data = $state(null);
	let error = $state('');
	/** @type {string | null} */
	let shown = $state(null);
	let left = $state('');
	let right = $state('');

	$effect(() => {
		void rev;
		world.view({ view: 'spaces', on: device }).then(
			(v) => {
				spaces = v.spaces;
				if (!spaces.some((s) => s.id === space)) space = spaces.find((s) => s.id === start.space)?.id ?? spaces[0]?.id ?? '';
			},
			(e) => (error = e.message)
		);
	});

	$effect(() => {
		void rev;
		if (!space) return void (data = null);
		world.view({ view: 'schemas', on: device, space }).then(
			(v) => ([data, error] = [v, '']),
			(e) => ([data, error] = [null, e.message])
		);
	});

	/** every version either the lane or an app knows, by hash */
	const versions = $derived.by(() => {
		/** @type {Map<string, { id: string, title: string, json: string }>} */
		const by = new Map();
		for (const s of [...(data?.schemas ?? []), ...(data?.apps ?? []).filter((/** @type {any} */ a) => !a.lens)]) by.set(s.id, s);
		return [...by.values()];
	});

	$effect(() => {
		if (!versions.some((v) => v.id === left)) left = versions[0]?.id ?? '';
		if (!versions.some((v) => v.id === right)) right = versions[1]?.id ?? left;
	});

	/** @param {string} id */
	const titled = (id) => versions.find((v) => v.id === id)?.title ?? `schema ${short(id)}`;
	/** @param {string} id */
	const inLane = (id) => [...(data?.schemas ?? []), ...(data?.lenses ?? [])].some((x) => x.id === id);
	/** @param {string} json */
	const tidy = (json) => {
		try {
			return JSON.stringify(JSON.parse(json), null, 2);
		} catch {
			return json;
		}
	};
	/** A lens's steps, from its JSON. @param {string} json @returns {any[]} */
	const stepsOf = (json) => {
		try {
			return JSON.parse(json).steps ?? [];
		} catch {
			return [];
		}
	};
	/** @param {string} id */
	const toggle = (id) => (shown = shown === id ? null : id);
</script>

<div class="row">
	<span class="soft">The lane of</span>
	<select class="field" bind:value={space}>
		{#each spaces as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
	</select>
</div>

{#if error}<p class="error">{error}</p>{/if}

{#if data}
	<h2 class="part">Versions in the lane</h2>
	{#each data.schemas as s (s.id)}
		<div class="item">
			<button class="head" onclick={() => toggle(s.id)}>
				<b>{s.title}</b>
				<span class="mono soft">{short(s.id)}</span>
				<span class="soft">{shown === s.id ? 'Hide' : 'Show'} the JSON Schema</span>
			</button>
			{#if shown === s.id}<pre class="json">{tidy(s.json)}</pre>{/if}
		</div>
	{:else}
		<p class="empty">No schema in this lane yet: every app reads what it was written in, and nothing else.</p>
	{/each}

	<h2 class="part">Lenses</h2>
	{#each data.lenses as l (l.id)}
		<div class="item">
			<button class="head" onclick={() => toggle(l.id)}>
				<b>{l.title}</b>
				<span class="mono soft">{short(l.id)}</span>
				<span class="soft">{titled(l.from)} ⇄ {titled(l.to)}</span>
			</button>
			<ol class="steps">
				{#each stepsOf(l.json) as step, i (i)}<li><code>{JSON.stringify(step)}</code></li>{/each}
			</ol>
			{#if shown === l.id}<pre class="json">{tidy(l.json)}</pre>{/if}
		</div>
	{:else}
		<p class="empty">No lens: an app opens only what was written in its own version, and the rest read-only.</p>
	{/each}

	<h2 class="part">Compare two versions</h2>
	{#if versions.length > 1}
		<div class="row">
			<select class="field" bind:value={left}>
				{#each versions as v (v.id)}<option value={v.id}>{v.title} · {short(v.id)}</option>{/each}
			</select>
			<span class="soft">against</span>
			<select class="field" bind:value={right}>
				{#each versions as v (v.id)}<option value={v.id}>{v.title} · {short(v.id)}</option>{/each}
			</select>
		</div>
		{@const a = versions.find((v) => v.id === left)}
		{@const b = versions.find((v) => v.id === right)}
		{#if a && b}
			<div class="diff spaced">
				{#each diffLines(tidy(a.json), tidy(b.json)) as d, i (i)}
					<div class:add={d.op === '+'} class:del={d.op === '-'}>{d.op} {d.text}</div>
				{/each}
			</div>
		{/if}
	{/if}

	<h2 class="part">What each commit was written under</h2>
	{#each data.written as w (w.entry)}
		<div class="item">
			<b>{w.title ?? `entry ${short(w.entry)}`}</b>
			<ul class="written">
				{#each w.commits as c (c.op)}
					<li>
						<span class="mono soft">{short(c.op)}</span>
						<span class="chip">{c.kind}</span>
						<span class="soft">{c.author.name}</span>
						{#each c.schemas as s (s)}<span class="chip accent" title={s}>{titled(s)}</span>{:else}<span class="soft">no schema: a restore</span>{/each}
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<p class="empty">This device opens no entry in this space.</p>
	{/each}

	<h2 class="part">The apps' own</h2>
	<p class="soft small">What the document and todo apps ship. {data.mayPublish ? "An owner of this space, this device publishes them into its lane." : 'Only an owner of this space publishes into its lane.'}</p>
	<ul class="apps">
		{#each data.apps as a (a.id)}
			<li>
				<b>{a.title}</b>
				<span class="mono soft">{short(a.id)}</span>
				{#if inLane(a.id)}
					<span class="chip ok">in the lane</span>
				{:else}
					<button class="btn" disabled={!data.mayPublish} onclick={() => act({ do: 'publish', space, blob: a.id })}>Publish it here</button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.item {
		max-width: 60rem;
		margin-bottom: 0.6rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: baseline;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.head span:last-child {
		margin-left: auto;
		font-size: 0.8rem;
	}

	.item pre {
		margin-top: 0.6rem;
	}

	.steps {
		margin: 0.5rem 0 0;
		padding-left: 1.3rem;
		font-size: 0.78rem;
	}

	.steps code {
		word-break: break-word;
	}

	.spaced {
		margin-top: 0.6rem;
	}

	.written,
	.apps {
		margin: 0.4rem 0 0;
		padding: 0;
		list-style: none;
	}

	.written li,
	.apps li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		align-items: center;
		padding: 0.3rem 0;
		font-size: 0.85rem;
	}

	.apps li {
		max-width: 60rem;
		border-bottom: 1px solid var(--edge);
	}

	.small {
		font-size: 0.84rem;
	}
</style>
