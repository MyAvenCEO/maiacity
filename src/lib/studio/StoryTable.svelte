<!--
	One story's files as a table — the place its keeping is decided and checked. A row per file: its class, its size,
	and a column per destination the story's rules name for any class (this Mac's avenSSD, the server's Object Storage,
	later drives), each verified by the file's BLAKE3 hash, still on its way, or missing — against what its class asks
	for (at least two). iroh does the syncing underneath; this only says where it stands. Select rows to move them to
	another story (a file has one) or into another class.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { listMedia, type MediaItem } from '$lib/auth/client';
	import { command } from '$lib/native';
	import { profileInfo } from './color.js';
	import { analysisState, hasSound, stepOpen, transcriptState, type Step } from './transcript.js';
	import { BY_HAND, CLASSES, TIERS, gb, proxyState, vaultUrl, type Making, type Copies, type FileClass, type Moving, type StoryView } from './vault';

	let {
		story,
		stories,
		reload = 0,
		open = null,
		onchanged = () => {},
		onopen = () => {}
	}: {
		story: string | null;
		stories: StoryView[];
		reload?: number;
		/** the file whose metadata the right column shows */
		open?: string | null;
		onchanged?: () => void;
		onopen?: (m: MediaItem) => void;
	} = $props();

	let files = $state<MediaItem[]>([]);
	let copies = $state<Record<string, Copies>>({});
	let only = $state<FileClass | 'all'>('all');
	let incomplete = $state(false);
	let selected = $state<string[]>([]);
	/** what is on its way right now, per file and destination (live, from iroh) */
	let moving = $state<Moving[]>([]);
	/** what holds this Mac's uploads now ("ingest", "proxy", "render"): local work first, then sync */
	let hold = $state<string[]>([]);
	/** the file coming in right now: its B column fills as it is copied, read back and taken into the store */
	let landing = $state<{ path: string; story: string; size: number; done: number } | null>(null);
	const waitingWhy = $derived(hold.includes('ingest') ? 'waits: the ingest runs first' : hold.includes('proxy') ? 'waits: the proxies render first' : hold.includes('render') ? 'waits: a film renders first' : 'queued');
	const movingOf = (m: MediaItem, dest: string) => moving.find((t) => t.hash === m.hash && t.dest === dest && !t.done && !t.aborted);
	const active = $derived(moving.filter((t) => !t.done && !t.aborted && mine.some((m) => m.hash === t.hash)));
	let error = $state('');

	const current = $derived(stories.find((s) => s.id === story) ?? null);
	const landingHere = $derived(landing && (landing.story === story || (!landing.story && current?.inbox)) ? landing : null);
	const mine = $derived(files.filter((m) => (current?.inbox ? !m.story : m.story === story) && m.meta?.role !== 'proxy-cache'));
	/** every destination any class of this story names, in the order they are first named */
	const destinations = $derived.by(() => {
		const all: string[] = [];
		for (const c of CLASSES) for (const d of current?.rules[c] ?? []) if (!all.includes(d)) all.push(d);
		return all;
	});
	const classOf = (m: MediaItem) => (m.class ?? 'default') as FileClass;

	/** one destination's state for one file, as the vault reports it */
	function at(m: MediaItem, dest: string): 'ok' | 'on its way' | 'missing' | '' {
		const c = copies[m.hash];
		if (!(current?.rules[classOf(m)] ?? []).includes(dest)) return '';
		if (!c) return 'missing';
		if (dest === 'avenSSD') return c.here === 'verified' ? 'ok' : c.here === 'partial' ? 'on its way' : 'missing';
		if (dest === 'hetzner') return c.server === 'stored' ? 'ok' : c.server === 'syncing' ? 'on its way' : 'missing';
		return 'missing';
	}
	const verified = (m: MediaItem) => destinations.filter((d) => at(m, d) === 'ok').length;
	const needed = (m: MediaItem) => (current?.rules[classOf(m)] ?? []).length;
	const kept = (m: MediaItem) => verified(m) >= needed(m);

	/** a proxy's original, when it has one here */
	const proxyOf = (m: MediaItem) => (typeof m.meta?.proxy_of === 'string' ? m.meta.proxy_of : null);
	const rows = $derived.by(() => {
		const list = mine
			.filter((m) => (only === 'all' || classOf(m) === only || (only === 'proxy' && m.kind === 'video' && classOf(m) === 'original')) && (!incomplete || !kept(m)))
			.sort((a, b) => CLASSES.indexOf(classOf(a)) - CLASSES.indexOf(classOf(b)) || name(a).localeCompare(name(b), undefined, { numeric: true }));
		// every proxy right under its original (a proxy whose original is not in view stays where it sorted)
		const here = new Set(list.map((m) => m.hash));
		const under = new Map<string, MediaItem[]>();
		for (const m of list) {
			const of = proxyOf(m);
			if (of && here.has(of)) under.set(of, [...(under.get(of) ?? []), m]);
		}
		const groups = list
			.filter((m) => !(proxyOf(m) && here.has(proxyOf(m)!)))
			.map((m): Row[] => {
				const kids: Row[] = under.get(m.hash) ?? [];
				// a video original's proxy before it exists: its first step, rendering, as its own row
				const due = m.kind === 'video' && classOf(m) === 'original' && !kids.length && (only === 'all' || only === 'proxy');
				return [m, ...kids, ...(due ? [{ coming: m }] : [])];
			});
		// what is moving or rendering now on top, then what is not kept yet, then the rest — an original and its proxy
		// always together
		// (and a file whose words or tags are being made now, or are still to come)
		const rank = (g: Row[]) => (g.some((r) => busy(r) || (!('coming' in r) && stepsRunning(r))) ? 0 : g.some((r) => 'coming' in r || !kept(r) || stepsOpen(r)) ? 1 : 2);
		return groups
			.map((g, i) => ({ g, i, r: rank(g) }))
			.sort((a, b) => a.r - b.r || a.i - b.i)
			.flatMap(({ g }) => g)
			.filter((r) => ('coming' in r ? true : only === 'all' || classOf(r) === only || (only === 'proxy' && !!proxyOf(r))));
	});
	/** a row that is moving (to any destination) or rendering right now */
	const busy = (r: Row) =>
		'coming' in r ? making.some((x) => x.of === r.coming.hash && x.stage === 'making') : moving.some((t) => t.hash === r.hash && !t.done && !t.aborted);
	/** the rows that are files (a proxy still being made is not one yet) */
	const files_ = $derived(rows.filter((r): r is MediaItem => !('coming' in r)));
	/** a row: a file, or the proxy of an original that is still being made */
	type Row = MediaItem | { coming: MediaItem };
	const rowKey = (r: Row) => ('coming' in r ? `coming:${r.coming.hash}` : r.hash);
	/** the proxies being made now (live) */
	let making = $state<Making[]>([]);
	const colourOf = (m: MediaItem) => {
		const c = m.meta?.color as { profile?: string; override?: string } | undefined;
		return c?.override ?? c?.profile ?? '';
	};
	// ── the automatic steps after the ingest: the words (on this Mac, Nemotron) and the tags (the server, Qwen) ──
	const wantsWords = (m: MediaItem) => !proxyOf(m) && m.meta?.role !== 'audio' && hasSound(m);
	// as the server picks them (analyse.rs `wants`): pictures and films that are not working files
	const wantsTags = (m: MediaItem) =>
		!proxyOf(m) &&
		(m.kind === 'video' || m.kind === 'image' || m.meta?.sequence === 'exr') &&
		(classOf(m) === 'original' || classOf(m) === 'default') &&
		!['frame', 'lut', 'proxy', 'proxy-cache', 'audio', 'thumbnail', 'plate', 'model'].includes(String(m.meta?.role ?? '')) &&
		!m.tags.includes('superseded');
	/** a recording's words: live from this Mac's queue while it works on it (every second), else what the catalog says */
	function words(m: MediaItem): Step | null {
		if (!wantsWords(m)) return null;
		const live = making.find((x) => x.of === `transcript:${m.hash}`);
		const st = transcriptState(m);
		if (!live || st.state === 'ready') return st;
		if (live.stage === 'queued') return { ...st, state: 'queued', note: st.state === 'queued' && st.note !== 'queued' ? st.note : 'queued on this Mac — one recording at a time, after any ingest' };
		if (live.stage === 'waiting for memory') return { ...st, state: 'queued', note: 'waits: the Mac needs its memory back first' };
		return { state: 'running', note: live.stage, stage: live.stage, progress: live.done };
	}
	const tags = (m: MediaItem): Step | null => (wantsTags(m) ? analysisState(m) : null);
	const stepsOpen = (m: MediaItem) => [words(m), tags(m)].some((s) => !!s && stepOpen(s));
	const stepsRunning = (m: MediaItem) => [words(m), tags(m)].some((s) => s?.state === 'running');
	/** the words still to come in this story */
	const wordsDue = $derived(mine.filter((m) => { const s = words(m); return !!s && stepOpen(s); }).length);
	/** the transcript made again, here (a failed or empty one) */
	async function again(m: MediaItem, e: Event) {
		e.stopPropagation();
		await command('vault_transcribe', { hash: m.hash }).catch((x) => (error = String(x)));
		files = await listMedia().catch(() => files);
	}
	const thumbOf = (m: MediaItem) => (typeof m.meta?.thumbnail === 'string' && /^[0-9a-f]{64}$/.test(m.meta.thumbnail) ? m.meta.thumbnail : null);

	const complete = $derived(mine.filter(kept).length);
	const name = (m: MediaItem) => m.title || m.original_name || m.hash.slice(0, 12);

	export async function load() {
		try {
			files = await listMedia();
			copies = Object.fromEntries((await command<Copies[]>('vault_copies')).map((c) => [c.hash, c]));
		} catch (e) {
			error = String(e);
		}
	}

	/** a move or a class change waits for the admin to confirm it — nothing moves by a stray click */
	let pending = $state<{ kind: 'story' | 'class'; to: string; label: string } | null>(null);
	const storyName = (s: StoryView) => (s.inbox ? 'Inbox' : `${s.episode ? `${s.episode} · ` : ''}${s.title}`);

	async function confirm() {
		if (!pending || !selected.length) return;
		const p = pending;
		pending = null;
		const hashes = selected;
		if (p.kind === 'story') await command('files_move', { hashes, story: p.to }).catch((e) => (error = String(e)));
		else await command('files_class', { hashes, class: p.to }).catch((e) => (error = String(e)));
		selected = [];
		await load();
		onchanged();
	}
	// a story can hold hundreds of files: rows come in as the table is scrolled, pictures only once they are in view
	// (a whole inbox of pictures and films loading at once took the window down)
	let shown = $state(150);
	$effect(() => {
		void story;
		shown = 150;
	});
	const more = (node: HTMLElement) => {
		const io = new IntersectionObserver(([e]) => e?.isIntersecting && (shown += 150), { rootMargin: '400px' });
		io.observe(node);
		return () => io.disconnect();
	};
	const seen = (src: string) => (node: HTMLImageElement) => {
		const io = new IntersectionObserver(
			([e]) => {
				if (!e?.isIntersecting) return;
				node.src = src;
				io.disconnect();
			},
			{ rootMargin: '300px' }
		);
		io.observe(node);
		return () => io.disconnect();
	};
	const toggle = (h: string) => (selected = selected.includes(h) ? selected.filter((x) => x !== h) : [...selected, h]);

	$effect(() => {
		void reload;
		void load();
	});
	onMount(() => {
		// the copies change while files sync: look again every 10 s; what is moving, every second
		const timer = setInterval(async () => {
			copies = Object.fromEntries((await command<Copies[]>('vault_copies').catch(() => [])).map((c) => [c.hash, c]));
			// words or tags on their way (the catalog moves on as this Mac and the server work): the rows again
			if (mine.some(stepsOpen)) files = await listMedia().catch(() => files);
		}, 10000);
		let unlisten: Array<() => void> = [];
		let loading: ReturnType<typeof setTimeout> | undefined;
		void import('@tauri-apps/api/event').then(async ({ listen }) => {
			unlisten.push(await listen<{ path: string; story: string; size: number; done: number }>('ingest-bytes', ({ payload }) => void (landing = payload)));
			// a proxy is in the store: its row, B ✓ at once
			unlisten.push(await listen('vault-proxy', () => void load()));
			unlisten.push(
				await listen<{ path: string; outcome: unknown }>('ingest', ({ payload }) => {
					if (!payload.outcome) return;
					landing = null;
					// the file is in: show it (at most every 2 s while a card comes in)
					clearTimeout(loading);
					loading = setTimeout(() => void load(), 2000);
				})
			);
		});
		const live = setInterval(async () => {
			making = await command<Making[]>('proxies_now').catch(() => []);
			hold = await command<string[]>('vault_hold').catch(() => []);
			const was = moving.filter((t) => t.done).length;
			moving = await command<Moving[]>('vault_transfers').catch(() => []);
			// a transfer just finished: its copy is now verified — look at the copies at once
			if (moving.filter((t) => t.done).length > was) copies = Object.fromEntries((await command<Copies[]>('vault_copies').catch(() => [])).map((c) => [c.hash, c]));
		}, 1000);
		return () => (clearInterval(timer), clearInterval(live), clearTimeout(loading), unlisten.forEach((u) => u()));
	});
