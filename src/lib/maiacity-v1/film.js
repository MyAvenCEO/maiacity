import { createIntroFilm } from '$lib/sandbox-kit/intro-film.js';
import { createWorld } from './world.js';
import { momentOf } from './tour.js';
import * as intro from './intro.js';

// Same world as Game.svelte; the shared film driver supplies its clock and camera.
export const mountIntroFilm = createIntroFilm({ sandbox: 'maiacity-v1', createWorld, momentOf, intro });
