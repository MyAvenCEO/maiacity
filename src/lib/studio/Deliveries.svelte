<!--
	Deliveries (the right of the Render tab): every file the last render made, by shape — format, codec, size, the
	channels it is for, and whatever the worker reports with it (QC checks, loudness, …; any field it adds shows). A
	delivery opens in the viewer.
-->
<script lang="ts">
	import { SHAPES, raw, type Studio } from './studio.svelte';

	let { s }: { s: Studio } = $props();

	const KNOWN = new Set(['channels', 'cid', 'format', 'aspect', 'width', 'height', 'codec', 'bytes', 'seconds', 'note', 'kind', 'timeline', 'cut', 'qc', 'loudness', 'lufs', 'true_peak', 'truePeak']);
	const byShape = $derived.by(() => {
		const map = new Map<string, typeof s.deliveries>();
		for (const d of s.deliveries) map.set(d.aspect ?? '?', [...(map.get(d.aspect ?? '?') ?? []), d]);
		return [...map.entries()].sort(([a], [b]) => (SHAPES.indexOf(a as never) + 99) % 99 - (SHAPES.indexOf(b as never) + 99) % 99);
	});
	const mb = (b: unknown) => (typeof b === 'number' ? `${(b / 1e6).toFixed(b > 1e8 ? 0 : 1)} MB` : '');
	const secs = (x: unknown) => (typeof x === 'number' && x > 0 ? `${x.toFixed(1)} s` : '');
	/** A QC report in whatever shape the worker gives it: { ok, checks: { name: ok | { ok, note } } }, a list, or a plain flag. */
	function qcOf(q: unknown): { ok: boolean | null; items: { name: string; ok: boolean | null; note?: string }[] } | null {
		if (q === undefined || q === null) return null;
		if (typeof q === 'boolean') return { ok: q, items: [] };
		if (Array.isArray(q)) {
			const items = q.map((x, i) => ({ name: String(x?.name ?? x?.check ?? `check ${i + 1}`), ok: typeof x?.ok === 'boolean' ? x.ok : typeof x?.pass === 'boolean' ? x.pass : null, note: x?.note ?? x?.message }));
			return { ok: items.every((i) => i.ok !== false), items };
		}
		if (typeof q === 'object') {
			const o = q as Record<string, unknown>;
			const checks = (o.checks && typeof o.checks === 'object' ? o.checks : Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'ok'))) as Record<string, unknown>;
			const items = Object.entries(checks).map(([name, v]) => ({
				name,
				ok: typeof v === 'boolean' ? v : typeof (v as { ok?: unknown })?.ok === 'boolean' ? ((v as { ok: boolean }).ok) : null,
				note: typeof v === 'object' && v ? String((v as { note?: unknown }).note ?? (v as { value?: unknown }).value ?? '') || undefined : typeof v === 'boolean' ? undefined : String(v)
			}));
			return { ok: typeof o.ok === 'boolean' ? o.ok : items.every((i) => i.ok !== false), items };
		}
		return { ok: null, items: [{ name: String(q), ok: null }] };
	}
	function loudOf(d: Record<string, unknown>): string | null {
		const l = (d.loudness ?? {}) as Record<string, unknown>;
		const lufs = l.lufs ?? l.integrated ?? l.I ?? d.lufs;
		const tp = l.truePeak ?? l.true_peak ?? l.TP ?? d.truePeak ?? d.true_peak;
		const parts = [lufs !== undefined ? `${Number(lufs).toFixed(1)} LUFS` : '', tp !== undefined ? `${Number(tp).toFixed(1)} dBTP` : ''].filter(Boolean);
		return parts.length ? parts.join(' · ') : null;
	}
	const extra = (d: Record<string, unknown>) => Object.entries(d).filter(([k, v]) => !KNOWN.has(k) && v !== undefined && v !== null && v !== '');
	const show = (v: unknown) => (typeof v === 'object' ? JSON.stringify(v) : String(v));
</script>

