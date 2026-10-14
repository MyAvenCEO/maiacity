<!--
	A vault's functions, each with how it is wired: the flow and the stage it hangs on, whether it runs as an entry
	enters that stage or leaves it, and for which kinds of entries; then where it runs, what it is given, what it may
	hand back, and its code (./flows.js, ./functions.js). First a table of all of them, then what every function is
	given and may do, then each on its own: the vault's own, avenCEO GmbH's, then the app's. One whose flow this device
	doesn't know is wired to nothing and never runs.
-->
<script>
	import Icon from './Icon.svelte';
	import { ASKS, everyFunction, stageTag } from './flows.js';
	import { RUN } from './functions.js';
	import { list, nameOf } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, vault: string }} */
	let { world, vault } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const fns = $derived(everyFunction(world, vault));

	/** whose a function is, in words: a vault's, or built into every app @param {{ vault?: string }} x */
	const from = (x) => (x.vault ? `${nameOf(byId.get(x.vault))}’s` : 'Built in');
	/** the name of stage `key` of flow `f` @param {import('./flows.js').Flow | null} f @param {string} key */
	const stageName = (f, key) => f?.stages.find((s) => s.key === key)?.name ?? key;
	/** "a todo", "an article" @param {string} t */
	const one = (t) => `${/^[aeiou]/i.test(t) ? 'an' : 'a'} ${t}`;
	/** what sets function `f` off, in words @param {ReturnType<typeof everyFunction>[number]} f */
	const when = (f) =>
		`${list((f.wired?.types ?? ['entry']).map(one))} ${f.on === 'leave' ? 'leaves' : 'enters'} ` +
		`${stageName(f.wired, f.stage)}`;
	/** an id for function `f`'s card on the page @param {{ flow: string, name: string }} f */
	const anchor = (f) => `fn-${f.flow}-${f.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	/** scrolls to function `f`'s card @param {{ flow: string, name: string }} f */
	const show = (f) => document.getElementById(anchor(f))?.scrollIntoView({ behavior: 'smooth' });

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

<p class="lead soft">
	Functions are wired to a stage of a flow. Each runs as an entry enters that stage or leaves it, on the device that
	moves it, in QuickJS: no page, no network, no keys. It hands back the changes it asks for, and the device makes them
	as the vault acting there, on the entry’s vault alone, so every share still decides.
</p>

{#if fns.length}
	<div class="wiring">
		<table>
			<thead>
				<tr><th>Function</th><th>Runs when</th><th>Flow</th><th>Whose</th><th></th></tr>
			</thead>
			<tbody>
				{#each fns as f (anchor(f))}
					<tr class:off={f.enabled === false || !f.wired}>
						<td><button class="link" onclick={() => show(f)}>{f.name}</button></td>
						<td>{f.wired ? when(f) : '—'}</td>
						<td>
							{#if f.wired}
								<a href="#flows">{f.wired.name}</a>
								<small class="soft">· {stageName(f.wired, f.stage)}</small>
							{:else}
								<span class="soft">{f.flow}, which this device doesn’t know</span>
							{/if}
						</td>
						<td>{from(f)}</td>
						<td>
							{#if !f.wired}<span class="chip">Not wired</span>
							{:else if f.enabled === false}<span class="chip">Off</span>
							{:else}<span class="chip ok">On</span>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<p class="soft">No functions yet.</p>
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

{#each fns as f (anchor(f))}
	<section class="fn" id={anchor(f)}>
		<h3>
			<Icon name="fn" size={18} />
			{f.name}
			<small class="soft">{from(f)}</small>
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
				{#if f.entry}
					<dt>Kept as</dt>
					<dd>An entry of {nameOf(byId.get(f.vault ?? ''))}: <code class="soft">{f.entry.slice(0, 16)}…</code></dd>
				{/if}
			</dl>
		{:else}
			<p class="soft">Wired to flow <code>{f.flow}</code>, which this device doesn’t know, so it never runs.</p>
		{/if}

		<details class="code-box">
			<summary><Icon name="code" size={14} /> Its code</summary>
			<pre class="code">{f.code}</pre>
		</details>
	</section>
{/each}

<style>
	.lead {
		max-width: 46rem;
		margin: 0 0 1.2rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.wiring {
		overflow-x: auto;
		margin-bottom: 1.6rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.84rem;
	}

	th,
	td {
		padding: 0.5rem 0.7rem;
		border-bottom: 1px solid var(--edge);
		text-align: left;
		white-space: nowrap;
	}

	th {
		font-weight: 600;
		font-size: 0.76rem;
		color: #6b6a65;
	}

	tr:last-child td {
		border-bottom: none;
	}

	tr.off td {
		color: #8b8a84;
	}

	td a,
	.link {
		color: inherit;
	}

	.link {
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	.fn {
		margin-bottom: 1.6rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
		font-size: 0.86rem;
		scroll-margin-top: 1rem;
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

	.fn h3 small {
		font-weight: 400;
		font-size: 0.8rem;
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

	dl {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr);
		gap: 0.45rem 0.8rem;
		margin: 0;
	}

	dt {
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

	@media (max-width: 640px) {
		dl {
			grid-template-columns: minmax(0, 1fr);
		}

		dt {
			margin-top: 0.3rem;
		}
	}
</style>
