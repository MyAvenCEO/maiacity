<script>
	// avenOS's Chat (MILESTONE2.md, thread B): the network's one room, everyone's lines live, who is present, and a line
	// to write in. Lines are pushed by this origin's Peer-Light and never re-queried (README, rule 8); none is kept, so
	// a reload empties the room. Senders are named through the tree: a device by the person vault it acts for. A line the
	// network says through the Aven Peer (who joined) is its own kind.
	import Avatar from '../Avatar.svelte';
	import { tree, vaultName } from '../id.svelte.js';
	import { room, say } from '../room.svelte.js';

	let { account, device } = $props();

	let text = $state('');
	let list = $state();
	// a vault the tree may not know yet (a member who joined after it was told): its id stands for its name
	const known = (id) => Boolean(id && tree.kind(id));
	// the vault a line is said for: as the line names it, or, in the cast, whom its device acts for
	const vaultOf = (line) => line.vault ?? (known(line.from) ? tree.actsFor(line.from) : null);
	const who = (id) => (known(id) ? vaultName(id) : id);
	const present = $derived([...new Set(room.present.map((id) => (known(id) ? (tree.actsFor(id) ?? id) : id)))]);
	const time = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

	$effect(() => {
		room.lines.length;
		list?.lastElementChild?.scrollIntoView({ block: 'end' });
	});

	function send(event) {
		event.preventDefault();
		say(text);
		text = '';
	}
</script>

<div data-view="chat" data-account={account}>
	<aside aria-label="Present">
		<h2>Present <small data-testid="present-count">{present.length}</small></h2>
		<ul data-testid="present">
			{#each present as id (id)}
				<li class="chip" data-vault={id}>{#if known(id)}<Avatar {id} size={20} />{/if}<span>{who(id)}</span></li>
			{/each}
		</ul>
	</aside>

	<section aria-label="Room">
		<ol bind:this={list} data-testid="lines">
			{#each room.lines as line, i (i)}
				{@const vault = vaultOf(line)}
				{@const said = known(vault) && tree.kind(vault) === 'agent'}
				<li class:mine={line.from === device} class:said data-from={line.from} data-vault={vault}>
					{#if said}
						<span class="text" data-testid="network-line">{line.text}</span>
					{:else}
						<strong>{who(vault ?? line.from)}</strong>
						<span class="text">{line.text}</span>
					{/if}
					<time>{time(line.at)}</time>
				</li>
			{:else}
				<li class="empty">Nobody has said anything since this page opened.</li>
			{/each}
		</ol>
		<form onsubmit={send}>
			<input bind:value={text} placeholder="Write to everyone here" aria-label="Line" data-testid="line" />
			<button disabled={!text.trim()} data-testid="say"
				><svg class="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg
				><span>Send</span></button
			>
		</form>
		{#if room.refused}<p class="refused" data-testid="refused">{room.refused}</p>{/if}
	</section>
</div>

<style>
	/* the room: presence as chips on top, the thread on the cream ground, the input bar at the bottom. Lines are
	   bubbles (`li`): your own (.mine) green, others' white with a hairline, the network's (.said) a muted note.
	   A line's parts: `strong` its sender, `.text` what it says, `time` when */
	[data-view='chat'] {
		display: grid;
		grid-template-rows: auto 1fr;
		gap: 12px;
		max-width: 880px;
		height: calc(100dvh - 64px);
		margin: 0 auto;
		padding: 16px 16px 20px;
	}

	aside {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}

	h2 {
		display: flex;
		flex: none;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 20px;
	}

	h2 small {
		padding: 2px 9px;
		color: var(--on-accent);
		font-family: var(--font-body);
		background: var(--accent);
		border-radius: var(--radius-pill);
	}

	small,
	time,
	.empty {
		color: var(--muted);
		font-size: 12px;
	}

	ul,
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ul {
		display: flex;
		gap: 6px;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	ul li.chip {
		flex: none;
		padding: 3px 12px 3px 3px;
		background: var(--raised);
		border: 1px solid var(--line);
	}

	section {
		display: grid;
		grid-template-rows: 1fr auto;
		gap: 12px;
		min-height: 0;
	}

	ol {
		display: grid;
		align-content: start;
		gap: 10px;
		overflow-y: auto;
		padding: 4px 2px 8px;
	}

	ol li {
		display: grid;
		gap: 2px;
		justify-self: start;
		max-width: min(78%, 560px);
		padding: 10px 16px 8px;
		font-size: 15px;
		background: var(--raised);
		border: 1px solid var(--line);
		border-radius: 20px 20px 20px 6px;
	}

	ol li strong {
		color: var(--muted);
		font-size: 12px;
		font-weight: 600;
	}

	.text {
		overflow-wrap: anywhere;
	}

	ol li time {
		justify-self: end;
		font-size: 11px;
	}

	ol li.mine {
		justify-self: end;
		color: var(--on-accent);
		background: var(--accent);
		border-color: var(--accent);
		border-radius: 20px 20px 6px 20px;
	}

	.mine strong,
	.mine time {
		color: var(--on-accent-muted);
	}

	ol li.said,
	ol li.empty {
		display: flex;
		gap: 8px;
		align-items: baseline;
		justify-self: center;
		max-width: 100%;
		padding: 4px 14px;
		color: var(--muted);
		font-size: 13px;
		background: var(--sage);
		border: 0;
		border-radius: var(--radius-pill);
		box-shadow: none;
	}

	ol li.empty {
		margin-top: 24px;
		background: transparent;
	}

	form {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px;
		background: var(--raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-soft);
	}

	form:focus-within {
		border-color: var(--accent);
		box-shadow: var(--ring);
	}

	input {
		flex: 1;
		min-width: 0;
		padding: 8px 12px;
		background: transparent;
		border: 0;
	}

	input:focus {
		box-shadow: none;
	}

	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 18px;
	}

	.refused {
		margin: 0;
		color: var(--down);
		font-size: 13px;
		text-align: center;
	}
</style>
