<script>
	// avenOS's root: #/brain is avenBRAIN (brain/Brain.svelte) on every host, signed in or not, before any vault's route;
	// every other address is the host's own view, App or Network, as main.js chose it
	import Brain from './brain/Brain.svelte';

	let { view, props } = $props();

	const read = () => /^#\/?brain(\/|$)/.test(location.hash);
	let brain = $state(read());
	$effect(() => {
		const follow = () => (brain = read());
		addEventListener('hashchange', follow);
		return () => removeEventListener('hashchange', follow);
	});
	const View = $derived(view);
</script>

{#if brain}
	<Brain />
{:else}
	<View {...props} />
{/if}
