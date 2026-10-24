<!--
	A story's Derivatives tab (./Story.svelte): its posts, each one way it goes out, of a post type of its vault
	(./posttypes.js): a schema of the vault's own, `post:<type>`, which holds the type's template. By type, the posts
	drawn from this story, each read and edited where it stands (./ArticleView.svelte), and published on the Maia
	Universe stream or taken off it (the content flow's published stage, which everyone reads); and for each type, a new
	post started from the story's text, its template beside it to fill in.
-->
<script>
	import ArticleView from './ArticleView.svelte';
	import { entryOf } from './artifacts.js';
	import { CONTENT, flowsFor, moving, stageOf, stageTag } from './flows.js';
	import { postTag } from './posttypes.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean,
	 *   item: import('./vaults.js').EntryView, writes: boolean }}
	 */
	let { world, actor, api, busy, item } = $props();

	/** the flow its posts go through, the vault's own or the app's content flow */
	const flow = $derived(flowsFor(world, item.vault, 'post')[0] ?? CONTENT);
	const story = $derived(/** @type {any} */ (item.record) ?? {});

	/** the vault's post types: the newest schema of each `post:` kind, with its channel and its template */
	let types = $state(/** @type {{ type: string, kind: string, channel: string, template: string }[]} */ ([]));
	$effect(() => {
		void world;
		let gone = false;
		api.ask({ op: 'schemas', vault: item.vault }).then((/** @type {any} */ out) => {
			const lane = out?.ok;
			if (gone || !lane) return;
			const newest = (lane.schemas ?? []).filter(
				(/** @type {any} */ s) => s.kind?.startsWith('post:') && !(lane.lenses ?? []).some((/** @type {any} */ l) => l.from === s.id)
			);
			types = newest.map((/** @type {any} */ s) => {
				let json = /** @type {any} */ ({});
				try {
					json = JSON.parse(s.json);
				} catch {
					json = {};
				}
				const type = s.kind.slice('post:'.length);
				return { type, kind: s.kind, channel: json.properties?.channel?.default || type, template: json['x-template'] ?? '' };
			});
		});
		return () => {
			gone = true;
		};
	});

	/** the posts drawn from this story, the oldest first */
	const posts = $derived(
		world.entries
			.filter((e) => e.type === 'post' && !e.deleted && entryOf(/** @type {any} */ (e.record)?.story) === item.entry)
			.sort((a, b) => (a.created ?? 0) - (b.created ?? 0))
	);
	/** post `p`'s type, by its record's kind @param {import('./vaults.js').EntryView} p */
	const typeOf = (p) => String(/** @type {any} */ (p.record)?.kind ?? '').replace(/^post:/, '');

	let open = $state('');
	const shown = $derived(posts.find((p) => p.entry === open));
	/** what the person has written of the post shown and not saved yet */
	let draft = $state(/** @type {string | undefined} */ (undefined));
	let title = $state(/** @type {string | undefined} */ (undefined));
	const edits = $derived(!!shown && (shown.writers ?? []).includes(actor) && !busy);

	/** Opens post `entry`, or closes it where it is open. @param {string} entry */
	function toggle(entry) {
		open = open === entry ? '' : entry;
		draft = title = undefined;
	}

	/** Starts a post of type `t` from the story: its title, and its text, to rewrite as the type's template says. */
	async function start(/** @type {(typeof types)[number]} */ t) {
		const value = {
			kind: t.kind,
			title: story.title || item.title || 'Untitled',
			text: item.text ?? story.text ?? '',
			story: { vault: item.vault, entry: item.entry },
			channel: t.channel,
			tags: []
		};
		const made = await api.run(`Starting its ${t.channel} post`, { op: 'create', vault: item.vault, type: 'post', tags: [postTag(t.type), stageTag(flow.key, 'draft')], value, as: actor });
		if (made?.entry) toggle(made.entry);
	}

	async function save() {
		if (!shown) return;
		if (draft !== undefined && draft !== (shown.text ?? '')) await api.run('Saving the post', { op: 'set', entry: shown.entry, path: ['text'], value: draft, as: actor });
		draft = undefined;
	}

	async function retitle() {
		const t = (title ?? '').trim();
		if (!shown || !t || t === (shown.title ?? '')) return;
		await api.run('Renaming the post', { op: 'set', entry: shown.entry, path: ['title'], value: t, as: actor });
	}

	let problem = $state('');
	/** Moves post `p` to its flow's published stage, on the Maia Universe stream, on today for its first time out, or
	 *  back to a draft, its flow's functions running as it goes. @param {import('./vaults.js').EntryView} p */
	async function publish(p) {
		const on = stageOf(p, flow)?.key === 'published';
		const { ops, errors } = await moving(world, actor, p, flow, on ? 'draft' : 'published');
		problem = errors.join(' · ');
		if (errors.length) return;
		await api.runAll(on ? 'Taking it off the stream' : 'Publishing it on the stream', ops);
	}
