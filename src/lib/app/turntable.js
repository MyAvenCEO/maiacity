/*
 * The turntables' camera ($lib/app/Turntable.svelte: the biomes, the 3D models, the actors, the plants), fitted to the
 * canvas it draws on. A turntable frames its thing for a canvas as wide as it is high or wider; on a canvas taller than
 * it is wide (a phone upright, a tablet) the same field of view would cut the thing off at its sides, so the view
 * widens there until it is as wide as it would be on a square canvas.
 */

/**
 * Size the camera to a canvas of `w` × `h`: its aspect, and its field of view widened from its turntable's own
 * (`camera.userData.fov`, set by the page; without one, as it is — a walk keeps its own) on an upright canvas.
 * @param {import('three').PerspectiveCamera} camera @param {number} w @param {number} h
 */
export function fit(camera, w, h) {
	camera.aspect = w / Math.max(1, h);
	const fov = camera.userData.fov;
	if (fov) {
		const half = Math.tan((fov * Math.PI) / 360);
		camera.fov = camera.aspect < 1 ? Math.min(100, (Math.atan(half / camera.aspect) * 360) / Math.PI) : fov;
	}
	camera.updateProjectionMatrix();
}
