<!--
	A card's schedule as the week it goes out in: seven days side by side, and in each, one small summary per post at
	its time — where it goes, its title (or first line) and two lines of its text. No previews here: those are the
	Derivatives step's. The launch minute (several platforms at once) is marked.
-->
<script lang="ts">
	import type { Post } from '$lib/auth/client';
	import ChannelGlyph from './ChannelGlyph.svelte';
	import { FORMAT_LABEL, PLATFORMS, formatOf, placeLabel } from './board';

	let { posts, when = null }: { posts: Post[]; /** for a post without its own time */ when?: string | null } = $props();

	const at = (p: Post) => p.scheduled_at ?? when ?? null;
	const timed = $derived(
		posts
			.filter((p) => at(p))
			.sort((a, b) => at(a)!.localeCompare(at(b)!) || PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform))
	);
	const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	// the weeks the posts fall in, Monday to Sunday
	const days = $derived.by(() => {
		if (!timed.length) return [] as Date[];
		const first = new Date(at(timed[0]!)!), last = new Date(at(timed.at(-1)!)!);
		const monday = new Date(first.getFullYear(), first.getMonth(), first.getDate() - ((first.getDay() + 6) % 7));
		const out: Date[] = [];
		for (let d = monday; d <= last || out.length % 7; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(d);
		return out;
	});
	const onDay = (d: Date) => timed.filter((p) => key(new Date(at(p)!)) === key(d));
	const count = $derived(timed.reduce((m, p) => m.set(at(p)!, (m.get(at(p)!) ?? 0) + 1), new Map<string, number>()));
	const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
	const title = (p: Post) => (p.title || p.thread?.[0] || p.text || '').split('\n').find((l) => l.trim())?.trim() ?? '';
	// the two lines under the title: the text, without the line the title already took
	const rest = (p: Post) => {
		const t = p.thread?.[0] ?? p.text ?? '';
		return (p.title ? t : t.split('\n').slice(1).join(' ')).replace(/\s+/g, ' ').trim();
	};
</script>

{#if days.length}
	<div class="week">
		{#each days as d (key(d))}
			{@const list = onDay(d)}
			<section class="day" class:empty={!list.length}>
				<h4>{d.toLocaleDateString('en-GB', { weekday: 'short' })} <span>{d.getDate()}.{d.getMonth() + 1}.</span></h4>
				{#each list as p, i (i)}
					<article class="mini" class:launch={(count.get(at(p)!) ?? 0) > 1}>
						<p class="head"><b>{clock(at(p)!)}</b><ChannelGlyph platform={p.platform} /><span>{placeLabel(p)}</span></p>
						<p class="title">{title(p)}</p>
						{#if rest(p)}<p class="desc">{rest(p)}</p>{/if}
						<p class="kind">{FORMAT_LABEL[formatOf(p)]}{#if (count.get(at(p)!) ?? 0) > 1} · launch{/if}</p>
					</article>
				{/each}
			</section>
		{/each}
	</div>
{:else}
	<p class="none">Nothing has a time yet.</p>
{/if}

<style>
	/* the week, one column a day; on a narrow screen the days stack */
	.week {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.day {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
		min-height: 8rem;
		padding: 0.5rem;
		border-radius: 10px;
		background: #f3efe6;
	}

	.day.empty {
		opacity: 0.55;
	}

	h4 {
		margin: 0 0 0.2rem;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	h4 span {
		font-weight: 400;
	}

	.mini {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.5rem 0.55rem;
		border: 1px solid var(--line, #e3ddd0);
		border-radius: 8px;
		background: #fff;
	}

	.mini.launch {
		border-left: 3px solid #e3b35c;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin: 0;
		font-size: 0.74rem;
		color: var(--ink-soft);
	}

	.head b {
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.head span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title {
		margin: 0;
		overflow: hidden;
		font-size: 0.8rem;
		font-weight: 600;
		line-height: 1.3;
		color: var(--ink);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.desc {
		margin: 0;
		overflow: hidden;
		font-size: 0.74rem;
		line-height: 1.35;
		color: var(--ink-soft);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.kind {
		margin: 0;
		font-size: 0.68rem;
		color: var(--muted, #9a978d);
	}

	.none {
		color: var(--ink-soft);
	}

	@media (max-width: 900px) {
		.week {
			grid-template-columns: minmax(0, 1fr);
		}
		.day {
			min-height: 0;
		}
		.day.empty {
			display: none;
		}
	}
</style>
