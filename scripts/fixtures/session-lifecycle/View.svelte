<script>
 import { onMount } from 'svelte';
 import { session } from '../../../src/lib/avendb/session.svelte.js';
 onMount(() => session.boot());
</script>
<p data-testid="view">View mounted</p>
