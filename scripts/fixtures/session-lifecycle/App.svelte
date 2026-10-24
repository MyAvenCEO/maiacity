<script>
 import View from './View.svelte';
 import Diagnostics from '../../../src/lib/app/Diagnostics.svelte';
 import { session } from '../../../src/lib/avendb/session.svelte.js';
 let visible = $state(true);
 function navigate() {
   visible = !visible;
   history.pushState({}, '', `?view=${visible ? 'mounted' : 'away'}`);
 }
</script>
<button onclick={navigate}>Change view</button>
<button onclick={() => session.unlock()}>Unlock fixture</button>
<p data-testid="phase">{session.phase}</p>
{#if visible}<View />{/if}

<Diagnostics />
