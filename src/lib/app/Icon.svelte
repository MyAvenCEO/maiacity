<!-- The app's icons: plain line drawings, drawn in the text colour. -->
<script lang="ts">
	import type { IconName } from './places';

	let { name, size = 24 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	{#if name === 'home'}
		<path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5.5h4V20" />
	{:else if name === 'play'}
		<path d="M4 18a8 8 0 0 1 16 0" /><path d="M12 10V4" /><path d="M9 5.5c1.8-1.2 4.2-1.2 6 0" /><circle cx="12" cy="18" r="1.4" />
	{:else if name === 'board'}
		<rect x="3.5" y="4.5" width="5" height="15" rx="1.5" /><rect x="9.5" y="4.5" width="5" height="10" rx="1.5" /><rect x="15.5" y="4.5" width="5" height="12.5" rx="1.5" />
	{:else if name === 'calendar'}
		<rect x="3.5" y="5.5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3.5v4M16 3.5v4" /><path d="M8 14h2M14 14h2M8 17h2" />
	{:else if name === 'media'}
		<rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
	{:else if name === 'studio'}
		<rect x="3.5" y="6" width="17" height="12.5" rx="2" /><path d="M3.5 10h17" /><path d="m6.5 6 2 4M11 6l2 4M15.5 6l2 4" />
	{:else if name === 'journal'}
		<path d="M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3v-12Z" /><path d="M5 16.5a3 3 0 0 1 3-3h10.5" /><path d="M9 8h6" />
	{:else if name === 'spark'}
		<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2 18 18M18 6l-2.8 2.8M8.8 15.2 6 18" />
	{:else if name === 'user'}
		<circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" />
	{:else if name === 'ledger'}
		<path d="M4.5 7.5h15v12h-15z" /><path d="M4.5 7.5 7 4.5h10l2.5 3" /><path d="M15.5 13.5h4" /><circle cx="15.5" cy="13.5" r="0.6" fill="currentColor" />
	{:else if name === 'coops'}
		<circle cx="12" cy="7" r="2.6" /><circle cx="6" cy="16" r="2.6" /><circle cx="18" cy="16" r="2.6" /><path d="M10.4 9 7.4 13.8M13.6 9l3 4.8M8.6 16h6.8" />
	{:else if name === 'key'}
		<circle cx="8" cy="14" r="4" /><path d="m11 11 8.5-8.5M16 6l2.5 2.5M13.5 8.5 16 11" />
	{/if}
</svg>
