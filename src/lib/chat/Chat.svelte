<!--
	Chat (/app/chat/), in the layout every avenDB view has (../avendb/Frame.svelte): on the left the rooms the person
	reads, by kind (channels, groups, direct messages, notes to self), each with how many messages are new on this
	device, and the buttons that start one; in the middle the open room's timeline, a day divider where the day changes
	and a person's run of messages under one name, then the composer; on the right the open thread, or the room's
	details: its topic, everyone who reads it (Samuel 2026-10-19: show readers, the aven and its server among them where
	they do), and for the room's vault, adding people.

	A DM, a group and a note to self live in the person's own vault; a channel in a coop they act for. Every change is
	one op the device runs and judges ($lib/chat/rooms.js); a member changes only the messages and reactions it added,
	as every reader of the room decides from its history (avendb/docs/ARCHITECTURE.md §8, "Rooms").
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount, tick, untrack } from 'svelte';
	import Frame from '$lib/avendb/Frame.svelte';
	import Icon from '$lib/avendb/Icon.svelte';
	import { session } from '$lib/avendb/session.svelte.js';
	import { KINDS, nameOf } from '$lib/avendb/vaults.js';
	import Composer from './Composer.svelte';
	import Message from './Message.svelte';
	import * as R from './rooms.js';
	import { entryDetail } from '$lib/avendb/entry-detail.svelte.js';
	import { entryCollection } from '$lib/avendb/entry-collection.svelte.js';

	/** the device the view reads and changes through: the tab's (../avendb/session.svelte.js), or one a test gives */
	let { api = session } = $props();

	const world = $derived(api.world);
	const byId = $derived(new Map((world?.vaults ?? []).map((v) => [v.id, v])));
	// Discovery is an authorized local query, independent of the broad world summary.
	// The page bounds rows/demand; the core query may still scan/materialize before limiting.
	let offset = $state(0);
	const discovery = entryDetail(() => api, () => ({ op: 'query', where: { type: ['room'] },
		select: [], order: [['created', 'desc']], offset, limit: 50 }));

	const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
	let open = $state(q.get('room') ?? '');
	let side = $state('');
	const ids = $derived(JSON.stringify([...new Set([
		...(discovery.value?.rows ?? []).map(r => r.entry), ...(open ? [open] : [])
	])].sort()));
	const metadata = entryCollection(() => api, () => ({ op: 'entry_views', entries: JSON.parse(ids), types: ['room'] }));
	const rooms = $derived(R.roomsOf({ entries: metadata.rows }));

	/** each room's head, its record with its last message, and how many it holds: `{ [entry]: answer }`, `null` where
	 *  the read was refused; a room not in it is still being read. Each head shows as it comes. Replacing the selected page or API closes the old observers
	 *  and clears their results; a refusal clears that head. */
	let heads = $state({});
	$effect(() => {
		const owner = api, entries = JSON.parse(ids);
		heads = {};
		const stop = entries.map(entry => owner.observe(() => ({ op: 'room', entry, last: 1 }),
			a => heads = { ...heads, [entry]: a?.ok ?? null },
			() => heads = { ...heads, [entry]: null }));
		return () => stop.forEach(close => close());
	});
	/** Room `r`'s record from its targeted head, else its canonical scoped metadata. */
	const recordOf = (r) => heads[r.entry]?.room ?? r.record ?? null;
	// Absence on a paginated sidebar does not prove that a note to self does not exist.
	const selfRoom = entryDetail(() => api, () => world?.mine ? { op: 'query', vault: world.mine,
		where: { all: [{ type: ['room'] }, { path: ['look'], eq: 'self' }, { not: { tag: R.GONE } }] },
		select: [], limit: 1 } : null);
	const known = $derived(!!world?.mine && selfRoom.phase === 'ready' && !!selfRoom.value);
	let seen = $state(R.seenAll());
	const unread = (entry) => Math.max(0, (heads[entry]?.count ?? 0) - (seen[entry] ?? 0));

	const groups = $derived.by(() => {
		const by = { channel: [], group: [], dm: [], self: [], opening: [] };
		for (const r of rooms) (by[recordOf(r)?.look] ?? by.opening).push(r);
		return by;
	});

	// the open room
	const here = $derived(rooms.find((r) => r.entry === open) ?? null);
	const actor = $derived(here ? R.actorIn(world, here.vault) : world?.mine);
	const owner = $derived(!!here && actor === here.vault);
	let shown = $state(50);
	let read = $state(null);
	let why = $state('');
	// The shared avenDB subscription reads this view directly from accepted local
	// state. Full-world rendering and peer catch-up are independent.
	$effect(() => api.observe(() => here?.entry ? { op: 'room', entry: open, last: shown } : null,
		(answer) => {
			read = answer?.ok ?? null;
			why = answer?.ok ? '' : (answer?.why ?? 'This room doesn’t open on this device yet.');
		}, (error) => { why = error.message; }));
	$effect(() => { if (!here) read = null; });
	const record = $derived(read?.entry === open ? read.room : null);
	const messages = $derived(record?.messages ?? []);
	const lines = $derived(R.grouped(messages));

	// read up to the end once it shows
	$effect(() => {
		if (!read || read.entry !== open) return;
		const [entry, n] = [open, read.count];
		R.markSeen(entry, n);
		untrack(() => seen[entry] !== n && (seen = { ...seen, [entry]: n }));
	});

	let timeline = $state();
	let stuck = true;
	$effect(() => {
		void messages.length;
		if (stuck) tick().then(() => timeline && (timeline.scrollTop = timeline.scrollHeight));
	});
	const onscroll = () => timeline && (stuck = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 80);

	// the address names the open room, so a link opens it, and a message by #m<id>
	$effect(() => {
		const p = new URLSearchParams(location.search);
		if (open) p.set('room', open);
		else p.delete('room');
		history.replaceState(history.state, '', `${location.pathname}${p.size ? `?${p}` : ''}${location.hash}`);
	});
	function pick(entry) {
		open = entry;
		thread = null;
		shown = 50;
		stuck = true;
		making = '';
	}

	const title = (r) => R.titleOf(r, recordOf(r), world, (v) => (v ? nameOf(v) : ''));
	const readers = $derived((here?.readers ?? []).map((v) => byId.get(v) ?? { id: v, name: `Vault ${v.slice(0, 8)}…`, kind: 'unknown' }));
	const mentionable = $derived(readers.filter((v) => v.id !== world?.mine).map((v) => ({ id: v.id, name: v.name ?? '' })));
	const mine = (m) => !!m?.by && (m.by.vault === world?.mine || m.actor === actor);

	// changes
	async function send(text, mentions, threadOf = null) {
		if (!actor) return false;
		const op = R.posting({ room: open, actor, text, thread: threadOf, mentions });
		stuck = true;
		return !!(await api.run('Sending', op));
	}
	const react = (path, key, minePrev) =>
		actor && api.run(
			minePrev != null ? 'Taking the reaction back' : 'Reacting',
			minePrev != null ? R.unreacting(open, actor, path, minePrev) : R.reacting(open, actor, path, key)
		);
	const edit = (path, text) => actor && api.runAll('Saving the edit', R.editing(open, actor, path, text));
	function remove(path) {
		if (!actor) return;
		if (confirm('Delete this message for everyone in the room? It stays in the room’s signed history.'))
			api.runAll('Deleting', R.deleting(open, actor, path));
	}
	let editingLast = $state(null);
	function upEdit() {
		const last = [...messages].reverse().find((m) => mine(m) && !m.deleted);
		if (last) editingLast = last.id;
	}

	// the thread open on the right
	let thread = $state(null);
	const parent = $derived(thread == null ? null : (messages.find((m) => m.id === thread) ?? null));
	function openThread(id) {
		thread = id;
		side = 'aside';
	}

	// a new room
	let making = $state('');
	let name = $state('');
	let topic = $state('');
	let chosen = $state([]);
	let where = $state('');
	const people = $derived(R.people(world).sort((a, b) => nameOf(a).localeCompare(nameOf(b))));
	const coops = $derived(R.channelVaults(world));
	function start(kind) {
		if (!world?.mine) return;
		[making, name, topic, chosen] = [kind, '', '', []];
		where = coops[0]?.id ?? '';
		side = '';
	}
	let busy = false;
	async function make() {
		const self = making === 'self';
		// one note to self: an existing one opens, and none is made while the rooms' kinds are still being read
		if (self && selfRoom.value?.rows?.length) return pick(selfRoom.value.rows[0].entry);
		if (!world?.mine || busy || (self && !known)) return;
		const vault = making === 'channel' ? where : world?.mine;
		const members = self ? [] : chosen;
		if (making === 'dm' && members.length !== 1) return;
		if (making === 'channel' && !vault) return;
		const ops = R.making({ vault, actor: R.actorIn(world, vault), look: making, name: name.trim(), topic: topic.trim(), members });
		busy = true;
		const done = await api.runAll(self ? 'Making your note to self' : 'Making the room', ops).finally(() => (busy = false));
		if (done?.[0]?.entry) pick(done[0].entry);
		else if (self) making = '';
	}
	let dmWindow;
	let dmBusy = $state(false), dmError = $state('');
	$effect(() => {
		const owner = api;
		if (making !== 'dm') return;
		const window = (owner.api ?? owner).window();
		dmWindow = window; dmBusy = false; dmError = '';
		return () => {
			window.close();
			if (dmWindow === window) { dmWindow = null; dmBusy = false; dmError = ''; }
		};
	});
	/** A sidebar page cannot prove there is no existing DM. Search through the shared read window. */
	async function dmWith(who) {
		if (dmBusy || !world?.mine || !dmWindow) return;
		const window = dmWindow, owner = api, vault = world.mine;
		dmBusy = true; dmError = '';
		try {
			const found = await R.directRoom(op => window.read(op), who);
			if (dmWindow !== window || api !== owner || world?.mine !== vault || making !== 'dm') return;
			if (found) pick(found);
			else { chosen = [who]; await make(); }
		} catch (error) {
			if (dmWindow === window) dmError = error.message;
		} finally { if (dmWindow === window) dmBusy = false; }
	}

	// deleting the open room: off every reader's list, its signed history kept
	async function drop() {
		if (!actor || !here) return;
		const n = read?.count ?? 0;
		if (!confirm(`Delete “${title(here)}”${n ? ` and its ${n} ${n === 1 ? 'message' : 'messages'}` : ''} for everyone in it? It stays in the vault’s signed history.`)) return;
		if (await api.run('Deleting the room', R.deletingRoom(open, actor))) pick('');
	}

	// adding people to the open room
	let adding = $state('');
	async function add() {
		if (!adding || !actor || !here) return;
		if (await api.run('Adding them to the room', R.adding(here.vault, open, adding, actor))) adding = '';
	}

	onMount(() => {
		const go = (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				document.querySelector('.chat-search')?.focus();
			}
		};
		addEventListener('keydown', go);
		return () => removeEventListener('keydown', go);
	});
	let filter = $state('');
	const matches = (r) => !filter || title(r).toLowerCase().includes(filter.toLowerCase());
	const SECTIONS = [
		['channel', 'Channels'],
		['group', 'Groups'],
		['dm', 'Direct messages'],
		['self', 'Notes to self'],
		['opening', 'Still opening']
	];
