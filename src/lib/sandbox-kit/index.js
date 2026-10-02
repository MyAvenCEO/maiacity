/**
 * THE SANDBOX KIT — what every avenCITY sandbox world is made with, taken out of Sandbox 4.
 *
 * In the world (three.js):
 *   createStage   the canvas, the scene and the camera, kept to their container's size and smooth on a slow phone
 *   createSky     the one sky of every world, a view of one universe (./universe.js): from the ground, or round a
 *                 planet from space; the sun and moon on the hour, shadows, fog in the horizon's colour, the stars
 *   createWalker  the first-person camera: WASD and drag to look, a joystick and a finger on a phone
 *   createObstacles  what stands in the walker's way, filed in 8 m cells; never a trap to whoever stands in it
 *   createOrbitRig  the map camera: WASD travels, drag turns and tilts, the wheel zooms to the cursor
 *   connectFilm   hands the world to the film camera (window.__world): the studio can shoot it
 *
 * On the page (Svelte):
 *   SkyControl    the time of the sky: Auto (the in-game clock) or Manual (a slider, from noon), one state for
 *                 every sandbox (./skyTime.svelte.js)
 *   WalkHint      how to walk, for keys and for fingers
 *   WorldBar      the bar along the top: the way back, the world's name, its SkyControl; slimmer on a phone
 *   …and $lib/touch/TouchStick, the phone's joystick, hands `move` and `look` to the walker.
 *
 * How to build a new sandbox with it: ./README.md.
 */
export { createStage } from './stage.js';
export { createSky, createSkyClock, lightAt, sunAt } from './sky.js';
export { celestial, createUniverse, horizonAt } from './universe.js';
export { automatic, manual, skyHour, skyTime, NOON } from './skyTime.svelte.js';
export { createWalker } from './walker.js';
export { createObstacles } from './obstacles.js';
export { createOrbitRig } from './orbit.js';
export { connectFilm, createCameraHold, filmDraws, filmHoldsSize, worldTime } from './film.js';
export { default as SkyControl } from './SkyControl.svelte';
export { default as WalkHint } from './WalkHint.svelte';
export { default as WorldBar } from './WorldBar.svelte';
