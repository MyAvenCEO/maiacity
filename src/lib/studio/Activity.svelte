<!--
	Activity — every file on its way right now, live from iroh: to this Mac's avenSSD, to the server's Object Storage
	(hetzner), or to another device — how far, how fast — and what arrived in the last minute. Nothing here is decided;
	it only shows the syncing the stories' rules set in motion.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { listMedia } from '$lib/auth/client';
	import { command } from '$lib/native';
	import { gb, type Moving } from './vault';

	let moving = $state<Moving[]>([]);
	let names = $state<Record<string, string>>({});

	const going = $derived(moving.filter((t) => !t.done && !t.aborted));
	const ended = $derived(moving.filter((t) => t.done || t.aborted));
	const rate = $derived(going.reduce((a, t) => a + t.rate, 0));
	const label = (h: string) => names[h] ?? `${h.slice(0, 12)}…`;

	onMount(() => {
		void listMedia().then((all) => (names = Object.fromEntries(all.map((m) => [m.hash, m.original_name || m.title || `${m.hash.slice(0, 12)}…`]))));
		const tick = async () => (moving = await command<Moving[]>('vault_transfers').catch(() => []));
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

<style>
	.sum { margin: 0 0 0.8rem; font-size: 0.84rem; color: var(--dim); }
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
