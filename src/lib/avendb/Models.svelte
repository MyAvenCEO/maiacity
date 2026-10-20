<!--
	The models (Samuel 2026-10-20: "a model viewer" in avenDB, the models kept by the Maia City COOP): the speech models
	The OS runs on the Mac, as src/lib/models/models.json pins them (the one list, which vault/app/src/models.rs builds
	in), in the layout every avenDB view has (./Frame.svelte): on the left every model; in the middle the one picked, what
	it does and its files, each with its pinned size and BLAKE3 and whether the vault holds it, a `file` entry tagged
	`blake3:<its pin>` (scripts/propose-models.mjs proposes the missing ones as one AIP); on the right where it came from.
	A Mac loads a file only when its bytes hash to its pin, wherever it was brought from. Each has an address of its own,
	`#models/` and its id.
-->
<script>
	// @ts-nocheck — plain JS
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { ago, nameOf, reads, short, size } from './vaults.js';
	import PINS from '$lib/models/models.json';

	/** @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, entry?: string }} */
	let { world, vault, actor, entry = '' } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const models = PINS.models;

	/** the model shown: the one the address names, else the first */
	const shown = $derived(models.find((m) => m.id === entry) ?? models[0]);

	/** the vault's file entries by the pin they are tagged with */
	const held = $derived(
		new Map(
			world.entries
				.filter((e) => e.vault === vault && e.type === 'file' && !e.deleted && !(e.tags ?? []).includes('avendb:deleted') && reads(e, actor))
				.flatMap((e) => (e.tags ?? []).filter((t) => t.startsWith('blake3:')).map((t) => [t.slice(7), e]))
		)
	);
	/** how many of model `m`'s files the vault holds */
	const count = (m) => m.files.filter((f) => held.has(f.blake3)).length;
	const total = (m) => m.files.reduce((s, f) => s + f.size, 0);
	/** where a file was published: its host, or what made it */
	const from = (src) => (src.startsWith('https://') ? new URL(src).host : src);
</script>

<!-- every model down the left -->
{#snippet list()}
	<h3 class="nav-group">Speech</h3>
	{#each models as m (m.id)}
		{@const on = shown?.id === m.id}
		<a class="nav-item" class:on href="#models/{m.id}" aria-current={on ? 'page' : undefined} data-pick
			><Icon name="audio" size={16} /><span>{m.label}</span><small class="tally">{count(m)}/{m.files.length}</small></a
		>
	{/each}
{/snippet}

<!-- on the right, the model's pins: its version, where it came from -->
{#snippet about()}
	<header class="about-head">
		<small>Model</small>
		<h3>{shown.label}</h3>
	</header>
	<h4 class="side-head">Its pins</h4>
	<dl class="facts">
		<dt>Id</dt>
		<dd class="mono">{shown.id}</dd>
		<dt>Version</dt>
		<dd>{shown.version}</dd>
		<dt>Files</dt>
		<dd>{shown.files.length}, {size(total(shown))}</dd>
		<dt>Held</dt>
		<dd>{count(shown)} of {shown.files.length} in {nameOf(here)}</dd>
		<dt>Pinned in</dt>
		<dd class="mono">src/lib/models/models.json</dd>
	</dl>
{/snippet}

<Frame nav={list} aside={about} navLabel="The models" asideLabel="The model’s pins" navIcon="audio" asideIcon="info">
	<section class="model">
		<p class="kind">{shown.task}</p>
		<h2>{shown.label}</h2>
		{#if shown.note}<p class="soft">{shown.note}</p>{/if}
		<p class="soft">
			The OS loads a file only when its bytes hash to its pin below, wherever it brought it from. It brings each from
			Maia City in avenDB, a <span class="mono">file</span> entry tagged with its pin.
		</p>
	</section>

	<ul class="files">
		{#each shown.files as f (f.blake3)}
			{@const e = held.get(f.blake3)}
			<li>
				<div class="line">
					<Icon name="file" size={16} />
					<strong class="mono">{f.name}</strong>
					<span class="soft">{size(f.size)}</span>
					{#if e}
						<span class="state ok" title={e.entry}><Icon name="check" size={14} /> In {nameOf(here)}, entry {short(e.entry)}{e.created ? `, ${ago(e.created)}` : ''}</span>
					{:else}
						<span class="state">Not in {nameOf(here)} yet</span>
					{/if}
				</div>
				<div class="pin mono" title="BLAKE3 of its bytes">BLAKE3 {f.blake3}</div>
				<div class="soft small">
					From
					{#if f.source.startsWith('https://')}<a href={f.source} rel="noreferrer noopener" target="_blank">{from(f.source)}</a>{:else}{f.source}{/if}
				</div>
			</li>
		{/each}
	</ul>

	{#if count(shown) < shown.files.length}
		<p class="empty">
			{#if here?.name === 'Maia City'}
				The missing files go in as one AIP (<span class="mono">bun scripts/propose-models.mjs --run</span> on the Mac),
				then land here once an owner accepts it in Proposals.
			{:else}
				The models are kept in Maia City: pick it in the nav pill.
			{/if}
		</p>
	{/if}
</Frame>

<style>
	.model {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 44rem;
		margin-bottom: 1rem;
	}

	.model p {
		margin: 0;
	}

	.kind {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	h2 {
		margin: 0;
		font-size: 1.6rem;
	}

	.files {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: 44rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.files li {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.8rem 1rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: var(--card, #fff);
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.line strong {
		overflow-wrap: anywhere;
	}

	.state {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
		color: var(--soft);
		font-size: 0.78rem;
	}

	.state.ok {
		color: var(--accent);
	}

	.pin {
		font-size: 0.72rem;
		opacity: 0.7;
		overflow-wrap: anywhere;
	}

	.small {
		font-size: 0.78rem;
	}

	.tally {
		margin-left: auto;
		opacity: 0.6;
	}

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
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
