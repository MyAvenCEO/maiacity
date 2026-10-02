<!--
	Skills: the film crew's skills (src/lib/skills, read from .claude/skills when the site is built) as a wiki — the
	crew grouped as a film is made, each skill's SKILL.md and its sub-skills rendered to read, an outline of the page,
	links between the skills, and a search through all of them. An admin's. ?skill=<id>&file=<file> opens one page.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { marked } from 'marked';
	import { onMount, tick } from 'svelte';
	import { CREW, SKILLS, skillById, slug, type Doc, type Skill } from '$lib/skills';

	let skillId = $state<string | null>(null);
	let file = $state('SKILL.md');
	let query = $state('');
	let article = $state<HTMLElement>();

	const skill = $derived(skillId ? skillById(skillId) : undefined);
	const doc = $derived(skill?.docs.find((d) => d.file === file) ?? skill?.docs[0]);
	const totals = $derived({
		skills: SKILLS.length,
		subs: SKILLS.reduce((n, s) => n + s.docs.length - 1, 0),
		words: SKILLS.reduce((n, s) => n + s.docs.reduce((m, d) => m + d.words, 0), 0)
	});
	const GROUP_COLOUR: Record<string, string> = { Producer: '#b8893f', Story: '#c4622d', Picture: '#4f7a55', Post: '#5d73a6', Out: '#8d6a99' };

	const renderer = new marked.Renderer();
	renderer.heading = ({ tokens, depth, text }) => `<h${depth} id="${slug(text)}">${marked.Parser.parseInline(tokens)}</h${depth}>`;

	const link = (skill: string, file: string, inner: string) =>
		`<a class="wiki" data-skill="${skill}" data-file="${file}" href="?skill=${skill}${file === 'SKILL.md' ? '' : `&file=${file}`}">${inner}</a>`;
	/**
	 * a doc as HTML: a skill or a file named in `code` becomes a link to its page — a file of this skill, or of the
	 * skill named just before it ("`storyteller`, `retention.md`")
	 */
	function html(s: Skill, d: Doc): string {
		const raw = marked.parse(d.body.replace(/^# .+\n+/, ''), { gfm: true, renderer, async: false }) as string;
		let out = '', last = 0, named: { id: string; end: number } | null = null;
		for (const m of raw.matchAll(/<code>([a-z0-9-]+(?:\.md)?)<\/code>/g)) {
			const [whole, name] = m as unknown as [string, string];
			const at = m.index ?? 0;
			out += raw.slice(last, at);
			last = at + whole.length;
			const other = named && at - named.end < 40 ? skillById(named.id) : undefined;
			if (name.endsWith('.md') && s.docs.some((x) => x.file === name)) out += link(s.id, name, whole);
			else if (name.endsWith('.md') && other?.docs.some((x) => x.file === name)) out += link(other.id, name, whole);
			else if (skillById(name)) {
				out += link(name, 'SKILL.md', whole);
				named = { id: name, end: last };
			} else out += whole;
		}
		return out + raw.slice(last);
	}

	function open(id: string | null, f = 'SKILL.md', push = true) {
		skillId = id;
		file = f;
		query = '';
		if (push) history.pushState(null, '', id ? `?skill=${id}${f !== 'SKILL.md' ? `&file=${f}` : ''}` : location.pathname);
		tick().then(() => window.scrollTo({ top: 0 }));
	}
	const fromUrl = () => {
		const p = new URLSearchParams(location.search);
		skillId = p.get('skill');
		file = p.get('file') ?? 'SKILL.md';
	};
	onMount(() => {
		fromUrl();
		addEventListener('popstate', fromUrl);
		return () => removeEventListener('popstate', fromUrl);
	});
	/** the links inside a page open their page here */
	const follow = (e: MouseEvent) => {
		const a = (e.target as HTMLElement).closest('a.wiki') as HTMLAnchorElement | null;
		if (!a) return;
		e.preventDefault();
		open(a.dataset.skill!, a.dataset.file!);
	};

	/** search: every page whose title or text holds the words, with a line around the first */
	const results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (q.length < 2) return [];
		const words = q.split(/\s+/);
		const hits: { skill: Skill; doc: Doc; snippet: string; score: number }[] = [];
		for (const s of SKILLS)
			for (const d of s.docs) {
				const text = d.body.toLowerCase();
				if (!words.every((w) => text.includes(w) || d.title.toLowerCase().includes(w))) continue;
				const at = text.indexOf(words[0]!);
				const from = Math.max(0, at - 70);
				const snippet = (from > 0 ? '…' : '') + d.body.slice(from, at + 130).replace(/[#*`|>\n]+/g, ' ').trim() + '…';
				const score = words.reduce((n, w) => n + (d.title.toLowerCase().includes(w) ? 5 : 0) + text.split(w).length - 1, 0);
				hits.push({ skill: s, doc: d, snippet, score });
			}
		return hits.sort((a, b) => b.score - a.score).slice(0, 30);
	});
	const firstLine = (s: string) => s.split(/(?<=\.)\s/)[0] ?? s;
</script>

<svelte:head>
	<title>{doc && skill ? `${doc.file === 'SKILL.md' ? skill.name : doc.title} · Skills` : 'Skills'} · maiaCITY</title>
</svelte:head>

<main class="wiki">
	<nav class="crew" aria-label="The film crew">
		<a class="back" href="{base}/app/">← Dashboard</a>
		<button class="home" class:on={!skillId} onclick={() => open(null)}>
			<b>Skills</b><span>the film crew · {totals.skills} skills · {totals.subs} sub-skills</span>
		</button>
		<input class="search" type="search" placeholder="Search every skill…" bind:value={query} />
		{#each CREW as g (g.group)}
			<section style="--accent: {GROUP_COLOUR[g.group]}">
				<h2>{g.group}</h2>
				{#each g.skills.map(skillById).filter((s): s is Skill => !!s) as s (s.id)}
					<button class="skill" class:on={skillId === s.id} onclick={() => open(s.id)}>{s.name}</button>
					{#if skillId === s.id}
						<ul>
							{#each s.docs.slice(1) as d (d.file)}
								<li><button class:on={file === d.file} onclick={() => open(s.id, d.file)}>{d.title}</button></li>
							{/each}
						</ul>
					{/if}
				{/each}
			</section>
		{/each}
	</nav>

	<section class="page">
		{#if query.trim().length >= 2}
			<header class="lead"><h1>Search</h1><p>{results.length} {results.length === 1 ? 'page' : 'pages'} for “{query.trim()}”</p></header>
			<ol class="results">
				{#each results as r (r.skill.id + r.doc.file)}
					<li>
						<button onclick={() => open(r.skill.id, r.doc.file)}>
							<small style="color: {GROUP_COLOUR[r.skill.group]}">{r.skill.name}{r.doc.file === 'SKILL.md' ? '' : ` · ${r.doc.file}`}</small>
							<b>{r.doc.title}</b>
							<span>{r.snippet}</span>
						</button>
					</li>
				{/each}
			</ol>
		{:else if skill && doc}
			<header class="lead" style="--accent: {GROUP_COLOUR[skill.group]}">
				<small>{skill.group} · {skill.name}{doc.file === 'SKILL.md' ? '' : ` · ${doc.file}`}</small>
				<h1>{doc.title}</h1>
				{#if doc.file === 'SKILL.md'}<p class="when">{skill.description}</p>{/if}
				<div class="chips">
					{#each skill.docs as d (d.file)}
						<button class:on={d.file === doc.file} onclick={() => open(skill.id, d.file)}>{d.file === 'SKILL.md' ? 'Overview' : d.title}</button>
					{/each}
				</div>
			</header>
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<article bind:this={article} onclick={follow}>{@html html(skill, doc)}</article>
			<footer class="meta">{doc.file} · {doc.lines} lines · {doc.words} words · <code>.claude/skills/{skill.id}/{doc.file}</code></footer>
		{:else}
			<header class="lead">
				<h1>The film crew</h1>
				<p>Every skill of the story producer's crew, as the agents read it: {totals.skills} skills, {totals.subs} sub-skills, {totals.words.toLocaleString('en')} words. Open one to read its laws, its sub-skills and its sources.</p>
			</header>
			{#each CREW as g (g.group)}
				<section class="group" style="--accent: {GROUP_COLOUR[g.group]}">
					<h2>{g.group} <span>{g.note}</span></h2>
					<div class="cards">
						{#each g.skills.map(skillById).filter((s): s is Skill => !!s) as s (s.id)}
							<button class="card" onclick={() => open(s.id)}>
								<b>{s.name}</b>
								<span>{firstLine(s.description)}</span>
								<small>{s.docs.length - 1} sub-skills · {s.docs.reduce((n, d) => n + d.words, 0).toLocaleString('en')} words</small>
								<ul>{#each s.docs.slice(1) as d (d.file)}<li>{d.title}</li>{/each}</ul>
							</button>
						{/each}
					</div>
				</section>
			{/each}
		{/if}
	</section>

	{#if doc && skill && query.trim().length < 2 && doc.headings.length > 1}
		<aside class="outline" aria-label="On this page">
			<h2>On this page</h2>
			<ul>
				{#each doc.headings as h (h.id)}
					<li class="l{h.level}"><a href="#{h.id}">{h.text}</a></li>
				{/each}
			</ul>
		</aside>
	{/if}
</main>

<style>
	.wiki {
		display: grid;
		grid-template-columns: 17rem minmax(0, 1fr) 14rem;
		min-height: 100vh;
		background: #f4f1eb;
		color: #1f2a23;
	}

	.crew {
		position: sticky;
		top: 0;
		align-self: start;
		max-height: 100vh;
		overflow: auto;
		padding: 1.2rem 0.8rem 2rem;
		border-right: 1px solid rgb(0 0 0 / 0.08);
	}

	.back {
		display: block;
		margin: 0 0.4rem 0.8rem;
		color: inherit;
		opacity: 0.65;
		font-size: 0.85rem;
		text-decoration: none;
	}

	button {
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		cursor: pointer;
		text-align: left;
	}

	.home {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 0.5rem 0.6rem;
		border-radius: 10px;
	}

	.home span {
		font-size: 0.75rem;
		opacity: 0.6;
	}

	.home.on,
	.skill.on {
		background: #fff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
	}

	.search {
		width: 100%;
		margin: 0.7rem 0 0.4rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 10px;
		background: #fff;
		font: inherit;
		font-size: 0.85rem;
	}

	.crew section {
		margin-top: 0.9rem;
	}

	.crew h2 {
		margin: 0 0.6rem 0.25rem;
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.skill {
		display: block;
		width: 100%;
		padding: 0.35rem 0.6rem;
		border-radius: 8px;
		font-size: 0.92rem;
		border-left: 3px solid transparent;
	}

	.skill.on {
		border-left-color: var(--accent);
		font-weight: 600;
	}

	.crew ul {
		margin: 0.15rem 0 0.4rem 0.9rem;
		padding: 0;
		list-style: none;
		border-left: 1px solid rgb(0 0 0 / 0.1);
	}

	.crew li button {
		display: block;
		width: 100%;
		padding: 0.25rem 0.6rem;
		font-size: 0.8rem;
		opacity: 0.75;
	}

	.crew li button.on {
		opacity: 1;
		font-weight: 600;
		color: var(--accent);
	}

	.page {
		min-width: 0;
		padding: 2rem clamp(1rem, 4vw, 3rem) 4rem;
	}

	.lead small {
		color: var(--accent, #6b6b60);
		font-size: 0.78rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.lead h1 {
		margin: 0.3rem 0 0.6rem;
		font-size: clamp(1.6rem, 3vw, 2.2rem);
		line-height: 1.15;
	}

	.lead p {
		max-width: 72ch;
		margin: 0 0 1rem;
		line-height: 1.55;
		opacity: 0.8;
	}

	.when {
		padding: 0.8rem 1rem;
		border-left: 3px solid var(--accent);
		border-radius: 0 10px 10px 0;
		background: rgb(255 255 255 / 0.6);
		font-size: 0.92rem;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.4rem 0 1.4rem;
	}

	.chips button {
		padding: 0.3rem 0.7rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.5);
		font-size: 0.8rem;
	}

	.chips button.on {
		border-color: var(--accent);
		background: #fff;
		color: var(--accent);
		font-weight: 600;
	}

	article {
		max-width: 78ch;
		line-height: 1.62;
		font-size: 0.98rem;
	}

	article :global(h2) {
		margin: 2.2rem 0 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid rgb(0 0 0 / 0.08);
		font-size: 1.3rem;
		scroll-margin-top: 1rem;
	}

	article :global(h3) {
		margin: 1.5rem 0 0.4rem;
		font-size: 1.05rem;
		scroll-margin-top: 1rem;
	}

	article :global(p),
	article :global(li) {
		max-width: 78ch;
	}

	article :global(ul),
	article :global(ol) {
		padding-left: 1.3rem;
	}

	article :global(li) {
		margin: 0.25rem 0;
	}

	article :global(code) {
		padding: 0.08rem 0.32rem;
		border-radius: 5px;
		background: rgb(0 0 0 / 0.06);
		font-size: 0.86em;
	}

	article :global(pre) {
		overflow: auto;
		padding: 0.9rem 1rem;
		border-radius: 10px;
		background: #23302a;
		color: #eef0e8;
		font-size: 0.82rem;
		line-height: 1.5;
	}

	article :global(pre code) {
		padding: 0;
		background: none;
	}

	article :global(table) {
		display: block;
		overflow-x: auto;
		max-width: 100%;
		margin: 1rem 0;
		border-collapse: collapse;
		font-size: 0.86rem;
	}

	article :global(th),
	article :global(td) {
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid rgb(0 0 0 / 0.08);
		text-align: left;
		vertical-align: top;
	}

	article :global(th) {
		background: rgb(255 255 255 / 0.7);
	}

	article :global(blockquote) {
		margin: 1rem 0;
		padding: 0.4rem 1rem;
		border-left: 3px solid rgb(0 0 0 / 0.15);
		opacity: 0.85;
	}

	article :global(a.wiki) {
		text-decoration: none;
	}

	article :global(a.wiki code) {
		background: rgb(79 122 85 / 0.14);
		color: #2f5a3a;
		box-shadow: inset 0 -1px 0 rgb(47 90 58 / 0.35);
	}

	article :global(input[type='checkbox']) {
		margin-right: 0.4rem;
	}

	.meta {
		max-width: 78ch;
		margin-top: 2.5rem;
		padding-top: 0.8rem;
		border-top: 1px solid rgb(0 0 0 / 0.08);
		font-size: 0.78rem;
		opacity: 0.6;
	}

	.outline {
		position: sticky;
		top: 0;
		align-self: start;
		max-height: 100vh;
		overflow: auto;
		padding: 2rem 1rem 2rem 0.5rem;
		font-size: 0.8rem;
	}

	.outline h2 {
		margin: 0 0 0.5rem;
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	.outline ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.outline li {
		margin: 0.3rem 0;
	}

	.outline li.l3 {
		padding-left: 0.8rem;
		opacity: 0.75;
	}

	.outline a {
		color: inherit;
		text-decoration: none;
	}

	.outline a:hover {
		text-decoration: underline;
	}

	.group h2 {
		margin: 2rem 0 0.8rem;
		color: var(--accent);
		font-size: 1rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.group h2 span {
		margin-left: 0.5rem;
		color: #1f2a23;
		font-size: 0.8rem;
		letter-spacing: 0;
		text-transform: none;
		opacity: 0.55;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: 0.8rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1rem;
		border-radius: 14px;
		border-top: 4px solid var(--accent);
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
	}

	.card b {
		font-size: 1.05rem;
	}

	.card span {
		font-size: 0.82rem;
		line-height: 1.45;
		opacity: 0.8;
	}

	.card small {
		font-size: 0.72rem;
		opacity: 0.55;
	}

	.card ul {
		margin: 0.2rem 0 0;
		padding-left: 1rem;
		font-size: 0.78rem;
		opacity: 0.75;
	}

	.results {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.results button {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		width: 100%;
		max-width: 78ch;
		padding: 0.7rem 0.9rem;
		border-radius: 10px;
	}

	.results button:hover {
		background: #fff;
	}

	.results span {
		font-size: 0.82rem;
		opacity: 0.7;
	}

	@media (max-width: 1100px) {
		.wiki {
			grid-template-columns: 15rem minmax(0, 1fr);
		}

		.outline {
			display: none;
		}
	}

	@media (max-width: 720px) {
		.wiki {
			grid-template-columns: 1fr;
		}

		.crew {
			position: static;
			max-height: none;
			border-right: 0;
			border-bottom: 1px solid rgb(0 0 0 / 0.08);
		}
	}
</style>
