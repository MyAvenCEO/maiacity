<!--
	A vault's functions, in the layout every avenDB view has (./Frame.svelte): on the left each of them, by the flow it
	hangs on: the vault's own, avenCEO GmbH's, then the app's; in the middle the one picked and how it is wired, the
	flow and the stage it hangs on, whether it runs as an entry enters that stage or leaves it, and for which kinds of
	entries, then its code (./flows.js, ./functions.js), and under it what every function is given, may hand back and
	its limits; on the right whose it is, whether it is on, the flow it is wired to, the entry that keeps it and its
	version. One whose flow this device doesn't know is wired to nothing and never runs.
-->
<script>
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { ASKS, everyFunction, stageTag } from './flows.js';
	import { RUN } from './functions.js';
	import { ago, list, nameOf, short } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, vault: string }} */
	let { world, vault } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const fns = $derived(everyFunction(world, vault));

	/** the name of stage `key` of flow `f` @param {import('./flows.js').Flow | null} f @param {string} key */
	const stageName = (f, key) => f?.stages.find((s) => s.key === key)?.name ?? key;
	/** "a todo", "an article" @param {string} t */
	const one = (t) => `${/^[aeiou]/i.test(t) ? 'an' : 'a'} ${t}`;
	/** what sets function `f` off, in words @param {ReturnType<typeof everyFunction>[number]} f */
	const when = (f) =>
		`${list((f.wired?.types ?? ['entry']).map(one))} ${f.on === 'leave' ? 'leaves' : 'enters'} ` +
		`${stageName(f.wired, f.stage)}`;
	/** what tells function `f` apart from every other @param {{ flow: string, name: string }} f */
	const keyOf = (f) => `${f.flow}\n${f.name}`;

	/** the functions by the flow they hang on, each group its flow's name; those wired to none last */
	const groups = $derived.by(() => {
		/** @type {Map<string, { name: string, fns: typeof fns }>} */
		const by = new Map();
		for (const f of fns) {
			const k = f.wired?.key ?? '';
			by.set(k, { name: f.wired?.name ?? 'Not wired', fns: [...(by.get(k)?.fns ?? []), f] });
		}
		return [...by].sort(([a], [b]) => Number(!a) - Number(!b)).map(([k, g]) => ({ key: k, ...g }));
	});

	/** the function picked on the left: the first listed until one is */
	let picked = $state('');
	const fn = $derived(fns.find((f) => keyOf(f) === picked) ?? groups[0]?.fns[0]);
	/** the entry that keeps the function shown, as this device holds it: none for one the app knows by heart */
	const kept = $derived(fn?.entry ? world.entries.find((e) => e.entry === fn.entry) : undefined);

	/** what a function is given, each field with what it holds */
	const EVENT = [
		['on', '"enter" or "leave"'],
		['flow, stage, tag', 'the flow, the stage it hangs on, and that stage’s tag'],
		['from, to', 'the stage the entry leaves and the one it enters'],
		['item', 'the entry moved: entry, vault, type, title, text, tags'],
		['posts', 'the posts about it its vault holds'],
		['now', 'the time, in seconds']
	];
</script>

