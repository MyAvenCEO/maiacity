<!--
	The one version-control side of avenDB (Samuel 2026-10-18: "the same DRY avenDB version control aside as on all
	other systems", a note's its model, ./Note.svelte): an entry's lines and history as the device's `note` op reads
	them (avendb's `data::note`), for any entry, in the right side of ./Frame.svelte. Its tabs:

	  History   the edits of the line shown, newest first: what each did, its number, the version it is where it is a
	            release, and who made it (who stands behind it, link by link back to the passkeys, a tap away)
	  Versions  its lines: main, the proposals still open (those merged are main's versions now), the variants beside
	            main; under each line what it holds, where the view names it (`versionsOf`: an asset's versions)

	and any tabs of the view's own beside them (`tabs`: an asset's parts). It reads and shows; picking a line
	(`onpick`), an edit's version (`hrefOf`, or `onopen` where the view shows it in place, as a note does) and what an
	edit is in the view's own words (`said`) are the view's, and so is what it does with them: what it says of a line
	(`about`: a note's "differs from main", a story's title there), what goes beside a line (`lineEnd`: a story's
	Merge), under each section of lines (`adding`: a note's New proposal and New variant), under each edit (`below`:
	its words changed, Restore, Undo) and under the history (`after`: the history a note's copy goes on into).
-->
<script>
	import Icon from './Icon.svelte';
	import { actingWords, authorsLine, chainSteps, count, hue, short } from './vaults.js';
	import { editWords, lineName, versionWords } from './versions.js';

	/** @typedef {import('svelte').ComponentProps<typeof Icon>['name']} IconName */
	/**
	 * @typedef {{ line: string | null, name: string | null, heads: string[], history: string[], variant?: boolean,
	 *   version?: import('./versions.js').Described, main?: import('./versions.js').Described | null,
	 *   behind?: boolean }} LineView a line of the entry, as the `note` op reads it
	 * @typedef {{ id: string, author: string, actor: string, via: string[], chain: import('./vaults.js').Chain,
	 *   line: string | null, deps: string[], kind: 'edit' | 'propose' | 'variant' | 'merge' | 'accept' | 'sealed',
	 *   name: string | null, from: { line: string | null, name: string | null } | null, counted: boolean,
	 *   version?: number | null, authors?: { vault: string, name: string | null, kind: string | null }[] | null }} EditView
	 *   an edit of the entry, as the `note` op reads it: `authors` who a release is by
	 * @typedef {EditView & { n: number }} Numbered
	 * @typedef {{ key: string, label: string, href: string, on?: boolean, note?: string }} Held what a line holds
	 *   that the view shows one of, to pick: its label, where it is shown, whether it is the one shown
	 * @typedef {{ id: string, label: string, icon: IconName, count?: number, body: import('svelte').Snippet }} Tab
	 */

	/**
	 * @type {{ world: import('./vaults.js').WorldView, note: { lines: LineView[], edits: EditView[] } | null,
	 *   line?: string | null, at?: string, tab?: string, thing?: string, tabs?: Tab[],
	 *   versionsOf?: (l: LineView) => Held[], hrefOf?: (e: Numbered) => string | undefined,
	 *   said?: (e: Numbered) => string | undefined, onpick?: (line: string | null) => void,
	 *   onopen?: (e: Numbered) => void, opens?: (e: Numbered) => boolean, about?: (l: LineView) => string | undefined,
	 *   also?: number, versions?: import('svelte').Snippet, lineEnd?: import('svelte').Snippet<[LineView]>,
	 *   adding?: import('svelte').Snippet<['propose' | 'variant']>, below?: import('svelte').Snippet<[Numbered]>,
	 *   after?: import('svelte').Snippet }}
	 *   `note` what the `note` op read of the entry, `line` the line shown (null for main), `at` the edit shown, `tab`
	 *   the tab open, `thing` what the entry is called in a sentence ("Wrote it"), `versions` what goes under its lines
	 *   and `also` how many it holds, counted on the Versions tab; `onopen` shows an edit's version in the view, where
	 *   `opens` lets it (an edit this browser can't open never does); `about` the view's words for a line in place of
	 *   avenDB's, before its edits
	 */
	let {
		world,
		note,
		line = null,
		at = '',
		tab = $bindable('history'),
		thing = 'it',
		tabs = [],
		versionsOf,
		hrefOf,
		said,
		onpick,
		onopen,
		opens = () => true,
		about,
		also = 0,
		versions,
		lineEnd,
		adding,
		below,
		after
	} = $props();

	const lines = $derived(note?.lines ?? []);
	const main = $derived(lines[0]);
	const here = $derived(lines.find((l) => l.line === line) ?? main);
	/** what main's history holds: a proposal whose heads it holds is merged, a version of main now */
	const onMain = $derived(new Set(main?.history ?? []));
	const merged = (/** @type {LineView} */ l) => l.heads.length > 0 && l.heads.every((h) => onMain.has(h));
	const proposals = $derived(lines.slice(1).filter((l) => !l.variant));
	const open = $derived(proposals.filter((l) => !merged(l)));
	const breeds = $derived(lines.slice(1).filter((l) => l.variant));
	/** every edit its readers count, numbered in the order the device took them */
	const numbered = $derived((note?.edits ?? []).filter((e) => e.counted !== false).map((e, i) => ({ ...e, n: i + 1 })));
	/** the line's edits, newest first */
	const history = $derived.by(() => {
		const on = new Set(here?.history ?? []);
		return numbered.filter((e) => on.has(e.id)).reverse();
	});
	const extra = $derived(tabs.find((t) => t.id === tab));
	/** the edit whose chain of signers is shown */
	let opened = $state('');

	/** Line `l` of the entry. @param {string | null} l @returns {{ line: string | null, name: string | null, variant?: boolean }} */
	const lineOf = (l) => lines.find((x) => x.line === l) ?? { line: l, name: null };
	/** Line `l` quoted, as a sentence names it. @param {string | null} l */
	const quoted = (l) => `“${lineName(lineOf(l))}”`;
	/** Who made edit `e`: its device by name, the vault it acted for and the owners it acted through. @param {Numbered} e */
	const who = (e) => actingWords(world, e.author, e.actor, e.via);

	/** What edit `e` did, in the view's words where it has them, else avenDB's. @param {Numbered} e */
	const what = (e) => said?.(e) || editWords(e, lines, here?.line, thing);
</script>

<!-- a line, to pick where the view picks lines, else leading to the first of what it holds; beside it what the view
	puts there, and under it what it holds -->
{#snippet row(/** @type {LineView} */ l, /** @type {string} */ name, /** @type {string} */ sub)}
	{#if lineEnd}
		<div class="beside">{@render lineItself(l, name, sub)}{@render lineEnd(l)}</div>
	{:else}
		{@render lineItself(l, name, sub)}
	{/if}
	{@const held = versionsOf?.(l) ?? []}
	{#if held.length}
		<ol class="held" aria-label="What {lineName(l)} holds">
			{#each held as h (h.key)}
				<li>
					<a class="pick" class:on={h.on} href={h.href} aria-current={h.on ? 'page' : undefined}>{h.label}</a>
					{#if h.note}<small class="soft">{h.note}</small>{/if}
				</li>
			{/each}
		</ol>
	{/if}
{/snippet}

<!-- an edit as its history names it: what it did, its number, and its version where it is a release of its line -->
{#snippet edit(/** @type {Numbered} */ e)}
	<b>{what(e)}</b>
	<span class="n mono">#{e.n}</span>
	{#if e.version && (e.line === null || lineOf(e.line).variant)}<span
			class="release chip"
			title="Version {e.version} of {quoted(e.line)}, by {authorsLine(world, e.authors, 'whoever wrote it')}">v{e.version}</span
		>{/if}
{/snippet}

<!-- the line itself: a button, a link or a row -->
{#snippet lineItself(/** @type {LineView} */ l, /** @type {string} */ name, /** @type {string} */ sub)}
	{@const on = l.line === here?.line}
	{@const to = onpick ? undefined : versionsOf?.(l)[0]?.href}
	{#if onpick}
		<button class="line" class:on style:--hue={hue(l.line ?? '')} aria-current={on ? 'true' : undefined} onclick={() => onpick(l.line)}>
			<i class="dot" class:main={l.line === null}></i>
			<span><b>{name}</b><small>{sub}</small></span>
		</button>
	{:else if to}
		<a class="line" class:on style:--hue={hue(l.line ?? '')} aria-current={on ? 'true' : undefined} href={to}>
			<i class="dot" class:main={l.line === null}></i>
			<span><b>{name}</b><small>{sub}</small></span>
		</a>
	{:else}
		<div class="line" class:on style:--hue={hue(l.line ?? '')}>
			<i class="dot" class:main={l.line === null}></i>
			<span><b>{name}</b><small>{sub}</small></span>
		</div>
	{/if}
{/snippet}

<div class="lines-side">
	<div class="sides" role="tablist" aria-label="What the side shows">
		<button role="tab" class="side" class:on={tab === 'history'} aria-selected={tab === 'history'} onclick={() => (tab = 'history')}
			><Icon name="history" size={14} /> History</button
		>
		<button role="tab" class="side" class:on={tab === 'versions'} aria-selected={tab === 'versions'} onclick={() => (tab = 'versions')}
			><Icon name="proposal" size={14} /> Versions <small>{open.length + breeds.length + also || ''}</small></button
		>
		{#each tabs as t (t.id)}
			<button role="tab" class="side" class:on={tab === t.id} aria-selected={tab === t.id} onclick={() => (tab = t.id)}
				><Icon name={t.icon} size={14} /> {t.label} <small>{t.count || ''}</small></button
			>
		{/each}
	</div>

	{#if extra}
		{@render extra.body()}
	{:else if !note}
		<p class="hint soft">Reading its history…</p>
	{:else if tab === 'versions'}
		<div class="lines">
			<section>
				<h4>Main</h4>
				{@render row(main, 'Main', `${main.version ? `${versionWords(main.version)} · ` : ''}${count(main.history.length, 'edit')}`)}
			</section>

			<section>
				<h4>Proposals <small>{open.length || ''}</small></h4>
				{#each open as l (l.line)}
					{@render row(l, lineName(l), `${about?.(l) ?? 'open, not merged yet'} · ${count(l.history.length, 'edit')}`)}
				{:else}
					<p class="hint soft">
						None open.{proposals.length
							? ` ${count(proposals.length, 'proposal')} merged into main, each a version of it now.`
							: ' A proposal is a line of its own, to change apart from main and then merge into it.'}
					</p>
				{/each}
				{@render adding?.('propose')}
			</section>

			<section>
				<h4>Variants <small>{breeds.length || ''}</small></h4>
				{#each breeds as l (l.line)}
					{@render row(
						l,
						`${lineName(l)}${l.version?.version ? ` v${l.version.version}` : ''}`,
						`${about?.(l) ?? (l.behind ? 'main has changed since' : `holds main ${l.main ? versionWords(l.main) : ''}`)} · ${count(l.history.length, 'edit')}`
					)}
				{:else}
					<p class="hint soft">
						None. A variant is a line that stays beside main, as breeds of one animal do: each merge into main comes into
						it, and it keeps its own where both changed one place.
					</p>
				{/each}
				{@render adding?.('variant')}
			</section>

			{#if versions}<section>{@render versions()}</section>{/if}
		</div>
	{:else}
		<div class="history">
			<header>
				<h4>History</h4>
				<small class="soft">{count(history.length, 'edit')} of {quoted(here?.line ?? null)}, newest first</small>
			</header>
			<ol>
				{#each history as e (e.id)}
					{@const to = hrefOf?.(e)}
					<li class={e.kind} class:on={e.id === at}>
						{#if to}
							<a class="what" href={to} aria-current={e.id === at ? 'page' : undefined}>{@render edit(e)}</a>
						{:else if onopen}
							<button
								class="what"
								disabled={e.kind === 'sealed' || !opens(e)}
								aria-pressed={e.id === at}
								onclick={() => onopen(e)}>{@render edit(e)}</button
							>
						{:else}
							<span class="what">{@render edit(e)}</span>
						{/if}
						<small class="soft"
							>{#if e.version && e.authors?.length}By {authorsLine(world, e.authors)} · {/if}<button class="who" aria-expanded={opened === e.id} onclick={() => (opened = opened === e.id ? '' : e.id)}>{who(e)}</button> ·
							<span class="mono" title={e.id}>{short(e.id)}</span></small
						>
						{@render below?.(e)}
						{#if opened === e.id}
							<ol class="chain" aria-label="Who stands behind it">
								{#each chainSteps(world, e.chain) as step, i (i)}<li>{step.says}</li>{/each}
							</ol>
						{/if}
					</li>
				{/each}
			</ol>
			{@render after?.()}
		</div>
	{/if}
</div>

<style>
	/* the side's tabs: the history, the lines, and the view's own */
	.sides {
		display: flex;
		gap: 0.25rem;
		margin: 0 0 0.8rem;
		padding: 0.2rem;
		border-radius: 10px;
		background: rgb(0 0 0 / 0.05);
	}

	.side {
		display: inline-flex;
		flex: 1 1 0;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-width: 0;
		padding: 0.35rem 0.4rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--soft);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}

	.side.on {
		background: #fff;
		color: inherit;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
	}

	.side small {
		font-weight: 500;
		opacity: 0.7;
	}

	h4 {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin: 0 0 0.45rem 0.35rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.lines section + section {
		margin-top: 1.3rem;
	}

	.line {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		box-sizing: border-box;
		width: 100%;
		margin-bottom: 0.15rem;
		padding: 0.45rem 0.55rem;
		border: 0;
		border-radius: 8px;
		background: none;
		font: inherit;
		text-align: left;
		text-decoration: none;
		color: inherit;
	}

	button.line,
	a.line {
		cursor: pointer;
	}

	button.line:hover,
	a.line:hover {
		background: rgb(0 0 0 / 0.05);
	}

	.line.on {
		background: #fff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
	}

	.line span {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.line b {
		overflow-wrap: anywhere;
		font-size: 0.88rem;
	}

	.line small {
		color: var(--soft);
		font-size: 0.72rem;
	}

	.dot {
		flex: none;
		width: 0.62rem;
		height: 0.62rem;
		margin-top: 0.3rem;
		border-radius: 50%;
		background: hsl(var(--hue, 170) 45% 45%);
	}

	.dot.main {
		background: var(--accent);
	}

	/* a line with what the view puts beside it */
	.beside {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.beside > .line {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* what a line holds, newest first, each to pick */
	.held {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0.1rem 0 0.5rem 0.83rem;
		padding: 0.15rem 0 0.15rem 0.9rem;
		border-left: 2px solid rgb(0 0 0 / 0.08);
		list-style: none;
	}

	.held li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
	}

	.held small {
		font-size: 0.72rem;
	}

	.pick {
		padding: 0.14rem 0.6rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
		font-size: 0.76rem;
		font-variant-numeric: tabular-nums;
		color: inherit;
		text-decoration: none;
	}

	.pick:hover {
		background: #fff;
	}

	.pick.on {
		border-color: #1f2a23;
		background: #1f2a23;
		color: #fff;
	}

	.hint {
		margin: 0.3rem 0.35rem 0.5rem;
		font-size: 0.76rem;
		line-height: 1.45;
	}

	/* the line's history */
	.history header {
		margin: 0 0 0.8rem 0.35rem;
	}

	.history header h4 {
		margin: 0 0 0.15rem;
	}

	.history header small {
		font-size: 0.74rem;
	}

	.history ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.history li {
		position: relative;
		margin-left: 0.4rem;
		padding: 0.1rem 0 0.85rem 1.1rem;
		border-left: 2px solid rgb(0 0 0 / 0.12);
		font-size: 0.84rem;
	}

	.history li::before {
		position: absolute;
		top: 0.4rem;
		left: -0.42rem;
		width: 0.62rem;
		height: 0.62rem;
		border: 2px solid #f7f4ee;
		border-radius: 50%;
		background: var(--accent);
		content: '';
	}

	.history li.propose::before,
	.history li.variant::before {
		background: #8a6bb8;
	}

	.history li.merge::before {
		background: #c99a3a;
	}

	.history li.sealed::before {
		background: rgb(0 0 0 / 0.3);
	}

	.history li.on {
		border-radius: 0 10px 10px 0;
		background: #fff;
	}

	.what {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.15rem 0.3rem 0.1rem 0;
		color: inherit;
		text-decoration: none;
	}

	button.what {
		width: 100%;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	button.what:disabled {
		cursor: default;
	}

	a.what:hover b,
	button.what:hover:not(:disabled) b {
		color: var(--accent);
	}

	.n {
		color: var(--soft);
	}

	/* a release of its line: each merge into main is its next version */
	.release {
		margin-left: 0.3rem;
		font-size: 0.68rem;
		font-weight: 700;
	}

	.history small {
		display: block;
		font-size: 0.72rem;
	}

	.who {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		text-decoration: underline dotted;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	/* who stands behind the edit, link by link back to the passkeys */
	.history ol.chain {
		margin: 0.35rem 0 0;
		padding-left: 1.1rem;
		list-style: decimal;
		color: var(--soft);
		font-size: 0.76rem;
	}

	.history ol.chain li {
		margin: 0;
		padding: 0.08rem 0;
		border: 0;
		font-size: inherit;
	}

	.history ol.chain li::before {
		content: none;
	}
</style>
