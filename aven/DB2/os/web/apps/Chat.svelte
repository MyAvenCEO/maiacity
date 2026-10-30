<script>
	// avenOS's Chat (MILESTONE2.md, thread B; store/README.md): the city-dome, everyone's lines live, who is present,
	// and a line to write in. Lines are pushed by this origin's Peer-Light and never re-queried (README, rule 8); they
	// are the chat's history, so a reload finds them again. A line written here shows at once and says while it is
	// still on its way; a dropped image, PDF or movie shows at once too, as a file card from /files/<hash>, which the
	// Service Worker answers range by range. Senders are named through the tree: a device by the person vault it acts
	// for. A line is yours when it is said for the vault you act as, from any of its devices, this browser or another
	// (Samuel, 30 Oct 2026). A line the network says through the Aven Peer (who joined) is its own kind.
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
	// a file still on its way (the Aven Peer not yet keeping it, its sender's peer not reachable): asked for again, a
	// little later each time, until it comes
	function retrying(node) {
		const base = node.getAttribute('src');
		let tries = 0;
		const again = () => {
			if (++tries > 8) return;
			setTimeout(() => node.setAttribute('src', `${base}?try=${tries}`), 500 * 2 ** Math.min(tries, 4));
		};
		node.addEventListener('error', again);
		return { destroy: () => node.removeEventListener('error', again) };
	}
	const size = (n) => (n < 1 << 20 ? `${Math.ceil(n / 1024)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`);
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
				<li class:mine={line.from === device || (vault !== null && vault === account)} class:said data-from={line.from} data-vault={vault} data-id={line.id}>
					{#if said}
						<span class="text" data-testid="network-line">{line.text}</span>
					{:else if line.file}
						{@const f = line.file}
						<strong>{who(vault ?? line.from)}</strong>
						<figure class="file card" data-testid="file" data-file={f.file} data-kind={kind(f.type)}>
							{#if kind(f.type) === 'image'}
								<img src="/files/{f.file}" alt={f.name} use:retrying />
							{:else if kind(f.type) === 'video'}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video src="/files/{f.file}" controls preload="metadata" use:retrying></video>
							{:else if kind(f.type) === 'pdf'}
								<iframe src="/files/{f.file}" title={f.name}></iframe>
							{/if}
							<figcaption>
								<svg class="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
									><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg
								>
								<a href="/files/{f.file}" download={f.name}>{f.name}</a>
								<small>{size(f.size)}</small>
							</figcaption>
						</figure>
					{:else}
						<strong>{who(vault ?? line.from)}</strong>
						<span class="text">{line.text}</span>
					{/if}
					<time>{time(line.at)}{#if line.from === device && line.id && !room.sent[line.id]}<small data-testid="sending">
								· sending</small
							>{/if}</time
					>
				</li>
			{:else}
				<li class="empty">Nobody has said anything yet.</li>
			{/each}
			{#each room.sharing as s (s)}
				<li class="mine" data-testid="sharing">
					<span class="text">{s.name}</span>
					<span class="bar"><span style:width="{(100 * s.done) / Math.max(1, s.size)}%"></span></span>
					<time>into the store, {size(s.done)} of {size(s.size)}</time>
				</li>
			{/each}
		</ol>
		<form onsubmit={send}>
			<input bind:value={text} placeholder="Write to everyone here" aria-label="Line" data-testid="line" />
			<input type="file" multiple hidden bind:this={picker} onchange={pick} data-testid="file-input" />
			<button type="button" class="quiet" onclick={() => picker.click()} aria-label="Share a file" data-testid="share"
				><svg class="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
				></button
			>
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
	   bubbles (`li`): your vault's own (.mine) green, others' white with a hairline, the network's (.said) a muted note.
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

	/* a file is a card inside its bubble: the image, movie or PDF, and below it its name and size */
	section.over ol {
		outline: 2px dashed var(--accent);
		outline-offset: -2px;
		border-radius: var(--radius-card);
	}

	figure.file {
		display: grid;
		gap: 6px;
		margin: 2px 0 0;
		padding: 6px;
		border-radius: var(--radius-inner);
	}

	figure.file img,
	figure.file video,
	figure.file iframe {
		display: block;
		max-width: 100%;
		max-height: 320px;
		border-radius: var(--radius-inner);
	}

	figure.file iframe {
		width: min(420px, 70vw);
		height: 320px;
		border: 1px solid var(--line);
	}

	figcaption {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 4px;
		font-size: 13px;
	}

	figcaption a {
		overflow: hidden;
		color: inherit;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mine figure.file {
		color: var(--text, inherit);
	}

	.mine figcaption small,
	.mine time small {
		color: var(--on-accent-muted);
	}

	li .bar {
		width: 220px;
	}

	.refused {
		margin: 0;
		color: var(--down);
		font-size: 13px;
		text-align: center;
	}
</style>