<!-- the functions down the left, by the flow each hangs on -->
{#snippet shelf()}
	{#each groups as g (g.key)}
		<h3 class="nav-group">{g.name}</h3>
		{#each g.fns as f (keyOf(f))}
			{@const on = !!fn && keyOf(fn) === keyOf(f)}
			<button class="nav-item" class:on aria-pressed={on} data-pick onclick={() => (picked = keyOf(f))}
				><Icon name="fn" size={16} /><span>{f.name}</span>{#if f.wired && f.enabled === false}<small>Off</small>{/if}</button
			>
		{/each}
	{/each}
{/snippet}

<!-- on the right, the one place for the function shown: whose it is, whether it runs, its entry and version -->
{#snippet about()}
	{#if fn}
		<header class="about-head">
			<small>Function</small>
			<h3>{fn.name}</h3>
		</header>
		<h4 class="side-head">Where it is kept</h4>
		<dl class="facts">
			<dt>Whose</dt>
			<dd>{fn.vault ? nameOf(byId.get(fn.vault)) : 'Built into every app'}</dd>
			<dt>It is</dt>
			<dd>
				{#if !fn.wired}<span class="chip">Not wired</span>
				{:else if fn.enabled === false}<span class="chip">Off</span>
				{:else}<span class="chip ok">On</span>{/if}
			</dd>
			<dt>Flow</dt>
			<dd>
				{#if fn.wired}
					<a href="#flows">{fn.wired.name}</a> <span class="soft">· {stageName(fn.wired, fn.stage)}</span>
				{:else}
					<span class="soft">{fn.flow}, which this device doesn’t know</span>
				{/if}
			</dd>
			<dt>Entry</dt>
			{#if fn.entry}
				<dd class="mono" title={fn.entry}>{short(fn.entry)}</dd>
			{:else}
				<dd>None: the app knows it by heart</dd>
			{/if}
			<dt>Version</dt>
			<dd>{kept ? `Edit #${kept.edits}` : 'The app’s own'}</dd>
			{#if kept?.created}
				<dt>Made</dt>
				<dd>{ago(kept.created)}</dd>
			{/if}
		</dl>
	{/if}
{/snippet}

<Frame
	nav={fns.length ? shelf : undefined}
	aside={fn ? about : undefined}
	navLabel="{nameOf(here)}’s functions"
	asideLabel="The function’s details"
	navIcon="fn"
	asideIcon="info"
>
	<p class="lead soft">
		Functions are wired to a stage of a flow. Each runs as an entry enters that stage or leaves it, on the device that
		moves it, in QuickJS: no page, no network, no keys. It hands back the changes it asks for, and the device makes them
		as the vault acting there, on the entry’s vault alone, so every share still decides.
	</p>

	{#if fn}
		{@const f = fn}
		<section class="fn">
			<h3>
				<Icon name="fn" size={18} />
				{f.name}
				{#if !f.wired}<span class="chip">Not wired</span>
				{:else if f.enabled === false}<span class="chip">Off</span>{/if}
			</h3>
			{#if f.about}<p class="soft about">{f.about}</p>{/if}

			{#if f.wired}
				{@const w = f.wired}
				<div class="strip" aria-label="Where it hangs in {w.name}">
					<span class="flow-name"><Icon name="flow" size={14} /> {w.name}</span>
					{#each w.stages as s, i (s.id)}
						{#if i}<span class="sep" aria-hidden="true">›</span>{/if}
						<span class="stage" class:here={s.key === f.stage} class:open={s.public}>
							{s.name}
							{#if s.key === f.stage}
								<b class="trigger">{f.on === 'leave' ? '↤ as it leaves' : '↦ as it enters'}</b>
							{/if}
						</span>
					{/each}
				</div>
				<dl>
					<dt>Runs</dt>
					<dd>
						As {when(f)} in {w.name} (its tag <code>{stageTag(w.key, f.stage)}</code>
						{f.on === 'leave' ? 'comes off' : 'goes on'}), on the device that moves it.
					</dd>
				</dl>
			{:else}
				<p class="soft">Wired to flow <code>{f.flow}</code>, which this device doesn’t know, so it never runs.</p>
			{/if}

			<details class="code-box" open>
				<summary><Icon name="code" size={14} /> Its code</summary>
				<pre class="code">{f.code}</pre>
			</details>
		</section>
	{:else}
		<p class="empty">No functions yet.</p>
	{/if}

	<section class="fn how">
		<h3>How every function runs</h3>
		<dl>
			<dt>Is given</dt>
			<dd>
				<ul>
					{#each EVENT as [k, v] (k)}<li><code>{k}</code> <span class="soft">{v}</span></li>{/each}
				</ul>
			</dd>
			<dt>May hand back</dt>
			<dd>
				{#each ASKS as a (a)}<code class="op">{a}</code>{/each}
				<span class="soft">on the entry it moves, its posts and the entries it creates; a share is Public alone.</span>
			</dd>
			<dt>Its limits</dt>
			<dd class="soft">
				A fresh QuickJS engine for each run, with {RUN.mb} MB of memory and {RUN.ms} ms. One that throws, runs
				longer or hands back anything but ops changes nothing.
			</dd>
		</dl>
	</section>
</Frame>

<style>
	.lead {
		max-width: 46rem;
		margin: 0 0 1.2rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.fn {
		margin-bottom: 1.6rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
		font-size: 0.86rem;
	}

	.fn h3 {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 0.3rem;
	}

	.fn.how {
		background: #f8f7f3;
	}

	.about {
		margin: 0 0 0.7rem;
	}

	.strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin: 0.6rem 0 0.8rem;
		padding: 0.6rem;
		border-radius: 10px;
		background-color: #f8f7f3;
		background-image: radial-gradient(rgb(0 0 0 / 0.09) 1px, transparent 1px);
		background-size: 14px 14px;
	}

	.flow-name {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-right: 0.3rem;
		font-weight: 600;
	}

	.stage {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid rgb(0 0 0 / 0.18);
		border-radius: 8px;
		background: #fff;
	}

	.stage.open {
		border-color: #1f7a52;
		background: #eef6f1;
	}

	.stage.here {
		outline: 2px solid #7c3aed;
		outline-offset: 1px;
	}

	.trigger {
		font-size: 0.74rem;
		font-weight: 600;
		color: #7c3aed;
	}

	.sep {
		color: #8b8a84;
	}

	.fn dl {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr);
		gap: 0.45rem 0.8rem;
		margin: 0;
	}

	.fn dt {
		color: #6b6a65;
	}

	dd {
		margin: 0;
	}

	dd ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.op {
		margin-right: 0.3rem;
	}

	.code-box {
		margin-top: 0.8rem;
		border-top: 1px solid var(--edge);
		padding-top: 0.5rem;
	}

	.code-box summary {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		cursor: pointer;
	}

	.code {
		overflow-x: auto;
		margin: 0.4rem 0 0;
		padding: 0.6rem;
		border-radius: 8px;
		background: #1e1e1c;
		color: #f1efe8;
		font-size: 0.76rem;
		line-height: 1.45;
	}

	/* the right side: the function's name, then where it is kept */
	.about-head small {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.about-head h3 {
		margin: 0.15rem 0 0;
		font-size: 1.15rem;
		overflow-wrap: anywhere;
	}

	.side-head {
		margin: 1.3rem 0 0.5rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.facts {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.3rem 0.8rem;
		margin: 0;
		font-size: 0.8rem;
	}

	.facts dt {
		opacity: 0.6;
	}

	.facts dd {
		overflow-wrap: anywhere;
	}

	@media (max-width: 640px) {
		.fn dl {
			grid-template-columns: minmax(0, 1fr);
		}

		.fn dt {
			margin-top: 0.3rem;
		}
	}
</style>
