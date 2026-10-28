<script>
	import { base } from '$app/paths';
</script>

<svelte:head><title>Network diagnostics · theOS</title></svelte:head>

<main>
	<a class="back" href="{base}/app/#settings/devices">← Back to Settings</a>
	<h1>Network diagnostics</h1>
	<p>Measure this device’s connection without leaving the app. Your account stays open.</p>
	<iframe title="This device’s network check" src="{base}/diagnostics/network/index.html"></iframe>
</main>

<style>
	main { max-width: 52rem; margin: auto; padding: 1.5rem 1rem calc(7rem + env(safe-area-inset-bottom)); }
	.back { display: inline-flex; min-height: 44px; align-items: center; color: inherit; }
	h1 { font-size: 1.7rem; margin: .7rem 0; }
	p { color: #526557; }
	iframe { display: block; width: 100%; height: 75dvh; min-height: 32rem; border: 1px solid #d0cabb; border-radius: 1rem; background: #f2f0e8; }
</style>
