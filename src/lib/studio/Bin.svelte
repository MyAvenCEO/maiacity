<!--
	The library bin: the timelines by project, the world shots, and every file, filtered by story (the inbox, or one
	story's files — remembered), by type and by a search (names, words, tags, hash). A click shows a
	file in the source monitor; a drag lays it on a track; a double-click drops it at the playhead. Each picture shows
	its colour profile (a menu sets it by hand) and whether its HD proxy is ready — the Edit tab plays only proxies.
-->
<script>
	import ColorBadge from './ColorBadge.svelte';
	import { isCache } from './color.js';
	import { allShots, blankSpec, newShot } from './shots.js';
	import { itemName, thumb } from './studio.svelte.js';
	import { command } from '$lib/native';
	import { transcriptState } from './transcript.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	/** @typedef {'all' | 'image' | 'video' | 'audio' | 'world'} Kind */
	let kind = $state(/** @type {Kind} */ ('all'));
	let q = $state('');

	// ── the story the library shows: every file of it (its originals, sound, stills, deliveries) — or all ──
	/** @typedef {import('./vault').StoryView} StoryView */
	const STORY = 'studio:bin-story';
	/** @type {StoryView[]} */
	let stories = $state([]);
	/** a story's id, or 'all' */
	let story = $state(read());
	function read() {
		try {
			return localStorage.getItem(STORY) || 'all';
		} catch {
			return 'all';
		}
	}
	/** @param {string} id */
	function choose(id) {
		story = id;
		try {
			localStorage.setItem(STORY, id);
		} catch {
			/* not remembered: fine */
		}
	}
	async function loadStories() {
		try {
			const list = await command('stories_list');
			stories = /** @type {StoryView[]} */ (Array.isArray(list) ? list : []);
		} catch {
			stories = [];
		}
	}
	$effect(() => void loadStories());
	// the inbox first, then by episode (Day 2 before Day 10), then by title
	const ordered = $derived(
		[...stories].sort((a, b) => Number(b.inbox) - Number(a.inbox) || (a.episode || '~').localeCompare(b.episode || '~', undefined, { numeric: true }) || a.title.localeCompare(b.title))
	);
	const chosen = $derived(story === 'all' ? null : (stories.find((x) => x.id === story) ?? null));
	/** Is a file of the chosen story? (the inbox: of none) @param {import('$lib/auth/client').MediaItem} m */
	const inStory = (m) => !chosen || (chosen.inbox ? !m.story || m.story === chosen.id : m.story === chosen.id);
	/** A world shot of the chosen story: its project names the story (its episode or title); the inbox: no project. @param {string | null | undefined} p */
	const shotIn = (p) => {
		if (!chosen) return true;
		if (chosen.inbox) return !p;
		const want = [chosen.episode, chosen.title].filter(Boolean).map((x) => x.trim().toLowerCase());
		return !!p && want.includes(p.trim().toLowerCase());
	};
	/** @param {StoryView} x */
	const storyName = (x) => (x.inbox ? 'Inbox' : `${x.episode ? `${x.episode} · ` : ''}${x.title}`);
	/** @type {import('$lib/auth/client').Shot[]} */
	let shots = $state([]);
	let shotsNote = $state('');

	const ROLES = ['cover', 'in the post', 'poster', 'film', 'author', 'site'];
	/** @param {string} t */
	const rank = (t) => (t.startsWith('Day ') ? 0 : ROLES.includes(t) ? 1 : t === 'unused' ? 3 : 2);
	const files = $derived(s.library.filter((m) => !isCache(m)));
	/** how many files each story holds (in the bin's sense: no proxies) */
	const counts = $derived.by(() => {
		/** @type {Map<string, number>} */
		const n = new Map();
		const inbox = stories.find((x) => x.inbox)?.id ?? '';
		for (const m of files) n.set(m.story || inbox, (n.get(m.story || inbox) ?? 0) + 1);
		return n;
	});
	// a remembered story that is gone: all again
	$effect(() => {
		if (stories.length && story !== 'all' && !chosen) choose('all');
	});
	const shown = $derived(
		kind === 'world'
			? []
			: files.filter((m) => {
					// the pipeline's own working files (proxies, the worker's old LUT caches, hero frames) are not footage to cut with
					if (!['image', 'video', 'audio'].includes(m.kind) || m.tags.some((t) => t === 'superseded' || t === 'role:proxy' || t === 'role:lut' || t === 'role:frame')) return false;
					if (kind !== 'all' && m.kind !== kind) return false;
					if (!inStory(m)) return false;
					const f = q.trim().toLowerCase();
					return !f || m.hash.includes(f) || m.title.toLowerCase().includes(f) || m.description.toLowerCase().includes(f) || m.tags.some((t) => t.toLowerCase().includes(f)) || String(m.meta?.text ?? '').toLowerCase().includes(f) || String(/** @type {{ text?: string } | undefined} */ (m.meta?.transcript)?.text ?? '').toLowerCase().includes(f);
				})
	);
	const shownShots = $derived(
		kind === 'world' || kind === 'all'
			? shots.filter((x) => shotIn(x.project) && (!q.trim() || x.name.toLowerCase().includes(q.trim().toLowerCase())))
			: []
	);
	const shownTimelines = $derived(s.timelines);
	// one heading per project, its variants under it (A, B, …); timelines without a project last
	const groups = $derived.by(() => {
		/** @type {Map<string, typeof shownTimelines>} */
		const map = new Map();
		for (const t of shownTimelines) map.set(t.project ?? '', [...(map.get(t.project ?? '') ?? []), t]);
		for (const l of map.values()) l.sort((a, b) => (a.variant ?? '').localeCompare(b.variant ?? '', undefined, { numeric: true }));
		return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
	});

	async function loadShots() {
		try {
			shots = await allShots();
			shotsNote = '';
		} catch (e) {
			shotsNote = /** @type {Error} */ (e).message;
		}
	}
	// the shots again whenever one changes (a new version saved from the lanes)
	$effect(() => {
		void s.shotRev;
		void loadShots();
	});
	async function addShot() {
		const name = prompt('Name the new world shot', `Shot ${shots.length + 1}`);
		if (!name) return;
		const aspect = /** @type {import('$lib/auth/client').Shape} */ (['16:9', '9:16', '1:1', '4:5'].includes(s.aspect) ? s.aspect : '16:9');
		const made = await newShot(name, s.current?.project ?? null, blankSpec(aspect)).catch((e) => void (s.error = `Shot: ${e.message}`));
		if (!made) return;
		await loadShots();
		s.placeShot(made, s.time);
	}

	/** @type {Record<string, string>} */
	const proxyLabel = { ready: 'proxy · ACEScct', none: 'no proxy yet', queued: 'proxy queued', rendering: 'proxy…', failed: 'proxy failed' };
</script>

<aside class="bin">
	<div class="tl-head"><h3>Timelines</h3></div>
	<div class="tls">
		{#each groups as [project, list] (project)}
			<button class="proj" class:here={(s.current?.project ?? '') === project} aria-expanded={s.expanded.includes(project)} onclick={() => s.expand(project)}>
				<span class="caret">{s.expanded.includes(project) ? '▾' : '▸'}</span>{project || 'Other'} <span>{list.length}</span>
			</button>
			{#if s.expanded.includes(project)}
				<ul>
					{#each list as t (t.id)}
						<li class:on={s.current?.id === t.id}>
							<button class="tl" onclick={() => s.openTimeline(t)}>
								<span class="nm">{#if t.variant}<b class="var">{t.variant}</b>{/if}{t.name}{#if t.stage && t.stage !== 'edit'}<i class="stg {t.stage}">{t.stage}</i>{/if}</span>
								<span class="tg">{t.description ?? `${t.aspect} · ${t.clips.length} clips`}</span>
							</button>
							<button class="x" onclick={() => s.removeTimeline(t)} aria-label="Delete timeline">×</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/each}
	</div>
	<div class="lib-head">
		<h3>Library</h3>
		<select class="story" value={story} onchange={(e) => choose(e.currentTarget.value)} onfocus={loadStories} aria-label="Story" title="The files of one story (or of none: the inbox)">
			<option value="all">All stories · {files.length}</option>
			{#each ordered as x (x.id)}<option value={x.id}>{storyName(x)} · {counts.get(x.id) ?? 0}</option>{/each}
		</select>
	</div>
	<div class="kinds">
		{#each [['all', 'All'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Sound'], ['world', 'World']] as [k, label] (k)}
			<button class:on={kind === k} onclick={() => (kind = /** @type {Kind} */ (k))}>{label}</button>
		{/each}
	</div>
	<input type="search" bind:value={q} placeholder="Find by name, what is said, tag or hash" aria-label="Find" />
	<ul class="items">
		{#if kind === 'world' || shownShots.length}
			<li class="sect">
				World shots {#if shotsNote}<span title={shotsNote}>· local</span>{/if}
				{#if s.canEdit}<button class="link" onclick={addShot}>+ New shot</button>{/if}
			</li>
			{#each shownShots as x (x.id)}
				<li>
					<button
						class="item"
						draggable="true"
						ondragstart={(e) => (e.dataTransfer?.setData('text/x-shot', x.id), e.dataTransfer?.setData('text/x-shot-version', String(x.version)))}
						ondblclick={() => s.placeShot(x, s.time)}
						title="A world shot (data, rendered live): drag onto V1, or double-click to drop it at the playhead"
					>
						<span class="thumb world"><i>◎</i></span>
						<span class="meta">
							<span class="nm">{x.name}</span>
							<span class="tg">v{x.version} · {x.spec.seconds}s · {x.spec.camera.kind}{x.spec.look ? ` · ${x.spec.look}` : ''}</span>
						</span>
					</button>
				</li>
			{/each}
			{#if kind !== 'world'}<li class="sect">Files</li>{/if}
		{/if}
		{#each shown as m (m.hash)}
			{@const px = s.proxy(m)}
			{@const ts = m.kind === 'video' || m.kind === 'audio' ? transcriptState(m) : null}
			<li>
				<button
					class="item"
					class:on={s.preview === m.hash}
					draggable="true"
					ondragstart={(e) => e.dataTransfer?.setData('text/x-hash', m.hash)}
					onclick={() => s.pick(m)}
					ondblclick={() => s.place(m.hash, s.defaultTrack(m), s.time)}
					title="Click to see it in the source monitor, drag onto a track, or double-click to drop it at the playhead"
				>
					<span class="thumb">
						{#if m.kind === 'image'}<img src={thumb(m)} alt="" loading="lazy" draggable="false" />{:else}<i>{m.kind === 'audio' ? '♪' : '▶'}</i>{/if}
					</span>
						<span class="meta">
						<span class="nm">{String(m.meta?.title ?? itemName(m))}</span>
						<span class="tg">
							{#if px.state !== 'n/a'}<b class="px {px.state}">{proxyLabel[px.state]}</b>{/if}
							{#if ts && ts.state !== 'unknown' && ts.state !== 'none'}<b class="tr {ts.state}" title={ts.note}>{ts.state === 'ready' ? 'T' : ts.state === 'failed' ? 'T ✗' : 'T …'}</b>{/if}
							{m.tags.filter((t) => rank(t) < 3).slice(0, 2).join(' · ') || m.kind}
						</span>
					</span>
				</button>
				{#if m.kind !== 'audio'}<span class="badge"><ColorBadge {s} {m} /></span>{/if}
			</li>
		{/each}
	</ul>
</aside>

<style>
	.bin {
		grid-area: bin;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-height: 0;
		padding: 0.8rem;
		background: var(--panel);
	}

	h3 {
		margin: 0.2rem 0 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.tl-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.lib-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.story {
		min-width: 0;
		max-width: 12rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.72rem;
		color: var(--ink);
		text-overflow: ellipsis;
	}

	.tr {
		margin-right: 0.3rem;
		font-weight: 600;
		color: #4a5f93;
	}

	.tr.queued,
	.tr.transcribing {
		color: #a8741a;
	}

	.tr.failed {
		color: #9c3b26;
	}

	.kinds button {
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.75rem;
		color: var(--dim);
		cursor: pointer;
	}

	.kinds button.on {
		border-color: var(--ink);
		background: var(--ink);
		color: #fff;
	}

	input[type='search'] {
		padding: 0.45rem 0.75rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.8rem;
		color: var(--ink);
	}

	.items {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0;
		overflow: auto;
		list-style: none;
	}

	.items li {
		position: relative;
	}

	.sect {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		margin: 0.4rem 0 0.15rem;
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.sect span {
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
	}

	.link {
		margin-left: auto;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.7rem;
		letter-spacing: 0;
		text-transform: none;
		color: var(--accent);
		cursor: pointer;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.35rem;
		border: 0;
		border-radius: 8px;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: grab;
	}

	.item:hover {
		background: var(--bg);
	}

	.item.on {
		background: #f3e3c1;
	}

	.badge {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
	}

	.thumb {
		display: grid;
		flex: none;
		place-items: center;
		width: 3.4rem;
		height: 2.2rem;
		overflow: hidden;
		border-radius: 5px;
		background: var(--bg);
	}

	.thumb.world {
		background: linear-gradient(#9fb6cf, #cfd9c4);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb i {
		font-style: normal;
		color: var(--dim);
	}

	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		padding-right: 2.6rem;
	}

	.nm,
	.tg {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.nm {
		font-size: 0.8rem;
	}

	.tg {
		font-size: 0.68rem;
		color: var(--dim);
	}

	.px {
		margin-right: 0.3rem;
		font-weight: 600;
		color: #2f7d4f;
	}

	.px.none,
	.px.queued,
	.px.rendering {
		color: #a8741a;
	}

	.px.failed {
		color: #9c3b26;
	}

	.tls {
		flex: none;
		max-height: 14rem;
		overflow: auto;
	}

	.tls ul {
		margin: 0 0 0.4rem;
		padding: 0 0 0 0.9rem;
		list-style: none;
	}

	.proj {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		width: 100%;
		margin: 0.15rem 0;
		padding: 0.3rem 0.2rem;
		border: 0;
		border-radius: 6px;
		background: none;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.proj:hover {
		background: #0000000a;
	}

	.proj span {
		font-weight: 400;
		color: var(--dim);
	}

	.caret {
		width: 0.8rem;
		font-size: 0.7rem;
		color: var(--dim);
	}

	.tls li {
		display: flex;
		align-items: center;
		border-radius: 8px;
	}

	.tls li.on {
		background: #f3e3c1;
	}

	.tl {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		padding: 0.4rem 0.55rem;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.var {
		display: inline-grid;
		place-items: center;
		min-width: 1.15rem;
		height: 1.15rem;
		margin-right: 0.4rem;
		padding: 0 0.2rem;
		border-radius: 4px;
		background: var(--ink);
		font-size: 0.68rem;
		color: #fff;
	}

	.stg {
		margin-left: 0.35rem;
		padding: 0 0.3rem;
		border-radius: 4px;
		background: #e6ecf5;
		font-size: 0.6rem;
		font-style: normal;
		color: #4a5f93;
	}

	.stg.rendered {
		background: #dcebe1;
		color: #2f7d4f;
	}

	.tls .x {
		padding: 0 0.5rem;
		border: 0;
		background: none;
		font-size: 1rem;
		color: var(--dim);
		cursor: pointer;
		opacity: 0.4;
	}

	.tls li:hover .x {
		opacity: 1;
	}
</style>
