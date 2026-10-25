<!--
	The code packages (Samuel 2026-10-21: "another code app like the models app"): the programs theOS runs on the Mac
	beside its own code, Lean first, as src/lib/code/packages.json pins them (the one list, which avendb-device's lean.rs
	builds in), in the layout every avenDB view has (./Frame.svelte): on the left every package; in the middle the one
	picked, what it does and its files, each with its pinned size, its BLAKE3 and its publisher's SHA-256 and whether the
	vault holds it, a `file` entry tagged `blake3:<its pin>` (scripts/propose-code.mjs proposes the missing ones as one
	AIP); on the right its pins. A Mac brings a package only from avenDB, and unpacks a file only when its bytes hash to
	its pins. Each has an address of its own, `#code/` and its id. In theOS, Lean's own page gets it onto this Mac (Get
	Lean, `leanGet`) or says it is here (Samuel 2026-10-21: with no AIP at the objective stage, the AIP page had nowhere
	to offer it).
-->
<script>
	// @ts-nocheck — plain JS
	import Frame from './Frame.svelte';
	import { entryCollection } from './entry-collection.svelte.js';
	import { packageQuery, missingPackageLabel } from './package-inventory.js';
	import Icon from './Icon.svelte';
	import { session } from './session.svelte.js';
	import { ago, nameOf, reads, short, size } from './vaults.js';
	import PINS from '$lib/code/packages.json';

	/** @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, entry?: string }} */
	let { world, vault, actor, api, entry = '' } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const packages = PINS.packages;

	/** the package shown: the one the address names, else the first */
	const shown = $derived(packages.find((p) => p.id === entry) ?? packages[0]);

	const inventory = entryCollection(() => api, () => packageQuery(vault, actor));
	/** the vault's locally discovered file entries by their pins; file bytes may still be absent. */
	const held = $derived(
		new Map(
			inventory.rows
				.filter((e) => e.vault === vault && e.type === 'file' && !e.deleted && !(e.tags ?? []).includes('avendb:deleted') && reads(e, actor))
				.flatMap((e) => (e.tags ?? []).filter((t) => t.startsWith('blake3:')).map((t) => [t.slice(7), e]))
		)
	);
	/** how many of package `p`'s files the vault holds */
	const count = (p) => p.files.filter((f) => held.has(f.blake3)).length;
	const total = (p) => p.files.reduce((s, f) => s + f.size, 0);
	/** the systems a file runs on, as a person names them */
	const SYSTEMS = { 'macos aarch64': 'Mac, Apple silicon', 'macos x86_64': 'Mac, Intel', 'linux x86_64': 'Linux' };
	const system = (f) => SYSTEMS[`${f.os} ${f.arch}`] ?? `${f.os} ${f.arch}`;

	/** Lean on this Mac, in theOS (avendb-device's `leanEngine`): `{version, can, here, download, kept, getting, failed}` */
	let lean = $state(null);
	const readLean = async () => (lean = (await session.mac?.call('leanEngine').catch(() => null)) ?? lean);
	$effect(() => {
		if (session.mac && shown.id === 'lean' && !lean) readLean();
	});
	const GETTING = 'Getting Lean for this Mac';
	/** brings Lean's archive from avenDB and unpacks it, saying how far it got (as the AIP page's Get Lean) */
	async function getLean() {
		const poll = setInterval(async () => {
			const at = (await readLean())?.getting;
			if (at && session.doing.startsWith(GETTING)) session.doing = `${GETTING}: ${size(at.at)} of ${size(at.of)}`;
		}, 1000);
		try {
			await session.attempt(GETTING, async () => (lean = await session.mac.call('leanGet')));
		} finally {
			clearInterval(poll);
			await readLean();
		}
	}
</script>

<!-- every package down the left -->
{#snippet list()}
	<h3 class="nav-group">Packages</h3>
	{#each packages as p (p.id)}
		{@const on = shown?.id === p.id}
		<a class="nav-item" class:on href="#code/{p.id}" aria-current={on ? 'page' : undefined} data-pick
			><Icon name="code" size={16} /><span>{p.label} {p.version}</span><small class="tally">{count(p)}/{p.files.length}</small></a
		>
	{/each}
{/snippet}

<!-- on the right, the package's pins: its version, its files -->
{#snippet about()}
	<header class="about-head">
		<small>Package</small>
		<h3>{shown.label} {shown.version}</h3>
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
		<dd class="mono">src/lib/code/packages.json</dd>
	</dl>
{/snippet}

<Frame nav={list} aside={about} navLabel="The code packages" asideLabel="The package’s pins" navIcon="code" asideIcon="info">
	<section class="model">
		<p class="kind">{shown.task}</p>
		<h2>{shown.label} {shown.version}</h2>
		{#if shown.note}<p class="soft">{shown.note}</p>{/if}
		<p class="soft">
			theOS brings a package only from avenDB, a <span class="mono">file</span> entry tagged with its pin, and unpacks a
			file only when its bytes hash to both pins below.
		</p>
	</section>

	{#if lean && shown.id === 'lean'}
		<section class="mac">
			<h3>On this Mac</h3>
			{#if lean.here}
				<p class="state ok"><Icon name="check" size={14} /> Lean {lean.version} is here, {size(lean.kept)} kept: theOS checks AIP objectives with it.</p>
			{:else if lean.can}
				<p class="soft">
					Lean {lean.version} checks AIP objectives on this Mac, locked away from your files and the network: {size(lean.download)} read
					from avenDB, {size(lean.kept)} kept.{lean.failed ? ` The last try failed: ${lean.failed}` : ''}
				</p>
				<button class="btn primary" disabled={!!session.doing} onclick={getLean}>Get Lean</button>
			{:else}
				<p class="soft">No Lean is pinned for this Mac: it runs only on Macs with Apple silicon.</p>
			{/if}
		</section>
	{/if}

	<ul class="files">
		{#each shown.files as f (f.blake3)}
			{@const e = held.get(f.blake3)}
			<li>
				<div class="line">
					<Icon name="file" size={16} />
					<strong class="mono">{f.name}</strong>
					<span class="soft">{size(f.size)}, {size(f.kept)} kept, {system(f)}</span>
					{#if e}
						<span class="state ok" title={e.entry}><Icon name="check" size={14} /> Entry in {nameOf(here)}, entry {short(e.entry)}{e.created ? `, ${ago(e.created)}` : ''}</span>
					{:else}
						<span class="state">{missingPackageLabel(inventory.phase)}</span>
					{/if}
				</div>
				<div class="pin mono" title="BLAKE3 of its bytes, its tag in avenDB">BLAKE3 {f.blake3}</div>
				<div class="pin mono" title="SHA-256 of its bytes, as its publisher gives it">SHA-256 {f.sha256}</div>
				<div class="soft small">
					Published at <a href={f.source} rel="noreferrer noopener" target="_blank">{new URL(f.source).host}</a>
				</div>
			</li>
		{/each}
	</ul>

	{#if count(shown) < shown.files.length}
		<p class="empty" role="status">{missingPackageLabel(inventory.phase)}. This local list can grow as authorized entries arrive; it does not establish that files are missing from other peers.</p>
	{/if}
	<p class="soft small">Counts describe locally discovered file entries, not downloaded or verified package bytes.</p>
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

	.mac {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		max-width: 44rem;
		margin-bottom: 1rem;
		padding: 0.8rem 1rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: var(--card, #fff);
	}

	.mac h3 {
		margin: 0;
		font-size: 1rem;
	}

	.mac p {
		margin: 0;
	}

	.mac .state {
		margin-left: 0;
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