</script>

<Frame bind:open={side} navLabel="Rooms" asideLabel={thread != null ? 'Thread' : 'About this room'} navIcon="chat" asideIcon={thread != null ? 'chat' : 'info'} flush>
	{#snippet nav()}
		<input class="nav-search chat-search" placeholder="Find a room  ⌘K" bind:value={filter} aria-label="Find a room" />
		<div class="new">
			<button class="nav-item" data-pick disabled={!world?.mine} onclick={() => start('dm')}><Icon name="users" /><span>New message</span></button>
			<button class="nav-item" data-pick disabled={!world?.mine} onclick={() => start('group')}><Icon name="plus" /><span>New group</span></button>
			{#if coops.length}<button class="nav-item" data-pick onclick={() => start('channel')}><Icon name="plus" /><span>New channel</span></button>{/if}
			{#if known && !selfRoom.value.rows.length}<button class="nav-item" data-pick onclick={() => ((making = 'self'), make())}><Icon name="note" /><span>Note to self</span></button>{/if}
		</div>
		{#each SECTIONS as [look, label] (look)}
			{#if groups[look].some(matches)}
				<h3 class="nav-group">{label}</h3>
				{#each groups[look].filter(matches) as r (r.entry)}
					<button class="nav-item" class:on={r.entry === open} aria-current={r.entry === open ? 'page' : undefined} data-pick onclick={() => pick(r.entry)}>
						<Icon name={look === 'channel' ? 'board' : look === 'dm' ? 'users' : look === 'self' ? 'note' : 'chat'} />
						<span class:bold={unread(r.entry) > 0}>{title(r)}</span>
						{#if unread(r.entry)}<small class="badge">{unread(r.entry)}</small>{/if}
					</button>
				{/each}
			{/if}
		{/each}
		{#if discovery.phase === 'error' || metadata.phase === 'error'}
			<p class="hint" role="alert">Rooms could not be read on this device.</p>
		{:else if discovery.phase === 'loading' || metadata.phase === 'loading'}
			<p class="hint">Opening local rooms…</p>
		{:else if !rooms.length}<p class="hint empty">No rooms held on this device yet.</p>{/if}
		{#if offset > 0}<button class="link" onclick={() => offset = Math.max(0, offset - 50)}>Previous rooms</button>{/if}
		{#if offset + 50 < (discovery.value?.count ?? 0)}<button class="link" onclick={() => offset += 50}>More rooms</button>{/if}
	{/snippet}

	{#snippet aside()}
		{#if parent}
			<div class="thread">
				<header class="aside-head">
					<h3>Thread</h3>
					<button class="link" onclick={() => (thread = null)}>Close</button>
				</header>
				<Message m={parent} me={world?.mine} {byId} mine={mine(parent)} deletable={owner} inThread
					onreact={(k, p) => react(R.pathOf(parent.id), k, p)}
					onedit={(t) => edit(R.pathOf(parent.id), t)}
					ondelete={() => remove(R.pathOf(parent.id))} />
				<p class="count">{parent.thread?.length ? `${parent.thread.length} ${parent.thread.length === 1 ? 'reply' : 'replies'}` : 'No replies yet'}</p>
				{#each parent.thread ?? [] as r (r.id)}
					<Message m={r} me={world?.mine} {byId} mine={mine(r)} deletable={owner} inThread
						onreact={(k, p) => react(R.pathOf(r.id, parent.id), k, p)}
						onedit={(t) => edit(R.pathOf(r.id, parent.id), t)}
						ondelete={() => remove(R.pathOf(r.id, parent.id))} />
				{/each}
				<Composer place="{open}:{parent.id}" people={mentionable} label="Reply" disabled={!actor} onsend={(t, ms) => send(t, ms, parent.id)} />
			</div>
		{:else if here && record}
			<div class="details">
				<p class="eyebrow">{R.LOOKS[record.look] ?? 'Room'} · {nameOf(byId.get(here.vault))}</p>
				<h3>{title(here)}</h3>
				{#if record.topic}<p>{record.topic}</p>{/if}
				<h4>Who reads it <small>{readers.length}</small></h4>
				{#if !world}<p class="hint">Reader names are still loading. Vault identifiers are shown below.</p>{/if}
				<ul class="readers">
					{#each readers as v (v.id)}
						<li>{nameOf(v)} <small>{v.id === world?.mine ? 'you' : v.id === here.vault ? 'its vault' : KINDS[v.kind]}</small></li>
					{/each}
				</ul>
				<p class="hint">Everyone listed opens every message, its whole history included. Messages are encrypted to them alone; Peers store them encrypted.</p>
				{#if owner && record.look !== 'self' && record.look !== 'dm'}
					<h4>Add someone</h4>
					<div class="row">
						<select bind:value={adding} aria-label="Who to add">
							<option value="">Pick a person</option>
							{#each people.filter((p) => !here.readers.includes(p.id)) as p (p.id)}<option value={p.id}>{nameOf(p)}</option>{/each}
						</select>
						<button class="btn" disabled={!adding} onclick={add}>Add</button>
					</div>
				{/if}
				{#if owner}
					<h4>Delete</h4>
					<p class="hint">{read?.count ? `${read.count} ${read.count === 1 ? 'message' : 'messages'} in it.` : 'No messages in it.'}</p>
					<button class="btn danger" disabled={!!api.doing} onclick={drop}>Delete this room</button>
				{/if}
			</div>
		{/if}
	{/snippet}

	<div class="room">
		{#if making}
			<section class="making">
				<h2>{making === 'dm' ? 'New message' : making === 'group' ? 'New group' : making === 'channel' ? 'New channel' : 'Note to self'}</h2>
				{#if making === 'self'}
					<p class="hint">{api.doing || 'Only you read it.'}</p>
					<div class="row"><button class="link" onclick={() => (making = '')}>Back</button></div>
				{:else if making === 'dm'}
					<p class="hint">Only the two of you read it.</p>
					{#if dmBusy}<p class="hint">Looking for your existing conversation…</p>{/if}
					{#if dmError}<p class="hint" role="alert">{dmError}</p>{/if}
					<ul class="people">
						{#each people as p (p.id)}<li><button disabled={dmBusy} onclick={() => dmWith(p.id)}>{nameOf(p)} <small>{KINDS[p.kind]}</small></button></li>{:else}<li class="hint">Nobody else is in your vaults yet.</li>{/each}
					</ul>
				{:else if making === 'group' || making === 'channel'}
					{#if making === 'channel'}
						<label>In <select bind:value={where}>{#each coops as c (c.id)}<option value={c.id}>{nameOf(c)}</option>{/each}</select></label>
					{/if}
					<label>Name <input bind:value={name} maxlength="80" placeholder={making === 'channel' ? 'general' : 'Garden crew'} /></label>
					<label>Topic <input bind:value={topic} maxlength="500" placeholder="What it is for" /></label>
					<fieldset>
						<legend>Who is in it</legend>
						{#each people as p (p.id)}
							<label class="check"><input type="checkbox" value={p.id} bind:group={chosen} /> {nameOf(p)} <small>{KINDS[p.kind]}</small></label>
						{:else}<p class="hint">Nobody else is in your vaults yet.</p>{/each}
					</fieldset>
					<div class="row">
						<button class="btn" onclick={make} disabled={!name.trim() || api.doing}>Make it</button>
						<button class="link" onclick={() => (making = '')}>Cancel</button>
					</div>
				{/if}
			</section>
		{:else if here}
			<header class="room-head">
				<h2>{title(here)}</h2>
				<button class="readers-line" onclick={() => ((thread = null), (side = 'aside'))}
					>{record ? `${R.LOOKS[record.look] ?? 'Room'} · ` : ''}read by {readers.map((v) => (v.id === world?.mine ? 'you' : nameOf(v))).join(', ')}</button
				>
			</header>
			<div class="timeline" bind:this={timeline} {onscroll}>
				{#if read?.more}<button class="older link" onclick={() => ((stuck = false), (shown += 50))}>Show older messages</button>{/if}
				{#if !record && why}<p class="hint">{why}</p>
				{:else if read?.entry !== open}<p class="hint empty">Opening the room…</p>{/if}
				{#each lines as l (l.m.id)}
					{#if l.dayStart}<div class="day"><span>{R.dayWords(l.m.at)}</span></div>{/if}
					<Message
						m={l.m}
						me={world?.mine}
						{byId}
						head={l.head || l.dayStart}
						mine={mine(l.m)}
						deletable={owner}
						replies={l.m.thread?.filter((r) => !r.deleted).length ?? 0}
						editing={editingLast === l.m.id}
						onreact={(k, p) => react(R.pathOf(l.m.id), k, p)}
						onreply={() => openThread(l.m.id)}
						onedit={(t) => ((editingLast = null), edit(R.pathOf(l.m.id), t))}
						ondelete={() => remove(R.pathOf(l.m.id))}
					/>
				{:else}
					{#if record}<p class="hint empty">No messages yet. Say hello.</p>{/if}
				{/each}
			</div>
			<div class="compose">
				{#if !actor}<p class="hint">Checking which vault you can act for…</p>{/if}
				<Composer place={open} people={mentionable} label="Message {title(here)}" onsend={(t, ms) => send(t, ms)} onup={upEdit} disabled={!record || !actor} />
			</div>
		{:else}
			<section class="welcome">
				<h2>Chat</h2>
				<p>Talk with the people in your vaults: direct messages, groups, a coop’s channels and notes to yourself. Every message is signed and encrypted end to end, and only the people a room names read it.</p>
				<div class="row">
					<button class="btn" disabled={!world?.mine} onclick={() => start('dm')}>New message</button>
					<button class="link" disabled={!world?.mine} onclick={() => start('group')}>New group</button>
				</div>
			</section>
		{/if}
	</div>
</Frame>

<style>
	.room {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.room-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.2rem 0.8rem;
		padding: calc(1rem + env(safe-area-inset-top, 0px)) 1.2rem 0.6rem;
		border-bottom: 1px solid var(--edge);
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.35rem;
	}
	.readers-line {
		padding: 0;
		border: 0;
		background: none;
		color: var(--soft);
		font: inherit;
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
	}
	.timeline {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.5rem 0.6rem 1rem;
	}
	.compose {
		padding: 0.4rem 1rem calc(var(--nav-room, 5rem) + 0.2rem);
	}
	.day {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		justify-content: center;
		margin: 0.8rem 0 0.2rem;
	}
	.day span {
		padding: 0.15rem 0.7rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font-size: 0.74rem;
		font-weight: 600;
	}
	.older {
		display: block;
		margin: 0.4rem auto;
	}
	.hint {
		color: var(--soft);
		font-size: 0.85rem;
	}
	.empty {
		padding: 1rem 0.6rem;
	}
	.bold {
		font-weight: 700;
	}
	.badge {
		min-width: 1.2rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		background: var(--accent);
		color: #fff !important;
		text-align: center;
	}
	.new {
		margin-bottom: 0.4rem;
	}
	.welcome,
	.making {
		max-width: 34rem;
		padding: calc(1.6rem + env(safe-area-inset-top, 0px)) 1.4rem 8rem;
		overflow-y: auto;
	}
	.making label {
		display: grid;
		gap: 0.2rem;
		margin: 0.7rem 0;
		font-size: 0.85rem;
	}
	.making input:not([type]),
	.making select {
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		font: inherit;
	}
	fieldset {
		margin: 0.8rem 0;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
	}
	.making label.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.3rem 0;
	}
	.people {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.people button {
		width: 100%;
		padding: 0.55rem 0.7rem;
		border: 0;
		border-bottom: 1px solid var(--edge);
		background: none;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}
	.people button:hover {
		background: rgb(0 0 0 / 0.04);
	}
	small {
		color: var(--soft);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}
	.btn {
		padding: 0.38rem 0.9rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.btn.danger {
		border-color: #b3261e;
		background: #fff;
		color: #b3261e;
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.details,
	.thread {
		padding: 0 0.4rem;
	}
	.aside-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.details h3,
	.aside-head h3 {
		margin: 0.2rem 0 0.4rem;
		font-family: var(--font-display);
	}
	.details h4 {
		margin: 1rem 0 0.3rem;
		font-size: 0.8rem;
	}
	.eyebrow {
		margin: 0;
		color: var(--soft);
		font-size: 0.7rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.readers {
		margin: 0;
		padding-left: 1rem;
		font-size: 0.88rem;
	}
	.count {
		margin: 0.6rem 0 0.2rem;
		color: var(--soft);
		font-size: 0.78rem;
	}
	.thread :global(.composer) {
		margin-top: 0.6rem;
	}
</style>
