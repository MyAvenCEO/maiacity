<!--
	Chat: rooms on avenDB for every signed-in person ($lib/chat/Chat.svelte), on the whole screen, its sides sliding in
	on a phone as every avenDB view's do. While avenDB isn't open in this tab, it says how to open it.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { session } from '$lib/avendb/session.svelte.js';
	import Unlock from '$lib/avendb/Unlock.svelte';
	import Chat from '$lib/chat/Chat.svelte';

	onMount(() => session.boot());
</script>

<svelte:head>
	<title>Chat · maiaCITY</title>
</svelte:head>

<div class="chat-page">
	{#if session.phase === 'open' && session.world}
		<Chat />
	{:else}
		<div class="closed">
			<h1>Chat</h1>
			<p>Your rooms open once avenDB is open in this tab.</p>
			<Unlock />
		</div>
	{/if}
</div>

<style>
	.chat-page {
		--ok: #3f7a4f;
		--bad: #b5523a;
		--soft: rgb(0 0 0 / 0.55);
		--edge: rgb(0 0 0 / 0.1);
		--card: #fff;
		--accent: #2f6d62;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		background: var(--paper);
	}
	.closed {
		max-width: 30rem;
		margin: 0 auto;
		padding: 3rem 1.2rem;
	}
	h1 {
		font-family: var(--font-display);
	}
</style>
