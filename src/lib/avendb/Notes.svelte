<!--
	A vault's notes, as a docs app lists its documents: a blank note to start, made at once and opened, then each of the
	vault's spaces, its home first, with the notes the acting vault reads there as pages, each with its edits, its
	proposals, whether it is a variant of another, and who holds a role on it; a click opens it (Note). Everything else
	stays out of sight, as on a device of the acting vault alone: the device's world says which vault holds which role
	on each space and each entry (avendb-browser's `World`), and every edit goes out acting for that vault.
-->
<script>
	import Icon from './Icon.svelte';
	import { allows, count, nameOf, reads, ROLES } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void, onact: (vault: string) => void, onopen: (entry: string) => void }}
	 */
	let { world, vault, actor, api, busy, onaccess, onact, onopen } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const spaces = $derived(world.spaces.filter((s) => s.founder === vault));
	/** the spaces of this vault the acting vault writes in: a new note goes to the one picked, the first at first */
	const writable = $derived(spaces.filter((s) => allows(s.roles[actor], 'write')));
	let into = $state('');
	const target = $derived(writable.find((s) => s.id === into) ?? writable[0]);
	/** every note this browser knows, by entry: to name the one a variant came from */
	const notes = $derived(new Map(world.spaces.flatMap((s) => s.items.filter((i) => i.kind === 'note').map((i) => [i.entry, i]))));

	/** Space `s`'s name in its vault: Home, or Space 2. @param {import('./vaults.js').SpaceView} s */
	const spaceName = (s) => (s.id === here?.home ? 'Home' : `Space ${spaces.indexOf(s) + 1}`);

	/**
	 * The vaults that hold a role on an item, the strongest first.
	 * @param {Record<string, import('./vaults.js').Role>} roles
	 */
	const holders = (roles) =>
		Object.entries(roles)
			.map(([id, role]) => ({ id, role }))
			.sort((a, b) => ['owner', 'write', 'read', 'relay'].indexOf(a.role) - ['owner', 'write', 'read', 'relay'].indexOf(b.role));

	/** A blank note in the space picked, opened at once. */
	async function blank() {
		if (!target) return;
		const made = await api.write(actor, target.id, 'Untitled note', '');
		if (made) onopen(made);
	}
</script>

{#if writable.length}
	<section class="start" aria-label="Start a new note">
		<button class="blank" disabled={busy} onclick={blank}>
			<span class="sheet"><Icon name="plus" size={34} /></span>
			<span class="label">Blank note</span>
		</button>
		<p class="soft">
			A new note, as <b>{nameOf(as)}</b>{#if writable.length > 1}, in
				<select class="field" bind:value={into} aria-label="New note in">
					{#each writable as s (s.id)}<option value={s.id}>{spaceName(s)}</option>{/each}
				</select>{:else}, in {spaceName(writable[0])}{/if}: it opens at once, to title and write.
		</p>
	</section>
{/if}

{#each spaces as s (s.id)}
	{@const role = s.roles[actor]}
	{@const seen = s.items.filter((i) => reads(i, actor))}
	{@const docs = seen.filter((i) => i.kind === 'note')}
	{@const hidden = s.items.length - seen.length}
	<section class="space">
		<header class="space-head">
			<h2>{spaceName(s)}</h2>
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
		{:else if docs.length}
			<div class="docs">
				{#each docs as it (it.entry)}
					{@const origin = it.variantOf ? notes.get(it.variantOf) : undefined}
					<a class="note" href="#notes/{it.entry}" aria-label={it.title}>
						<span class="thumb" aria-hidden="true">
							<span class="page"><b>{it.title}</b><span>{it.text}</span></span>
						</span>
						<span class="info">
							<b>{it.title}</b>
							<small class="soft">
								{count(it.edits ?? 0, 'edit')}{it.proposals ? ` · ${count(it.proposals, 'proposal')}` : ''}{it.by
									? ` · by ${nameOf(byId.get(it.by))}`
									: ''}
							</small>
							{#if it.variantOf}
								<small class="variant"><Icon name="variant" size={12} /> Variant of {origin ? `“${origin.title}”` : 'a note'}</small>
							{/if}
							<span class="who">
								{#each holders(it.roles) as h (h.id)}
									<span class="chip" class:accent={h.id === actor}>{nameOf(byId.get(h.id))} {ROLES[h.role]}</span>
								{/each}
								{#if it.public}<span class="chip">everyone reads</span>{/if}
							</span>
						</span>
					</a>
				{/each}
			</div>
		{:else}
			<p class="soft">No note here{role && allows(role, 'write') ? ' yet: start one above.' : '.'}</p>
		{/if}

		{#if hidden > 0 && (seen.length || role)}
			<p class="soft">{count(hidden, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
		{/if}
	</section>
{:else}
	<div class="empty">{nameOf(here)} has no space yet{here?.via ? ': its home comes with its name.' : '.'}</div>
{/each}

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
		flex: 1 1 14rem;
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.start select {
		margin: 0 0.2rem;
		padding: 0.15rem 0.4rem;
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

	.space {
		margin-bottom: 2rem;
	}

	.space-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.8rem;
	}

	.space-head h2 {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 600;
		font-variation-settings: normal;
		letter-spacing: 0;
	}

	/* the notes as a docs app's documents: a page's thumbnail over its title */
	.docs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 12.5rem), 1fr));
		gap: 1rem;
	}

	.note {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
		color: inherit;
		text-decoration: none;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.note:hover,
	.note:focus-visible {
		border-color: var(--accent);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.08);
	}

	.thumb {
		display: block;
		height: 9.5rem;
		overflow: hidden;
		padding: 0.9rem 1.1rem 0;
		border-bottom: 1px solid var(--edge);
		background: #f1efe9;
	}

	.page {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		height: 100%;
		padding: 0.8rem 0.85rem;
		box-sizing: border-box;
		background: #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
		font-size: 0.56rem;
		line-height: 1.45;
		overflow: hidden;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.page b {
		font-size: 0.72rem;
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.6rem 0.75rem 0.7rem;
		min-width: 0;
	}

	.info > b {
		overflow: hidden;
		font-size: 0.9rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.info small {
		font-size: 0.74rem;
	}

	.variant {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: #6a4b9a;
	}

	.who {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.3rem;
	}

	.who .chip {
		font-size: 0.66rem;
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
