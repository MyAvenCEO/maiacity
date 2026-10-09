<!--
	One note's history, as a docs app shows a document's: its lines, the main line and each branch, to switch between;
	the note on the line picked, to edit there, with what a branch changes against the main line; and every write of
	that line, newest first, each with what it changed, word by word, who made it, and the version it made, to view,
	restore, undo or branch from. A branch merges into the main line, makes the main line match it, or takes in what
	the main line has since; any line forks into a new note, with none of its history. All of it acts for the acting
	vault, whose caps the device checks as any peer does: a note it only reads, it reads, every version of it.
-->
<script>
	import { untrack } from 'svelte';
	import { diff } from './diff.js';
	import { allows, count, hue, nameOf, short } from './vaults.js';

	/**
	 * @typedef {{ line: string | null, name: string | null, from: string[] | null, heads: string[], history: string[],
	 *   title: string | null, text: string | null }} LineView
	 * @typedef {{ op: string, author: string, actor: string, line: string | null, deps: string[],
	 *   kind: 'edit' | 'branch' | 'merge' | 'promote' | 'sealed', name: string | null,
	 *   from: { line: string | null, name: string | null } | null, title: string | null, text: string | null,
	 *   before: string | null }} CommitView
	 * @typedef {CommitView & { n: number }} Numbered
	 * @typedef {{ space: string, entry: string, lines: LineView[], commits: CommitView[] }} Note
	 */

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, space: string,
	 *   entry: string, onclose: () => void, onopen: (space: string, entry: string) => void }}
	 */
	let { world, actor, api, busy, space, entry, onclose, onopen } = $props();

	let note = $state(/** @type {Note | null} */ (null));
	let loaded = $state(false);
	/** the line picked: `null` for the main line, else the id of its branch's first write */
	let line = $state(/** @type {string | null} */ (null));
	/** the write whose version shows, read-only: '' for the line's latest */
	let viewing = $state('');
	/** each line's text as the person edits it, and as last shown, by line ('' for the main line) */
	let edits = $state(/** @type {Record<string, string>} */ ({}));
	/** @type {Record<string, string>} */
	let shown = {};
	/** a new branch being named: the version it starts from, that version in words, and its name */
	let naming = $state(/** @type {{ from: string[], at: string, name: string } | null} */ (null));
	/** the space a fork goes to, and the fork made */
	let into = $state('');
	let forked = $state(/** @type {{ space: string, entry: string } | null} */ (null));

	// what the device holds changed: read the note again
	$effect(() => {
		void world;
		const [sp, e] = [space, entry];
		let gone = false;
		api.note(sp, e).then(
			(/** @type {Note | undefined} */ n) => {
				if (!gone) [note, loaded] = [n ?? null, true];
			},
			() => {
				if (!gone) loaded = true;
			}
		);
		return () => {
			gone = true;
		};
	});

	const key = (/** @type {string | null} */ l) => l ?? '';
	const lines = $derived(note?.lines ?? []);
	const here = $derived(lines.find((l) => l.line === line) ?? lines[0]);
	const main = $derived(lines[0]);
	const item = $derived(world.spaces.find((s) => s.id === space)?.items.find((i) => i.entry === entry));
	const writes = $derived(allows(item?.roles[actor], 'write'));
	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const as = $derived(byId.get(actor));
	/** the devices this browser knows, by id: their name and their vault */
	const devices = $derived(new Map(world.vaults.flatMap((v) => v.devices.map((d) => [d.id, { name: d.name, vault: v }]))));
	/** the line's writes, newest first, each numbered in the order the device took the note's writes */
	const history = $derived.by(() => {
		const on = new Set(here?.history ?? []);
		/** @type {Numbered[]} */
		const all = (note?.commits ?? []).map((c, i) => ({ ...c, n: i + 1 }));
		return all.filter((c) => on.has(c.op)).reverse();
	});
	const seen = $derived(viewing ? history.find((c) => c.op === viewing) : undefined);
	/** the line's one latest write, which restoring changes nothing */
	const latest = $derived(here?.heads.length === 1 ? here.heads[0] : '');
	/** the spaces the acting vault writes in, to fork into */
	const targets = $derived(world.spaces.filter((s) => allows(s.roles[actor], 'write')));

	$effect(() => {
		const now = lines;
		untrack(() => {
			for (const l of now) {
				const k = key(l.line);
				// a line the person isn't editing follows what arrives
				if (edits[k] === undefined || edits[k] === shown[k]) edits[k] = l.text ?? '';
				shown[k] = l.text ?? '';
			}
		});
	});

	/** A line's name, as a person reads it. @param {{ line: string | null, name: string | null } | null | undefined} l */
	const lineName = (l) => (!l ? 'a line' : l.line === null ? 'main' : (l.name ?? 'a branch this browser can’t name'));
	/** Line `l` of the note. @param {string | null} l */
	const lineOf = (l) => lines.find((x) => x.line === l) ?? { line: l, name: null };
	/** Line `l` quoted, as a sentence names it. @param {string | null} l */
	const at = (l) => `“${lineName(lineOf(l))}”`;

	/** A space by its founder: their home, or one of their spaces. @param {import('./vaults.js').SpaceView} s */
	function spaceName(s) {
		const v = byId.get(s.founder);
		return v?.home === s.id ? `${nameOf(v)}’s home` : `${nameOf(v)}’s space ${short(s.id)}`;
	}

	/** Who made write `c`: its device by name, and the vault it acted for. @param {CommitView} c */
	function who(c) {
		const d = devices.get(c.author);
		const device = d?.name ?? (d ? `A device of ${nameOf(d.vault)}` : 'A device this browser doesn’t know');
		return `${device}, for ${nameOf(byId.get(c.actor))}`;
	}

	/** What write `c` did, in words. @param {CommitView} c */
	function what(c) {
		const elsewhere = c.line !== here?.line ? ` on ${at(c.line)}` : '';
		switch (c.kind) {
			case 'branch':
				return `Started the branch “${c.name ?? '…'}”${c.from ? ` from ${at(c.from.line)}` : ''}`;
			case 'merge':
				return `Merged ${at(c.from?.line ?? null)} into ${at(c.line)}`;
			case 'promote':
				return `Made ${at(c.line)} match ${at(c.from?.line ?? null)}`;
			case 'sealed':
				return `A write this browser can’t open${elsewhere}`;
			default:
				return c.deps.length ? `Edited${elsewhere}` : `Wrote the note${elsewhere}`;
		}
	}

	/** Name a new branch from version `from`, `words` saying which. @param {string[]} from @param {string} words */
	function branchFrom(from, words) {
		naming = { from, at: words, name: '' };
	}

	async function startBranch() {
		const name = naming?.name.trim();
		if (!naming || !name) return;
		const made = await api.branch(actor, space, entry, naming.from, name);
		if (made) [line, viewing, naming] = [made, '', null];
	}

	async function save() {
		if (!here) return;
		await api.setTextOn(actor, space, entry, here.line, edits[key(here.line)]);
	}

	/**
	 * Merge line `from` into line `to`, then show `to`; with `promote`, `to` then shows exactly what `from` does.
	 * @param {string | null} from @param {string | null} to @param {boolean} promote
	 */
	async function merge(from, to, promote) {
		if (await api.merge(actor, space, entry, from, to, promote)) [line, viewing] = [to, ''];
	}

	/** Put version `op` back on the line. @param {string} op */
	async function restore(op) {
		if (here && (await api.restore(actor, space, entry, here.line, [op]))) viewing = '';
	}

	/** Undo write `op` on the line, keeping every change since. @param {string} op */
	const undo = (op) => here && api.undo(actor, space, entry, here.line, op);

	async function fork() {
		const target = into || targets[0]?.id;
		if (!here || !target) return;
		const made = await api.fork(actor, space, entry, here.line, target);
		if (made) forked = { space: target, entry: made };
	}