<aside class="dl">
	<h2>Deliveries</h2>
	{#if !s.deliveries.length}
		<p class="hint">{s.focus?.status === 'done' ? 'The last render left no deliveries on record.' : 'None yet: render the timeline, and every shape’s files show here.'}</p>
	{/if}
	{#each byShape as [shape, list] (shape)}
		<section>
			<h3><span class="shape">{shape}</span> {list.length} file{list.length === 1 ? '' : 's'}</h3>
			{#each list as d (d.cid + (d.kind ?? '') + d.codec)}
				{@const qc = qcOf(d.qc)}
				{@const loud = loudOf(d)}
				<div class="card" class:thumb={d.kind === 'thumbnail'}>
					<div class="top">
						<b>{d.format ?? d.codec ?? 'file'}</b>
						{#if qc}<span class="qc" class:ok={qc.ok === true} class:bad={qc.ok === false}>QC {qc.ok === true ? 'passed' : qc.ok === false ? 'failed' : '—'}</span>{/if}
					</div>
					<p class="spec">
						{[d.codec, d.width && d.height ? `${d.width}×${d.height}` : '', secs(d.seconds), mb(d.bytes)].filter(Boolean).join(' · ')}
					</p>
					{#if d.channels?.length}<p class="ch">{d.channels.join(' · ')}</p>{/if}
					{#if loud}<p class="loud">{loud}</p>{/if}
					{#if qc?.items.length}
						<ul class="checks">
							{#each qc.items as it (it.name)}<li class:ok={it.ok === true} class:bad={it.ok === false}>{it.ok === true ? '✓' : it.ok === false ? '✗' : '·'} {it.name}{#if it.note} <i>{it.note}</i>{/if}</li>{/each}
						</ul>
					{/if}
					{#if d.note}<p class="note">{d.note}</p>{/if}
					{#each extra(d) as [k, v] (k)}<p class="x"><span>{k}</span> {show(v)}</p>{/each}
					<div class="acts">
						<button class="ghost small" onclick={() => s.openFile(d.cid)}>▶ View</button>
						<a class="ghost small" href={raw(d.cid)} target="_blank" rel="noopener">File ↗</a>
					</div>
				</div>
			{/each}
		</section>
	{/each}
</aside>

<style>
	.dl {
		grid-area: inspector;
		min-height: 0;
		padding: 0.9rem;
		overflow: auto;
		background: var(--panel);
	}

	h2 {
		margin: 0 0 0.6rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	h3 {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		margin: 0.7rem 0 0.35rem;
		font-size: 0.72rem;
		font-weight: 400;
		color: var(--dim);
	}

	.shape {
		padding: 0.05rem 0.4rem;
		border-radius: 4px;
		background: var(--ink);
		font-weight: 600;
		color: #fff;
	}

	.hint {
		font-size: 0.74rem;
		color: var(--dim);
	}

	.card {
		margin-bottom: 0.4rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		font-size: 0.72rem;
	}

	.card.thumb {
		background: #fbfaf6;
	}

	.top {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
	}

	.top b {
		flex: 1;
		font-size: 0.76rem;
	}

	.qc {
		padding: 0 0.35rem;
		border-radius: 4px;
		background: #eee;
		font-size: 0.62rem;
		font-weight: 600;
	}

	.qc.ok {
		background: #dcebe1;
		color: #2f7d4f;
	}

	.qc.bad {
		background: #f8ebe6;
		color: #9c3b26;
	}

	p {
		margin: 0.15rem 0 0;
	}

	.spec {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.66rem;
	}

	.ch,
	.note {
		color: var(--dim);
	}

	.loud {
		color: #4a5f93;
	}

	.checks {
		margin: 0.25rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.66rem;
	}

	.checks .ok {
		color: #2f7d4f;
	}

	.checks .bad {
		color: #9c3b26;
	}

	.checks i {
		color: var(--dim);
	}

	.x {
		font-size: 0.64rem;
		overflow-wrap: anywhere;
		color: var(--dim);
	}

	.x span {
		font-weight: 600;
	}

	.acts {
		display: flex;
		gap: 0.3rem;
		margin-top: 0.4rem;
	}

	.acts a {
		text-decoration: none;
	}
</style>
