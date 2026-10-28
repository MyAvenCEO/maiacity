<!--
	A story's Writing tab (./Story.svelte): its full written text (`text`, Markdown), the story's own, the base every post
	of it is drawn from (Samuel 2026-10-17: there are only stories and their posts). It reads as the journal lays it out
	and is edited where it stands (./ArticleView.svelte), saved on the story's main line. Proposals, an agent's above
	all, and the history of every edit are the note editor's (Note), a click away, whose back arrow comes back here. A
	story with no text yet starts it from its journey: the question it holds open as the subtitle, a heading for each
	beat with the beat's lines under it.
-->
<script>
	import ArticleView from './ArticleView.svelte';
	import { allowed, may, windowRead } from './ops.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean,
	 *   item: import('./vaults.js').EntryView, writes: boolean }}
	 */
	let { world, actor, api, busy, item } = $props();

	let noteWindow = $state.raw(/** @type {any} */ (null));
	$effect(() => {
		const window = api.window?.();
		noteWindow = window;
		return () => window?.close();
	});

	const story = $derived(/** @type {any} */ (item.record) ?? {});
	const text = $derived(item.text ?? story.text ?? '');

	/** whether it may change the story, as the device answers a dry run */
	let can = $state(false);
	$effect(() => {
		void world;
		let gone = false;
		may(api, actor, [{ op: 'set', entry: item.entry, path: ['title'], value: item.title ?? '' }]).then(([w]) => {
			if (!gone) can = allowed(w);
		});
		return () => {
			gone = true;
		};
	});
	const edits = $derived((item.writers ?? []).includes(actor) && can && !busy);

	/** the story's proposals, as its note's lines name them */
	let proposals = $state(/** @type {{ line: string, name: string | null }[]} */ ([]));
	$effect(() => {
		void world;
		if (api.window && !noteWindow) return;
		let gone = false;
		const request = windowRead(api, { op: 'note', entry: item.entry }, null, noteWindow);
		request.result.then((/** @type {any} */ n) => { if (!gone) proposals = (n?.lines ?? []).slice(1); });
		return () => { gone = true; request.close(); };
	});

	/** what the person has written and not saved yet */
	let draft = $state(/** @type {string | undefined} */ (undefined));
	let title = $state(/** @type {string | undefined} */ (undefined));
	const unsaved = $derived(draft !== undefined && draft !== text);

	/** Runs change `op` on the story, on its main line, as `what`. @param {string} what @param {object} op */
	const change = (what, op) => api.run(what, { ...op, entry: item.entry, as: actor });

	async function save() {
		if (!unsaved) return;
		await change('Saving its text', { op: 'set', path: ['text'], value: draft });
	}

	async function retitle() {
		const t = (title ?? '').trim();
		if (!t || t === (item.title ?? '')) return;
		await change('Renaming the story', { op: 'set', path: ['title'], value: t });
	}

	/** The text a story starts with: the question it holds open as the subtitle, a heading per beat. */
	function starter() {
		const beats = /** @type {any[]} */ (story.beats ?? []);
		const lines = [];
		if (story.question?.trim()) lines.push(`*${story.question.trim()}*`);
		for (const b of beats) {
			if (b.title?.trim()) lines.push(`## ${b.title.trim()}`);
			if (b.text?.trim()) lines.push(b.text.trim());
		}
		return lines.join('\n\n');
	}

	const start = () => change('Starting its text', { op: 'set', path: ['text'], value: starter() });
</script>

{#if !text.trim() && draft === undefined}
	<div class="blank">
		<p>
			No text yet. The text is the story written out in full: the base every post of it is drawn from, the journal’s
			day, the inspire-me report, the voice-over of its film.
		</p>
		{#if edits}
			<button class="btn primary" onclick={start}>Start its text from the journey</button>
			<button class="btn quiet" onclick={() => (draft = '')}>Start blank</button>
			<p class="soft">
				{(story.beats ?? []).length
					? `Its question as the subtitle and a heading for each of its ${(story.beats ?? []).length} beats.`
					: 'Its journey has no beats yet: it starts blank.'}
			</p>
		{:else}
			<p class="soft">The acting vault may not change this story.</p>
		{/if}
	</div>
{:else}
	<div class="writing">
		<div class="bar">
			<span class="grow"></span>
			<a class="btn" href="#stories/{item.entry}/edit">Proposals and history</a>
		</div>

		{#if proposals.length}
			<p class="proposed">
				{#each proposals as p, i (p.line)}{#if i}, {/if}<b>“{p.name ?? 'A proposal'}”</b>{/each}
				{proposals.length === 1 ? 'proposes changes' : 'propose changes'} to it:
				<a href="#stories/{item.entry}/edit">read and merge {proposals.length === 1 ? 'it' : 'them'}</a>.
			</p>
		{/if}

		{#if unsaved}
			<div class="save">
				<b>Unsaved changes</b>
				<button class="btn primary" disabled={busy} onclick={save}>Save</button>
				<button class="btn quiet" onclick={() => (draft = undefined)}>Discard</button>
			</div>
		{/if}

		<div class="page">
			<ArticleView
				{world}
				{api}
				{item}
				bind:title={() => title ?? item.title ?? '', (v) => (title = v)}
				bind:text={() => draft ?? text, (v) => (draft = v)}
				editable={edits}
				renames={edits}
				eyebrow="Its text"
				onretitle={retitle}
				onsave={save}
			/>
		</div>
	</div>
{/if}

<style>
	.blank {
		padding: 2rem 1.5rem;
		border: 1px dashed var(--edge);
		border-radius: 14px;
		text-align: center;
	}

	.blank p {
		max-width: 34rem;
		margin: 0 auto 1rem;
	}

	.writing {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.grow {
		flex: 1;
	}

	.proposed {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border: 1px dashed var(--edge);
		border-radius: 10px;
		background: #fbfaf6;
		font-size: 0.86rem;
	}

	.save {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.8rem;
		border-radius: 10px;
		background: #fff6e0;
		font-size: 0.86rem;
	}

	.page {
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
		overflow: hidden;
	}
</style>
