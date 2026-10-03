<!--
	When a story goes out: its date (each post may keep its own time), the launch (the first minute several platforms
	go out together), the week it goes out in, and the files. The calendar of every story is the Stories page's.
-->
<script>
	import { base } from '$app/paths';
	import ChannelGlyph from '$lib/admin/ChannelGlyph.svelte';
	import Deliveries from '$lib/admin/Deliveries.svelte';
	import ScheduleWeek from '$lib/admin/ScheduleWeek.svelte';
	import { dateLabel, entriesOf, launchOf, placeLabel } from '$lib/admin/board';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */

	/** @type {{ item: ContentItem, onchange: (patch: Partial<ContentItem>) => void }} */
	let { item, onchange } = $props();

	const launch = $derived(launchOf(entriesOf(item)));
	const posts = $derived(item.posts ?? []);

	/** "2026-10-04T09:00" in local time, for the input */
	const local = (/** @type {string | null} */ iso) => {
		if (!iso) return '';
		const d = new Date(iso);
		const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
	};
</script>

<div class="sched">
	<label class="when">
		<span>Goes out</span>
		<input
			type="datetime-local"
			value={local(item.scheduled_at)}
			onchange={(e) => onchange({ scheduled_at: e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : null })}
		/>
		<a href="{base}/app/stories/?view=calendar">See every story in the calendar →</a>
	</label>

	{#if launch}
		<p class="launch">
			{item.status === 'published' ? 'Went out' : 'Launch'} <b>{dateLabel(launch.when)}</b> on
			{#each launch.entries as e, i (e.index)}{#if i}{i === launch.entries.length - 1 ? ' and ' : ', '}{/if}<span class="lp"
					>{#if e.post}<ChannelGlyph platform={e.post.platform} /> {placeLabel(e.post)}{/if}</span
				>{/each}
		</p>
	{/if}

	{#if posts.length}
		<ScheduleWeek {posts} when={item.scheduled_at} />
	{:else}
		<p class="empty">No posts to schedule yet: they are derived first (the Derivatives step).</p>
	{/if}

	{#if item.deliveries?.length}
		<details class="fold">
			<summary>Files <small>{item.deliveries.length}</small></summary>
			<Deliveries deliveries={item.deliveries} />
		</details>
	{/if}
</div>

<style>
	.sched {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
	}

	.when {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
	}

	.when span {
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.when input {
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
		font: inherit;
		font-size: 0.9rem;
		color: var(--ink);
	}

	.when a {
		font-size: 0.82rem;
		color: var(--terracotta);
	}

	.launch {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.7;
		color: var(--ink-soft);
	}

	.launch b,
	.lp {
		font-weight: 600;
		color: var(--ink);
	}

	.lp {
		white-space: nowrap;
	}

	.empty {
		margin: 0;
		font-size: 0.9rem;
		color: var(--muted);
	}

	.fold {
		padding: 0.8rem 1rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
	}

	.fold summary {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.fold summary small {
		margin-left: 0.5rem;
		font-weight: 400;
		color: var(--muted);
	}

	.fold[open] summary {
		margin-bottom: 1rem;
	}
</style>
