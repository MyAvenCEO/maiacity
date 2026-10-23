<script>
 import { onMount } from 'svelte';
 import Chat from '../../../src/lib/chat/Chat.svelte';
 import { session } from '../../../src/lib/avendb/session.svelte.js';
 let status = $state('');
 onMount(() => session.boot());
 onMount(() => session.observe(() => session.phase === 'open' ? {op:'get',entry:'c'.repeat(64)} : null, answer => status = answer?.ok?.status ?? '')); 
</script>
<button onclick={() => session.unlock()}>Unlock fixture</button>
<p data-testid="phase">{session.phase}</p>
{#if session.phase === 'open' && session.world}<Chat />{/if}

<p data-testid="todo-status">{status}</p>
