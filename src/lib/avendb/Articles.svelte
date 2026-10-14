<!--
	A vault's articles, as a magazine lists its stories: a blank article to start, or one made of a post of the site's
	blog, its pictures brought into the vault's Library first, each named by its content hash, and the article made
	public with them; then every article of the vault the acting vault reads, each with its cover, its title, its
	opening words, the vault that wrote it and when, read from its first signed edit (./article.js). A click opens it
	to read (Article); it is edited, proposed to and merged as a note is. A vault other than this one adds an article
	only through a cap that lets it, as the device says (`creatable`, `may`). Each goes through the content flow
	(./flows.js): a blank one starts as an idea, one made of a blog post as a draft, its pictures public already, and
	it is published, made public and put on the Maia Universe stream, from its page.
-->
<script>
	import { asset } from '$lib/media/url';
	import { ARTICLE, blogPosts, EXAMPLE, fileNamed, fromBlog, opening, pictures } from './article.js';
	import { mediaOf, whole } from './files.js';
	import { CONTENT, flowsFor, stageOf, stageTag } from './flows.js';
	import Icon from './Icon.svelte';
	import { allowed, articleRecord, creatable, may } from './ops.js';
	import { count, EVERYONE, nameOf, reads, why } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void, onopen: (entry: string) => void }}
	 */
	let { world, vault, actor, api, busy, onaccess, onopen } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const entries = $derived(world.entries.filter((e) => e.vault === vault));
	const seen = $derived(entries.filter((e) => reads(e, actor)));
	const articles = $derived(
		seen.filter((e) => e.type === ARTICLE && !e.deleted).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
	);
	const hidden = $derived(entries.length - seen.length);

	/** the tags the acting vault's caps ask a new article and a new file to carry: `null` where nothing lets it add one */
	let asked = $state(/** @type {string[] | null} */ (null));
	let askedFile = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		let gone = false;
		creatable(api, actor, vault, ARTICLE).then((t) => !gone && (asked = t));
		creatable(api, actor, vault, 'file').then((t) => !gone && (askedFile = t));
		return () => {
			gone = true;
		};
	});

	/** the flow its articles go through, and the stage of it each is in */
	const flow = $derived(flowsFor(world, vault, ARTICLE)[0] ?? CONTENT);
	/** @param {import('./vaults.js').EntryView} a */
	const stage = (a) => stageOf(a, flow);

	/**
	 * The op that adds article `title` reading `text`, in stage `at` of its flow.
	 * @param {string} title @param {string} text @param {string} [at]
	 */
	const adding = (title, text, at = 'idea') => ({
		op: 'create',
		vault,
		type: ARTICLE,
		tags: [...(asked ?? []), stageTag(flow.key, at)],
		value: articleRecord(title, text)
	});

	/** why the device won't add an article for the acting vault, as it answers a dry run: '' where it would */
	let unadded = $state('');
	$effect(() => {
		if (!asked) return;
		const op = adding('Untitled article', '');
		let gone = false;
		may(api, actor, [op]).then(([a]) => {
			if (!gone) unadded = allowed(a) ? '' : why(/** @type {any} */ (a));
		});
		return () => {
			gone = true;
		};
	});

	async function blank() {
		const made = await api.run('Writing the article', { ...adding('Untitled article', ''), as: actor });
		if (made) onopen(made.entry);
	}

	const posts = blogPosts();
	let slug = $state(posts.some((p) => p.slug === EXAMPLE) ? EXAMPLE : (posts[0]?.slug ?? ''));
	/** what the import is doing, and why it stopped */
	let importing = $state('');
	let failed = $state('');

	/**
	 * Makes an article of blog post `slug`: each picture it names brought into the vault's Library first, unless a file
	 * of that name is there, and shared with everyone, then the article, a draft of the content flow, published from
	 * its page.
	 */
	async function fromPost() {
		failed = '';
		try {
			const post = await fromBlog(slug);
			/** @type {string[]} */
			const files = [];
			for (const [i, name] of post.pictures.entries()) {
				const there = fileNamed(world, vault, name);
				if (there) {
					files.push(there.entry);
					continue;
				}
				importing = `Fetching picture ${i + 1} of ${post.pictures.length}`;
				const got = await fetch(asset(name));
				if (!got.ok) throw new Error(`the site has no picture ${name} (${got.status})`);
				const blob = await got.blob();
				const file = new File([blob], name, { type: blob.type || mediaOf({ name, type: '' }) });
				importing = `Bringing picture ${i + 1} of ${post.pictures.length} into the Library`;
				const made = await api.putFile(actor, vault, file, mediaOf(file), askedFile ?? []);
				if (!made) throw new Error(`${name} didn't go into the Library`);
				files.push(made.entry);
			}
			if (files.length) {
				importing = 'Making its pictures public';
				const share = { op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { entry: files } };
				await api.run('Making its pictures public', { ...share, as: actor });
			}
			importing = 'Writing the article';
			const write = { ...adding(post.title, post.text, 'draft'), as: actor };
			const made = await api.run(`Writing “${post.title}”`, write);
			if (!made) throw new Error('the article wasn’t written');
			onopen(made.entry);
		} catch (e) {
			failed = /** @type {Error} */ (e).message;
		} finally {
			importing = '';
		}
	}

	/** Bytes `from` to `to` of a file, as the device reads them. @type {import('./files.js').Read} */
	const read = (root, size, from, to) => api.readFile(root, size, from, to);

	/** each article's cover, its first picture, as a blob URL, by its name, once read */
	let covers = $state(/** @type {Record<string, string>} */ ({}));
	const reading = new Set();
	$effect(() => {
		for (const a of articles) {
			const name = pictures(a.text ?? '')[0];
			const file = name && !reading.has(name) ? fileNamed(world, vault, name)?.files?.[0] : undefined;
			if (!name || !file || file.len === null) continue;
			reading.add(name);
			whole(read, file, mediaOf({ name, type: '' }))
				.then((blob) => (covers = { ...covers, [name]: URL.createObjectURL(blob) }))
				.catch(() => reading.delete(name));
		}
	});
	$effect(() => () => Object.values(covers).forEach((u) => URL.revokeObjectURL(u)));

	/** When an article was written, in words. @param {number | null} at */
	const when = (at) =>
		at ? new Date(at * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
</script>

{#if asked}
	<section class="start" aria-label="Start a new article">
		<button class="blank" disabled={busy || !!unadded} onclick={blank}>
			<span class="sheet"><Icon name="plus" size={34} /></span>
			<span class="label">Blank article</span>
		</button>
		<div class="say">
			{#if unadded}
				<p class="soft">{nameOf(as)} can’t add an article here: {unadded}.</p>
			{:else}
				<p class="soft">
					A new article in {nameOf(here)}, written by <b>{nameOf(as)}</b>, starts as an idea: its author and when it
					was written come from its first signed edit, and it is private until it is published. Or make a draft of a
					post of our blog, its pictures brought into the Library by their content hashes and made public:
				</p>
				<div class="row">
					<select class="field" bind:value={slug} aria-label="The blog post to make an article of">
						{#each posts as p (p.slug)}<option value={p.slug}>{p.name}</option>{/each}
					</select>
					<button class="btn primary" disabled={busy || !!importing || !slug || askedFile === null} onclick={fromPost}>
						Make it an article
					</button>
				</div>
				{#if importing}<p class="soft">{importing}…</p>{/if}
				{#if failed}<p class="bad">It stopped: {failed}.</p>{/if}
			{/if}
		</div>
	</section>
{/if}

{#if !seen.length && vault !== actor}
	<div class="empty">
		<p>
			{nameOf(as)} can't see {hidden ? `the ${count(hidden, 'entry', 'entries')}` : 'anything'} in {nameOf(here)}: none
			of it is shared with {nameOf(as)}. A vault that owns it can share its articles with {nameOf(as)} in
			<button class="link" onclick={onaccess}>Sharing</button>.
		</p>
	</div>
{:else if articles.length}
	<div class="stories">
		{#each articles as a (a.entry)}
			{@const cover = covers[pictures(a.text ?? '')[0] ?? '']}
			<a class="story" href="#articles/{a.entry}" aria-label={a.title}>
				<span class="cover" aria-hidden="true">
					{#if cover}<img src={cover} alt="" />{:else}<Icon name="article" size={34} />{/if}
				</span>
				<span class="info">
					<b>{a.title}</b>
					<span class="lead">{opening(a.text ?? '', 160)}</span>
					<small class="soft">
						By {nameOf(byId.get(a.by))}{a.created ? `, ${when(a.created)}` : ''}{a.proposals
							? ` · ${count(a.proposals, 'proposal')}`
							: ''}
					</small>
					<span class="chips">
						{#if stage(a)}<span class="chip" class:accent={stage(a)?.public}>{stage(a)?.name}</span>{/if}
						{#if a.public}<span class="chip">Public</span>{/if}
					</span>
				</span>
			</a>
		{/each}
	</div>
{:else}
	<p class="soft">No article here{asked ? ' yet: start one above.' : '.'}</p>
{/if}

{#if hidden > 0 && seen.length}
	<p class="soft">{count(hidden, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
{/if}

<style>
	.start {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.4rem;
		margin: 0 0 1.8rem;
		padding: 1rem 1.2rem;
		border-radius: 14px;
		background: #e9e4d9;
	}

	.start p {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.blank {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.blank .sheet {
		display: grid;
		place-items: center;
		width: 6.6rem;
		height: 8.4rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 6px;
		background: #fff;
		color: var(--accent);
		transition: border-color 0.15s ease;
	}

	.blank:hover:not(:disabled) .sheet {
		border-color: var(--accent);
	}

	.blank:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.blank .label {
		font-size: 0.84rem;
		font-weight: 600;
	}

	.say {
		display: flex;
		flex: 1 1 18rem;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.55rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		width: 100%;
	}

	.row .field {
		flex: 1 1 14rem;
		min-width: 0;
	}

	.bad {
		color: #9a3324;
	}

	/* the articles as a magazine's stories: a cover over the title and the opening words */
	.stories {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
		gap: 1.1rem;
	}

	.story {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
		color: inherit;
		text-decoration: none;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.story:hover,
	.story:focus-visible {
		border-color: var(--accent);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.08);
	}

	.cover {
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: #f1efe9;
		color: var(--soft);
	}

	.cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.info {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
		padding: 0.75rem 0.9rem 0.85rem;
		min-width: 0;
	}

	.info > b {
		font-size: 0.98rem;
		line-height: 1.35;
	}

	.lead {
		font-size: 0.82rem;
		line-height: 1.5;
		color: #4a4a44;
	}

	.info small {
		font-size: 0.74rem;
	}

	.info .chip {
		font-size: 0.66rem;
	}

	.chips {
		display: flex;
		gap: 0.3rem;
	}

	.empty p {
		margin: 0;
		line-height: 1.5;
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
