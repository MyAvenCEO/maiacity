<!--
	What each source brought in — a card, a drive, a folder — newest first, as one card each: its files, what was new
	and what was already in the vault, and for every destination how many of its files are there, verified by hash, and
	what is on its way right now (live, from iroh). When every file is at every
	destination, the source may be released: the check reads every copy back and hashes it (this Mac here, Object
	Storage on the server) and only then says so. Deleting the source is the person's, by hand; the app never does.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { command } from '$lib/native';
	import { TIERS, gb, type Copies, type Moving } from './vault';

	type SourceFile = { hash: string; name: string; size: number; verdict: string };
	type Ingested = { session: string; story: string; path: string; name: string; bytes: number; files: SourceFile[] };
	type Checked = { hash: string; avenSSD: string; hetzner: string };

	let { story, reload = 0 }: { story: string | null; reload?: number } = $props();

	let sources = $state<Ingested[]>([]);
	let copies = $state<Record<string, Copies>>({});
	let moving = $state<Moving[]>([]);
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

	// ── releasing a source: every copy read back and hashed, now ──
	let releasing = $state<Ingested | null>(null);
	let checked = $state<Checked[]>([]);
	let checking = $state(false);
	let verdict = $state<boolean | null>(null);
	let unlisten: (() => void) | null = null;
	async function release(s: Ingested) {
		releasing = s;
		checked = [];
		verdict = null;
		checking = true;
		try {
			const r = await command<{ ok: boolean; files: Checked[] }>('release_check', { hashes: s.files.map((f) => f.hash) });
			checked = r.files;
			verdict = r.ok;
		} catch (e) {
			error = String(e);
		} finally {
			checking = false;
		}
	}
	let copiedPath = $state(false);
	async function copyPath(p: string) {
		await navigator.clipboard.writeText(p);
		copiedPath = true;
		setTimeout(() => (copiedPath = false), 1400);
	}

	onMount(() => {
		void import('@tauri-apps/api/event').then(async ({ listen }) => {
			unlisten = await listen<{ index: number; total: number; file: Checked }>('release-check', ({ payload }) => {
				checked = [...checked.filter((c) => c.hash !== payload.file.hash), payload.file];
			});
		});
		const live = setInterval(async () => {
			const was = moving.filter((t) => t.done).length;
			moving = await command<Moving[]>('vault_transfers').catch(() => []);
			if (moving.filter((t) => t.done).length > was) copies = Object.fromEntries((await command<Copies[]>('vault_copies').catch(() => [])).map((c) => [c.hash, c]));
		}, 1000);
		const slow = setInterval(async () => {
			copies = Object.fromEntries((await command<Copies[]>('vault_copies').catch(() => [])).map((c) => [c.hash, c]));
		}, 10000);
		return () => (clearInterval(live), clearInterval(slow));
	});
	onDestroy(() => unlisten?.());
	const when = (s: string) => (s ? new Date(s).toLocaleString() : '');
	const mark = (st: string) => (st === 'verified' ? '✓' : st === 'missing' ? '✗ missing' : st === 'corrupt' ? '✗ CORRUPT' : '? unreachable');
</script>

