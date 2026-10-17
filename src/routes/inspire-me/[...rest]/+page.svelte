<!-- The inspire-me's old addresses: on to Maia Universe ($lib/universe/OldAddress.svelte). -->
<script lang="ts">
	import { page } from '$app/state';
	import OldAddress from '$lib/universe/OldAddress.svelte';
</script>

<OldAddress path="inspire-me/{page.params.rest ?? ''}" />