</script>

{#snippet pieces(/** @type {import('./diff.js').Piece[]} */ ps)}
	{#each ps as p, i (i)}{#if p.kind === 'in'}<ins>{p.text}</ins>{:else if p.kind === 'out'}<del>{p.text}</del>{:else}<span
				>{p.text}</span
			>{/if}{/each}
{/snippet}

<div class="viewer">
	<button class="btn quiet back" onclick={onclose}>← Notes & todos</button>

	{#if !loaded}
		<p class="soft">Opening the note…</p>
	{:else if !note || !here}
		<div class="empty">This browser holds no write of this note.</div>
	{:else}
		<header class="head">
			<small>Note · history & branches</small>
			<h2>{main?.title ?? item?.title ?? 'A note'}</h2>
			<p class="soft">
				{count(note.commits.length, 'write')} on {count(lines.length, 'line')}. As <b>{nameOf(as)}</b>, which {writes
					? 'writes it: each change here acts for it.'
					: 'only reads it: it views every version, and changes none.'}
			</p>
		</header>

		<nav class="lines" aria-label="Lines">
			{#each lines as l (key(l.line))}
				<button
					class="line"
					class:on={l.line === here.line}
					style:--hue={l.line === null ? null : hue(l.line)}
					aria-current={l.line === here.line ? 'true' : undefined}
					onclick={() => ([line, viewing, naming] = [l.line, '', null])}
				>
					<i class="dot" class:main={l.line === null}></i>
					<b>{lineName(l)}</b>
					<small>{count(l.history.length, 'write')}</small>
				</button>
			{/each}
			{#if writes}
				<button class="btn" disabled={busy} onclick={() => branchFrom(here.heads, `the latest on ${at(here.line)}`)}>
					New branch
				</button>
			{/if}
		</nav>

		{#if naming}
			<div class="card naming">
				<label for="branch-name">New branch, from {naming.at}</label>
				<div class="row">
					<input
						id="branch-name"
						class="field grow"
						placeholder="Its name"
						bind:value={naming.name}
						onkeydown={(e) => e.key === 'Enter' && startBranch()}
					/>
					<button class="btn primary" disabled={busy || !naming.name.trim()} onclick={startBranch}>Start the branch</button>
					<button class="btn quiet" onclick={() => (naming = null)}>Cancel</button>
				</div>
			</div>
		{/if}

		{#if seen}
			<article class="card doc old">
				<header class="doc-head">
					<span class="chip warn">Version #{seen.n}, read-only</span>
					<span class="soft">as it was after: {what(seen)}</span>
				</header>
				<h3>{seen.title ?? ''}</h3>
				<p class="text">{seen.text || '…'}</p>
				{#if (seen.text ?? '') !== (here.text ?? '')}
					<p class="soft since">What {at(here.line)} has changed since:</p>
					<p class="diff">{@render pieces(diff(seen.text ?? '', here.text ?? ''))}</p>
				{/if}
				<div class="row">
					{#if writes && seen.op !== latest}
						<button class="btn primary" disabled={busy} onclick={() => restore(seen.op)}>Restore it on {at(here.line)}</button>
					{/if}
					{#if writes}
						<button class="btn" disabled={busy} onclick={() => branchFrom([seen.op], `version #${seen.n}`)}>Branch from it</button>
					{/if}
					<button class="btn quiet" onclick={() => (viewing = '')}>Back to the latest</button>
				</div>
			</article>
		{:else}
			<article class="card doc">
				<header class="doc-head">
					<span class="chip on-line" style:--hue={here.line === null ? null : hue(here.line)}>On {at(here.line)}</span>
					{#if here.line !== null && here.from}
						{@const start = history.find((c) => c.op === here.from?.[0])}
						<span class="soft">started from {start ? `version #${start.n}` : 'a version'} of {at(start?.line ?? null)}</span>
					{/if}
				</header>
				<h3>{here.title ?? ''}</h3>
				{#if writes}
					<textarea class="field" rows="5" bind:value={edits[key(here.line)]} aria-label="The note’s text on {lineName(here)}"
					></textarea>
					{#if edits[key(here.line)] !== (here.text ?? '')}
						<div class="row">
							<button class="btn primary" disabled={busy} onclick={save}>Save on {at(here.line)}</button>
							<button class="btn quiet" onclick={() => (edits[key(here.line)] = here.text ?? '')}>Discard</button>
						</div>
					{/if}
				{:else}
					<p class="text">{here.text || '…'}</p>
				{/if}
			</article>

			{#if here.line !== null}
				<section class="card against">
					<h3>Against main</h3>
					{#if (main?.text ?? '') === (here.text ?? '')}
						<p class="soft">{at(here.line)} reads the same as main.</p>
					{:else}
						<p class="diff">{@render pieces(diff(main?.text ?? '', here.text ?? ''))}</p>
					{/if}
					{#if writes}
						<div class="row">
							<button class="btn primary" disabled={busy} onclick={() => merge(here.line, null, false)}>Merge into main</button>
							<button class="btn" disabled={busy} onclick={() => merge(here.line, null, true)}>Make main match it</button>
							<button class="btn" disabled={busy} onclick={() => merge(null, here.line, false)}>Update it from main</button>
						</div>
						<p class="soft hint">
							A merge keeps the changes of both lines; making main match brings main to exactly this text. Both keep every
							write of each line.
						</p>
					{/if}
				</section>
			{/if}

			{#if targets.length}
				<section class="card fork">
					<h3>Fork</h3>
					<p class="soft">A new note with what {at(here.line)} reads now, and none of its history.</p>
					<div class="row">
						{#if targets.length > 1}
							<select class="field" bind:value={into} aria-label="Fork into">
								{#each targets as s (s.id)}<option value={s.id}>{spaceName(s)}</option>{/each}
							</select>
						{/if}
						<button class="btn" disabled={busy} onclick={fork}>
							Fork into a new note{targets.length === 1 ? ` in ${spaceName(targets[0])}` : ''}
						</button>
					</div>
					{#if forked}
						<p class="made">
							Forked: a new note, with one write.
							<button class="link" onclick={() => forked && onopen(forked.space, forked.entry)}>Open the fork</button>
						</p>
					{/if}
				</section>
			{/if}
		{/if}

		<section class="history">
			<h3>History of {at(here.line)} <small class="soft">{count(history.length, 'write')}, newest first</small></h3>
			<ol>
				{#each history as c (c.op)}
					{@const changed = c.kind === 'edit' || c.kind === 'merge' || c.kind === 'promote'}
					<li class={c.kind} class:on={c.op === viewing}>
						<div class="what">
							<span class="n mono">#{c.n}</span>
							<b>{what(c)}</b>
						</div>
						<small class="soft">{who(c)} · <span class="mono" title={c.op}>{short(c.op)}</span></small>
						{#if changed && c.text !== null}
							{#if (c.before ?? '') === c.text}
								<p class="soft diff">No change to the text.</p>
							{:else}
								<p class="diff">{@render pieces(diff(c.before ?? '', c.text))}</p>
							{/if}
						{/if}
						{#if c.kind !== 'sealed'}
							<div class="row actions">
								{#if c.text !== null}
									<button class="btn quiet" onclick={() => (viewing = c.op)}>View</button>
								{/if}
								{#if writes && c.text !== null && c.op !== latest}
									<button class="btn quiet" disabled={busy} onclick={() => restore(c.op)}>Restore</button>
								{/if}
								{#if writes && (c.kind === 'edit' || c.kind === 'promote') && c.deps.length}
									<button class="btn quiet" disabled={busy} onclick={() => undo(c.op)}>Undo</button>
								{/if}
								{#if writes}
									<button class="btn quiet" disabled={busy} onclick={() => branchFrom([c.op], `version #${c.n}`)}>
										Branch from here
									</button>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}
</div>

<style>
	.viewer {
		max-width: 54rem;
	}

	.back {
		margin: 0 0 0.6rem -0.6rem;
	}

	.head small {
		color: var(--accent);
		font-size: 0.72rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.head h2 {
		margin: 0.15rem 0 0.25rem;
		font-size: 1.5rem;
		overflow-wrap: anywhere;
	}

	.head p {
		margin: 0 0 1rem;
		font-size: 0.88rem;
	}

	.lines {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.9rem;
	}

	.line {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.32rem 0.75rem 0.32rem 0.55rem;
		border: 1px solid rgb(0 0 0 / 0.14);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.84rem;
		color: inherit;
		cursor: pointer;
	}

	.line small {
		color: var(--soft);
		font-size: 0.72rem;
	}

	.line.on {
		border-color: #1f2a23;
		box-shadow: inset 0 0 0 1px #1f2a23;
	}

	.dot {
		width: 0.62rem;
		height: 0.62rem;
		border-radius: 50%;
		background: hsl(var(--hue, 170) 45% 45%);
	}

	.dot.main {
		background: var(--accent);
	}

	.on-line {
		background: hsl(var(--hue, 170) 40% 90%);
		color: hsl(var(--hue, 170) 45% 25%);
	}

	.naming label {
		display: block;
		margin-bottom: 0.4rem;
		font-size: 0.86rem;
		font-weight: 600;
	}

	.card + .card,
	.naming,
	.doc,
	.history {
		margin-bottom: 0.9rem;
	}

	.doc-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
	}

	.doc h3,
	.against h3,
	.fork h3 {
		margin: 0.6rem 0 0.4rem;
	}

	.doc textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin: 0.2rem 0 0.5rem;
		line-height: 1.5;
	}

	.old {
		border-color: #c99a3a;
		background: #fffaf0;
	}

	.text {
		margin: 0.2rem 0 0.7rem;
		line-height: 1.55;
		white-space: pre-wrap;
	}

	.since {
		margin: 0 0 0.2rem;
		font-size: 0.8rem;
	}

	.diff {
		margin: 0.35rem 0 0.5rem;
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.diff ins {
		border-radius: 3px;
		background: #d4ecd0;
		color: #1f4d2a;
		text-decoration: none;
	}

	.diff del {
		border-radius: 3px;
		background: #f6dcd3;
		color: #7a2f1c;
	}

	.fork > p {
		margin: 0 0 0.6rem;
		font-size: 0.88rem;
	}

	.hint {
		margin: 0.5rem 0 0;
		font-size: 0.8rem;
		line-height: 1.45;
	}

	.made {
		margin: 0.6rem 0 0;
		font-size: 0.88rem;
	}

	.grow {
		flex: 1 1 12rem;
	}

	.history h3 {
		margin: 1.4rem 0 0.6rem;
	}

	.history h3 small {
		font-weight: 400;
		font-size: 0.8rem;
	}

	.history ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.history li {
		position: relative;
		margin-left: 0.4rem;
		padding: 0.15rem 0 0.9rem 1.2rem;
		border-left: 2px solid rgb(0 0 0 / 0.12);
	}

	.history li::before {
		position: absolute;
		top: 0.35rem;
		left: -0.42rem;
		width: 0.62rem;
		height: 0.62rem;
		border: 2px solid #f4f1eb;
		border-radius: 50%;
		background: var(--accent);
		content: '';
	}

	.history li.branch::before {
		background: #8a6bb8;
	}

	.history li.merge::before,
	.history li.promote::before {
		background: #c99a3a;
	}

	.history li.sealed::before {
		background: rgb(0 0 0 / 0.3);
	}

	.history li.on {
		background: linear-gradient(90deg, #fffaf0, transparent);
	}

	.what {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.45rem;
	}

	.n {
		color: var(--soft);
	}

	.actions {
		margin-top: 0.15rem;
	}

	.actions .btn {
		padding: 0.18rem 0.55rem;
		font-size: 0.78rem;
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