</script>

{#snippet step(s: Step | null, what: string, retry: MediaItem | null)}
	{#if !s}<span class="none">—</span>
	{:else if s.state === 'ready'}<span class="ok" title="{what}: {s.note}">✓</span>
	{:else if s.state === 'running'}<span class="pct" title="{what}: {s.stage || s.note}">{Math.floor(s.progress * 100)}%</span>
	{:else if s.state === 'queued'}<span class="wait" title="{what}: {s.note}">0%</span>
	{:else if s.state === 'unknown'}<span class="wait" title="{what}: not started yet — it comes by itself">·</span>
	{:else if s.state === 'none'}<span class="none" title="{what}: {s.note}">∅</span>
	{:else if s.state === 'failed'}<span class="warn" title="{what}: failed, tries again by itself — {s.note}">↻</span>
	{:else if retry}<button class="miss again" title="{what}: {s.note} — click to try again" onclick={(e) => again(retry, e)}>✗</button>
	{:else}<span class="miss" title="{what}: {s.note}">✗</span>{/if}
{/snippet}

<div class="table">
	{#if current}
		<header>
			<div>
				<span class="ep">{current.inbox ? 'INBOX' : [current.series, current.episode].filter(Boolean).join(' · ')}</span>
				<h3>{current.title}</h3>
				{#if current.description && !current.inbox}<p>{current.description}</p>{/if}
			</div>
			<div class="state" class:ok={complete === mine.length && mine.length > 0}>
				<strong>{complete} / {mine.length}</strong> files kept as the story asks · {gb(mine.reduce((a, m) => a + m.size, 0))}
				{#if active.length}<br /><span class="live">↻ {active.length} on their way · {gb(active.reduce((a, t) => a + t.rate, 0))}/s</span>{/if}
				{#if wordsDue}<br /><span class="live">✎ {wordsDue} recording{wordsDue === 1 ? '' : 's'} still to transcribe, on this Mac</span>{/if}
			</div>
		</header>

		<div class="bar">
			<div class="chips">
				<button class:on={only === 'all'} onclick={() => (only = 'all')}>all {mine.length}</button>
				{#each CLASSES as c (c)}
					<button class:on={only === c} onclick={() => (only = c)}>{c} {mine.filter((m) => classOf(m) === c).length}</button>
				{/each}
			</div>
			<label><input type="checkbox" bind:checked={incomplete} /> only files still missing a copy</label>
			{#if selected.length}
				<span class="bulk">
					{selected.length} selected ·
					<select
						value=""
						onchange={(e) => {
							const s = stories.find((x) => x.id === e.currentTarget.value);
							if (s) pending = { kind: 'story', to: s.id, label: `Move ${selected.length} file${selected.length === 1 ? '' : 's'} to ${storyName(s)}` };
						}}
					>
						<option value="">move to story…</option>
						{#each stories.filter((s) => s.id !== story) as s (s.id)}<option value={s.id}>{storyName(s)}</option>{/each}
					</select>
					<select
						value=""
						onchange={(e) => {
							const c = e.currentTarget.value;
							if (c) pending = { kind: 'class', to: c, label: `Make ${selected.length} file${selected.length === 1 ? '' : 's'} ${c}` };
						}}
					>
						<option value="">class…</option>
						{#each BY_HAND as c (c)}<option value={c}>{c}</option>{/each}
					</select>
				</span>
			{/if}
			{#if pending}
				<span class="confirm">
					{pending.label}?
					<button class="yes" onclick={confirm}>Confirm</button>
					<button class="no" onclick={() => (pending = null)}>Cancel</button>
				</span>
			{/if}
		</div>

		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th><input type="checkbox" checked={selected.length > 0 && selected.length === files_.length} onchange={(e) => (selected = e.currentTarget.checked ? files_.map((m) => m.hash) : [])} /></th>
						{#each TIERS as t (t.tier)}<th class="c tier" title="{t.name} · {t.where}">{t.tier}</th>{/each}
						<th></th>
						<th>File (BLAKE3)</th>
						<th>Came in as · title</th>
						<th>Colour · proxy</th>
						<th class="c step" title="The words: transcribed on this Mac, on-device (Nemotron) — by itself after the ingest">Words</th>
						<th class="c step" title="The tags, cues and thumbnail: the shot analysis on the server (Qwen, confidential)">Tags</th>
						<th>Class</th>
						<th class="r">Size</th>
					</tr>
				</thead>
				<tbody>
					{#if landingHere}
						<tr class="coming">
							<td></td>
							{#each TIERS as t (t.tier)}
								<td class="c tier">
									{#if t.store === 'avenSSD'}<span class="pct" title="Local Master: coming in — copied, read back, taken in by iroh, each hashed">{Math.floor(landingHere.done * 100)}%</span>
									{:else if t.store}<span class="wait" title="{t.name}: after the ingest">0%</span>
									{:else}<span class="none">·</span>{/if}
								</td>
							{/each}
							<td class="thumb"><span>⇣</span></td>
							<td class="h">hashing…</td>
							<td class="n">{landingHere.path.split('/').pop()}</td>
							<td class="col"></td>
							<td class="c step"></td>
							<td class="c step"></td>
							<td></td>
							<td class="r">{gb(landingHere.size)}</td>
						</tr>
					{/if}
					{#each rows.slice(0, shown) as r (rowKey(r))}
						{#if 'coming' in r}
							{@const now = making.find((x) => x.of === r.coming.hash)}
							{@const ps = proxyState(r.coming.meta)}
							<tr class="coming">
								<td></td>
								{#each TIERS as t (t.tier)}
									<td class="c tier">
										{#if t.store === 'avenSSD'}
											{#if now?.stage === 'making'}<span class="pct" title="Local Master: rendering into ACEScct">{Math.floor(now.done * 100)}%</span>
											{:else if now}<span class="wait" title="Local Master: {now.stage === 'queued' ? 'queued for rendering — one at a time, after any ingest' : now.stage}">0%</span>
											{:else if ps.state === 'failed' && Number(r.coming.meta?.proxy_tries ?? 0) < 3}<span class="wait" title="Local Master: rendering again by itself — {ps.note}">0%</span>
											{:else if ps.state === 'failed'}<span class="miss" title="Rendering: {ps.note}">✗</span>
											{:else if ps.state === 'unknown-colour' || ps.state === 'waiting'}<span class="warn" title={ps.note}>⚠</span>
											{:else}<span class="wait" title="Local Master: rendering next">0%</span>{/if}
										{:else if t.store && (current?.rules.proxy ?? []).includes(t.store)}<span class="wait" title="{t.name}: once it is rendered">0%</span>
										{:else if t.store}<span class="none">—</span>
										{:else}<span class="none">·</span>{/if}
									</td>
								{/each}
								<td class="thumb"><span>▶</span></td>
								<td class="h">—</td>
								<td class="n sub">↳ {(r.coming.original_name ?? '').replace(/\.[^.]+$/, '')}.proxy</td>
								<td class="col"><span class="dim">ACEScct</span></td>
								<td class="c step"></td>
								<td class="c step"></td>
								<td><span class="cls proxy">proxy</span></td>
								<td class="r"></td>
							</tr>
						{:else}
						{@const m = r}
						<tr class:sel={selected.includes(m.hash)} class:short={!kept(m)} class:open={open === m.hash} onclick={(e) => !(e.target as HTMLElement).closest('input') && onopen(m)}>
							<td><input type="checkbox" checked={selected.includes(m.hash)} onchange={() => toggle(m.hash)} /></td>
							{#each TIERS as t (t.tier)}
								{@const st = t.store ? at(m, t.store) : ''}
								{@const mv = t.store && st !== 'ok' ? movingOf(m, t.store) : undefined}
								<td class="c tier">
									{#if !t.store}<span class="none" title="{t.name}: not set up yet">·</span>
									{:else if st === 'ok'}<span class="ok" title="{t.name}: verified by hash">✓</span>
									{:else if mv}<span class="pct" title="{t.name}: {gb(mv.sent)} of {gb(mv.size)} · {gb(mv.rate)}/s">{mv.size ? Math.floor((mv.sent / mv.size) * 100) : 0}%</span>
									{:else if st === ''}<span class="none" title="{t.name}: not a destination of this class">—</span>
									{:else}<span class="wait" title="{t.name}: {waitingWhy}">0%</span>{/if}
								</td>
							{/each}
							<td class="thumb">
								{#if thumbOf(m)}<img {@attach seen(vaultUrl(thumbOf(m)!))} alt="" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
								{:else if m.kind === 'image' && m.size < 4e6}<img {@attach seen(vaultUrl(m.hash))} alt="" />
								{:else}<span>{m.kind === 'video' ? '▶' : m.kind === 'audio' ? '♪' : m.kind === 'image' ? '▣' : '▤'}</span>{/if}
							</td>
							<td class="h" title={m.hash}>{m.hash.slice(0, 16)}…</td>
							<td class="n" class:sub={!!proxyOf(m)} title="{m.original_name ?? ''}{m.title ? ` · ${m.title}` : ''}">{#if proxyOf(m)}↳ {/if}{m.original_name || '—'}{#if m.title && m.title !== m.original_name}<small> · {m.title}</small>{/if}</td>
							<td class="col">
								{#if proxyOf(m)}<span class="dim">ACEScct</span>
								{:else if m.kind === 'video' && classOf(m) === 'original'}
									<span class="prof">{colourOf(m) ? profileInfo(colourOf(m)).label : '—'}</span>
								{:else if colourOf(m)}<span class="dim">{profileInfo(colourOf(m)).label}</span>{/if}
							</td>
							<td class="c step">{@render step(words(m), 'Words', m)}</td>
							<td class="c step">{@render step(tags(m), 'Tags', null)}</td>
							<td><span class="cls {classOf(m)}">{classOf(m)}</span></td>
							<td class="r">{gb(m.size)}</td>
						</tr>
						{/if}
					{:else}
						<tr><td colspan="12" class="empty">{mine.length ? 'Nothing matches.' : 'No files in this story yet — ingest into it, or move files here.'}</td></tr>
					{/each}
					{#if rows.length > shown}
						<tr><td colspan="12" class="more" {@attach more}>{rows.length - shown} more…</td></tr>
					{/if}
				</tbody>
			</table>
		</div>
	{/if}
	{#if error}<p class="err">{error}</p>{/if}
</div>

<style>
	.table { display: flex; flex-direction: column; min-height: 0; gap: 0.6rem; }
	header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
	.ep { font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--dim); }
	h3 { margin: 0.1rem 0 0.2rem; font-size: 1.15rem; }
	header p { margin: 0; max-width: 42rem; font-size: 0.82rem; color: var(--dim); }
	.state { flex-shrink: 0; padding: 0.35rem 0.7rem; border-radius: 999px; background: #f6e3da; font-size: 0.78rem; color: #8a2a12; }
	.state.ok { background: #eef2e6; color: #3e5a2f; }
	.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.8rem; font-size: 0.78rem; color: var(--dim); }
	.chips { display: flex; gap: 0.3rem; }
	.chips button { padding: 0.2rem 0.65rem; border: 1px solid var(--edge); border-radius: 999px; background: #fff; font: inherit; font-size: 0.76rem; color: var(--dim); cursor: pointer; }
	.chips button.on { border-color: var(--ink); background: var(--ink); color: #fff; }
	label { display: flex; align-items: center; gap: 0.35rem; }
	.bulk { display: flex; align-items: center; gap: 0.4rem; color: var(--ink); }
	select { padding: 0.2rem 0.4rem; border: 1px solid var(--edge); border-radius: 6px; background: #fff; font: inherit; font-size: 0.76rem; }
	.scroll { overflow: auto; min-height: 0; border: 1px solid var(--edge); border-radius: 10px; background: #fff; }
	table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
	th { position: sticky; top: 0; z-index: 1; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--edge); background: var(--bg); font-size: 0.68rem; font-weight: 600; letter-spacing: 0.06em; text-align: left; text-transform: uppercase; color: var(--dim); }
	td { padding: 0.38rem 0.6rem; border-bottom: 1px solid var(--edge); }
	tr.sel td { background: #f3f6ee; }
	tbody tr { cursor: pointer; }
	tbody tr:hover td { background: var(--bg); }
	tr.open td { background: #eef2e6; box-shadow: inset 0 1px 0 #9bb58a, inset 0 -1px 0 #9bb58a; }
	tr.short td.n { color: #8a2a12; }
	.r { text-align: right; white-space: nowrap; }
	.c { text-align: center; }
	.n { max-width: 22rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.h { font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--dim); }
	.cls { padding: 0.05rem 0.45rem; border-radius: 999px; background: var(--bg); font-size: 0.7rem; }
	.cls.original { background: #e8eefb; color: #2b4a8a; }
	.cls.proxy { background: #f1eafb; color: #5a3a8a; }
	.cls.delivery { background: #fbf3df; color: #7a5a14; }
	.tier { width: 2.2rem; padding-left: 0.2rem; padding-right: 0.2rem; }
	.tier .ok { display: inline-grid; place-items: center; width: 1.25rem; height: 1.25rem; border-radius: 50%; background: #6f9a57; font-size: 0.7rem; font-weight: 700; color: #fff; }
	.tier .pct { font-size: 0.72rem; font-weight: 600; font-variant-numeric: tabular-nums; color: #b8860b; }
	.tier .miss { font-weight: 700; color: #9c3b26; }
	.tier .warn { font-weight: 700; color: #b8860b; }
	.tier .wait { font-size: 0.72rem; font-variant-numeric: tabular-nums; color: var(--dim); }
	.tier .none, .step .none { color: var(--edge); }
	.step { width: 3rem; }
	.step .ok { display: inline-grid; place-items: center; width: 1.25rem; height: 1.25rem; border-radius: 50%; background: #4a5f93; font-size: 0.7rem; font-weight: 700; color: #fff; }
	.step .pct { font-size: 0.72rem; font-weight: 600; font-variant-numeric: tabular-nums; color: #b8860b; }
	.step .wait { font-size: 0.72rem; font-variant-numeric: tabular-nums; color: var(--dim); }
	.step .warn { font-weight: 700; color: #b8860b; }
	.step .miss { font-weight: 700; color: #9c3b26; }
	.step .again { padding: 0 0.3rem; border: 1px solid #e3b7a8; border-radius: 4px; background: #fff; font: inherit; cursor: pointer; }
	th.tier { text-align: center; }
	.thumb { width: 2.6rem; padding: 0.2rem 0.3rem; }
	.n.sub { padding-left: 1.4rem; color: var(--dim); }
	.col { white-space: nowrap; font-size: 0.74rem; }
	.col .prof { margin-right: 0.4rem; }
	.col .pok { color: #3e5a2f; }
	.col .pm { color: #b8860b; font-weight: 600; }
	.col .pw { color: #9c3b26; }
	.col .dim { color: var(--dim); }
	tr.coming td { background: var(--bg); font-size: 0.76rem; }
	.rbar { display: inline-block; width: 6rem; height: 3px; margin-left: 0.6rem; vertical-align: middle; border-radius: 2px; background: var(--edge); overflow: hidden; }
	.rbar i { display: block; height: 100%; background: #b8860b; transition: width 0.8s linear; }
	.more { padding: 0.8rem; text-align: center; color: var(--dim); }
	.thumb img, .thumb span { display: grid; place-items: center; width: 2.4rem; height: 1.6rem; border-radius: 4px; background: var(--bg); object-fit: cover; font-size: 0.8rem; color: var(--dim); }
	.live { font-size: 0.72rem; }
	.confirm { display: flex; align-items: center; gap: 0.4rem; padding: 0.2rem 0.3rem 0.2rem 0.7rem; border-radius: 999px; background: #fbf3df; color: #7a5a14; }
	.confirm button { padding: 0.15rem 0.7rem; border: 0; border-radius: 999px; font: inherit; font-size: 0.74rem; cursor: pointer; }
	.confirm .yes { background: var(--ink); color: #fff; }
	.confirm .no { background: transparent; color: var(--dim); text-decoration: underline; }
	.n small { color: var(--dim); }
	.empty { padding: 1.2rem; text-align: center; color: var(--dim); }
	.err { color: #9c3b26; }
</style>
