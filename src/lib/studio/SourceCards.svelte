<!--
	What each source brought in — a card, a drive, a folder — newest first, as one card each: its files, what was new
	and what was already in the vault, and for every destination how many of its files are there, verified by hash, and
	what is on its way right now (live, from iroh). When every file is at every
	destination, the source may be released: the check reads every copy back and hashes it (this Mac here, Object
	Storage on the server) and only then says so. Deleting the source is the person's, by hand; the app never does.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { command } from '$lib/native';
	import { listMedia, type MediaItem } from '$lib/auth/client';
	import { TIERS, gb, proxyState, type Copies, type Making, type Moving } from './vault';
	import { isCache } from './color.js';
	import { analysisState, hasSound, stepOpen, transcriptState } from './transcript.js';

	type SourceFile = { hash: string; name: string; size: number; verdict: string };
	type Ingested = { session: string; story: string; path: string; name: string; bytes: number; files: SourceFile[] };

	let { story, reload = 0 }: { story: string | null; reload?: number } = $props();

	let sources = $state<Ingested[]>([]);
	let copies = $state<Record<string, Copies>>({});
	let moving = $state<Moving[]>([]);
	let making = $state<Making[]>([]);
	let meta = $state<Record<string, MediaItem>>({});
	/** the proxies of a source's video originals: made, being made, waiting (and why) */
	function proxies(s: Ingested) {
		const vids = s.files.map((f) => meta[f.hash]).filter((m): m is MediaItem => !!m && m.kind === 'video' && m.class === 'original');
		const now = making.filter((x) => vids.some((m) => m.hash === x.of));
		const states = vids.map((m) => proxyState(m.meta).state);
		return {
			total: vids.length,
			made: states.filter((x) => x === 'made').length,
			waiting: vids.filter((m) => ['waiting', 'unknown-colour'].includes(proxyState(m.meta).state) && !now.some((x) => x.of === m.hash)),
			failed: states.filter((x) => x === 'failed').length,
			current: now.find((x) => x.stage !== 'queued'),
			queued: now.filter((x) => x.stage === 'queued').length
		};
	}
	/** the words of a source's recordings (on this Mac, on-device) and the tags of its pictures (the server) */
	function steps(s: Ingested) {
		const all = s.files.map((f) => meta[f.hash]).filter((m): m is MediaItem => !!m && !isCache(m));
		const rec = all.filter((m) => hasSound(m));
		const ws = rec.map((m) => ({ m, st: transcriptState(m) }));
		const live = making.find((x) => x.of.startsWith('transcript:') && rec.some((m) => x.of === `transcript:${m.hash}`) && x.stage !== 'queued');
		const pics = all.filter((m) => m.kind === 'video' || m.kind === 'image');
		const ts = pics.map((m) => analysisState(m));
		return {
			rec: rec.length,
			words: ws.filter((x) => x.st.state === 'ready' || x.st.state === 'none').length,
			live,
			stuck: ws.filter((x) => x.st.state === 'stuck').length,
			retrying: ws.filter((x) => x.st.state === 'failed').length,
			pics: pics.length,
			tagged: ts.filter((x) => x.state === 'ready' || x.state === 'none').length,
			tagging: ts.find((x) => x.state === 'running'),
			waitsWhy: ts.find((x) => x.state === 'queued' && x.note !== 'queued')?.note ?? ''
		};
	}
	let error = $state('');
	const DESTS = ['avenSSD', 'hetzner'] as const;

	const keyOf = (s: Ingested) => `${s.session}|${s.path}`;
	/** one destination's state of one file: verified by hash, on its way (with how far), or missing */
	function at(hash: string, dest: string): { st: 'ok' | 'moving' | 'missing'; sent?: number; size?: number; rate?: number } {
		const c = copies[hash];
		const ok = dest === 'avenSSD' ? c?.here === 'verified' : c?.server === 'stored';
		if (ok) return { st: 'ok' };
		const t = moving.find((m) => m.hash === hash && m.dest === dest && !m.done && !m.aborted);
		if (t) return { st: 'moving', sent: t.sent, size: t.size, rate: t.rate };
		return { st: 'missing' };
	}
	function dest(s: Ingested, d: string) {
		const files = s.files.filter((f) => f.verdict !== 'mismatch');
		let ok = 0, okBytes = 0, sent = 0, rate = 0, going = 0;
		for (const f of files) {
			const a = at(f.hash, d);
			if (a.st === 'ok') (ok++, (okBytes += f.size));
			else if (a.st === 'moving') (going++, (sent += a.sent ?? 0), (rate += a.rate ?? 0));
		}
		const bytes = files.reduce((n, f) => n + f.size, 0);
		return { ok, total: files.length, okBytes, bytes, going, sent, rate, pct: bytes ? ((okBytes + sent) / bytes) * 100 : 100 };
	}
	const complete = (s: Ingested) => s.files.every((f) => f.verdict !== 'mismatch') && DESTS.every((d) => dest(s, d).ok === s.files.length);
	const tierLine = (t: (typeof TIERS)[number]) => `${t.tier} · ${t.name}`;
	const counts = (s: Ingested) => ({
		fresh: s.files.filter((f) => f.verdict === 'verified').length,
		dup: s.files.filter((f) => f.verdict === 'duplicate').length,
		bad: s.files.filter((f) => f.verdict === 'mismatch').length
	});

	export async function load() {
		try {
			sources = await command<Ingested[]>('ingest_sources', { story });
			meta = Object.fromEntries((await listMedia()).map((m) => [m.hash, m]));
			copies = Object.fromEntries((await command<Copies[]>('vault_copies')).map((c) => [c.hash, c]));
		} catch (e) {
			error = String(e);
		}
	}
	$effect(() => {
		void story;
		void reload;
		void load();
	});

	// ── deleting a source: by hand, after the person saw exactly what goes ──
	type Release = { name: string; hash: string; size: number; local: boolean; cloud: boolean; kept: boolean; why: string };
	let deleting = $state<Ingested | null>(null);
	let files = $state<Release[]>([]);
	let asking = $state(false);
	let sure = $state(false);
	let busy = $state(false);
	let result = $state<{ moved: number; bytes: number; left: { name: string; why: string }[] } | null>(null);
	/** sources whose files went to the Trash this session */
	let gone = $state<Record<string, number>>({});
	const allKept = $derived(files.length > 0 && files.every((f) => f.kept));
	async function ask(s: Ingested) {
		deleting = s;
		files = [];
		sure = false;
		result = null;
		asking = true;
		try {
			files = await command<Release[]>('source_ready', { session: s.session, path: s.path });
		} catch (e) {
			error = String(e);
			deleting = null;
		} finally {
			asking = false;
		}
	}
	async function remove() {
		if (!deleting || !allKept || !sure) return;
		busy = true;
		try {
			result = await command<{ moved: number; bytes: number; left: { name: string; why: string }[] }>('source_delete', { session: deleting.session, path: deleting.path });
			gone = { ...gone, [keyOf(deleting)]: result.moved };
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		const live = setInterval(async () => {
			const wasMaking = making.length;
			making = await command<Making[]>('proxies_now').catch(() => []);
			// a proxy just came in: read the descriptions again
			if (making.length < wasMaking) meta = Object.fromEntries((await listMedia().catch(() => [])).map((m) => [m.hash, m]));
			const was = moving.filter((t) => t.done).length;
			moving = await command<Moving[]>('vault_transfers').catch(() => []);
			if (moving.filter((t) => t.done).length > was) copies = Object.fromEntries((await command<Copies[]>('vault_copies').catch(() => [])).map((c) => [c.hash, c]));
		}, 1000);
		const slow = setInterval(async () => {
			copies = Object.fromEntries((await command<Copies[]>('vault_copies').catch(() => [])).map((c) => [c.hash, c]));
			// words or tags still coming for a source's files: the descriptions again, so the line moves on
			const open = sources.some((s) => s.files.some((f) => { const m = meta[f.hash]; return !!m && !isCache(m) && ((hasSound(m) && stepOpen(transcriptState(m))) || ((m.kind === 'video' || m.kind === 'image') && analysisState(m).state === 'running')); }));
			if (open) meta = Object.fromEntries((await listMedia().catch(() => [])).map((m) => [m.hash, m]));
		}, 10000);
		return () => (clearInterval(live), clearInterval(slow));
	});
	const when = (s: string) => (s ? new Date(s).toLocaleString() : '');
