<!--
	A story's Movie tab (./Story.svelte, plan J8, J9): its script ($lib/studio/scripts.js), an entry of its own that links
	the story. Its scenes in order, each drawn from a beat of the journey and
	saying what happens there, with its lines (the voice-over and what is said on screen) and its shot list (size, angle,
	move, what it shows, the line it covers). A story with no script draws its first from its beats; its lines and shots
	can be adapted from the story's full text, the lines then quoting it. When the beats or that text move on, the
	script says it is behind and takes the change. A script makes a first cut for the studio: a slate for each shot and a
	line for each line, the story listing its cuts; and once a cut is rendered, each film it made can go out as a film post
	($lib/studio/films.js), the story's post of type `film`. Agents propose on the script's lines, as on any entry; each change
	here is one op on its main line, as the device allows it.
-->
<script>
	import { entryCollection } from './entry-collection.svelte.js';
	import { entryReferenceClosure } from './entry-reference-closure.svelte.js';
	import { reads } from './vaults.js';
	import { BEAT_LABEL } from '$lib/stories/stories.js';
	import { CUT, CUT_V1, fieldsOf } from '$lib/studio/cuts.js';
	import {
		ANGLES,
		DELIVERY,
		MOVES,
		SCRIPT,
		SCRIPT_V2,
		SIZES,
		WHO,
		adaptOps,
		articleBehindOf,
		articleTakingOps,
		cutFrom,
		cutsOf,
		draftFrom,
		scriptsOf,
		spokenSeconds,
		storyBehindOf,
		storyTakingOps
	} from '$lib/studio/scripts.js';
	import { filmPost, filmsOf, postsOfFilm } from '$lib/studio/films.js';
	import FILM_TEMPLATE from '/films/TEMPLATE.md?raw';
	import { entryOf } from './artifacts.js';
	import { allowed, may, windowRead } from './ops.js';
	import { postTag, postTypeSchema } from './posttypes.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean,
	 *   item: import('./vaults.js').EntryView, writes: boolean }}
	 */
	let { world: baseWorld, actor, api, busy, item } = $props();
	const inventory = entryCollection(() => api, () => ({op:'entry_views', as:actor, types:['script','cut','task','post']}));
	const held = $derived(inventory.rows.filter(e=>reads(e,actor)));
	const discoveryWorld = $derived({...baseWorld, entries:held, entriesComplete:false});
	const roots = $derived.by(() => {
		const scripts = scriptsOf(discoveryWorld,item.entry), cuts = cutsOf(discoveryWorld,item.entry);
		const ids = new Set(cuts.map(c=>c.entry));
		const tasks = held.filter(e=>e.type === 'task' && ids.has(/** @type {any} */ (e.record)?.inputs?.[0]?.entry));
		return [...scripts.map(e=>e.entry),...cuts.map(e=>e.entry),...tasks.map(e=>e.entry)];
	});
	const references = entryReferenceClosure(() => api, () => roots, () => actor);
	const world = $derived({...baseWorld, entries:[...new Map([...held,...references.rows,item].map(e=>[e.entry,e])).values()],entriesComplete:false});

	let noteWindow = $state.raw(/** @type {any} */ (null));
	$effect(() => {
		const window = api.window?.();
		noteWindow = window;
		return () => window?.close();
	});

	/** a beat kind's name, for a beat with no title @param {string} t */
	const label = (t) => /** @type {Record<string, string>} */ (BEAT_LABEL)[t] ?? t;
	const story = $derived(/** @type {any} */ (item.record) ?? {});
	const beats = $derived(/** @type {any[]} */ (story.beats ?? []));
	/** what the lines can be adapted from: the story's own full text, where it has one (there are no articles now) */
	const article = $derived((item.text ?? story.text ?? '').trim() ? { ...item, text: item.text ?? story.text } : undefined);
	const scripts = $derived(scriptsOf(world, item.entry));
	let picked = $state('');
	const script = $derived(scripts.find((s) => s.entry === picked) ?? scripts[0]);
	const record = $derived(/** @type {any} */ (script?.record) ?? {});
	const scenes = $derived(/** @type {import('$lib/studio/scripts.js').Scene[]} */ (record.scenes ?? []));
	/** the delivery the script was adapted from, if any */
	const source = $derived(record.from ? world.entries.find((e) => e.entry === entryOf(record.from)) : undefined);
	const storyWhere = $derived(script ? storyBehindOf(record, beats) : { behind: false, changed: [], added: [], gone: [] });
	const where = $derived(script && source ? articleBehindOf(record, source.text ?? '') : { behind: false, changed: [], added: [] });
	const cuts = $derived(cutsOf(world, item.entry));
	/** the reports of renders too long to keep in their task, read from their files, by task entry */
	let reports = $state(/** @type {Record<string, any>} */ ({}));
	/** the tasks whose reports were asked for already */
	const asked = new Set();
	/** the films its cuts' renders made, each with its cut and the film posts made of it */
	const films = $derived(
		cuts.flatMap((c) => filmsOf(world, c.entry, reports).map((f) => ({ ...f, cut: c, posts: postsOfFilm(world, f.file.entry) })))
	);
	$effect(() => {
		const ids = new Set(cuts.map((c) => c.entry));
		const kept = world.entries.filter((e) => e.type === 'task' && /** @type {any} */ (e.record)?.rule === 'render' && ids.has(/** @type {any} */ (e.record)?.inputs?.[0]?.entry));
		for (const t of kept) {
			let file = '';
			try {
				file = JSON.parse(/** @type {any} */ (t.record).result || '{}').file ?? '';
			} catch {
				file = '';
			}
			if (!file || asked.has(t.entry)) continue;
			asked.add(t.entry);
			import('$lib/studio/aven.js')
				.then((m) => m.valueOfFile(world, file))
				.then((v) => v && (reports = { ...reports, [t.entry]: v }))
				.catch(() => {});
		}
	});

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
	const writer = $derived((item.writers ?? []).includes(actor));

	/** the script's proposals, as its note's lines name them: an agent's, merged on its page */
	let proposals = $state(/** @type {{ line: string, name: string | null }[]} */ ([]));
	$effect(() => {
		void world;
		const e = script?.entry;
		if (!e) return void (proposals = []);
		if (api.window && !noteWindow) return;
		let gone = false;
		const request = windowRead(api, { op: 'note', entry: e }, null, noteWindow);
		request.result.then((/** @type {any} */ n) => { if (!gone) proposals = (n?.lines ?? []).slice(1); });
		return () => { gone = true; request.close(); };
	});

	/** Runs change `op` on the script's main line as `what`. @param {string} what @param {object} op */
	const change = (what, op) => api.run(what, { ...op, entry: script?.entry, as: actor });

	/** Schema `text` added to the story's vault where it has none of its title. @param {string} text @param {string} what */
	async function schema(text, what) {
		const title = JSON.parse(text).title;
		const out = await api.ask({op:'schemas',vault:item.vault});
		if (!out?.ok || !Array.isArray(out.ok.schemas)) throw new Error('The local schema inventory is unavailable');
		const has = out.ok.schemas.some((/** @type {any} */ schema) => { try { return JSON.parse(schema.json).title === title; } catch { return false; } });
		if (!has) await api.run(what, { op: 'create', vault: item.vault, type: 'schema', value: text, as: actor });
	}

	/** The script's first version, from the story's beats. */
	async function make() {
		await schema(SCRIPT_V2, 'Adding the script schema');
		const value = draftFrom(item, Math.floor(Date.now() / 1000), label);
		const made = await api.run('Drawing the script from the story', { op: 'create', vault: item.vault, type: SCRIPT, tags: [DELIVERY], value, as: actor });
		if (made?.entry) picked = made.entry;
	}

	/** The script's lines and shots adapted from the story's text. */
	function adapt() {
		if (!script || !article) return;
		return api.run('Adapting the lines from its text', { op: 'batch', as: actor, ops: adaptOps(script.entry, record, article, beats) });
	}

	const takeStory = () => script && api.run('Taking the story’s change', { op: 'batch', as: actor, ops: storyTakingOps(script.entry, record, beats, label) });

	function take() {
		if (!script || !source) return;
		return api.run('Taking its text’s change', { op: 'batch', as: actor, ops: articleTakingOps(script.entry, record, source.text ?? '') });
	}

	/** A first cut of the script, in the story's vault, for the studio. */
	async function cut() {
		if (!script) return;
		await schema(CUT_V1, 'Adding the cut schema');
		const value = { kind: CUT, ...fieldsOf(cutFrom(record, script.vault, script.entry)) };
		await api.run('Making a cut of the script', { op: 'create', vault: item.vault, type: CUT, value, as: actor });
	}

	/**
	 * A film post of film `f`, the story gone out as that film: the film post type added to the vault where it has
	 * none, with its template. @param {any} f
	 */
	async function post(f) {
		const cut = world.entries.find((e) => e.entry === f.cut.entry);
		if (!cut) return;
		await schema(postTypeSchema('film', FILM_TEMPLATE.trim()), 'Adding the film post type');
		await api.run('Making a film post', { op: 'create', vault: item.vault, type: 'post', tags: [postTag('film')], value: filmPost(item, cut, f), as: actor });
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
{#if inventory.phase !== 'ready' || references.phase !== 'ready'}<p class="soft">Reading locally available scripts, cuts and their linked outputs…</p>{/if}
{#if references.limited}<p class="soft">This film’s reference graph exceeds the bounded view; open a linked cut to continue.</p>{/if}
<p class="soft">Showing film work held locally; missing entries and files may arrive later.</p>

{#if !script}
	<div class="blank">
		{#if beats.length}
			<p>No script is available locally yet. The script is the story told as a film: a scene for each beat of its journey, saying what happens there, then the lines said and the shots they need. Its lines can be adapted from the story’s text. Then it is yours and the agents’ to shape.</p>
		{:else}
			<p>No script is available locally yet, and the story has no beats. Lay them out in the Journey tab first, or start from one opening scene.</p>
		{/if}
		{#if writer}<button class="add" disabled={busy} onclick={make}>Draw the script from the story</button>{/if}
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
			<p class="tally">{scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · {shotCount} {shotCount === 1 ? 'shot' : 'shots'} · about {minutes(spokenSeconds(record))} read aloud{#if source}{' · '}lines adapted from “{source.title ?? 'its text'}”{/if}</p>
			{#if edits && !record.from && article}<button class="ghost" onclick={adapt}>Adapt the lines from the story’s text</button>{/if}
		</header>

		<section class="cuts" aria-label="Its cuts">
			<p class="cap">Cuts</p>
			{#each cuts as c (c.entry)}
				<a class="cut" href="/app/studio/?timeline=cut:{c.entry}">{c.name} · {c.clips} {c.clips === 1 ? 'clip' : 'clips'}{#if c.script && c.script !== script.entry} · of another script{/if}</a>
			{:else}
				<span class="tally">No cut is available locally yet. A first cut lays a slate for each shot and a line for each line, timed to be said, for the studio to fill.</span>
			{/each}
			{#if writer}<button class="ghost" disabled={busy} onclick={cut}>Make a cut of this script</button>{/if}
			<span class="tally">The studio opens avenDB cuts in the Mac app.</span>
		</section>

		{#if films.length}
			<section class="cuts" aria-label="Its films">
				<p class="cap">Films</p>
				{#each films as f (f.file.entry)}
					<span class="cut">
						{[f.name, f.aspect, f.seconds ? minutes(Math.round(f.seconds)) : '', `from ${f.cut.name}`].filter(Boolean).join(' · ')}
						{#if f.posts.length}
							· posted as a film (Derivatives tab)
						{:else if writer}
							<button class="ghost" disabled={busy} onclick={() => post(f)}>Make a film post</button>
						{/if}
					</span>
				{/each}
			</section>
		{/if}

		{#if storyWhere.behind}
			<aside class="behind" aria-label="The story moved on">
				<p>
					<b>The story’s beats changed since this script was drawn.</b>
					{#if storyWhere.changed.length}{storyWhere.changed.length} {storyWhere.changed.length === 1 ? 'beat says' : 'beats say'} new words.{/if}
					{#if storyWhere.added.length}{storyWhere.added.length} new {storyWhere.added.length === 1 ? 'beat has' : 'beats have'} no scene yet.{/if}
					{#if storyWhere.gone.length}{storyWhere.gone.length} {storyWhere.gone.length === 1 ? 'scene’s beat is' : 'scenes’ beats are'} gone.{/if}
				</p>
				<ul>
					{#each storyWhere.changed as c (c.scene.id)}<li>{c.scene.name}: <s>{c.was}</s> → {c.now}</li>{/each}
					{#each storyWhere.added as a (a.beat.id)}<li>+ {a.beat.title || label(a.beat.type ?? '')}{#if a.beat.text}: {a.beat.text}{/if}</li>{/each}
					{#each storyWhere.gone as g (g.scene.id)}<li>{g.scene.name} (its beat is gone; the scene stays)</li>{/each}
				</ul>
				{#if edits}<button class="add" onclick={takeStory}>Take the change</button>{/if}
			</aside>
		{/if}

		{#if proposals.length}
			<p class="tally">
				{#each proposals as p, i (p.line)}{#if i}, {/if}<b>“{p.name ?? 'A proposal'}”</b>{/each}
				{proposals.length === 1 ? 'is' : 'are'} proposed for this script; merge on its page.
			</p>
		{/if}

		{#if where.behind}
			<aside class="behind" aria-label="The text moved on">
				<p>
					<b>The story’s text changed since this script was made.</b>
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
						{#each beats as b (b.id)}<option value={b.id}>{b.title || label(b.type ?? '')}</option>{/each}
					</select>
					{#if edits}
						<button class="mini" disabled={k === 0} onclick={() => shift(s, -1)} aria-label="Earlier">‹</button>
						<button class="mini" disabled={k === scenes.length - 1} onclick={() => shift(s, 1)} aria-label="Later">›</button>
						<button class="mini x" onclick={() => drop(s)} aria-label="Take the scene out">×</button>
					{/if}
				</header>

				<textarea class="action" rows="2" value={s.action ?? ''} disabled={!edits} placeholder="What happens in this scene" aria-label="What happens" onchange={(e) => edit(s, 'action', e.currentTarget.value)}></textarea>
				{#if s.feel}<p class="tally">The viewer should feel: {s.feel}</p>{/if}

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

	.cuts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.8rem;
	}
	.cuts .cap {
		flex-basis: 100%;
	}
	.cut {
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 0.84rem;
		color: var(--ink);
		text-decoration: none;
	}
	.scene .action {
		margin-bottom: 0.6rem;
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
