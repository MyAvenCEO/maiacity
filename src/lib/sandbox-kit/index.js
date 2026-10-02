/**
 * THE SANDBOX KIT — what every avenCITY sandbox world is made with, taken out of Sandbox 4.
 *
 * In the world (three.js):
 *   createStage   the canvas, the scene and the camera, kept to their container's size and smooth on a slow phone
 *   createSky     the one sky of every world: a sun and moon that follow the in-game clock, shadows, fog, stars;
 *                 kept at day if asked. lightAt(hour) and createSkyClock() are its light and its hour, for a world
 *                 with no sky round it (the planet)
 *   createWalker  the first-person camera: WASD and drag to look, a joystick and a finger on a phone
 *   createOrbitRig  the map camera: WASD travels, drag turns and tilts, the wheel zooms to the cursor
 *   connectFilm   hands the world to the film camera (window.__world): the studio can shoot it
 *
 * On the page (Svelte):
 *   SkyToggle     the switch between the real sky and an always-day sky
 *   WorldClock    the in-game time
 *   WalkHint      how to walk, for keys and for fingers
 *   …and $lib/touch/TouchStick, the phone's joystick, hands `move` and `look` to the walker.
 *
 * How to build a new sandbox with it: ./README.md.
 */
export { createStage } from './stage.js';
export { createSky, createSkyClock, lightAt, sunAt, DAY_HOUR } from './sky.js';
export { createWalker } from './walker.js';
export { createOrbitRig } from './orbit.js';
export { connectFilm, createCameraHold, filmDraws, filmHoldsSize, worldTime } from './film.js';
export { default as SkyToggle } from './SkyToggle.svelte';
export { default as WorldClock } from './WorldClock.svelte';
export { default as WalkHint } from './WalkHint.svelte';
