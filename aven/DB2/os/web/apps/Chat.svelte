<script>
	// avenOS's Chat (MILESTONE2.md, thread B; store/README.md): the city-dome, everyone's lines live, who is present,
	// and a line to write in. Lines are pushed by this origin's Peer-Light and never re-queried (README, rule 8); they
	// are the chat's history, so a reload finds them again. A line written here shows at once and says while it is
	// still on its way; a dropped image, PDF or movie shows at once too, as a file card from /files/<hash>, which the
	// Service Worker answers range by range. Senders are named through the tree: a device by the person vault it acts
	// for. A line is yours when it is said for the vault you act as, from any of its devices, this browser or another
	// (Samuel, 30 Oct 2026). A line the network says through the Aven Peer (who joined) is its own kind. Your own lines
	// and files can be deleted, for everyone (a retraction, Aven.DB.Chains): a small button beside the bubble, or a long
	// press on a phone, then a confirmation; a deleted line stays in its place as a quiet "Message deleted".
	import Avatar from '../Avatar.svelte';
	import Offline from '../Offline.svelte';
	import { tree, vaultName } from '../id.svelte.js';
	import { remove, room, say, share } from '../room.svelte.js';

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

	// how a file shows, inline in its bubble (Samuel, 30 Oct 2026: every kind shows and plays in the chat): only through
	// <img>, <audio>, <video> or a PDF's frame, and only for the passive types the Service Worker serves inline
	// (public/files-sw.js keeps the same list). Anything else, SVG and HTML included, is a download link
	const kind = (type) => {
		const t = String(type ?? '').split(';')[0].trim().toLowerCase();
		if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(t)) return 'image';
		if (/^audio\/[a-z0-9.+-]+$/.test(t)) return 'audio';
		if (/^video\/[a-z0-9.+-]+$/.test(t)) return 'video';
		return t === 'application/pdf' ? 'pdf' : 'file';
	};
	// What became of a file that didn't load, by its name: `waiting` while it is still on its way, with why; `failed`
	// once it stopped asking; `unplayable` when its bytes are here and this browser can't show or play them (an
	// iPhone's HEVC movie in a browser without the codec). A card never shows a dead player (Samuel, 30 Oct 2026)
	let cards = $state({});
	// how many times a person asked for a file again, by its name: its player is made anew each time
	let asked = $state({});
	const whyNot = (status, text) =>
		!navigator.onLine
			? "You're offline: it loads when you're back."
			: status === 404
				? "Its sender isn't reachable, and the network doesn't have it yet."
				: `It couldn't be fetched: ${text || `answer ${status}`}.`;
	// a file still on its way (the Aven Peer not yet keeping it, its sender's peer not reachable): a placeholder of its
	// kind until it has loaded (`data-ready`), asked for again, a little later each time, until it comes
	function retrying(node, file) {
		const base = `/files/${file}`;
		let tries = 0;
		// one try waits at a time, and none once the file has loaded: a late one would load a playing movie again from
		// its start (WebKit, 30 Oct 2026). A player asked again goes on from where it was
		let at = 0;
		let waiting = null;
		let gone = false;
		let refused = 0;
		const again = async () => {
			if (waiting || gone) return;
			at = node.currentTime || at;
			// why: its first byte answered means the bytes are here and this browser can't decode them
			const probe = await fetch(base, { headers: { range: 'bytes=0-0' } }).then(
				async (r) => ({ status: r.status, text: (await r.text()).slice(0, 120) }),
				(e) => ({ status: 0, text: String(e?.message ?? e) }),
			);
			if (gone) return;
			// the bytes are here: once may be a hiccup (a stream cut off), so it loads once more; twice, this browser can't
			const here = probe.status === 206 || probe.status === 200;
			if (here && refused++) return void (cards[file] = { state: 'unplayable' });
			if (here) tries = 0;
			if (!here && ++tries > 8) return void (cards[file] = { state: 'failed', why: whyNot(probe.status, probe.text) });
			if (!here) cards[file] = { state: 'waiting', why: whyNot(probe.status, probe.text) };
			waiting = setTimeout(() => {
				waiting = null;
				node.setAttribute('src', `${base}?try=${tries}`);
			}, 500 * 2 ** Math.min(tries, 4));
		};
		const ready = () => {
			clearTimeout(waiting);
			waiting = null;
			node.setAttribute('data-ready', '');
			delete cards[file];
			if (at && node.currentTime < at) node.currentTime = at;
		};
		const loaded = node.tagName === 'IMG' ? 'load' : 'loadedmetadata';
		node.addEventListener('error', again);
		node.addEventListener(loaded, ready);
		if (node.complete && node.naturalWidth) ready();
		return {
			destroy: () => {
				gone = true;
				clearTimeout(waiting);
				node.removeEventListener('error', again);
				node.removeEventListener(loaded, ready);
			},
		};
	}
	// A player loads once its bubble is in view, and at most `LOADING` at once: a fresh viewer of a chat full of big
	// movies asked for every one's metadata through one Peer-Light and waited a minute for the newest (30 Oct 2026).
	// Until then it has no src, so it costs nothing
	const LOADING = 3;
	let loading = 0;
	const turns = [];
	const nextTurn = () => {
		while (loading < LOADING && turns.length) {
			loading++;
			turns.shift()();
		}
	};
	function lazy(node, file) {
		let mine = false;
		let gone = false;
		const done = () => {
			if (!mine) return;
			mine = false;
			loading--;
			nextTurn();
		};
		const load = () => {
			if (gone) return;
			mine = true;
			node.setAttribute('preload', 'metadata');
			node.setAttribute('src', `/files/${file}`);
			setTimeout(done, 30_000);
		};
		node.addEventListener('loadedmetadata', done);
		node.addEventListener('error', done);
		// in view for a moment, not passed by: catching up adds lines at the bottom and scrolls past each
		let dwell = null;
		const seen = new IntersectionObserver((entries) => {
			clearTimeout(dwell);
			if (!entries.at(-1).isIntersecting) return;
			dwell = setTimeout(() => {
				seen.disconnect();
				turns.push(load);
				nextTurn();
			}, 400);
		});
		seen.observe(node);
		return {
			destroy: () => {
				gone = true;
				clearTimeout(dwell);
				seen.disconnect();
				const waiting = turns.indexOf(load);
				if (waiting >= 0) turns.splice(waiting, 1);
				done();
			},
		};
	}
	function retry(file) {
		delete cards[file];
		asked[file] = (asked[file] ?? 0) + 1;
	}
	const percent = (part, whole) => `${Math.floor((100 * part) / Math.max(1, whole))}%`;
	// deleting: the line asked about, and the dialog that asks
	let asking = $state(null);
	let confirming = $state();
	function ask(line) {
		asking = line;
		confirming?.showModal();
	}
	function confirmed() {
		if (asking) remove(asking.id);
		confirming?.close();
	}
	// a long press on a touch screen asks too: half a second without moving
	function holding(node, line) {
		let timer;
		const stop = () => clearTimeout(timer);
		const start = (event) => {
			if (event.pointerType !== 'touch' || !line) return;
			stop();
			timer = setTimeout(() => ask(line), 500);
		};
		node.addEventListener('pointerdown', start);
		for (const end of ['pointerup', 'pointercancel', 'pointermove']) node.addEventListener(end, stop);
		return {
			update: (next) => (line = next),
			destroy: () => {
				stop();
				node.removeEventListener('pointerdown', start);
				for (const end of ['pointerup', 'pointercancel', 'pointermove']) node.removeEventListener(end, stop);
			},
		};
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
			<!-- keyed by the line, never by its place: a line caught up later lands before others, and a place's bubble
			     would take another file's player, which loads again from nothing (30 Oct 2026) -->
			{#each room.lines as line (line.id ?? line)}
				{@const vault = vaultOf(line)}
				{@const said = known(vault) && tree.kind(vault) === 'agent'}
				{@const mine = line.from === device || (vault !== null && vault === account)}
				{@const deletable = mine && !said && !line.deleted && /^[0-9a-f]{64}$/.test(line.id ?? '')}
				<li class:mine class:said class:deleted={line.deleted} data-from={line.from} data-vault={vault} data-id={line.id} use:holding={deletable ? line : null}>
					{#if said}
						<span class="text" data-testid="network-line">{line.text}</span>
					{:else if line.deleted}
						<strong>{who(vault ?? line.from)}</strong>
						<span class="text" data-testid="deleted">Message deleted</span>
					{:else if line.file}
						{@const f = line.file}
						<strong>{who(vault ?? line.from)}</strong>
						{@const card = cards[f.file]}
						{@const going = room.files[f.file]}
						<figure class="file card" data-testid="file" data-file={f.file} data-kind={kind(f.type)} data-state={card?.state ?? 'ok'}>
							{#key asked[f.file]}
							{#if card?.state === 'unplayable'}
								<p class="note" data-testid="unplayable">
									This browser can't {kind(f.type) === 'image' ? 'show this image' : `play this ${kind(f.type)}`}. Download it to
									open it on this device.
								</p>
							{:else if card?.state === 'failed'}
								<p class="note" data-testid="file-failed">{card.why}</p>
							{:else if kind(f.type) === 'image'}

								<!-- opened large in a tab of its own on a tap -->
								<a class="media" href="/files/{f.file}" target="_blank" rel="noopener" aria-label="Open {f.name}"
									><img src="/files/{f.file}" alt={f.name} loading="lazy" use:retrying={f.file} /></a
								>
							{:else if kind(f.type) === 'audio'}
								<audio controls preload="none" use:retrying={f.file} use:lazy={f.file}></audio>
							{:else if kind(f.type) === 'video'}
								<!-- playsinline: iOS plays it in the bubble, not full-screen; it seeks by ranges (files-sw.js answers 206) -->
								<!-- svelte-ignore a11y_media_has_caption -->
								<video controls playsinline preload="none" use:retrying={f.file} use:lazy={f.file}></video>
							{:else if kind(f.type) === 'pdf'}
								<!-- previewed where the browser shows a PDF in a sandboxed frame; the link opens it in any case -->
								<iframe src="/files/{f.file}" title={f.name} loading="lazy"></iframe>
							{/if}
							{/key}
							{#if card?.state === 'waiting'}<p class="note" data-testid="file-waiting">{card.why}</p>{/if}
							{#if card?.state === 'failed' || card?.state === 'waiting'}<button type="button" class="quiet retry" onclick={() => retry(f.file)} data-testid="retry"
									>Try again</button
								>{/if}
							<!-- how far it is on its way: from this device to the network, or from the network here -->
							<!-- "Kept by the network" only once the Aven Peer says it holds the file whole (`kept`), for its sender -->
							{#if going?.kept && mine}
								<p class="going" data-testid="file-kept">Kept by the network</p>
							{:else if going?.size}
								<p class="going" data-testid="file-sending">
									Sending to the network, {percent(going.sent, going.size)}<span class="bar"
										><span style:width={percent(going.sent, going.size)}></span></span
									>
								</p>
							{:else if going?.len && going.held < going.len}
								<p class="going" data-testid="file-fetching">
									Fetching {size(going.held)} of {size(going.len)}<span class="bar"
										><span style:width={percent(going.held, going.len)}></span></span
									>
								</p>
							{/if}
							<figcaption>

								<svg class="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
									><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg
								>
								<a href="/files/{f.file}" download={f.name}>{f.name}</a>
								<small>{size(f.size)}</small>
								{#if kind(f.type) === 'pdf'}<a class="open" href="/files/{f.file}" target="_blank" rel="noopener" data-testid="open"
										>Open</a
									>{/if}
							</figcaption>
						</figure>
					{:else}
						<strong>{who(vault ?? line.from)}</strong>
						<span class="text">{line.text}</span>
					{/if}
					<time
						>{#if deletable}<button type="button" class="delete" onclick={() => ask(line)} aria-label="Delete" data-testid="delete"
								><svg class="icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
									><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg
								></button
							>{/if}{time(line.at)}{#if line.from === device && line.id && !line.deleted && !room.sent[line.id]}<small data-testid="sending">
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
					<time data-testid="file-adding">Adding to this device, {percent(s.done, s.size)}</time>
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
		<dialog bind:this={confirming} onclose={() => (asking = null)} data-testid="confirm-delete">
			<p>Delete this {asking?.file ? 'file' : 'message'} for everyone?</p>
			<div>
				<button type="button" class="quiet" onclick={() => confirming.close()} data-testid="delete-no">Cancel</button>
				<button type="button" class="danger" onclick={confirmed} data-testid="delete-yes">Delete</button>
			</div>
		</dialog>
		<Offline />
		{#if room.refused}<p class="refused" data-testid="refused">{room.refused}</p>{/if}
	</section>
</div>

<style>
	/* Every grid here has one column of minmax(0, 1fr), and every grid or flex child that holds text or a file has
	   min-width 0: an implicit column is auto, so one long file name or progress bar would widen the whole chat past a
	   phone's screen, and the right-hand bubbles and the Send button with it (Samuel's iPhone, 30 Oct 2026).
	   The room: presence as chips on top, the thread on the cream ground, the input bar at the bottom. Lines are
	   bubbles (`li`): your vault's own (.mine) green, others' white with a hairline, the network's (.said) a muted note.
	   A line's parts: `strong` its sender, `.text` what it says, `time` when */
	[data-view='chat'] {
		display: grid;
		grid-template-rows: auto 1fr;
		grid-template-columns: minmax(0, 1fr);
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
		grid-template-columns: minmax(0, 1fr);
		min-width: 0;
		gap: 12px;
		min-height: 0;
	}

	ol {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: 10px;
		overflow-y: auto;
		padding: 4px 2px 8px;
	}

	ol li {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 2px;
		min-width: 0;
		justify-self: start;
		max-width: min(78%, 560px);
		padding: 10px 16px 8px;
		font-size: 15px;
		background: var(--raised);
		border: 1px solid var(--line);
		border-radius: 20px 20px 20px 6px;
	}

	ol li strong {
		overflow-wrap: anywhere;
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
		flex: none;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 44px;
		min-height: 44px;
		padding: 10px 18px;
	}

	/* on a phone, Send is its arrow alone, still 44 px to touch */
	@media (max-width: 480px) {
		[data-view='chat'] {
			padding: 12px 12px 16px;
		}

		button {
			padding: 10px;
		}

		button span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* a file is a card inside its bubble: the image, movie or PDF, and below it its name and size */
	section.over ol {
		outline: 2px dashed var(--accent);
		outline-offset: -2px;
		border-radius: var(--radius-card);
	}

	figure.file {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		min-width: 0;
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

	figure.file .media {
		display: block;
		min-width: 0;
	}

	figure.file audio {
		display: block;
		width: 300px;
		max-width: 100%;
	}

	/* a file still arriving: a quiet box of its kind's shape, then the image or the player */
	figure.file img:not([data-ready]),
	figure.file video:not([data-ready]) {
		width: 240px;
		aspect-ratio: 16 / 9;
		background: var(--sage);
	}

	figure.file iframe {
		width: min(420px, 100%);
		height: 320px;
		border: 1px solid var(--line);
	}

	figcaption {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 6px;
		padding: 0 4px;
		font-size: 13px;
	}

	figcaption svg,
	figcaption small,
	figcaption .open {
		flex: none;
	}

	figcaption .open {
		margin-left: auto;
		color: inherit;
		font-weight: 600;
	}

	figcaption a {
		flex: 0 1 auto;
		min-width: 0;
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
		width: min(220px, 100%);
	}

	/* a file's state and how far it is on its way: a line of text over a slim bar */
	figure.file .note,
	figure.file .going {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0 4px;
		font-size: 13px;
		overflow-wrap: anywhere;
	}

	figure.file .going {
		color: var(--muted);
		font-size: 12px;
	}

	figure.file .going .bar {
		width: 100%;
		height: 4px;
	}

	figure.file .retry {
		justify-self: start;
		min-height: 44px;
		padding: 8px 14px;
	}


	/* a deleted line: a quiet note in its place, its bubble without colour */
	ol li.deleted,
	ol li.mine.deleted {
		color: var(--muted);
		background: transparent;
		border: 1px dashed var(--line);
	}

	.deleted .text {
		font-style: italic;
	}

	.mine.deleted strong,
	.mine.deleted time {
		color: var(--muted);
	}

	/* the delete button sits before the time, shown on hover or focus where there is a pointer; a phone long-presses */
	ol li time {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	button.delete {
		min-width: 24px;
		min-height: 24px;
		padding: 2px;
		color: inherit;
		background: transparent;
		border: 0;
		opacity: 0;
	}

	li:hover button.delete,
	li:focus-within button.delete {
		opacity: 1;
	}

	@media (hover: none) {
		button.delete {
			display: none;
		}

		ol li.mine {
			-webkit-touch-callout: none;
		}
	}

	dialog {
		max-width: min(360px, calc(100vw - 32px));
		padding: 20px;
		color: var(--text, inherit);
		background: var(--raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-soft);
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 30%);
	}

	dialog p {
		margin: 0 0 16px;
	}

	dialog div {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
	}

	dialog .danger {
		color: #fff;
		background: var(--down);
		border-color: var(--down);
	}

	.refused {
		margin: 0;
		color: var(--down);
		font-size: 13px;
		text-align: center;
	}
</style>
