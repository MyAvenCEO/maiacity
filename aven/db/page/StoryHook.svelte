<!--
	A story's Hook tab (./Story.svelte), its record's hook step (avendb's `story` schema, the hook-writer skill): the
	hooks tried, rows of `hooks`, each its line, its parts named (subject, action, end state, contrast, proof, time,
	anchor), the promise and the objection killer after it, how far up the extreme dial it sits, a note and its image
	title; the one on the card (`hook`, its row's id), whose line is the title everywhere; the image title, the hook's
	catchwords on the card; the intro, the first 3 to 30 seconds; and the description. Beside them how it looks on
	YouTube: the card (the 16:9 one rendered on the Thumbnail step, a stand-in until then), the title, the channel, the first lines. Hooks a
	proposal adds (an agent's, which may only suggest) show among them, marked, until the proposal is merged on the
	right. Each change is one op on its main line, as the device allows it.
-->
<script>
	import { entryOf } from './artifacts.js';
	import { artworksOf } from './artworks.js';
	import Icon from './Icon.svelte';
	import { allowed, may } from './ops.js';
	import { newId, pictureOf } from './sparks.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean,
	 *   item: import('./vaults.js').EntryView, writes: boolean,
	 *   lines: { line: string | null, name: string | null, record: any, variant?: boolean }[] }}
	 */
	let { world, actor, api, busy, item, writes, lines } = $props();

	/** The parts of a hook, as the hook-writer skill names them, in its order. */
	const PARTS = /** @type {const} */ ([
		['subject', 'Subject'],
		['action', 'Action'],
		['end', 'End state'],
		['contrast', 'Contrast'],
		['proof', 'Proof'],
		['time', 'Time'],
		['anchor', 'Anchor']
	]);
	/** The extreme dial: aim at 3, the most impossible-sounding line that is still true. */
	const DIAL = ['', 'mild', 'bold', 'extreme', 'false'];

	const entry = $derived(item.entry);
	const record = $derived(/** @type {any} */ (item.record) ?? {});
	const rows = $derived(/** @type {any[]} */ (record.hooks ?? []));
	const chosen = $derived(rows.find((h) => h.id === record.hook) ?? null);
	/** what goes out as the title: the hook on the card; the story's working name only until there is one */
	const title = $derived(chosen?.text?.trim() || record.title || 'Untitled');
	/** the words on the card: the image title, else the hook */
	const words = $derived((record.image_title ?? []).filter(Boolean).join('\n') || chosen?.text?.trim() || record.title || '');
	/** the 16:9 card as rendered on the Thumbnail step, once it is: what YouTube shows */
	const rendered = $derived.by(() => {
		const card = artworksOf(world, entry).find((c) => /** @type {any} */ (c.record)?.shape === '16x9' && !c.forkOf);
		const id = entryOf(/** @type {any} */ (card?.record)?.render);
		return (id && world.entries.find((e) => e.entry === id)) || null;
	});
	let cover = $state(/** @type {string | null} */ (null));
	$effect(() => {
		let gone = false;
		if (rendered) pictureOf(api, rendered).then((u) => !gone && (cover = u));
		else cover = null;
		return () => {
			gone = true;
		};
	});

	/** the hooks each proposal adds or rewrites, not on the main line yet */
	const proposed = $derived(
		lines.slice(1).filter((l) => !l.variant).flatMap((l) =>
			/** @type {any[]} */ (l.record?.hooks ?? [])
				.filter((h) => !rows.some((r) => r.id === h.id && r.text === h.text))
				.map((h) => ({ ...h, proposal: l.name ?? 'a proposal' }))
		)
	);

	// YouTube's limits (the delivery skill): a title 1 to 100 letters, cut in most lists past ~60; a description up to
	// 5,000 bytes
	const hookLen = $derived((chosen?.text ?? '').length);
	const descBytes = $derived(new TextEncoder().encode(record.description ?? '').length);
	/** what YouTube shows of the description before “more”: its first lines */
	const descLines = $derived(String(record.description ?? '').trim().split('\n'));
	const firstLines = $derived(descLines.slice(0, 2).join('\n'));
	const moreLines = $derived(descLines.length > 2);

	/** whether the acting vault's ops let it change the hooks, as the device says */
	let changes = $state(false);
	$effect(() => {
		void world;
		let gone = false;
		const probe = { op: 'insert', entry, path: ['hooks'], value: { id: newId(rows), text: '' } };
		if (writes) may(api, actor, [probe]).then(([a]) => !gone && (changes = allowed(a)));
		else changes = false;
		return () => {
			gone = true;
		};
	});
	const edits = $derived(changes && !busy);

	/** Runs change `op` on its main line as `what`. @param {string} what @param {object} op */
	const change = (what, op) => api.run(what, { ...op, entry, as: actor });
	/** Runs the changes `ops` in one write as `what`. @param {string} what @param {object[]} ops */
	const changeAll = (what, ops) => api.run(what, { op: 'batch', as: actor, ops: ops.map((o) => ({ ...o, entry })) });

	/** Sets field `field` of the story to `value`, where it changed; an empty text clears it. @param {string} field
	 *  @param {any} value */
	function put(field, value) {
		const had = record[field];
		if (JSON.stringify(had ?? '') === JSON.stringify(value)) return;
		return change(`Changing its ${field.replace('_', ' ')}`, { op: 'set', path: [field], value });
	}

	/** Sets field `field` of hook `h` to `value`, where it changed. @param {any} h @param {string} field @param {any} value */
	function putHook(h, field, value) {
		if (JSON.stringify(h[field] ?? '') === JSON.stringify(value)) return;
		const empty = value === '' || (Array.isArray(value) && !value.length);
		if (empty && h[field] === undefined) return;
		return change('Changing the hook', empty ? { op: 'unset', path: ['hooks', { id: h.id }, field] } : { op: 'set', path: ['hooks', { id: h.id }, field], value });
	}

	/** the hook open in the list, its parts shown (the one on the card until another is opened, none at -1); the one
	 *  being edited */
	let openId = $state(/** @type {number | null} */ (null));
	let editId = $state(/** @type {number | null} */ (null));
	const open = $derived(openId === -1 ? null : (rows.find((h) => h.id === openId) ?? chosen));

	/** Puts hook `h` on the card: its line the title, its image title the card's where it has one, else the hook's own
	 *  words, where the card's were the last hook's. @param {any} h */
	function choose(h) {
		if (!edits || !h.text?.trim() || chosen?.id === h.id) return;
		const theirs = JSON.stringify(record.image_title ?? []) === JSON.stringify(chosen?.image_title ?? []);
		changeAll('Putting the hook on the card', [
			{ op: 'set', path: ['hook'], value: h.id },
			...(h.image_title?.length
				? [{ op: 'set', path: ['image_title'], value: h.image_title }]
				: theirs && record.image_title?.length
					? [{ op: 'set', path: ['image_title'], value: [] }]
					: [])
		]);
	}

	/** A new hook, opened to write. */
	async function add() {
		const value = { id: newId(rows), text: '', dial: 3 };
		[openId, editId] = [value.id, value.id];
		await change('Adding a hook', { op: 'insert', path: ['hooks'], value });
	}

	/** Takes hook `h` out, and off the card where it is on it. @param {any} h */
	function remove(h) {
		changeAll('Taking the hook out', [
			{ op: 'remove', path: ['hooks', { id: h.id }] },
			...(chosen?.id === h.id ? [{ op: 'unset', path: ['hook'] }] : [])
		]);
		if (editId === h.id) editId = null;
	}

	/** The hook typed in the field: the line of the one on the card, or a new hook put on it. @param {string} text */
	function retitle(text) {
		const t = text.trim();
		if (chosen) return putHook(chosen, 'text', t);
		if (!t) return;
		const value = { id: newId(rows), text: t, dial: 3 };
		changeAll('Writing the hook', [
			{ op: 'insert', path: ['hooks'], value },
			{ op: 'set', path: ['hook'], value: value.id }
		]);
	}

	/** Lines as a list, empty ones left out. @param {string} v */
	const linesOf = (v) =>
		v
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
	/** The parts hook `h` names, in the skill's order. @param {any} h */
	const named = (h) => PARTS.filter(([p]) => h[p]).map(([p, label]) => ({ p, label, text: h[p] }));
</script>

<div class="room">
<div class="hook">
	<section class="variants" aria-label="The hooks tried">
		<div class="head">
			<span>Hooks <small>{rows.length}{chosen ? ' · one on the card' : rows.length ? ' · none on the card yet' : ''}</small></span>
			{#if edits}<button class="btn" onclick={add}><Icon name="plus" size={13} /> Hook</button>{/if}
		</div>
		{#if rows.length}
			<ol class="list">
				{#each rows as h, k (h.id)}
					{@const onCard = chosen?.id === h.id}
					{@const isOpen = open?.id === h.id}
					<li class:oncard={onCard} class:open={isOpen}>
						<button class="line" aria-expanded={isOpen} onclick={() => (openId = isOpen ? -1 : h.id)}>
							<span class="n">{k + 1}</span>
							<b>{h.text || 'A new hook, not written yet'}</b>
							<span class="meta">
								{#if h.dial}
									<span class="dial" title="The extreme dial: {h.dial} {DIAL[h.dial]}">
										{#each [1, 2, 3, 4] as d (d)}<i class:lit={d <= (h.dial ?? 0)} class:false={d === 4 && h.dial === 4}></i>{/each}
										<small>{DIAL[h.dial]}</small>
									</span>
								{/if}
								{#if onCard}<em>On the card</em>{/if}
							</span>
						</button>
						{#if isOpen}
							<div class="parts">
								{#if editId === h.id && edits}
									<label class="f"><span>The line</span><textarea class="field" rows="2" maxlength="300" value={h.text ?? ''} onchange={(e) => putHook(h, 'text', e.currentTarget.value.trim())}></textarea></label>
									{#each PARTS as [p, label] (p)}
										<label class="f"><span>{label}</span><input class="field" maxlength="160" value={h[p] ?? ''} onchange={(e) => putHook(h, p, e.currentTarget.value.trim())} /></label>
									{/each}
									<label class="f"><span>Image title <small>catchwords, one per line</small></span><textarea class="field" rows="2" value={(h.image_title ?? []).join('\n')} onchange={(e) => putHook(h, 'image_title', linesOf(e.currentTarget.value))}></textarea></label>
									<label class="f"><span>Promise</span><input class="field" maxlength="300" value={h.promise ?? ''} onchange={(e) => putHook(h, 'promise', e.currentTarget.value.trim())} /></label>
									<label class="f"><span>Objection killer</span><input class="field" maxlength="300" value={h.objection ?? ''} onchange={(e) => putHook(h, 'objection', e.currentTarget.value.trim())} /></label>
									<label class="f">
										<span>Dial</span>
										<select class="field" value={String(h.dial ?? 3)} onchange={(e) => putHook(h, 'dial', Number(e.currentTarget.value))}>
											{#each [1, 2, 3, 4] as d (d)}<option value={String(d)}>{d} · {DIAL[d]}</option>{/each}
										</select>
									</label>
									<label class="f"><span>Note</span><input class="field" maxlength="200" value={h.note ?? ''} onchange={(e) => putHook(h, 'note', e.currentTarget.value.trim())} /></label>
								{:else}
									{#if named(h).length}
										<dl>
											{#each named(h) as n (n.p)}<dt>{n.label}</dt><dd>{n.text}</dd>{/each}
										</dl>
									{:else}
										<p class="soft none">No parts named yet: point at its subject, its verb and its contrast.</p>
									{/if}
									{#if h.image_title?.length}<p class="after"><b>Image title</b> {h.image_title.join(' · ')}</p>{/if}
									{#if h.promise}<p class="after"><b>Promise</b> {h.promise}</p>{/if}
									{#if h.objection}<p class="after"><b>Objection</b> {h.objection}</p>{/if}
									{#if h.note}<p class="after soft">{h.note}</p>{/if}
								{/if}
								{#if edits}
									<div class="actions">
										{#if !onCard && h.text?.trim()}<button class="btn primary" onclick={() => choose(h)}>Put it on the card</button>{/if}
										<button class="btn" onclick={() => (editId = editId === h.id ? null : h.id)}>{editId === h.id ? 'Done' : 'Edit'}</button>
										<button class="btn quiet" onclick={() => remove(h)}>Take it out</button>
									</div>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<p class="soft empty">
				No hooks tried yet. Write at least ten, from different angles, each with its parts named, then put the most
				extreme true one on the card.
			</p>
		{/if}
		{#if proposed.length}
			<h4 class="head">Proposed <small>merge the proposal on the right to keep them</small></h4>
			<ol class="list">
				{#each proposed as h (`${h.proposal}-${h.id}`)}
					<li class="proposed">
						<div class="line">
							<span class="n"><Icon name="proposal" size={12} /></span>
							<b>{h.text || 'A hook, not written yet'}</b>
							<span class="meta">in “{h.proposal}”{h.dial ? ` · ${DIAL[h.dial]}` : ''}</span>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	<section class="fields" aria-label="The hook, the intro and the description">
		<label class="f">
			<span
				>Hook <small
					>grabs attention · the title everywhere · <b class:over={hookLen > 100} class:long={hookLen > 60 && hookLen <= 100}
						>{hookLen} / 100</b
					>{chosen ? ` · hook ${rows.indexOf(chosen) + 1}` : ''}</small
				></span
			>
			<textarea
				class="field big"
				rows="2"
				maxlength="300"
				value={chosen?.text ?? ''}
				disabled={!edits}
				placeholder="One line, ~10 words, readable in a second: the most extreme true thing"
				onchange={(e) => retitle(e.currentTarget.value)}
			></textarea>
		</label>
		<label class="f">
			<span>Image title <small>the hook’s catchwords on the card · one per line · {(record.image_title ?? []).length} / 8</small></span>
			<textarea
				class="field catch"
				rows="2"
				value={(record.image_title ?? []).join('\n')}
				disabled={!edits}
				placeholder={"a '1' million lives\ndecision"}
				onchange={(e) => put('image_title', linesOf(e.currentTarget.value))}
			></textarea>
		</label>
		<label class="f">
			<span>Intro <small>the first 3 to 30 seconds: why care, what is my transformation · {(record.intro ?? '').length} / 5,000</small></span>
			<textarea
				class="field"
				rows="4"
				maxlength="5000"
				value={record.intro ?? ''}
				disabled={!edits}
				placeholder="The promise, the objection killer, the pain in the viewer’s own life, ending on the question the story answers"
				onchange={(e) => put('intro', e.currentTarget.value)}
			></textarea>
		</label>
		<label class="f">
			<span>Description <small>the overview and the detail · <b class:over={descBytes > 5000}>{descBytes} / 5,000 bytes</b></small></span>
			<textarea
				class="field"
				rows="7"
				maxlength="5000"
				value={record.description ?? ''}
				disabled={!edits}
				placeholder="What it is, in the first two lines (they show before “more”); then the links, the chapters"
				onchange={(e) => put('description', e.currentTarget.value)}
			></textarea>
		</label>
	</section>

	<aside class="yt" aria-label="How it looks on YouTube">
		<div class="frame">
			{#if cover}<img src={cover} alt="The 16:9 card" />{:else}<div class="stand-in"><b>{words}</b></div>{/if}
		</div>
		<p class="cardnote soft">{cover ? 'The 16:9 card, as rendered on the Thumbnail step.' : 'A stand-in until the 16:9 card is rendered on the Thumbnail step.'}</p>
		<h3>{title}</h3>
		<p class="chan soft">maiaCITY</p>
		{#if record.intro}<p class="intro">{record.intro}</p>{/if}
		{#if record.description}<p class="desc">{firstLines}{#if moreLines}<span class="soft"> …more</span>{/if}</p>{/if}
	</aside>
</div>
</div>

<style>
	/* it lays out by the room it has, beside the story's proposals or not */
	.room {
		container-type: inline-size;
	}

	.hook {
		display: grid;
		grid-template-columns: minmax(0, 18rem) minmax(0, 1fr);
		grid-template-areas: 'variants yt' 'variants fields';
		align-items: start;
		gap: 1.2rem 1.6rem;
		margin-top: 0.6rem;
	}

	.variants {
		grid-area: variants;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.fields {
		grid-area: fields;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.yt {
		grid-area: yt;
		max-width: 26rem;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin: 0;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.head small {
		letter-spacing: 0;
		text-transform: none;
		font-weight: 500;
	}

	.head .btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		letter-spacing: 0;
		text-transform: none;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
	}

	.list li.open {
		border-color: #b9b3a4;
	}

	.list li.oncard {
		border-color: #d9a441;
		box-shadow: 0 0 0 2px rgb(217 164 65 / 0.3);
	}

	.list li.proposed {
		border-style: dashed;
		background: #fbfaf6;
	}

	.line {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.15rem 0.6rem;
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
	}

	button.line {
		cursor: pointer;
	}

	.line .n {
		grid-row: 1 / span 2;
		color: var(--soft);
		font-size: 0.72rem;
		font-weight: 600;
		line-height: 1.6;
	}

	.line b {
		font-size: 0.95rem;
		font-weight: 600;
		line-height: 1.3;
	}

	.line .meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		color: var(--soft);
		font-size: 0.7rem;
	}

	.line em {
		color: #a06c12;
		font-style: normal;
		font-weight: 600;
	}

	.dial {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.dial i {
		width: 9px;
		height: 4px;
		border-radius: 2px;
		background: #e2ddd1;
	}

	.dial i.lit {
		background: #d9a441;
	}

	.dial i.lit.false {
		background: #c0503a;
	}

	.dial small {
		margin-left: 0.3rem;
	}

	.parts {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0 0.75rem 0.75rem;
		font-size: 0.84rem;
	}

	dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.2rem 0.6rem;
		margin: 0;
	}

	dt {
		color: var(--soft);
		font-size: 0.75rem;
	}

	dd {
		margin: 0;
	}

	.after,
	.none {
		margin: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.f {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.82rem;
		font-weight: 600;
	}

	.f small {
		color: var(--soft);
		font-weight: 400;
	}

	.f .field {
		box-sizing: border-box;
		width: 100%;
		font: inherit;
		font-weight: 400;
	}

	.f textarea.big {
		font-size: 1.15rem;
		font-weight: 600;
		line-height: 1.3;
	}

	.f textarea.catch {
		font-weight: 600;
	}

	b.long {
		color: #a06c12;
	}

	b.over {
		color: #b23a22;
	}

	.empty {
		margin: 0;
		font-size: 0.85rem;
	}

	.frame {
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: 12px;
		background: #1d2b22;
	}

	.frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.stand-in {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		height: 100%;
		box-sizing: border-box;
		padding: 7% 8%;
		background: linear-gradient(160deg, #3c5a44, #1d2b22 70%);
		color: #fdf8ec;
	}

	.stand-in b {
		display: -webkit-box;
		overflow: hidden;
		font-family: var(--font-display);
		font-size: clamp(1.1rem, 2.2vw, 1.7rem);
		line-height: 1.08;
		white-space: pre-line;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
	}

	.cardnote {
		margin: 0.35rem 0 0.7rem;
		font-size: 0.72rem;
	}

	h3 {
		display: -webkit-box;
		margin: 0;
		overflow: hidden;
		font-family: var(--font-body);
		font-size: 1.02rem;
		font-weight: 600;
		line-height: 1.35;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.chan {
		margin: 0.3rem 0 0.6rem;
		font-size: 0.82rem;
	}

	.intro {
		margin: 0 0 0.6rem;
		font-size: 0.86rem;
		line-height: 1.5;
		white-space: pre-line;
	}

	.desc {
		margin: 0;
		padding: 0.7rem 0.8rem;
		border-radius: 10px;
		background: #f2f0ea;
		font-size: 0.82rem;
		line-height: 1.5;
		white-space: pre-line;
	}

	@container (max-width: 720px) {
		.hook {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas: 'yt' 'fields' 'variants';
		}
	}
</style>
