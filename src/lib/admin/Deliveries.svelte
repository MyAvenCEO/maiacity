<!-- Every file a film is delivered as, cut by cut: what it is, how big, and which channels it goes to. -->
<script lang="ts">
	import { API, mediaUrl, type Delivery, type Platform } from '$lib/auth/client';
	import { PLATFORM_LABEL } from './board';

	let { deliveries }: { deliveries: Delivery[] } = $props();

	const raw = (cid: string) => mediaUrl(cid);
	const mmss = (s: number) => {
		const t = Math.round(s);
		return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
	};
	const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
	const channelsOf = (d: Delivery) => d.channels.map((c) => PLATFORM_LABEL[c as Platform] ?? c);
	// cut by cut; within a cut the videos first, the biggest first, then the thumbnails
	const sorted = $derived(
		[...deliveries].sort(
			(a, b) =>
				(a.cut ?? '').localeCompare(b.cut ?? '') || Number(a.kind === 'thumbnail') - Number(b.kind === 'thumbnail') || b.bytes - a.bytes
		)
	);
</script>

<ul>
	{#each sorted as d, i (`${d.cid}-${i}`)}
		<li>
			<a href={raw(d.cid)} target="_blank" rel="noopener">
				<i>{d.kind === 'thumbnail' ? '▣' : '▶'}</i>
				{#if d.cut}<span class="cut">{d.cut}</span>{/if}
				<b>{d.aspect}</b>
				{d.width}×{d.height} · {d.codec} · {d.format} · {size(d.bytes)}{d.kind === 'thumbnail' ? '' : ` · ${mmss(d.seconds)}`}
			</a>
			<span class="chans">{#each channelsOf(d) as c (c)}<em>{c}</em>{/each}</span>
			{#if d.note}<small>{d.note}</small>{/if}
		</li>
	{/each}
</ul>

<style>
	ul {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.2rem 0.6rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		font-size: 0.76rem;
	}

	a {
		color: var(--ink);
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}

	i {
		font-style: normal;
		color: var(--muted);
	}

	.cut {
		margin-right: 0.2rem;
		color: var(--terracotta);
	}

	.chans {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
		margin-left: auto;
	}

	.chans em {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--cream);
		font-size: 0.68rem;
		font-style: normal;
		color: var(--ink-soft);
	}

	small {
		flex-basis: 100%;
		color: var(--muted);
	}
</style>
