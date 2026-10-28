<script>
 import { onMount } from 'svelte';
 import { session } from '../../../page/session.svelte.js';
 onMount(() => session.boot());
</script>
<p data-testid="view">View mounted</p>
