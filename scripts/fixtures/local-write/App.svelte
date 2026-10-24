<script>
 import { onMount } from 'svelte';
 import Story from '../../../src/lib/avendb/Story.svelte';
 import Note from '../../../src/lib/avendb/Note.svelte';
 const detailView = new URLSearchParams(location.search).get('detail');
 let fixtureEntry = $state('d'.repeat(64));
 window.fixtureSwitchEntry = value => fixtureEntry = value;
 import Sparks from '../../../src/lib/avendb/Sparks.svelte';
 import Artifacts from '../../../src/lib/avendb/Artifacts.svelte';
 const collectionView = new URLSearchParams(location.search).get('collection');
 let fixtureVault = $state('b'.repeat(64));
 window.fixtureSwitchVault = value => fixtureVault = value;
 import Todos from '../../../src/lib/avendb/Todos.svelte';
 const worldView = new URLSearchParams(location.search).has('world-view');
 import Chat from '../../../src/lib/chat/Chat.svelte';
 import { session } from '../../../src/lib/avendb/session.svelte.js';
 let status = $state('');
 onMount(() => session.boot());
 onMount(() => session.observe(() => session.phase === 'open' ? {op:'get',entry:'c'.repeat(64)} : null, answer => status = answer?.ok?.status ?? '')); 
</script>
<button onclick={() => session.unlock()}>Unlock fixture</button>
<p data-testid="phase">{session.phase}</p>
{#if session.phase === 'open' && session.world}
 {#if detailView === 'story'}
 <Story world={session.world} actor={'b'.repeat(64)} api={session.api} busy={!!session.doing} entry={fixtureEntry} step='published' />
 {:else if detailView === 'note'}
 <Note world={session.world} actor={'b'.repeat(64)} api={session.api} busy={!!session.doing} entry={fixtureEntry} />
 {:else if collectionView === 'sparks'}
 <Sparks world={session.world} vault={fixtureVault} actor={'b'.repeat(64)} api={session.api} busy={!!session.doing} onaccess={() => {}} onopen={() => {}} onstory={() => {}} />
 {:else if collectionView === 'artifacts'}
 <Artifacts world={session.world} vault={fixtureVault} actor={'b'.repeat(64)} api={session.api} busy={!!session.doing} onaccess={() => {}} onopen={() => {}} />
 {:else if worldView}
 <Todos world={session.world} vault={'b'.repeat(64)} actor={'b'.repeat(64)} api={session.api} busy={!!session.doing} onaccess={() => {}} />
 {:else}<Chat />{/if}
{/if}

<p data-testid="todo-status">{status}</p>