</script>

<div class="cards">
	{#each sources as s (keyOf(s))}
		{@const c = counts(s)}
		{@const done = complete(s)}
		{@const px = proxies(s)}
		{@const st = steps(s)}
		<article class="card" class:done>
			<header>
				<div>
					<h3>{s.name}</h3>
					<p class="path" title={s.path}>{s.path}</p>
				</div>
				<p class="meta">
					{when(s.session)}<br />
					<strong>{s.files.length} files · {gb(s.bytes)}</strong> — {c.fresh} new · {c.dup} already in the vault{#if c.bad} · <span class="bad">{c.bad} mismatches</span>{/if}
				</p>
			</header>

			<div class="dests">
				{#each TIERS as t (t.tier)}
					{#if !t.store}
						<div class="dest off">
							<span class="name" title={t.where}>{tierLine(t)}</span>
							<div class="bar"></div>
							<span class="n">not set up yet</span>
						</div>
					{:else}
					{@const x = dest(s, t.store)}
					<div class="dest">
						<span class="name" title={t.where}>{tierLine(t)}</span>
						<div class="bar"><i class:full={x.ok === x.total} style:width="{Math.min(100, x.pct)}%"></i></div>
						<span class="n">
							{#if x.ok === x.total}✓ {x.ok}/{x.total} verified
							{:else}{x.ok}/{x.total} · {gb(x.okBytes + x.sent)} of {gb(x.bytes)}{#if x.going} · ↻ {x.going} on their way · {gb(x.rate)}/s{/if}{/if}
						</span>
					</div>
					{/if}
				{/each}
			</div>

			<footer>
				<div class="steps">
					{#if px.total}
						<p>
							<b>Proxies</b> {px.made}/{px.total}
							{#if px.current} · {px.current.name} {Math.floor(px.current.done * 100)}%{/if}
							{#if px.queued} · {px.queued} queued{/if}
							{#if px.waiting.length}<span class="warn"> · ⚠ {px.waiting.length} waiting — no colour journey for {[...new Set(px.waiting.map((m) => String((m.meta?.color as { profile?: string } | undefined)?.profile ?? 'an unknown source')))].join(', ')} yet</span>{/if}
							{#if px.failed}<span class="warn"> · {px.failed} failed</span>{/if}
						</p>
					{/if}
					{#if st.rec}
						<p title="Transcribed on this Mac, on-device (Nemotron) — by itself after the ingest; a failure tries again by itself, three times">
							<b>Words</b> {st.words}/{st.rec}
							{#if st.live} · {st.live.name} — {st.live.stage} {Math.floor(st.live.done * 100)}%{/if}
							{#if st.retrying}<span class="soft"> · {st.retrying} trying again</span>{/if}
							{#if st.stuck}<span class="warn"> · {st.stuck} failed — open them in the table to start again</span>{/if}
						</p>
					{/if}
					{#if st.pics}
						<p title="The shot analysis on the server (Qwen, confidential): tags, cues, the thumbnail">
							<b>Tags</b> {st.tagged}/{st.pics}
							{#if st.tagging} · {Math.floor(st.tagging.progress * 100)}%{/if}
							{#if st.waitsWhy && st.tagged < st.pics}<span class="soft"> · waits: {st.waitsWhy}</span>{/if}
						</p>
					{/if}
				</div>
				{#if gone[keyOf(s)] !== undefined}
					<span class="gone">✓ {gone[keyOf(s)]} files moved to the Trash</span>
				{:else}
					<button class="release" disabled={!done} onclick={() => ask(s)} title={done ? 'Every file is kept as its story says' : 'Not every file is at every destination yet'}>
						{done ? 'Delete source…' : 'Delete once every copy is there'}
					</button>
				{/if}
			</footer>

		</article>
	{:else}
		<p class="quiet">Nothing ingested into this story yet.</p>
	{/each}
	{#if error}<p class="bad">{error}</p>{/if}
</div>

{#if deleting}
	<div class="veil" role="presentation">
		<div class="dialog" role="dialog" aria-label="Delete this source">
			{#if result}
				<h3>{result.moved} files moved to the Trash</h3>
				<p>{gb(result.bytes)} from <code>{deleting.path}</code> — they stay in the Trash until it is emptied.</p>
				{#if result.left.length}
					<p class="bad">{result.left.length} left where they are:</p>
					<ul class="list">{#each result.left as l (l.name)}<li><span>{l.name}</span><em>{l.why}</em></li>{/each}</ul>
				{/if}
				<div class="actions"><button class="primary" onclick={() => (deleting = null)}>Done</button></div>
			{:else}
				<h3>Delete {deleting.name}?</h3>
				<p class="path">{deleting.path}</p>
				{#if asking}
					<p class="dim">Asking every destination…</p>
				{:else}
					<p>
						These <strong>{files.length} files · {gb(files.reduce((a, f) => a + f.size, 0))}</strong> would go to the Trash — each read once
						more first, and only if it is still the very bytes that came in.
					</p>
					<ul class="list">
						{#each files as f (f.hash + f.name)}
							<li class:no={!f.kept}>
								<span>{f.name}</span>
								<small>{gb(f.size)}</small>
								<b class:ok={f.cloud}>A {f.cloud ? '✓' : '✗'}</b>
								<b class:ok={f.local}>B {f.local ? '✓' : '✗'}</b>
								{#if !f.kept}<em>{f.why}</em>{/if}
							</li>
						{/each}
					</ul>
					{#if allKept}
						<label class="sure"><input type="checkbox" bind:checked={sure} /> Every file is kept in at least two places, as its story says — move these {files.length} files to the Trash.</label>
					{:else}
						<p class="bad">Not every file is kept as its story says — nothing can be deleted yet.</p>
					{/if}
					<div class="actions">
						<button class="link" onclick={() => (deleting = null)} disabled={busy}>Cancel</button>
						{#if allKept}<button class="danger" disabled={!sure || busy} onclick={remove}>{busy ? 'Reading and moving…' : `Move ${files.length} files to the Trash`}</button>{/if}
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.cards { display: flex; flex-direction: column; gap: 0.5rem; }
	.card { padding: 0.55rem 0.8rem; border: 1px solid var(--edge); border-radius: 10px; background: var(--raised); }
	.card.done { border-color: var(--ok-line); }
	header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
	h3 { margin: 0; font-size: 0.92rem; }
	.path { margin: 0; overflow: hidden; max-width: 30rem; font-family: ui-monospace, monospace; font-size: 0.66rem; white-space: nowrap; text-overflow: ellipsis; color: var(--dim); }
	.meta { margin: 0; font-size: 0.72rem; text-align: right; color: var(--dim); }
	.meta strong { color: var(--ink); }
	.dests { display: flex; flex-direction: column; gap: 0.2rem; margin: 0.45rem 0 0.3rem; }
	.dest.off { display: none; }
	.dest { display: grid; grid-template-columns: 11rem 1fr 16rem; gap: 0.6rem; align-items: center; font-size: 0.72rem; }
	.dest .name { font-weight: 600; }
	.dest .n { color: var(--dim); }
	.bar { overflow: hidden; height: 4px; border-radius: 2px; background: var(--edge); }
	.bar i { display: block; height: 100%; background: var(--accent); transition: width 0.8s linear; }
	.bar i.full { background: var(--ok); }
	.steps { display: flex; flex-wrap: wrap; gap: 0.1rem 1.1rem; min-width: 0; }
	.steps p { margin: 0; font-size: 0.72rem; color: var(--dim); }
	.steps b { margin-right: 0.25rem; font-weight: 600; color: var(--ink); }
	.soft { color: var(--warn); }
	.warn { color: var(--bad); }
	footer { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; margin-top: 0.15rem; }
	.link { padding: 0; border: 0; background: none; font: inherit; font-size: 0.78rem; color: var(--dim); text-decoration: underline; cursor: pointer; }
	.release { flex-shrink: 0; padding: 0.25rem 0.75rem; border: 0; border-radius: 999px; background: var(--ink); font: inherit; font-size: 0.72rem; color: var(--on-ink); cursor: pointer; }
	.release:disabled { background: var(--edge); color: var(--dim); cursor: default; }
	.bad { color: var(--bad); }
	.quiet { color: var(--dim); }
	.veil { position: fixed; inset: 0; z-index: 400; display: grid; place-items: center; background: rgb(2 6 12 / 0.65); }
	.dialog { width: min(34rem, 92vw); padding: 1.2rem 1.4rem; border-radius: 14px; background: var(--panel); box-shadow: 0 20px 60px rgb(0 0 0 / 0.6); }
	.dialog h3 { font-size: 1.15rem; }
	.dialog code { padding: 0.2rem 0.4rem; border-radius: 6px; background: var(--bg); font-size: 0.74rem; word-break: break-all; }
	.dialog p { font-size: 0.84rem; }
	.list { max-height: 16rem; overflow: auto; margin: 0.4rem 0 0.8rem; padding: 0; list-style: none; border-top: 1px solid var(--edge); }
	.list li { display: grid; grid-template-columns: minmax(0, 1fr) 4.5rem 2.2rem 2.2rem; gap: 0.5rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid var(--edge); font-size: 0.76rem; }
	.list li span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.list li small { text-align: right; color: var(--dim); }
	.list li b { font-weight: 600; color: var(--bad); }
	.list li b.ok { color: var(--ok); }
	.list li em { grid-column: 1 / -1; font-style: normal; color: var(--bad); }
	.list li.no span { color: var(--bad); }
	.sure { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.82rem; }
	.primary, .danger { padding: 0.4rem 1rem; border: 0; border-radius: 999px; font: inherit; font-size: 0.82rem; color: #fff; cursor: pointer; }
	.primary { background: var(--ink); color: var(--on-ink); }
	.danger { background: #c9432f; }
	.danger:disabled { opacity: 0.4; cursor: default; }
	.actions { gap: 1rem; align-items: center; }
	.gone { font-size: 0.8rem; color: var(--ok); }
	.dim { color: var(--dim); }
	.actions { display: flex; justify-content: flex-end; margin-top: 0.8rem; }
</style>
