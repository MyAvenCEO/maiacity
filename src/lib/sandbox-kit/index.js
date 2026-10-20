/**
 * THE SANDBOX KIT — what every avenCITY sandbox world is made with, taken out of Sandbox 4.
 *
 * In the world (three.js):
 *   createStage   the canvas, the scene and the camera, kept to their container's size and smooth on a slow phone:
 *                 the world renderer ($lib/render/world.js `createWorldRenderer`), under its kit name
 *   createSky     the one sky of every world, a view of one universe (./universe.js): from the ground, or round a
 *                 planet from space; the sun and moon on the hour, shadows, fog in the horizon's colour, the stars
 *   createWalker  the first-person camera: WASD and drag to look, a joystick and a finger on a phone
 *   createObstacles  what stands in the walker's way, filed in 8 m cells; never a trap to whoever stands in it
 *   createOrbitRig  the map camera: WASD travels, drag turns and tilts, the wheel zooms to the cursor
 *   connectFilm   hands the world to the film camera (window.__world): the studio can shoot it
 *   seededRandom  chance that is the same every time (./random.js), for whatever a world scatters
 *   disposeObject a world's shapes, materials and pictures let go of, all at once ($lib/render/core.js)
 *
 * On the page (Svelte):
 *   SkyControl    the time of the sky: Auto (the in-game clock) or Manual (a slider, from noon), one state for
 *                 every sandbox (./skyTime.svelte.js)
 *   WalkHint      how to walk, for keys and for fingers
 *   WorldBar      the bar along the top: the world's name, its SkyControl; slimmer on a phone (the way back is the
 *                 app's nav pill)
 *   WorldPage     the whole page of a world you walk: the stage, the bar, the hint, the joystick and the cover while
 *                 it comes up; the page hands it `mount`
 *   …and $lib/touch/TouchStick, the phone's joystick, hands `move` and `look` to the walker.
 *
 * How to build a new sandbox with it: ./README.md.
 */
export { createWorldRenderer as createStage } from '$lib/render/world.js';
export { createSky, createSkyClock, lightAt, sunAt } from './sky.js';
export { celestial, createUniverse, horizonAt, sunOverGround } from './universe.js';
export { seededLcg, seededMinStd, seededRandom } from './random.js';
export { disposeObject } from '$lib/render/core.js';
export { automatic, manual, skyHour, skyTime, NOON } from './skyTime.svelte.js';
export { createWalker, PACE } from './walker.js';
export { createObstacles } from './obstacles.js';
export { createOrbitRig } from './orbit.js';
export { aim, connectFilm, createCameraHold, filmDraws, filmHoldsSize, poseIn, poseOf, worldTime } from './film.js';
export { createTimeline } from './timeline.js';
export { default as SkyControl } from './SkyControl.svelte';
export { default as WalkHint } from './WalkHint.svelte';
export { default as WorldBar } from './WorldBar.svelte';
export { default as WorldPage } from './WorldPage.svelte';
