<!--
	Hero frames (Grade tab): one frame of the cut, at the playhead, in the shape being checked — rendered by the worker
	at that delivery's full resolution and precision (16-bit, the conformed original or the world's plate, through the
	whole chain: input transform, clip grade, film look, output transform; no graphics). The viewer shows a proxy-level
	preview; this is the frame to judge a grade against. The edit is saved first, so the frame is of what is on screen.
-->
<script>
	import { onDestroy } from 'svelte';
	import { listJobs, queueFrame } from '$lib/auth/client';
	import { clockText, raw, running } from './studio.svelte.js';

	/** @typedef {import('$lib/auth/client').RenderJob} RenderJob */
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	/** @type {RenderJob[]} */
	let frames = $state([]);
	let asking = $state(false);
	let error = $state('');
	/** @type {ReturnType<typeof setInterval> | null} */
	let poll = null;

	const id = $derived(s.current?.id ?? null);
	const newest = $derived(frames[0] ?? null);
	const busy = $derived(asking || (!!newest && running(newest)));

	async function refresh() {
		if (!id) return;
		const here = id;
		const list = await listJobs({ kind: 'frame', timeline: here, limit: 8 }).catch(() => null);
		if (!list || s.current?.id !== here) return;
		frames = list;
		watch(list.some(running));
	}
	/** @param {boolean} on */
	function watch(on) {
		if (on && !poll) poll = setInterval(refresh, 2000);
		else if (!on && poll) clearInterval(poll), (poll = null);
	}
	$effect(() => {
		void id;
		frames = [];
		void refresh();
	});
	onDestroy(() => watch(false));

	async function ask() {
		if (!id || busy) return;
		asking = true;
		error = '';
		try {
			await s.flush(); // the frame is of what is on screen, saved
			const job = await queueFrame(id, { t: Math.round(s.time * 1000) / 1000, shape: s.shape });
			frames = [job, ...frames];
			watch(true);
		} catch (e) {
			error = /** @type {Error} */ (e).message;
		} finally {
			asking = false;
		}
	}
</script>

<section class="hero">
	<h3>Hero frame</h3>
	<button class="ghost" onclick={ask} disabled={!id || busy} title="The worker renders this frame at full resolution and precision, through the whole chain">
		{busy ? 'Rendering the frame…' : `Render ${clockText(s.time)} · ${s.shape}`}
	</button>
	{#if error}<p class="bad">{error}</p>{/if}
	{#if newest}
		{#if newest.status === 'done' && newest.output_hash}
			<a class="shot" href={raw(newest.output_hash)} target="_blank" rel="noopener" title="Full size, 16-bit">
				<img src={raw(newest.output_hash)} alt="Hero frame at {clockText(newest.params?.t ?? 0)}" />
			</a>
			<p class="note">{clockText(newest.params?.t ?? 0)} · {newest.params?.shape} · {newest.note ?? ''}</p>
		{:else if newest.status === 'failed'}
			<p class="bad">{newest.note || 'The frame could not be rendered.'}</p>
		{:else}
			<p class="note">{newest.status === 'queued' ? 'Waiting for the render worker…' : `${newest.note ?? 'rendering'} · ${Math.round(newest.progress * 100)}%`}</p>
		{/if}
	{:else}
		<p class="note">The viewer is a proxy-level preview. A hero frame is the real thing: the original (or the world at full size), graded, at the delivery's resolution.</p>
	{/if}
	{#if frames.length > 1}
		<ul>
			{#each frames.slice(1) as f (f.id)}
				<li>
					{#if f.status === 'done' && f.output_hash}
						<a href={raw(f.output_hash)} target="_blank" rel="noopener">{clockText(f.params?.t ?? 0)} · {f.params?.shape}</a>
					{:else}
						<span>{clockText(f.params?.t ?? 0)} · {f.params?.shape} · {f.status}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.hero {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}

	h3 {
		margin: 0.3rem 0 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.note,
	.bad {
		margin: 0;
		font-size: 0.72rem;
		color: var(--dim);
	}

	.bad {
		color: #a4462c;
	}

	.shot {
		display: block;
		border: 1px solid var(--edge);
		border-radius: 6px;
		overflow: hidden;
		background: #111;
	}

	.shot img {
		display: block;
		width: 100%;
		max-height: 12rem;
		object-fit: contain;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.72rem;
	}

	li a {
		color: var(--ink);
	}

	li span {
		color: var(--dim);
	}
</style>
