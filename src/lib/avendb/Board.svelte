<!--
	A vault's notes and todos, as the acting vault sees them: each of the vault's spaces, its home first, with what the
	acting vault reads there, editable where it writes, and shared on where it owns; each note opens on its history and
	branches (NoteView). Everything else stays out of sight, as on a device of the acting vault alone: the device's
	world says which vault holds which role on each space and each entry (avendb-browser's `World`), and every write goes
	out acting for that vault, which the rules check against its caps.
-->
<script>
	import { untrack } from 'svelte';
	import { allows, count, nameOf, reads, ROLES } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void, onact: (vault: string) => void, onopen: (space: string, entry: string) => void }}
	 */
	let { world, vault, actor, api, busy, onaccess, onact, onopen } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const spaces = $derived(world.spaces.filter((s) => s.founder === vault));
	/** the vaults the acting vault may share with: every other vault this browser knows */
	const others = $derived(world.vaults.filter((v) => v.id !== actor));

	/** @type {Record<string, { title: string, body: string, todo: string }>} */
	let drafts = $state({});
	/** @type {Record<string, string>} each note's text as the person edits it */
	let edits = $state({});
	/** @type {Record<string, string>} each note's text as last shown, to tell the person's edits from what arrives */
	let shown = {};
	/** the entry whose share form is open */
	let sharing = $state('');
	let share = $state({ grantee: '', role: 'read' });

	$effect(() => {
		const now = spaces;
		untrack(() => {
			for (const s of now) {
				drafts[s.id] ??= { title: '', body: '', todo: '' };
				for (const i of s.items) {
					if (i.kind !== 'note') continue;
					// a note the person isn't editing follows what arrives
					if (edits[i.entry] === undefined || edits[i.entry] === shown[i.entry]) edits[i.entry] = i.text ?? '';
					shown[i.entry] = i.text ?? '';
				}
			}
		});
	});

	const NEXT = /** @type {const} */ ({ open: 'doing', doing: 'done', done: 'open' });
	const STATUS = /** @type {const} */ ({ open: 'Open', doing: 'Doing', done: 'Done' });

	/**
	 * The vaults that hold a role on an item or a space, the strongest first.
	 * @param {Record<string, import('./vaults.js').Role>} roles
	 */
	const holders = (roles) =>
		Object.entries(roles)
			.map(([id, role]) => ({ id, role }))
			.sort((a, b) => ['owner', 'write', 'read', 'relay'].indexOf(a.role) - ['owner', 'write', 'read', 'relay'].indexOf(b.role));

	/** @param {string} space */
	async function write(space) {
		const d = drafts[space];
		if (!d.title.trim()) return;
		if (await api.write(actor, space, d.title.trim(), d.body)) drafts[space] = { ...d, title: '', body: '' };
	}

	/** @param {string} space */
	async function todo(space) {
		const d = drafts[space];
		if (!d.todo.trim()) return;
		if (await api.todo(actor, space, d.todo.trim())) drafts[space] = { ...d, todo: '' };
	}

	/** @param {string} entry */
	function openShare(entry) {
		sharing = sharing === entry ? '' : entry;
		share = { grantee: others[0]?.id ?? '', role: 'read' };
	}

	/** @param {string} space @param {string} entry */
	async function give(space, entry) {
		if (!share.grantee) return;
		const role = share.grantee === 'public' ? 'read' : share.role;
		if (await api.grant(actor, space, entry, role, share.grantee)) sharing = '';
	}
</script>

