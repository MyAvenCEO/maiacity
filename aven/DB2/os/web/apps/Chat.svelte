<script>
	// avenOS's Chat (MILESTONE2.md, thread B): the network's one room, everyone's lines live, who is present, and a line
	// to write in. Lines are pushed by this origin's Peer-Light and never re-queried (README, rule 8); none is kept, so
	// a reload empties the room. Senders are named through the tree: a device by the person vault it acts for.
	import Avatar from '../Avatar.svelte';
	import { tree, vaultName } from '../id.js';
	import { room, say } from '../room.svelte.js';

	let { account, device } = $props();

	let text = $state('');
	let list = $state();
	// a vault the tree may not know yet (a member who joined after it was told): its id stands for its name
	const known = (id) => Boolean(tree.kind(id));
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
				<li data-vault={id}>{#if known(id)}<Avatar {id} size={20} />{/if}<span>{who(id)}</span></li>
			{/each}
		</ul>
	</aside>

	<section aria-label="Room">
		<ol bind:this={list} data-testid="lines">
			{#each room.lines as line, i (i)}
				<li class:mine={line.from === device} class:joined={line.joined} data-from={line.from} data-vault={line.vault}>
					{#if line.joined}
						<span class="text" data-testid="joined-line">{line.text}</span>
					{:else}
						<strong>{who(line.vault)}</strong>
						<span class="text">{line.text}</span>
					{/if}
					<time>{time(line.at)}</time>
				</li>
			{:else}
				<li class="empty">Nobody has said anything since this page opened.</li>
			{/each}
		</ol>
		<form onsubmit={send}>
			<input bind:value={text} maxlength="1000" placeholder="Write to everyone here" aria-label="Line" data-testid="line" />
			<button disabled={!text.trim()} data-testid="say">Send</button>
		</form>
	</section>
</div>

<style>
	[data-view='chat'] {
		display: grid;
		grid-template-columns: minmax(140px, 200px) 1fr;
		gap: 16px;
		padding: 16px;
		height: calc(100dvh - 57px);
		box-sizing: border-box;
	}

	@media (max-width: 560px) {
		[data-view='chat'] {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}
	}

	h2 {
		margin: 0 0 8px;
		font-size: 15px;
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

	ul li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
		font-size: 14px;
	}

	section {
		display: grid;
		grid-template-rows: 1fr auto;
		gap: 10px;
		min-height: 0;
	}

	ol {
		display: grid;
		align-content: start;
		gap: 6px;
		overflow-y: auto;
		padding: 10px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 10px;
	}

	ol li {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 14px;
	}

	.text {
		flex: 1;
		overflow-wrap: anywhere;
	}

	.mine strong {
		color: var(--live);
	}

	.joined {
		color: var(--muted);
		font-style: italic;
	}

	form {
		display: flex;
		gap: 8px;
	}

	input {
		flex: 1;
		min-width: 0;
		padding: 8px 12px;
		color: var(--text);
		font: inherit;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 999px;
	}

	button {
		padding: 8px 14px;
		color: var(--surface);
		font: inherit;
		background: var(--text);
		border: 0;
		border-radius: 999px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