</script>

<div class="posts">
	<p class="soft">
		A post is one way this story goes out, of a post type: its channel on the Maia Universe stream, and the template
		it is written from. Each starts from the story’s text.
	</p>

	{#if problem}<p class="soft">{problem}</p>{/if}

	{#each types as t (t.kind)}
		{@const mine = posts.filter((p) => typeOf(p) === t.type)}
		<section class="type">
			<header>
				<h3>{t.channel} <small>{mine.length} {mine.length === 1 ? 'post' : 'posts'}</small></h3>
				<button class="btn" disabled={busy} onclick={() => start(t)}>New {t.channel} post</button>
			</header>
			{#if t.template}
				<details class="template">
					<summary>Its template</summary>
					<pre>{t.template}</pre>
				</details>
			{/if}
			{#each mine as p (p.entry)}
				{@const live = stageOf(p, flow)?.key === 'published'}
				<div class="post" class:live>
					<button class="open" onclick={() => toggle(p.entry)} aria-expanded={open === p.entry}>
						<b>{p.title || 'Untitled'}</b>
						<span class="soft">{live ? `On the stream${/** @type {any} */ (p.record)?.published ? ` since ${/** @type {any} */ (p.record).published}` : ''}` : 'Not published'}</span>
					</button>
					{#if (p.writers ?? []).includes(actor)}
						<button class="btn quiet" disabled={busy} onclick={() => publish(p)}>{live ? 'Take it off' : 'Publish'}</button>
					{/if}
				</div>
				{#if shown && shown.entry === p.entry}
					{#if draft !== undefined && draft !== (shown.text ?? '')}
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
							item={shown}
							bind:title={() => title ?? shown?.title ?? '', (v) => (title = v)}
							bind:text={() => draft ?? shown?.text ?? '', (v) => (draft = v)}
							editable={edits}
							renames={edits}
							eyebrow={t.channel}
							onretitle={retitle}
							onsave={save}
						/>
					</div>
				{/if}
			{/each}
		</section>
	{:else}
		<p class="soft">This vault has no post types yet.</p>
	{/each}
</div>

<style>
	.posts {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.posts > .soft {
		margin: 0;
	}

	.type {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
	}

	.type header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.type h3 {
		margin: 0;
		font-size: 1rem;
	}

	.type h3 small {
		font-weight: 400;
		opacity: 0.6;
	}

	.template pre {
		max-height: 18rem;
		overflow: auto;
		padding: 0.7rem;
		border-radius: 8px;
		background: #fbfaf6;
		font-size: 0.8rem;
		white-space: pre-wrap;
	}

	.post {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.6rem;
		border-radius: 10px;
		background: #fbfaf6;
	}

	.post.live {
		background: #eef7f0;
	}

	.open {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		min-width: 0;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.open b {
		overflow: hidden;
		max-width: 100%;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.save {
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
		overflow: hidden;
	}
</style>
