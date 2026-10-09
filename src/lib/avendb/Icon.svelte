<!--
	A line icon of avenDB's screens, drawn in the text's colour on a 24-unit grid (in the manner of Lucide's): the
	nav's pages, a note's proposals and variants, and the studio's tables.
-->
<script>
	/** @type {{ name: keyof typeof PATHS, size?: number }} */
	let { name, size = 16 } = $props();

	const PATHS = /** @type {const} */ ({
		note: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8', 'M16 13H8', 'M16 17H8'],
		todo: ['m3 17 2 2 4-4', 'm3 7 2 2 4-4', 'M13 6h8', 'M13 12h8', 'M13 18h8'],
		table: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M3 9h18', 'M3 15h18', 'M12 3v18'],
		space: [
			'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
			'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
			'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'
		],
		schema: [
			'M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
			'M7 11v4a2 2 0 0 0 2 2h4',
			'M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z'
		],
		lens: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
		history: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
		info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
		users: [
			'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
			'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
			'M22 21v-2a4 4 0 0 0-3-3.87',
			'M16 3.13a4 4 0 0 1 0 7.75'
		],
		access: [
			'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'
		],
		sync: [
			'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
			'M21 3v5h-5',
			'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
			'M8 16H3v5'
		],
		back: ['m12 19-7-7 7-7', 'M19 12H5'],
		proposal: ['M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M13 6h3a2 2 0 0 1 2 2v7', 'M6 9v12'],
		variant: [
			'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
			'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
		],
		plus: ['M5 12h14', 'M12 5v14'],
		share: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6', 'M22 11h-6'],
		key: ['m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4', 'm21 2-9.6 9.6', 'M7.5 21a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z'],
		lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
		close: ['M18 6 6 18', 'm6 6 12 12'],
		search: ['m21 21-4.34-4.34', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'],
		check: ['M20 6 9 17l-5-5']
	});
</script>

<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each PATHS[name] as d (d)}<path {d} />{/each}
</svg>

<style>
	.icon {
		flex: none;
	}
</style>
