<!--
	Activity — every file on its way right now, live from iroh: to this Mac's avenSSD, to the server's Object Storage
	(hetzner), or to another device — how far, how fast — and what arrived in the last minute. Nothing here is decided;
	it only shows the syncing the stories' rules set in motion.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { listMedia } from '$lib/auth/client';
	import { command } from '$lib/native';
	import { gb, type Making, type Moving } from './vault';

	type Ingested = { session: string; story: string; path: string; name: string; bytes: number; files: { verdict: string }[] };
	let moving = $state<Moving[]>([]);
	let names = $state<Record<string, string>>({});
	let ingests = $state<Ingested[]>([]);
	let making = $state<Making[]>([]);

	const going = $derived(moving.filter((t) => !t.done && !t.aborted));
	const ended = $derived(moving.filter((t) => t.done || t.aborted));
	const rate = $derived(going.reduce((a, t) => a + t.rate, 0));
	const label = (h: string) => names[h] ?? `${h.slice(0, 12)}…`;

	onMount(() => {
		void command<Ingested[]>('ingest_sources', { story: null }).then((all) => (ingests = all)).catch(() => {});
		void listMedia().then((all) => (names = Object.fromEntries(all.map((m) => [m.hash, m.original_name || m.title || `${m.hash.slice(0, 12)}…`]))));
		const tick = async () => {
			moving = await command<Moving[]>('vault_transfers').catch(() => []);
			making = await command<Making[]>('proxies_now').catch(() => []);
		};
		void tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	});
</script>

<p class="sum">
	{#if going.length}{going.length} on their way · {gb(rate)}/s{:else}Nothing on its way right now — every copy the rules ask for is in place, or waits for its device.{/if}
</p>

<ul>
	{#each going as t (t.hash + t.dest)}
		<li>
			<span class="n" title={t.hash}>{label(t.hash)}</span>
			<span class="d">→ {t.dest}</span>
			<span class="bar"><i style:width="{t.size ? (t.sent / t.size) * 100 : 0}%"></i></span>
			<span class="p">{t.size ? Math.floor((t.sent / t.size) * 100) : 0}% · {gb(t.sent)} of {gb(t.size)} · {gb(t.rate)}/s</span>
		</li>
	{/each}
	{#each ended as t (t.hash + t.dest)}
		<li class="ended" class:aborted={t.aborted}>
			<span class="n" title={t.hash}>{label(t.hash)}</span>
			<span class="d">→ {t.dest}</span>
			<span class="p">{t.aborted ? 'broke off — tried again by itself' : `✓ ${gb(t.size)}`}</span>
		</li>
	{/each}
</ul>

{#if making.length}
	<h4>Proxies</h4>
	<ul>
		{#each making as x (x.of)}
			<li class="ended">
				<span class="n">{x.name}</span>
				<span class="d">→ ACEScct</span>
				<span class="p">{x.stage === 'making' ? `${Math.floor(x.done * 100)}%` : x.stage}</span>
			</li>
		{/each}
	</ul>
{/if}

<h4>Ingested</h4>
<ul>
	{#each ingests as i (i.session + i.path)}
		<li class="ingest">
			<span class="n" title={i.path}>{i.name}</span>
			<span class="d">{new Date(i.session).toLocaleString()}</span>
			<span class="p">{i.files.length} files · {gb(i.bytes)} · {i.files.filter((f) => f.verdict === 'verified').length} new · {i.files.filter((f) => f.verdict === 'duplicate').length} already{#if i.files.some((f) => f.verdict === 'mismatch')} · <b>mismatches</b>{/if}</span>
		</li>
	{:else}
		<li class="ingest"><span class="d">Nothing ingested yet.</span></li>
	{/each}
</ul>

<style>
	.sum { margin: 0 0 0.8rem; font-size: 0.84rem; color: var(--dim); }
	h4 { margin: 1.6rem 0 0.4rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
	li.ingest { grid-template-columns: minmax(0, 1fr) 11rem 20rem; }
	li.ingest b { color: #9c3b26; }
	ul { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
	li { display: grid; grid-template-columns: minmax(0, 1fr) 6rem 8rem 15rem; gap: 0.8rem; align-items: center; padding: 0.45rem 0; border-bottom: 1px solid var(--edge); font-size: 0.8rem; }
	li.ended { grid-template-columns: minmax(0, 1fr) 6rem 23.8rem; color: var(--dim); }
	li.aborted .p { color: #9c3b26; }
	.n { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.d { color: var(--dim); }
	.bar { overflow: hidden; height: 5px; border-radius: 3px; background: var(--edge); }
	.bar i { display: block; height: 100%; background: #d9a441; transition: width 0.8s linear; }
	.p { font-variant-numeric: tabular-nums; color: var(--dim); }
</style>
