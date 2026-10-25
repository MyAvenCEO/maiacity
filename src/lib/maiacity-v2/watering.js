/** Hand a downward-looking shot back to orbit without placing its pivot beneath the soil.
 * @param {import('three').Vector3} eye
 * @param {import('three').Vector3} direction
 */
export function orbitTarget(eye, direction) {
	const distance = direction.y < 0 && eye.y > 0 ? Math.min(40, eye.y / -direction.y) : 40;
	return eye.clone().addScaledVector(direction, distance).setY(Math.max(0, eye.y + direction.y * distance));
}
