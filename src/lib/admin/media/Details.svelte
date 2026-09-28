<!--
	Everything the library knows about the open file: its tags as chips (a click filters the grid by one), every name
	it goes by, its CID, what it is and how big, what made it, and where the raw file and its public copy are.
-->
<script lang="ts">
	import type { MediaItem } from '$lib/auth/client';
	import {
		clock,
		dayTag,
		FACET_LABEL,
		facetOrder,
		raw,
		seconds,
		size,
		thumb,
		valueOrder,
		SUPERSEDED,
		UNUSED,
		type Parsed
	} from './facets';

	let {
		m,
		p,
		measure,
		onfilter
	}: {
		m: MediaItem;
		p: Parsed;
		measure: { w?: number; h?: number; d?: number } | undefined;
		/** filter the grid by this facet value ('day' takes the day's number) */
		onfilter: (key: string, value: string) => void;
	} = $props();

	let copied = $state('');
	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		copied = text;
		setTimeout(() => copied === text && (copied = ''), 1400);
	}

	const facets = $derived([...p.facets.entries()].sort(([a], [b]) => facetOrder(a, b)).map(([k, vs]) => [k, [...vs].sort(valueOrder(k))] as const));
	const w = $derived(Number(m.meta?.width) || measure?.w);
	const h = $derived(Number(m.meta?.height) || measure?.h);
	const d = $derived(seconds(m) ?? measure?.d);

	// what made it, in words; the long lists (a take's word timings) stay out
	const SHOWN = ['title', 'text', 'direction', 'voice', 'model', 'format', 'timeline'];
	const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);
	const meta = $derived.by(() => {
		const all = Object.entries(m.meta ?? {}).filter(
			([k, v]) => str(v) !== null && str(v) !== '' && !['width', 'height', 'duration_s', 'duration_ms', 'words', 'tags'].includes(k)
		);
		const rank = (k: string) => (SHOWN.includes(k) ? SHOWN.indexOf(k) : SHOWN.length);
		return all.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([k, v]) => [k, str(v)!] as const);
	});
</script>

<div class="details">
	<div class="mini" class:clear={/png|webp|gif/.test(m.mime)} style:aspect-ratio={w && h ? `${w} / ${h}` : undefined}>
		{#if m.kind === 'image'}
			<img src={thumb(m)} alt="" />
		{:else if m.kind === 'video'}
			<video src={raw(m.cid)} crossorigin="use-credentials" preload="metadata" muted playsinline onloadedmetadata={(e) => (e.currentTarget.currentTime = Math.min(5, (e.currentTarget.duration || 0) * 0.1))}></video>
		{:else}
			<span aria-hidden="true">{m.kind === 'audio' ? '♪' : '▤'}</span>
		{/if}
	</div>

	<h3>Tags</h3>
	<div class="chips">
		{#each p.days as n (n)}
			<button class="chip day" onclick={() => onfilter('day', String(n))}>{dayTag(n)}</button>
		{/each}
		{#if p.superseded}<span class="chip flag">{SUPERSEDED}</span>{/if}
		{#if p.unused}<span class="chip flag">{UNUSED}</span>{/if}
	</div>
	{#each facets as [k, vs] (k)}
		<div class="facet">
			<span class="k">{FACET_LABEL[k] ?? k}</span>
			<span class="chips">
				{#each vs as v (v)}<button class="chip" onclick={() => onfilter(k, v)}>{v}</button>{/each}
			</span>
		</div>
	{/each}

	{#if m.description}<h3>Description</h3><p class="desc">{m.description}</p>{/if}
	<h3>Public</h3>
	<p class="desc">{m.public ? 'Yes: the site or a platform shows it (copied to the CDN)' : 'No: a working file'}</p>

	<h3>CID</h3>
	<button class="cid" onclick={() => copy(m.cid)} title="Copy the CID">
		<code>{m.cid}</code>
		<span>{copied === m.cid ? 'Copied' : 'Copy'}</span>
	</button>

	<dl>
		<dt>Type</dt>
		<dd>{m.kind} · {m.mime}</dd>
		<dt>Size</dt>
		<dd>{size(m.size)}</dd>
		{#if w && h}
			<dt>Frame</dt>
			<dd>{w} × {h}</dd>
		{/if}
		{#if d && Number.isFinite(d)}
			<dt>Runs</dt>
			<dd>{clock(d)} <span class="dim">({d.toFixed(1)} s)</span></dd>
		{/if}
		<dt>Kept</dt>
		<dd>{new Date(m.created).toLocaleDateString()}</dd>
		{#each meta as [k, v] (k)}
			<dt>{k}</dt>
			<dd class:said={k === 'text' || k === 'direction'}>{v}</dd>
		{/each}
	</dl>

	<h3>Files</h3>
	<ul class="links">
		<li><a href={raw(m.cid)} target="_blank" rel="noopener">The raw file ↗</a></li>
		{#if m.cdn_path}
			<li><a href="https://maia.city/{m.cdn_path}" target="_blank" rel="noopener">Public copy on Bunny ↗</a></li>
		{:else if m.stream_guid}
			<li>Bunny Stream <code>{m.stream_guid}</code></li>
		{:else}
			<li class="dim">{m.public ? 'public: its copy on Bunny comes with the next bun media seed (production)' : 'private: a working file, never copied to Bunny'}</li>
		{/if}
	</ul>
</div>

<style>
	.details {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.84rem;
	}

	/* the file at its own shape (once it is known), whole, never taller than a third of the window */
	.mini {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 100%;
		aspect-ratio: 16 / 10;
		max-height: 33vh;
		border-radius: 10px;
		background: var(--cream);
		overflow: hidden;
		font-size: 1.8rem;
		color: var(--muted);
	}

	.mini img,
	.mini video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.mini.clear {
		background: repeating-conic-gradient(#3b413c 0 25%, #2d322e 0 50%) 0 0 / 12px 12px;
	}

	h3 {
		margin: 0.7rem 0 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.facet {
		display: grid;
		grid-template-columns: 3.8rem 1fr;
		align-items: baseline;
		gap: 0.4rem;
	}

	.k {
		font-size: 0.74rem;
		color: var(--muted);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.chip {
		padding: 0.12rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		font: inherit;
		font-size: 0.75rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	button.chip:hover {
		border-color: var(--mustard);
		background: var(--mustard);
		color: var(--ink);
	}

	.chip.day {
		border-color: var(--ink);
		color: var(--ink);
	}

	.chip.flag {
		border-style: dashed;
		cursor: default;
	}

	.desc {
		margin: 0;
		font-size: 0.84rem;
		line-height: 1.45;
		color: var(--ink-soft);
	}

	.links {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	code {
		overflow-wrap: anywhere;
		font-size: 0.74rem;
	}

	.cid {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: copy;
	}

	.cid span {
		flex: none;
		font-size: 0.74rem;
		color: var(--terracotta);
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.3rem 0.8rem;
		margin: 0.6rem 0 0;
	}

	dt {
		color: var(--muted);
	}

	dd {
		min-width: 0;
		margin: 0;
		overflow-wrap: anywhere;
	}

	dd.said {
		font-family: var(--font-display);
		font-style: italic;
	}

	.dim {
		color: var(--muted);
	}

	.links a {
		color: var(--terracotta);
	}
</style>
