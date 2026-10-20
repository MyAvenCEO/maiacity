<!--
	Where a message is written: Enter sends, Shift+Enter starts a new line, ↑ in an empty box edits the person's last
	message, and @ offers the room's people to mention. What is being written is kept on this device per room (and per
	thread) until it is sent.
-->
<script>
	// @ts-nocheck — plain JS
	import { draftOf, keepDraft, MAX_TEXT, mentionsIn } from './rooms.js';

	/** `people`: who may be mentioned, `{ id, name }`; `onsend(text, mentions)` sends, and says whether it went */
	let { place, people = [], label = 'Message', onsend, onup, disabled = false } = $props();

	let text = $state('');
	let box = $state();
	let sending = $state(false);
	$effect(() => {
		text = draftOf(place);
	});
	$effect(() => keepDraft(place, text));

	/** the @word being typed at the caret, and the people it matches */
	let at = $state(null);
	const matches = $derived(
		at == null ? [] : people.filter((p) => p.name && p.name.toLowerCase().startsWith(at.word.toLowerCase())).slice(0, 6)
	);
	let pick = $state(0);

	function look() {
		const upto = text.slice(0, box?.selectionStart ?? text.length);
		const m = /(^|\s)@([^\s@]*)$/.exec(upto);
		at = m ? { word: m[2], from: upto.length - m[2].length - 1 } : null;
		pick = 0;
	}

	function mention(p) {
		const end = at.from + 1 + at.word.length;
		text = `${text.slice(0, at.from)}@${p.name} ${text.slice(end)}`;
		at = null;
		box?.focus();
	}

	async function send() {
		const t = text.trim();
		if (!t || sending || disabled) return;
		sending = true;
		const done = await onsend?.(t, mentionsIn(t, people));
		sending = false;
		if (done) text = '';
	}

	function key(e) {
		if (matches.length) {
			if (e.key === 'ArrowDown') return (e.preventDefault(), (pick = (pick + 1) % matches.length));
			if (e.key === 'ArrowUp') return (e.preventDefault(), (pick = (pick + matches.length - 1) % matches.length));
			if (e.key === 'Enter' || e.key === 'Tab') return (e.preventDefault(), mention(matches[pick]));
			if (e.key === 'Escape') return (at = null);
		}
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void send();
		} else if (e.key === 'ArrowUp' && !text) {
			e.preventDefault();
			onup?.();
		}
	}
</script>

<div class="composer">
	{#if matches.length}
		<ul class="mentions" role="listbox">
			{#each matches as p, i (p.id)}
				<li><button class:on={i === pick} onmousedown={(e) => (e.preventDefault(), mention(p))}>@{p.name}</button></li>
			{/each}
		</ul>
	{/if}
	<textarea
		bind:this={box}
		bind:value={text}
		maxlength={MAX_TEXT}
		rows="1"
		placeholder={label}
		aria-label={label}
		{disabled}
		oninput={look}
		onclick={look}
		onkeydown={key}
	></textarea>
	<button class="send" onclick={send} disabled={!text.trim() || sending || disabled} aria-label="Send">Send</button>
</div>

<style>
	.composer {
		position: relative;
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
	}
	textarea {
		flex: 1;
		min-height: 1.6rem;
		max-height: 12rem;
		padding: 0.3rem 0.4rem;
		border: 0;
		outline: 0;
		resize: none;
		field-sizing: content;
		font: inherit;
		background: none;
	}
	.send {
		padding: 0.38rem 0.9rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.send:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.mentions {
		position: absolute;
		bottom: calc(100% + 0.3rem);
		left: 0.5rem;
		margin: 0;
		padding: 0.25rem;
		list-style: none;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
	}
	.mentions button {
		display: block;
		width: 100%;
		padding: 0.3rem 0.6rem;
		border: 0;
		border-radius: 6px;
		background: none;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}
	.mentions button.on {
		background: rgb(47 109 98 / 0.12);
	}
</style>
