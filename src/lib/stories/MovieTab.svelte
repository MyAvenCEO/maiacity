<!--
	A story's film: its cuts in the studio (the timelines filed under it), where each stands — cut, locked, graded,
	rendered — and the files its renders delivered. The film is made in the studio, from the script to the render; this
	tab opens it there, or starts it.
-->
<script>
	import { base } from '$app/paths';
	import { createTimeline, listTimelines } from '$lib/auth/client';
	import Deliveries from '$lib/admin/Deliveries.svelte';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */
	/** @typedef {import('$lib/auth/client').Timeline} Timeline */

	/** @type {{ item: ContentItem, onchange: (patch: Partial<ContentItem>) => void }} */
	let { item, onchange } = $props();

	let timelines = $state(/** @type {Timeline[] | null} */ (null));
	let error = $state('');
	let busy = $state(false);

	const STAGE = { edit: 'Cutting', locked: 'Locked', graded: 'Graded', rendered: 'Rendered' };

	// its cuts: the timelines filed under the story's project, and the one it was first made from
	const mine = $derived(
		(timelines ?? []).filter((t) => (item.project && t.project?.toLowerCase() === item.project.toLowerCase()) || t.id === item.timeline_id)
	);

	$effect(() => {
		listTimelines()
			.then((t) => (timelines = t))
			.catch((e) => ((error = e.message), (timelines = [])));
	});

	/** @param {Timeline} t */
	const length = (t) => {
		const end = Math.max(0, ...t.clips.filter((c) => c.track === 'V1').map((c) => c.start + c.dur));
		const s = Math.round(end);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};
	/** @param {Timeline} t */
	const studio = (t) => `${base}/app/studio/?timeline=${encodeURIComponent(t.id)}&tab=script`;

	/** A first cut, filed under the story (its title is its project, until it has one). */
	async function start() {
		busy = true;
		error = '';
		try {
			const project = item.project || item.title.slice(0, 40);
			if (!item.project) onchange({ project });
			const t = await createTimeline({ name: 'Master', project, aspect: '16:9', clips: [] });
			location.href = studio(t);
		} catch (e) {
			error = /** @type {Error} */ (e).message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="movie">
	{#if timelines === null}
		<p class="empty">One moment…</p>
	{:else if mine.length}
		<ul class="cuts">
			{#each mine as t (t.id)}
				<li>
					<div class="what">
						<b>{t.name}</b>{#if t.variant}<span class="variant">{t.variant}</span>{/if}
						<small>{t.aspect} · {length(t)} · {t.clips.length} clips · {STAGE[t.stage ?? 'edit']}</small>
					</div>
					<a class="open" href={studio(t)}>Open in the studio →</a>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="blank">
			<p>No film yet. It is made in the studio — the script first (from the journey and the article), then the shots, the sound, the grade and the render.</p>
			<button onclick={start} disabled={busy}>{busy ? 'Starting…' : 'Start its film in the studio'}</button>
		</div>
	{/if}
	{#if error}<p class="bad">{error}</p>{/if}
	<p class="hint">The studio runs in maiaCITY Studio, the Mac app.</p>

	{#if item.deliveries?.length}
		<section class="files">
			<h3>Delivered</h3>
			<Deliveries deliveries={item.deliveries} />
		</section>
	{/if}
</div>

<style>
	.movie {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		max-width: 52rem;
	}

	.cuts {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.cuts li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
	}

	.what {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.2rem 0.6rem;
		min-width: 0;
	}

	.variant {
		padding: 0 0.4rem;
		border-radius: 6px;
		background: var(--cream);
		font-size: 0.75rem;
	}

	small {
		flex-basis: 100%;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.open {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--terracotta);
	}

	.blank {
		padding: 1.6rem 1.4rem;
		border: 1px dashed var(--line);
		border-radius: 14px;
		color: var(--ink-soft);
	}

	.blank p {
		margin: 0 0 1rem;
	}

	.blank button {
		padding: 0.45rem 1rem;
		border: 0;
		border-radius: 999px;
		background: var(--ink);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--paper);
		cursor: pointer;
	}

	.empty,
	.hint {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.bad {
		margin: 0;
		color: #9c3b26;
	}

	h3 {
		margin: 0 0 0.6rem;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}
</style>
