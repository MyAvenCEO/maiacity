<!--
	One picture as an article's header (./PostLayout.svelte's `hero`), shown whole: a title card keeps its words and
	its edges whatever its shape. Where its shape is not the header's (a 16:9 cover in the wide 5:2 header), the rest of
	the header is the same picture, blurred and darkened behind it, so nothing is cut and nothing is left blank. Used
	where an article has one picture only: a post of the Maia Universe and an article in avenDB. A blog post with a
	5:2 banner of its own keeps ./Banner.svelte.
-->
<script>
	// @ts-nocheck — plain JS
	/** @type {{ src: string, alt?: string }} */
	let { src, alt = '' } = $props();
</script>

<div class="cover">
	<img class="behind" {src} alt="" aria-hidden="true" />
	<img class="whole" {src} {alt} fetchpriority="high" />
</div>

<style>
	.cover {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #111;
	}

	img {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
	}

	/* the same picture, filling the header behind it: soft and dark, so the sharp one reads as the picture */
	.behind {
		object-fit: cover;
		filter: blur(28px) brightness(0.55) saturate(1.1);
		transform: scale(1.15);
	}

	.whole {
		object-fit: contain;
	}
</style>
