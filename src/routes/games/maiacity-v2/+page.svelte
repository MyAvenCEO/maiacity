<!--
	MaiaCity V2's film page: with ?film&area=A (the first player's) or B (the second's), the film camera
	(src/lib/film) over the world playing that seat's whole first-run intro on the film's clock
	($lib/maiacity-v2/film.js), for the studio's world viewer and the plate renderer; else it passes on to the game,
	/app/maiacity-v2/ (the registry's route, game/film/worlds.js).
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
</script>

<FilmRoute sandbox="maiacity-v2" mount={async (stage, area, onProgress) => (await import('$lib/maiacity-v2/film.js')).mountIntroFilm(stage, area === 'C' ? 'C' : area === 'B' ? 'B' : 'A', onProgress)} />