<div class="cards">
	{#each sources as s (keyOf(s))}
		{@const c = counts(s)}
		{@const done = complete(s)}
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
				<span></span>
				<button class="release" disabled={!done} onclick={() => release(s)} title={done ? 'Read every copy back and hash it, then say whether the source may go' : 'Not every file is at every destination yet'}>
					{done ? 'Release this source…' : 'Release when every copy is there'}
				</button>
			</footer>

		</article>
	{:else}
		<p class="quiet">Nothing ingested into this story yet.</p>
	{/each}
	{#if error}<p class="bad">{error}</p>{/if}
</div>

{#if releasing}
	<div class="veil" role="presentation">
		<div class="dialog" role="dialog" aria-label="Release this source">
			<h3>Release {releasing.name}?</h3>
			<p class="path">{releasing.path}</p>
			{#if checking}
				<p>Reading every copy back and hashing it — B on this Mac, A on the server… {checked.length} / {releasing.files.length}</p>
				<div class="bar"><i style:width="{(checked.length / releasing.files.length) * 100}%"></i></div>
			{:else if verdict}
				<p class="good">✓ All {releasing.files.length} files verified just now at A (Hetzner) and B (avenSSD) — each read back and hashed.</p>
				<p>The source may go. <strong>Delete it yourself</strong> (the app never does):</p>
				<p class="pathbox"><code>{releasing.path}</code> <button class="link" onclick={() => copyPath(releasing!.path)}>{copiedPath ? 'copied' : 'copy the path'}</button></p>
			{:else if verdict === false}
				<p class="bad">Not every copy holds — keep the source.</p>
				<ul class="problems">
					{#each checked.filter((c) => c.avenSSD !== 'verified' || c.hetzner !== 'verified') as c (c.hash)}
						<li><code>{c.hash.slice(0, 12)}…</code> A {mark(c.hetzner)} · B {mark(c.avenSSD)}</li>
					{/each}
				</ul>
			{/if}
			<div class="actions"><button class="link" onclick={() => (releasing = null)} disabled={checking}>Close</button></div>
		</div>
	</div>
{/if}

<style>
	.cards { display: flex; flex-direction: column; gap: 0.8rem; }
	.card { padding: 0.9rem 1rem; border: 1px solid var(--edge); border-radius: 12px; background: #fff; }
	.card.done { border-color: #9bb58a; }
	header { display: flex; justify-content: space-between; gap: 1rem; }
	h3 { margin: 0; font-size: 1.05rem; }
	.path { margin: 0.1rem 0 0; overflow: hidden; max-width: 34rem; font-family: ui-monospace, monospace; font-size: 0.7rem; white-space: nowrap; text-overflow: ellipsis; color: var(--dim); }
	.meta { margin: 0; font-size: 0.78rem; text-align: right; color: var(--dim); }
	.meta strong { color: var(--ink); }
	.dests { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.8rem 0 0.5rem; }
	.dest.off { opacity: 0.45; }
	.dest { display: grid; grid-template-columns: 13rem 1fr 18rem; gap: 0.7rem; align-items: center; font-size: 0.78rem; }
	.dest .name { font-weight: 600; }
	.dest .n { color: var(--dim); }
	.bar { overflow: hidden; height: 6px; border-radius: 3px; background: var(--edge); }
	.bar i { display: block; height: 100%; background: #d9a441; transition: width 0.8s linear; }
	.bar i.full { background: #6f9a57; }
	footer { display: flex; align-items: center; justify-content: space-between; margin-top: 0.4rem; }
	.link { padding: 0; border: 0; background: none; font: inherit; font-size: 0.78rem; color: var(--dim); text-decoration: underline; cursor: pointer; }
	.release { padding: 0.35rem 0.9rem; border: 0; border-radius: 999px; background: var(--ink); font: inherit; font-size: 0.8rem; color: #fff; cursor: pointer; }
	.release:disabled { background: var(--edge); color: var(--dim); cursor: default; }
	.bad { color: #9c3b26; }
	.good { color: #3e5a2f; }
	.quiet { color: var(--dim); }
	.veil { position: fixed; inset: 0; z-index: 400; display: grid; place-items: center; background: rgba(20, 26, 22, 0.45); }
	.dialog { width: min(34rem, 92vw); padding: 1.2rem 1.4rem; border-radius: 14px; background: var(--panel, #fbfaf6); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25); }
	.dialog h3 { font-size: 1.15rem; }
	.dialog .bar { margin: 0.4rem 0 0.8rem; }
	.pathbox { display: flex; align-items: center; gap: 0.6rem; }
	.pathbox code { padding: 0.2rem 0.4rem; border-radius: 6px; background: var(--bg); font-size: 0.74rem; word-break: break-all; }
	.problems { font-size: 0.76rem; }
	.actions { display: flex; justify-content: flex-end; margin-top: 0.8rem; }
</style>
