<!--
	A story's Movie tab (./Story.svelte, plan J8): its script, the writing made into a film plan ($lib/studio/scripts.js),
	an entry of its own beside the story that links it and the article it is made from. Its scenes in order, each
	serving a beat of the journey, with its lines (the voice-over and what is said on screen, a line drawn from the
	article quoting it) and its shot list (size, angle, move, what it shows, the line it covers). When the article moves
	on, the script says it is behind and takes the change: the article's new words where a line still said what it
	quoted, its new paragraphs as lines in place. A story with no script makes its first from its article. Agents
	propose on the script's lines, as on any entry; each change here is one op on its main line, as the device allows it.
-->
<script>
	import { entryOf } from './artifacts.js';
	import { allowed, may } from './ops.js';
	import { ANGLES, MOVES, SCRIPT, SCRIPT_V1, SIZES, WHO, behindOf, draftFrom, scriptsOf, spokenSeconds, takingOps } from '$lib/studio/scripts.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean,
	 *   item: import('./vaults.js').EntryView, writes: boolean }}
	 */
	let { world, actor, api, busy, item } = $props();

	const story = $derived(/** @type {any} */ (item.record) ?? {});
	const beats = $derived(/** @type {any[]} */ (story.beats ?? []));
	/** the story's main article: the one written first, no variant */
	const article = $derived(
		world.entries
			.filter((e) => e.type === 'article' && !e.deleted && !e.variantOf && entryOf(/** @type {any} */ (e.record)?.story) === item.entry)
			.sort((a, b) => (a.created ?? 0) - (b.created ?? 0))[0]
	);
	const scripts = $derived(scriptsOf(world, item.entry));
	let picked = $state('');
	const script = $derived(scripts.find((s) => s.entry === picked) ?? scripts[0]);
	const record = $derived(/** @type {any} */ (script?.record) ?? {});
	const scenes = $derived(/** @type {import('$lib/studio/scripts.js').Scene[]} */ (record.scenes ?? []));
	/** the article the script is made from, which may not be the main one */
	const source = $derived(world.entries.find((e) => e.entry === record.article) ?? article);
	const where = $derived(script && source ? behindOf(record, source.text ?? '') : { behind: false, changed: [], added: [] });

	/** whether it may change the script, as the device answers a dry run */
	let changes = $state(false);
	$effect(() => {
		void world;
		if (!script) return void (changes = false);
		let gone = false;
		may(api, actor, [{ op: 'set', entry: script.entry, path: ['title'], value: script.title ?? '' }]).then(([a]) => !gone && (changes = allowed(a)));
		return () => {
			gone = true;
		};
	});
	const edits = $derived(changes && !busy && (script?.writers ?? []).includes(actor));

	/** the script's proposals, as its note's lines name them: an agent's, merged on its page */
	let proposals = $state(/** @type {{ line: string, name: string | null }[]} */ ([]));
	$effect(() => {
		void world;
		const e = script?.entry;
		if (!e) return void (proposals = []);
		let gone = false;
		api.note(e).then(
			(/** @type {any} */ n) => !gone && (proposals = (n?.lines ?? []).slice(1)),
			() => {}
		);
		return () => {
			gone = true;
		};
	});

	/** Runs change `op` on the script's main line as `what`. @param {string} what @param {object} op */
	const change = (what, op) => api.run(what, { ...op, entry: script?.entry, as: actor });

	/** The script's first version, from the article; the schema added to the vault where it has none. */
	async function make() {
		if (!article) return;
		const has = world.entries.some((e) => e.vault === item.vault && e.type === 'schema' && !e.deleted && e.title === 'Script, v1');
		if (!has) await api.run('Adding the script schema', { op: 'create', vault: item.vault, type: 'schema', value: SCRIPT_V1, as: actor });
		const value = draftFrom(item, article, Math.floor(Date.now() / 1000));
		const made = await api.run('Making the script from its article', { op: 'create', vault: item.vault, type: SCRIPT, value, as: actor });
		if (made?.entry) picked = made.entry;
	}

	function take() {
		if (!script || !source) return;
		return api.run('Taking the article’s change', { op: 'batch', as: actor, ops: takingOps(script.entry, record, source.text ?? '') });
	}

	/** @param {number} scene */
	const sceneAt = (scene) => ['scenes', { id: scene }];
	/** An id none of `rows` has. @param {{ id: number }[]} rows */
	const next = (rows) => rows.reduce((m, r) => Math.max(m, r.id ?? 0), 0) + 1;

	/** Sets field `field` of scene `s` (or of its row `row` in list `list`) to `value`, where it changed; blank, it is
	 *  cleared. @param {any} s @param {string} field @param {any} value @param {'lines' | 'shots'} [list] @param {any} [row] */
	function edit(s, field, value, list, row) {
		const was = (row ?? s)[field];
		if ((was ?? '') === (value ?? '')) return;
		const path = [...sceneAt(s.id), ...(list ? [list, { id: row.id }] : []), field];
		return change('Changing the script', value === '' || value === undefined ? { op: 'unset', path } : { op: 'set', path, value });
	}

	const addScene = () => change('Adding a scene', { op: 'insert', path: ['scenes'], value: { id: next(scenes), name: `Scene ${scenes.length + 1}`, lines: [], shots: [] } });
	/** @param {any} s */
	const addLine = (s) => change('Adding a line', { op: 'insert', path: [...sceneAt(s.id), 'lines'], value: { id: next(s.lines ?? []), who: 'voice', text: '' } });
	/** @param {any} s */
	const addShot = (s) =>
		change('Adding a shot', { op: 'insert', path: [...sceneAt(s.id), 'shots'], value: { id: next(s.shots ?? []), size: 'ms', angle: 'eye', move: 'static', shows: '' } });
	/** @param {any} s @param {'lines' | 'shots'} [list] @param {any} [row] */
	const drop = (s, list, row) => change('Taking it out', { op: 'remove', path: [...sceneAt(s.id), ...(list ? [list, { id: row.id }] : [])] });
	/** @param {any} s @param {-1 | 1} by */
	function shift(s, by) {
		const k = scenes.findIndex((x) => x.id === s.id);
		if (k + by < 0 || k + by >= scenes.length) return;
		change(by < 0 ? 'Moving the scene earlier' : 'Moving the scene later', { op: 'move', path: sceneAt(s.id), to: k + by });
	}

	/** A line's opening words, to name it in a shot's list. @param {any} l */
	const short = (l) => {
		const t = (l.text ?? '').trim();
		return t.length > 40 ? `${t.slice(0, 39)}…` : t || 'An empty line';
	};
	/** @param {number} s */
	const minutes = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim());
	const shotCount = $derived(scenes.reduce((n, s) => n + (s.shots?.length ?? 0), 0));
