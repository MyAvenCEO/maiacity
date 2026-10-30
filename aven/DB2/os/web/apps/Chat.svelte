<script>
	// avenOS's Chat (MILESTONE2.md, thread B; store/README.md): the city-dome, everyone's lines live, who is present,
	// and a line to write in. Lines are pushed by this origin's Peer-Light and never re-queried (README, rule 8); they
	// are the chat's history, so a reload finds them again. A line written here shows at once and says while it is
	// still on its way; a dropped image, PDF or movie shows at once too, from /files/<hash>, which the Service Worker
	// answers range by range. Senders are named through the tree: a device by the person vault it acts for. A line the
	// network says through the Aven Peer (who joined) is its own kind.
	import Avatar from '../Avatar.svelte';
	import { tree, vaultName } from '../id.svelte.js';
	import { room, say, share } from '../room.svelte.js';

	let { account, device } = $props();

	let text = $state('');
	let list = $state();
	let over = $state(false);
	let picker = $state();
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

	function drop(event) {
		event.preventDefault();
		over = false;
		for (const file of event.dataTransfer?.files ?? []) share(file);
	}

	function pick() {
		for (const file of picker.files ?? []) share(file);
		picker.value = '';
	}

	const kind = (type) =>
		type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type === 'application/pdf' ? 'pdf' : 'file';
	const size = (n) => (n < 1 << 20 ? `${Math.ceil(n / 1024)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`);
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

	<section
		aria-label="Room"
		class:over
		ondragover={(e) => {
			e.preventDefault();
			over = true;
		}}
		ondragleave={() => (over = false)}
		ondrop={drop}
	>
		<ol bind:this={list} data-testid="lines">
			{#each room.lines as line, i (i)}
				{@const vault = vaultOf(line)}
				{@const said = known(vault) && tree.kind(vault) === 'agent'}
				<li class:mine={line.from === device} class:said data-from={line.from} data-vault={vault}>
					{#if said}
						<span class="text" data-testid="network-line">{line.text}</span>
					{:else if line.file}
						{@const f = line.file}
						<strong>{who(vault ?? line.from)}</strong>
						<figure data-testid="file" data-file={f.file} data-kind={kind(f.type)}>
							{#if kind(f.type) === 'image'}
								<img src="/files/{f.file}" alt={f.name} />
							{:else if kind(f.type) === 'video'}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video src="/files/{f.file}" controls preload="metadata"></video>
							{:else if kind(f.type) === 'pdf'}
								<iframe src="/files/{f.file}" title={f.name}></iframe>
							{/if}
							<figcaption><a href="/files/{f.file}" download={f.name}>{f.name}</a> · {size(f.size)}</figcaption>
						</figure>
					{:else}
						<strong>{who(vault ?? line.from)}</strong>
						<span class="text">{line.text}</span>
					{/if}
					<time>{time(line.at)}</time>
					{#if line.from === device && line.id && !room.sent[line.id]}<small data-testid="sending">sending</small>{/if}
				</li>
			{:else}
				<li class="empty">Nobody has said anything yet.</li>
			{/each}
			{#each room.sharing as s (s)}
				<li class="mine" data-testid="sharing"><span class="text">{s.name}</span> <small>into the store, {size(s.done)} of {size(s.size)}</small></li>
			{/each}
		</ol>
		<form onsubmit={send}>
			<input bind:value={text} placeholder="Write to everyone here" aria-label="Line" data-testid="line" />
			<button disabled={!text.trim()} data-testid="say">Send</button>
			<input type="file" multiple hidden bind:this={picker} onchange={pick} data-testid="file-input" />
			<button type="button" onclick={() => picker.click()} aria-label="Share a file" data-testid="share">+</button>
		</form>
		{#if room.refused}<p class="refused" data-testid="refused">{room.refused}</p>{/if}
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

	section.over {
		outline: 2px dashed var(--muted);
		outline-offset: 4px;
	}

	figure {
		margin: 4px 0 0;
		display: grid;
		gap: 4px;
	}

	figure img,
	figure video {
		max-width: min(420px, 100%);
		max-height: 320px;
		border-radius: 6px;
	}

	figure iframe {
		width: min(420px, 100%);
		height: 320px;
		border: 1px solid var(--muted);
		border-radius: 6px;
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

	.said {
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
	.refused {
		margin: 0;
		color: var(--pending);
	}
</style>
