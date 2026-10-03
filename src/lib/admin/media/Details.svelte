<!--
	Everything the library knows about the open file: its tags as chips (a click filters the grid by one), its hash,
	what it is and how big, what made it, and where its copies are — this Mac, the server's Object Storage.
-->
<script lang="ts">
	import CopiesBadge from '$lib/studio/CopiesBadge.svelte';
	import { command } from '$lib/native';
	import { BY_HAND, className, tiersOf, type Copies, type StoryView } from '$lib/studio/vault';
	import { GATEWAY } from '$lib/media/url';
	import type { MediaItem } from './facets';
	import {
		clock,
		storyName,
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
		copies,
		stories = [],
		onplaced,
		onfilter
	}: {
		m: MediaItem;
		p: Parsed;
		measure: { w?: number; h?: number; d?: number } | undefined;
		/** where its copies are, and whether each is verified */
		copies?: Copies;
		/** every story, to move it into another */
		stories?: StoryView[];
		/** it moved to another story or class: the library takes the new description */
		onplaced?: (m: MediaItem) => void;
		/** filter the grid by this facet value ('day' takes the day's number) */
		onfilter: (key: string, value: string) => void;
	} = $props();

	let copied = $state('');
	let placing = $state('');
	/** a move or a class change waits for the admin to confirm it */
	let pending = $state<{ what: 'story' | 'class'; value: string; label: string } | null>(null);
	const inbox = $derived(stories.find((x) => x.inbox));
	const home = $derived(stories.find((x) => (m.story ? x.id === m.story : x.inbox)));
	/** a file has one story: choosing another moves it there (the inbox takes it out of every story) */
	async function place(what: 'story' | 'class', value: string) {
		placing = '';
		try {
			const hashes = [m.hash];
			if (what === 'story') await command('files_move', { hashes, story: value });
			else await command('files_class', { hashes, class: value });
			onplaced?.({ ...m, ...(what === 'story' ? { story: value === inbox?.id ? undefined : value } : { class: value }) });
		} catch (e) {
			placing = String(e);
		}
	}
	/** into this Mac's Downloads folder, under the name it came in as (the Mac checks the copy against its hash) */
	let saving = $state<'' | 'saving' | 'saved' | string>('');
	async function download() {
		saving = 'saving';
		try {
			const at = await command<string>('file_download', { hash: m.hash, name: m.original_name ?? null });
			saving = `saved:${at}`;
		} catch (e) {
			saving = String(e);
		}
	}
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
			<video src={raw(m.hash)} preload="metadata" muted playsinline onloadedmetadata={(e) => (e.currentTarget.currentTime = Math.min(5, (e.currentTarget.duration || 0) * 0.1))}></video>
		{:else}
			<span aria-hidden="true">{m.kind === 'audio' ? '♪' : '▤'}</span>
		{/if}
	</div>

	<div class="dl">
		<button class="save" onclick={download} disabled={saving === 'saving'} title="Copy it into this Mac's Downloads folder">
			{saving === 'saving' ? 'Saving…' : '⤓ Download'}
		</button>
		{#if saving.startsWith('saved:')}<span class="dim">In Downloads: {saving.slice(6).split('/').pop()}</span>
		{:else if saving && saving !== 'saving'}<span class="bad">{saving}</span>{/if}
	</div>

	<h3>Tags</h3>
	<div class="chips">
		{#each p.ideas as n (n)}
			<button class="chip day" title="Its idea" onclick={() => onfilter('idea', n)}>{n}</button>
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
	{#if stories.length}
		<h3>Story</h3>
		<select
			class="place"
			value={home?.id ?? ''}
			onchange={(e) => {
				const to = stories.find((x) => x.id === e.currentTarget.value);
				if (to) pending = { what: 'story', value: to.id, label: `Move it to ${to.inbox ? 'the Inbox' : to.title}` };
			}}
		>
			{#each stories as st (st.id)}<option value={st.id}>{storyName(st)}</option>{/each}
		</select>
		<h3>Class</h3>
		{#if m.class === 'proxy' || m.class === 'delivery'}
			<p class="desc">{className(m.class)}{home ? ` → ${tiersOf(home.rules[m.class]).join(' + ')}` : ''} <span class="dim">(set by its pipeline)</span></p>
		{:else}
			<select class="place" value={m.class ?? 'default'} onchange={(e) => (pending = { what: 'class', value: e.currentTarget.value, label: `Make it ${className(e.currentTarget.value)}` })}>
				{#each BY_HAND as c (c)}<option value={c}>{className(c)}{home ? ` → ${tiersOf(home.rules[c]).join(' + ')}` : ''}</option>{/each}
			</select>
		{/if}
		{#if pending}
			<p class="confirm">
				{pending.label}?
				<button onclick={() => (place(pending!.what, pending!.value), (pending = null))}>Confirm</button>
				<button class="no" onclick={() => (pending = null)}>Cancel</button>
			</p>
		{/if}
		{#if placing}<p class="desc bad">{placing}</p>{/if}
	{/if}

	<h3>Public</h3>
	<p class="desc">{m.public ? 'Yes: the site or a platform shows it (the gateway serves it without a login)' : 'No: a working file'}</p>

	<h3>Copies</h3>
	{#if copies}<CopiesBadge c={copies} wide />{:else}<p class="desc dim">Looking…</p>{/if}

	<h3>Hash</h3>
	<button class="cid" onclick={() => copy(m.hash)} title="Copy the BLAKE3 hash">
		<code>{m.hash}</code>
		<span>{copied === m.hash ? 'Copied' : 'Copy'}</span>
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
		<dd>{new Date(m.added).toLocaleDateString()}</dd>
		{#if m.original_name}
			<dt>Came in as</dt>
			<dd>{m.original_name}</dd>
		{/if}
		{#each meta as [k, v] (k)}
			<dt>{k}</dt>
			<dd class:said={k === 'text' || k === 'direction'}>{v}</dd>
		{/each}
	</dl>

	{#if m.public && copies?.server === 'stored'}
		<h3>On the site</h3>
		<button class="cid" onclick={() => copy(`${GATEWAY}/${m.hash}`)} title="Copy its public address">
			<code>{GATEWAY}/{m.hash.slice(0, 16)}…</code>
			<span>{copied === `${GATEWAY}/${m.hash}` ? 'Copied' : 'Copy'}</span>
		</button>
	{/if}
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

	.dl {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.6rem;
		margin-top: 0.6rem;
	}

	.save {
		padding: 0.35rem 0.85rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: var(--accent);
		font: inherit;
		font-weight: 600;
		color: var(--on-accent);
		cursor: pointer;
	}

	.save:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.dl .dim,
	.dl .bad {
		font-size: 0.75rem;
		overflow-wrap: anywhere;
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

	.place {
		width: 100%;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--paper);
		font: inherit;
		font-size: 0.82rem;
		color: var(--ink);
	}

	.bad {
		color: #9c3b26;
	}

	.confirm {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0.2rem 0;
		font-size: 0.8rem;
		color: #7a5a14;
	}

	.confirm button {
		padding: 0.15rem 0.7rem;
		border: 0;
		border-radius: 999px;
		background: var(--ink);
		font: inherit;
		font-size: 0.76rem;
		color: #fff;
		cursor: pointer;
	}

	.confirm .no {
		background: none;
		color: var(--muted);
		text-decoration: underline;
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