{#snippet shareForm(/** @type {string} */ space, /** @type {string} */ entry)}
	<div class="share">
		<select class="field" bind:value={share.grantee} aria-label="Share with">
			{#each others as v (v.id)}<option value={v.id}>{nameOf(v)}</option>{/each}
			<option value="public">Everyone (public)</option>
		</select>
		{#if share.grantee !== 'public'}
			<select class="field" bind:value={share.role} aria-label="Role">
				<option value="read">reads</option>
				<option value="write">writes</option>
				<option value="owner">owns (your passkey approves)</option>
			</select>
		{/if}
		<button class="btn primary" disabled={busy || !share.grantee} onclick={() => give(space, entry)}>Share it</button>
	</div>
{/snippet}

{#each spaces as s, n (s.id)}
	{@const role = s.roles[actor]}
	{@const seen = s.items.filter((i) => reads(i, actor))}
	{@const notes = seen.filter((i) => i.kind === 'note')}
	{@const todos = seen.filter((i) => i.kind === 'todo')}
	{@const sealed = seen.filter((i) => i.kind === 'sealed')}
	{@const hidden = s.items.length - seen.length}
	<section class="space">
		<header class="space-head">
			<h2>{s.id === here?.home ? 'Home' : `Space ${n + 1}`}</h2>
			{#if role}
				<span class="chip accent">{nameOf(as)} {ROLES[role]} it</span>
			{:else if s.public}
				<span class="chip">Public: everyone reads it</span>
			{:else if seen.length}
				<span class="chip">Shared with {nameOf(as)}: {count(seen.length, 'entry', 'entries')}</span>
			{:else}
				<span class="chip warn">{nameOf(as)} holds no cap here</span>
			{/if}
		</header>

		{#if !seen.length && !role}
			<div class="empty">
				<p>
					{nameOf(as)} can't see {hidden ? `the ${count(hidden, 'entry', 'entries')}` : 'anything'} in {nameOf(here)}'s
					{s.id === here?.home ? 'home' : 'space'}: it holds no cap on it, nor on any of its entries. A vault that owns it
					can share it with {nameOf(as)}, in <button class="link" onclick={onaccess}>Access</button>.
				</p>
				{#if here?.via && vault !== actor}
					<button class="btn" onclick={() => onact(vault)}>Act as {nameOf(here)}</button>
				{/if}
			</div>
		{/if}

		{#if notes.length}
			<div class="notes">
				{#each notes as it (it.entry)}
					{@const writes = allows(it.roles[actor], 'write')}
					<article class="card note">
						<header>
							<b>{it.title}</b>
							{#if it.by}<span class="soft">by {nameOf(byId.get(it.by))}</span>{/if}
						</header>
						{#if writes}
							<textarea class="field" rows="3" bind:value={edits[it.entry]} aria-label="{it.title}'s text"></textarea>
							{#if edits[it.entry] !== it.text}
								<button class="btn primary" disabled={busy} onclick={() => api.setText(actor, s.id, it.entry, edits[it.entry])}>
									Save as {nameOf(as)}
								</button>
							{/if}
						{:else}
							<p class="text">{it.text || '…'}</p>
						{/if}
						<footer class="who">
							{#each holders(it.roles) as h (h.id)}
								<span class="chip" class:accent={h.id === actor}>{nameOf(byId.get(h.id))} {ROLES[h.role]}</span>
							{/each}
							{#if it.public}<span class="chip">everyone reads</span>{/if}
							<button class="btn quiet" onclick={() => onopen(s.id, it.entry)}>History & branches</button>
							{#if allows(it.roles[actor], 'owner')}
								<button class="btn quiet" disabled={busy} onclick={() => openShare(it.entry)}>Share</button>
							{/if}
						</footer>
						{#if sharing === it.entry}
							{@render shareForm(s.id, it.entry)}
						{/if}
					</article>
				{/each}
			</div>
		{/if}

		{#if todos.length}
			<ul class="card todos">
				{#each todos as it (it.entry)}
					{@const writes = allows(it.roles[actor], 'write')}
					<li class={it.status ?? 'open'}>
						<button
							class="tick"
							disabled={busy || !writes}
							title={writes ? `Mark it ${NEXT[it.status ?? 'open']}` : `${nameOf(as)} only reads it`}
							onclick={() => api.setStatus(actor, s.id, it.entry, NEXT[it.status ?? 'open'])}
						>
							{STATUS[it.status ?? 'open']}
						</button>
						<span class="title">{it.title}</span>
						{#if it.by}<small class="soft">by {nameOf(byId.get(it.by))}</small>{/if}
						{#if allows(it.roles[actor], 'owner')}
							<button class="btn quiet" disabled={busy} onclick={() => openShare(it.entry)}>Share</button>
						{/if}
						{#if sharing === it.entry}
							{@render shareForm(s.id, it.entry)}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#each sealed as it (it.entry)}
			<p class="soft">An entry this browser holds but can't open.</p>
		{/each}

		{#if hidden > 0 && (seen.length || role)}
			<p class="soft">{count(hidden, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
		{/if}

		{#if allows(role, 'write') && drafts[s.id]}
			<div class="card compose">
				<b>Write as {nameOf(as)}</b>
				<input class="field" placeholder="A new note’s title" bind:value={drafts[s.id].title} />
				<textarea class="field" rows="2" placeholder="What it says" bind:value={drafts[s.id].body}></textarea>
				<button class="btn primary" disabled={busy || !drafts[s.id].title.trim()} onclick={() => write(s.id)}>Write the note</button>
				<div class="row">
					<input
						class="field grow"
						placeholder="A new todo"
						bind:value={drafts[s.id].todo}
						onkeydown={(e) => e.key === 'Enter' && todo(s.id)}
					/>
					<button class="btn" disabled={busy || !drafts[s.id].todo.trim()} onclick={() => todo(s.id)}>Add the todo</button>
				</div>
			</div>
		{:else if role}
			<p class="soft">{nameOf(as)} {ROLES[role]} this space: it writes nothing new here.</p>
		{/if}
	</section>
{:else}
	<div class="empty">{nameOf(here)} has no space yet{here?.via ? ': its home comes with its name.' : '.'}</div>
{/each}

<style>
	.space {
		margin-bottom: 2rem;
	}

	.space-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.7rem;
	}

	.space-head h2 {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 600;
		font-variation-settings: normal;
		letter-spacing: 0;
	}

	.notes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
		gap: 0.8rem;
		margin-bottom: 0.9rem;
	}

	.note header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}

	.note textarea,
	.compose input,
	.compose textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin: 0.25rem 0 0.5rem;
	}

	.text {
		margin: 0.2rem 0 0.6rem;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.who {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.5rem;
	}

	.share {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.6rem;
		flex-basis: 100%;
	}

	.todos {
		margin: 0 0 0.9rem;
		padding: 0.3rem 0.9rem;
		list-style: none;
	}

	.todos li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--edge);
	}

	.todos li:last-child {
		border-bottom: 0;
	}

	.todos .title {
		flex: 1 1 10rem;
	}

	.todos li.done .title {
		color: var(--soft);
		text-decoration: line-through;
	}

	.tick {
		min-width: 4.2rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid rgb(0 0 0 / 0.15);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}

	.tick:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.doing .tick {
		border-color: #c99a3a;
		background: #efe3c8;
	}

	.done .tick {
		border-color: var(--ok);
		background: #dcebd9;
	}

	.compose {
		max-width: 38rem;
	}

	.compose .row {
		margin-top: 0.6rem;
	}

	.grow {
		flex: 1 1 12rem;
	}

	.empty p {
		margin: 0 0 0.6rem;
		line-height: 1.5;
	}

	.empty p:last-child {
		margin: 0;
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
