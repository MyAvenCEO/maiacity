<!--
	The media library: every image, sound and video the city has, as it is kept in Postgres — by its CID.

	A prerendered shell like every other page; the API decides who may look (media:admin), and serves the
	originals straight from the database. The public copies live on Bunny; each card says whether it has one.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { API, listMedia, may, me, type MediaItem } from '$lib/auth/client';
	import AdminNav from '$lib/admin/AdminNav.svelte';

	let phase = $state<'loading' | 'signed-out' | 'forbidden' | 'ready'>('loading');
	let media = $state<MediaItem[]>([]);
	let error = $state('');
	let kind = $state<'all' | MediaItem['kind']>('all');
	let q = $state('');
	let tag = $state<string | null>(null);
	let open = $state<MediaItem | null>(null);
	let copied = $state('');

	const KINDS = [
		['all', 'All'],
		['image', 'Images'],
		['video', 'Videos'],
		['audio', 'Sounds'],
		['document', 'Documents']
	] as const;

	const shown = $derived(
		media.filter((m) => {
			if (kind !== 'all' && m.kind !== kind) return false;
			if (tag && !m.tags.includes(tag)) return false;
			const f = q.trim().toLowerCase();
			return !f || m.cid.toLowerCase().includes(f) || m.paths.some((p) => p.toLowerCase().includes(f));
		})
	);
	// the days first, in order; then how a file is used; then the folders; "unused" last
	const ROLES = ['cover', 'in the post', 'poster', 'film', 'author', 'site'];
	const rank = (t: string) => (t.startsWith('Day ') ? 0 : ROLES.includes(t) ? 1 : t === 'unused' ? 3 : 2);
	const allTags = $derived(
		[...new Set(media.flatMap((m) => m.tags))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }))
	);
	const tagCount = (t: string) => media.filter((m) => m.tags.includes(t) && (kind === 'all' || m.kind === kind)).length;
	const cardTags = (m: MediaItem) => m.tags.filter((t) => rank(t) < 2).slice(0, 3);
	const pick = (t: string) => (tag = tag === t ? null : t);
	const count = (k: string) => (k === 'all' ? media.length : media.filter((m) => m.kind === k).length);
	const total = $derived(media.reduce((n, m) => n + m.size, 0));
	const distributed = $derived(media.filter((m) => m.distributed_at).length);

	onMount(async () => {
		try {
			const founder = await me();
			if (!may(founder, 'media:admin')) return void (phase = 'forbidden');
		} catch {
			return void (phase = 'signed-out');
		}
		try {
			media = (await listMedia()).media;
		} catch (e) {
			error = (e as Error).message;
		}
		phase = 'ready';
	});

	const raw = (m: MediaItem) => `${API}/api/media/${m.cid}`;
	const name = (m: MediaItem) => m.paths[0]?.split('/').pop() ?? m.cid;
	const size = (n: number) =>
		n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`;
	const short = (cid: string) => `${cid.slice(0, 9)}…${cid.slice(-6)}`;

	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		copied = text;
		setTimeout(() => copied === text && (copied = ''), 1400);
	}

	const onKey = (e: KeyboardEvent) => {
		const current = open;
		if (!current) return;
		if (e.key === 'Escape') open = null;
		const i = shown.indexOf(current);
		if (e.key === 'ArrowRight' && i < shown.length - 1) open = shown[i + 1]!;
		if (e.key === 'ArrowLeft' && i > 0) open = shown[i - 1]!;
	};
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
	<title>Media · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
	<AdminNav />
	<h1>Media</h1>

	{#if phase === 'loading'}
		<p class="lede">One moment…</p>
	{:else if phase === 'signed-out'}
		<p class="lede">The media library belongs to the admin. <a href="{base}/join/">Sign in</a> first.</p>
	{:else if phase === 'forbidden'}
		<p class="lede">The media library belongs to the admin, and your account is not one.</p>
	{:else}
		<p class="lede">
			{media.length} files · {size(total)} in Postgres, each known by its CID · {distributed} of {media.length} on Bunny
		</p>
		{#if error}<p class="note bad">{error}</p>{/if}

		<div class="bar">
			<div class="kinds" role="tablist">
				{#each KINDS as [k, label] (k)}
					<button role="tab" aria-selected={kind === k} class:on={kind === k} onclick={() => (kind = k)}>
						{label} <span>{count(k)}</span>
					</button>
				{/each}
			</div>
			<input type="search" bind:value={q} placeholder="Find by path or CID" aria-label="Find by path or CID" />
		</div>

		{#if allTags.length}
			<div class="tags" aria-label="Filter by tag">
				{#each allTags as t (t)}
					<button class="tag" class:on={tag === t} class:unused={t === 'unused'} aria-pressed={tag === t} onclick={() => pick(t)}>
						{t} <span>{tagCount(t)}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if shown.length === 0}
			<p class="empty">{media.length ? 'Nothing matches.' : 'The library is empty. Fill it with api/scripts/media-push.ts.'}</p>
		{/if}

		<ul class="grid">
			{#each shown as m (m.cid)}
				<li>
					<button class="card" onclick={() => (open = m)}>
						<span class="thumb">
							{#if m.kind === 'image'}
								<img src={raw(m)} alt={name(m)} loading="lazy" />
							{:else if m.kind === 'video'}
								<video src="{raw(m)}#t=1" preload="metadata" muted></video>
								<span class="badge-play" aria-hidden="true">▶</span>
							{:else}
								<span class="glyph" aria-hidden="true">{m.kind === 'audio' ? '♪' : '▤'}</span>
							{/if}
						</span>
						<span class="label">
							<span class="name">{name(m)}</span>
							<span class="sub">
								{size(m.size)} · {m.stream_guid ? 'Stream' : m.cdn_path ? 'CDN' : 'not on Bunny yet'}
							</span>
							{#if cardTags(m).length}<span class="chips">{cardTags(m).join(' · ')}</span>{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>

{#if open}
	{@const m = open}
	<div class="viewer" role="dialog" aria-modal="true" aria-label={name(m)}>
		<button class="backdrop" aria-label="Close" onclick={() => (open = null)}></button>
		<div class="panel">
			<div class="stage">
				{#if m.kind === 'image'}
					<img src={raw(m)} alt={name(m)} />
				{:else if m.kind === 'video'}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video src={raw(m)} controls autoplay></video>
				{:else if m.kind === 'audio'}
					<audio src={raw(m)} controls autoplay></audio>
				{:else}
					<a class="quiet" href={raw(m)} target="_blank" rel="noopener">Open the file</a>
				{/if}
			</div>
			<dl>
				<dt>CID</dt>
				<dd>
					<code>{m.cid}</code>
					<button class="quiet" onclick={() => copy(m.cid)}>{copied === m.cid ? 'Copied' : 'Copy'}</button>
				</dd>
				<dt>{m.paths.length === 1 ? 'Path' : 'Paths'}</dt>
				<dd>{#each m.paths as p (p)}<code>{p}</code>{:else}—{/each}</dd>
				<dt>Tags</dt>
				<dd>
					{#each m.tags as t (t)}
						<button class="tag small" class:on={tag === t} onclick={() => { pick(t); open = null; }}>{t}</button>
					{:else}—{/each}
				</dd>
				<dt>File</dt>
				<dd>{m.mime} · {size(m.size)} · kept {new Date(m.created).toLocaleDateString()}</dd>
				<dt>Public copy</dt>
				<dd>
					{#if m.stream_guid}
						Bunny Stream <code>{m.stream_guid}</code>
					{:else if m.cdn_path}
						<a class="quiet" href="https://maia.city/{m.cdn_path}" target="_blank" rel="noopener">maia.city/{m.cdn_path}</a>
					{:else}
						not on Bunny yet — api/scripts/media-distribute.ts
					{/if}
				</dd>
			</dl>
			<div class="actions">
				<span class="hint">← → to step through · Esc to close</span>
				<button class="pill-btn" onclick={() => (open = null)}>Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	main {
		padding-block: 2.5rem 6rem;
	}

	h1 {
		margin: 0.5rem 0 0.4rem;
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1.05;
	}

	.lede {
		margin: 0 0 1.5rem;
		color: var(--ink-soft);
	}

	.lede a {
		color: var(--terracotta);
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		margin-bottom: 1.25rem;
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.kinds button {
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		font: inherit;
		font-size: 0.88rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.kinds button span {
		margin-left: 0.2rem;
		color: var(--muted);
	}

	.kinds button.on {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--paper);
	}

	.kinds button.on span {
		color: var(--sage);
	}

	input[type='search'] {
		flex: 0 1 18rem;
		min-width: 0;
		padding: 0.55rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		font: inherit;
		font-size: 0.9rem;
		color: var(--ink);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: -0.4rem 0 1.25rem;
	}

	.tag {
		padding: 0.25rem 0.65rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		font: inherit;
		font-size: 0.78rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.tag span {
		color: var(--muted);
	}

	.tag.on {
		border-color: var(--mustard);
		background: var(--mustard);
		color: var(--ink);
	}

	.tag.on span {
		color: var(--ink-soft);
	}

	.tag.unused:not(.on) {
		border-style: dashed;
	}

	.tag.small {
		padding: 0.15rem 0.55rem;
	}

	.chips {
		overflow: hidden;
		font-size: 0.72rem;
		color: var(--ink-soft);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
		background: var(--paper);
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
		transition: transform 0.15s ease, box-shadow 0.15s ease;
	}

	.card:hover,
	.card:focus-visible {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgb(38 56 44 / 0.12);
	}

	.thumb {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 4 / 3;
		background: var(--cream);
	}

	.thumb img,
	.thumb video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.glyph {
		font-size: 2.4rem;
		color: var(--muted);
	}

	.badge-play {
		position: absolute;
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 50%;
		background: rgb(38 56 44 / 0.7);
		color: var(--paper);
		font-size: 0.9rem;
	}

	.label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.6rem 0.75rem 0.7rem;
	}

	.name {
		overflow: hidden;
		font-size: 0.85rem;
		font-weight: 500;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.sub {
		font-size: 0.75rem;
		color: var(--muted);
	}

	.empty {
		color: var(--muted);
	}

	.viewer {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: 1rem;
	}

	.backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(20 28 22 / 0.72);
		cursor: zoom-out;
	}

	.panel {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(64rem, 100%);
		max-height: calc(100vh - 2rem);
		padding: 1rem;
		border-radius: var(--radius);
		background: var(--paper);
		overflow: auto;
	}

	.stage {
		display: grid;
		place-items: center;
		min-height: 6rem;
		border-radius: 12px;
		background: var(--cream);
		overflow: hidden;
	}

	.stage img,
	.stage video {
		display: block;
		max-width: 100%;
		max-height: 62vh;
	}

	.stage audio {
		width: min(28rem, 90%);
		margin: 2rem 0;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.45rem 1rem;
		margin: 0;
		font-size: 0.88rem;
	}

	dt {
		color: var(--muted);
	}

	dd {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.7rem;
		min-width: 0;
		margin: 0;
	}

	code {
		overflow-wrap: anywhere;
		font-size: 0.8rem;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.hint {
		font-size: 0.8rem;
		color: var(--muted);
	}

	button.pill-btn {
		border: 0;
		cursor: pointer;
		font-family: inherit;
	}

	.quiet {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.85rem;
		color: var(--terracotta);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.note.bad {
		color: #9c3b26;
	}

	@media (max-width: 560px) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.6rem;
		}

		dl {
			grid-template-columns: 1fr;
		}

		dt {
			margin-top: 0.4rem;
		}
	}
</style>