</script>

{#if !script}
	<div class="blank">
		{#if article}
			<p>No script yet. The script turns the article into a film plan: a scene for each of its headings, on the beat of the same name, each paragraph a line of the voice-over and each picture a planned shot. Then it is yours and the agents’ to shape.</p>
			{#if (item.writers ?? []).includes(actor)}<button class="add" disabled={busy} onclick={make}>Make the script from “{article.title || 'its article'}”</button>{/if}
		{:else}
			<p>No article yet. A film’s script is made from the story’s article: write it in the Writing tab first.</p>
		{/if}
	</div>
{:else}
	<div class="movie">
		<header class="head">
			{#if scripts.length > 1}
				<select bind:value={picked} aria-label="Which script">
					{#each scripts as s (s.entry)}<option value={s.entry}>{s.title}</option>{/each}
				</select>
			{/if}
			<input class="title" value={script.title ?? ''} disabled={!edits} aria-label="The script's name" onchange={(e) => e.currentTarget.value.trim() && change('Renaming the script', { op: 'set', path: ['title'], value: e.currentTarget.value.trim() })} />
			<a class="ghost" href="#notes/{script.entry}">Proposals and history</a>
			<p class="tally">{scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · {shotCount} {shotCount === 1 ? 'shot' : 'shots'} · about {minutes(spokenSeconds(record))} read aloud · from “{source?.title ?? 'its article'}”</p>
		</header>

		{#if proposals.length}
			<p class="tally">
				{#each proposals as p, i (p.line)}{#if i}, {/if}<b>“{p.name ?? 'A proposal'}”</b>{/each}
				{proposals.length === 1 ? 'is' : 'are'} proposed for this script; merge on its page.
			</p>
		{/if}

		{#if where.behind}
			<aside class="behind" aria-label="The article moved on">
				<p>
					<b>The article changed since this script was made.</b>
					{#if where.changed.length}{where.changed.length} {where.changed.length === 1 ? 'line quotes' : 'lines quote'} words it no longer says.{/if}
					{#if where.added.length}{where.added.length} new {where.added.length === 1 ? 'paragraph' : 'paragraphs'} no line says yet.{/if}
				</p>
				<ul>
					{#each where.changed as c (`${c.scene}:${c.line.id}`)}
						<li><s>{c.line.quote}</s>{#if c.now} → {c.now}{:else} (taken out){/if}</li>
					{/each}
					{#each where.added as a, i (i)}<li>+ {a.text}</li>{/each}
				</ul>
				{#if edits}<button class="add" onclick={take}>Take the change</button>{/if}
			</aside>
		{/if}

		{#each scenes as s, k (s.id)}
			<section class="scene">
				<header>
					<span class="no">{k + 1}</span>
					<input class="name" value={s.name ?? ''} disabled={!edits} aria-label="The scene's name" onchange={(e) => edit(s, 'name', e.currentTarget.value.trim())} />
					<select value={s.beat ?? ''} disabled={!edits} aria-label="The beat it serves" onchange={(e) => edit(s, 'beat', e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}>
						<option value="">No beat</option>
						{#each beats as b (b.id)}<option value={b.id}>{b.title || b.type}</option>{/each}
					</select>
					{#if edits}
						<button class="mini" disabled={k === 0} onclick={() => shift(s, -1)} aria-label="Earlier">‹</button>
						<button class="mini" disabled={k === scenes.length - 1} onclick={() => shift(s, 1)} aria-label="Later">›</button>
						<button class="mini x" onclick={() => drop(s)} aria-label="Take the scene out">×</button>
					{/if}
				</header>

				<div class="cols">
					<div class="lines">
						<p class="cap">Lines</p>
						{#each s.lines ?? [] as l (l.id)}
							<div class="line" class:quoted={!!l.quote}>
								<select value={l.who ?? 'voice'} disabled={!edits} aria-label="Who says it" onchange={(e) => edit(s, 'who', e.currentTarget.value, 'lines', l)}>
									{#each WHO as [key, name] (key)}<option value={key}>{name}</option>{/each}
								</select>
								<textarea rows="2" value={l.text ?? ''} disabled={!edits} aria-label="What is said" onchange={(e) => edit(s, 'text', e.currentTarget.value, 'lines', l)}></textarea>
								{#if edits}<button class="mini x" onclick={() => drop(s, 'lines', l)} aria-label="Take the line out">×</button>{/if}
							</div>
						{/each}
						{#if edits}<button class="ghost" onclick={() => addLine(s)}>+ Line</button>{/if}
					</div>

					<div class="shots">
						<p class="cap">Shot list</p>
						{#each s.shots ?? [] as sh, j (sh.id)}
							<div class="shot">
								<span class="no">{k + 1}.{j + 1}</span>
								<select value={sh.size ?? 'ms'} disabled={!edits} aria-label="Shot size" onchange={(e) => edit(s, 'size', e.currentTarget.value, 'shots', sh)}>
									{#each SIZES as [key, name] (key)}<option value={key}>{name}</option>{/each}
								</select>
								<select value={sh.angle ?? 'eye'} disabled={!edits} aria-label="Angle" onchange={(e) => edit(s, 'angle', e.currentTarget.value, 'shots', sh)}>
									{#each ANGLES as [key, name] (key)}<option value={key}>{name}</option>{/each}
								</select>
								<select value={sh.move ?? 'static'} disabled={!edits} aria-label="Move" onchange={(e) => edit(s, 'move', e.currentTarget.value, 'shots', sh)}>
									{#each MOVES as [key, name] (key)}<option value={key}>{name}</option>{/each}
								</select>
								<input class="shows" value={sh.shows ?? ''} disabled={!edits} placeholder="What it shows" aria-label="What it shows" onchange={(e) => edit(s, 'shows', e.currentTarget.value, 'shots', sh)} />
								<select value={sh.line ?? ''} disabled={!edits} aria-label="The line it covers" onchange={(e) => edit(s, 'line', e.currentTarget.value === '' ? '' : Number(e.currentTarget.value), 'shots', sh)}>
									<option value="">Covers no line</option>
									{#each s.lines ?? [] as l (l.id)}<option value={l.id}>{short(l)}</option>{/each}
								</select>
								{#if sh.take || sh.shot}<span class="covered" title={sh.take || sh.shot}>covered</span>{/if}
								{#if edits}<button class="mini x" onclick={() => drop(s, 'shots', sh)} aria-label="Take the shot out">×</button>{/if}
							</div>
						{/each}
						{#if edits}<button class="ghost" onclick={() => addShot(s)}>+ Shot</button>{/if}
					</div>
				</div>
			</section>
		{/each}
		{#if edits}<button class="add" onclick={addScene}>+ Scene</button>{/if}
	</div>
{/if}

<style>
	.movie {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	input,
	textarea,
	select {
		box-sizing: border-box;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		font-size: 0.86rem;
		color: var(--ink);
	}

	textarea {
		width: 100%;
		resize: vertical;
		line-height: 1.45;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.8rem;
	}

	.head .title {
		flex: 1 1 16rem;
		font-family: var(--font-display);
		font-size: 1.1rem;
	}

	.tally,
	.cap {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.cap {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.behind {
		padding: 0.8rem 1rem;
		border: 1px solid var(--mustard);
		border-radius: 12px;
		background: color-mix(in srgb, var(--mustard) 10%, #fff);
	}

	.behind p,
	.behind ul {
		margin: 0 0 0.5rem;
		font-size: 0.86rem;
	}

	.behind ul {
		padding-left: 1.1rem;
	}

	.scene {
		padding: 0.8rem 1rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
	}

	.scene > header,
	.shot,
	.line {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.scene > header {
		margin-bottom: 0.6rem;
	}

	.scene .name {
		flex: 1;
		font-weight: 600;
	}

	.no {
		min-width: 1.6rem;
		font-size: 0.75rem;
		color: var(--muted);
	}

	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
		gap: 1rem;
	}

	.lines,
	.shots {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.line {
		align-items: flex-start;
	}

	.line.quoted textarea {
		border-left: 3px solid var(--terracotta);
	}

	.shot {
		flex-wrap: wrap;
	}

	.shot .shows {
		flex: 1 1 10rem;
	}

	.covered {
		font-size: 0.72rem;
		color: var(--ok, #2f7d4f);
	}

	.mini {
		padding: 0.1rem 0.45rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: none;
		cursor: pointer;
	}

	.mini.x {
		color: var(--terracotta);
	}

	.add,
	.ghost {
		text-decoration: none;
		color: inherit;
		align-self: flex-start;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.add {
		border-color: var(--terracotta);
		color: var(--terracotta);
	}

	.blank p {
		max-width: 44rem;
	}

	@media (max-width: 720px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
</style>
