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
	import { BY_HAND, CLASSES, gb, vaultUrl, type Copies, type FileClass, type Moving, type StoryView } from './vault';

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
	const movingOf = (m: MediaItem, dest: string) => moving.find((t) => t.hash === m.hash && t.dest === dest && !t.done && !t.aborted);
	const active = $derived(moving.filter((t) => !t.done && !t.aborted && mine.some((m) => m.hash === t.hash)));
	let error = $state('');

	const current = $derived(stories.find((s) => s.id === story) ?? null);
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

	const rows = $derived(
		mine
			.filter((m) => (only === 'all' || classOf(m) === only) && (!incomplete || !kept(m)))
			.sort((a, b) => CLASSES.indexOf(classOf(a)) - CLASSES.indexOf(classOf(b)) || name(a).localeCompare(name(b), undefined, { numeric: true }))
	);
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
	const toggle = (h: string) => (selected = selected.includes(h) ? selected.filter((x) => x !== h) : [...selected, h]);

	$effect(() => {
		void reload;
		void load();
	});
	onMount(() => {
		// the copies change while files sync: look again every 10 s; what is moving, every second
		const timer = setInterval(async () => {
			copies = Object.fromEntries((await command<Copies[]>('vault_copies').catch(() => [])).map((c) => [c.hash, c]));
		}, 10000);
		const live = setInterval(async () => {
			const was = moving.filter((t) => t.done).length;
			moving = await command<Moving[]>('vault_transfers').catch(() => []);
			// a transfer just finished: its copy is now verified — look at the copies at once
			if (moving.filter((t) => t.done).length > was) copies = Object.fromEntries((await command<Copies[]>('vault_copies').catch(() => [])).map((c) => [c.hash, c]));
		}, 1000);
		return () => (clearInterval(timer), clearInterval(live));
	});
</script>

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
						<th>Synced</th>
						<th><input type="checkbox" checked={selected.length > 0 && selected.length === rows.length} onchange={(e) => (selected = e.currentTarget.checked ? rows.map((m) => m.hash) : [])} /></th>
						<th></th>
						<th>File (BLAKE3)</th>
						<th>Came in as · title</th>
						<th>Class</th>
						<th class="r">Size</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as m (m.hash)}
						<tr class:sel={selected.includes(m.hash)} class:short={!kept(m)} class:open={open === m.hash} onclick={(e) => !(e.target as HTMLElement).closest('input') && onopen(m)}>
							<td class="sync" class:good={kept(m)}>
								{#if kept(m)}
									<span class="all" title="Verified by hash at {destinations.filter((d) => at(m, d) === 'ok').join(' and ')}">✓</span>
								{/if}
								<span class="per">
									{#each destinations.filter((d) => at(m, d) !== '') as d (d)}
										{@const st = at(m, d)}
										{@const mv = st === 'ok' ? undefined : movingOf(m, d)}
										<span class="d {mv ? 'moving' : st.replaceAll(' ', '-')}" title="{d}: {mv ? `${gb(mv.sent)} of ${gb(mv.size)} · ${gb(mv.rate)}/s` : st}">
											{d}
											<b>{st === 'ok' ? '✓' : mv ? `${mv.size ? Math.floor((mv.sent / mv.size) * 100) : 0}%` : st === 'on its way' ? '↻' : '✗'}</b>
										</span>
									{/each}
								</span>
							</td>
							<td><input type="checkbox" checked={selected.includes(m.hash)} onchange={() => toggle(m.hash)} /></td>
							<td class="thumb">
								{#if m.kind === 'image'}<img src={vaultUrl(m.hash)} alt="" loading="lazy" />
								{:else if m.kind === 'video'}<video src="{vaultUrl(m.meta?.proxy && typeof m.meta.proxy === 'string' && /^[0-9a-f]{64}$/.test(m.meta.proxy) ? m.meta.proxy : m.hash)}#t=1" preload="metadata" muted playsinline></video>
								{:else}<span>{m.kind === 'audio' ? '♪' : '▤'}</span>{/if}
							</td>
							<td class="h" title={m.hash}>{m.hash.slice(0, 16)}…</td>
							<td class="n" title="{m.original_name ?? ''}{m.title ? ` · ${m.title}` : ''}">{m.original_name || '—'}{#if m.title && m.title !== m.original_name}<small> · {m.title}</small>{/if}</td>
							<td><span class="cls {classOf(m)}">{classOf(m)}</span></td>
							<td class="r">{gb(m.size)}</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="empty">{mine.length ? 'Nothing matches.' : 'No files in this story yet — ingest into it, or move files here.'}</td></tr>
					{/each}
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
	.sync { display: flex; align-items: center; gap: 0.45rem; white-space: nowrap; }
	.sync .all { display: grid; place-items: center; width: 1.2rem; height: 1.2rem; border-radius: 50%; background: #6f9a57; font-size: 0.7rem; font-weight: 700; color: #fff; }
	.per { display: flex; flex-direction: column; gap: 0.05rem; font-size: 0.68rem; line-height: 1.25; color: var(--dim); }
	.per b { font-weight: 700; }
	.d.ok b { color: #3e5a2f; }
	.d.moving b, .d.on-its-way b { color: #b8860b; }
	.d.missing b { color: #9c3b26; }
	.thumb { width: 2.6rem; padding: 0.2rem 0.3rem; }
	.thumb img, .thumb video, .thumb span { display: grid; place-items: center; width: 2.4rem; height: 1.6rem; border-radius: 4px; background: var(--bg); object-fit: cover; font-size: 0.8rem; color: var(--dim); }
	.live { font-size: 0.72rem; }
	.confirm { display: flex; align-items: center; gap: 0.4rem; padding: 0.2rem 0.3rem 0.2rem 0.7rem; border-radius: 999px; background: #fbf3df; color: #7a5a14; }
	.confirm button { padding: 0.15rem 0.7rem; border: 0; border-radius: 999px; font: inherit; font-size: 0.74rem; cursor: pointer; }
	.confirm .yes { background: var(--ink); color: #fff; }
	.confirm .no { background: transparent; color: var(--dim); text-decoration: underline; }
	.n small { color: var(--dim); }
	.empty { padding: 1.2rem; text-align: center; color: var(--dim); }
	.err { color: #9c3b26; }
</style>
