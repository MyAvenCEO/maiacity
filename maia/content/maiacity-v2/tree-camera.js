import { Box3, Vector3, MathUtils } from 'three';

/** Fit both growth stages inside the narrower camera angle, with a little breathing room.
 * @param {import('three').Box3} bounds
 * @param {import('three').Matrix4} transform
 * @param {Vector3} previousEye
 * @param {number} aspect
 */
export function growthFrame(bounds, transform, previousEye, aspect) {
	// Include the player and container beside even a tiny seedling.
	const box = bounds.clone().union(new Box3(new Vector3(-0.55, 0, -1.1), new Vector3(0.55, 1.9, 0.4))).applyMatrix4(transform);
	const radius = Math.max(0.18, box.getSize(new Vector3()).length() / 2);
	const target = box.getCenter(new Vector3());
	const vertical = MathUtils.degToRad(42) / 2;
	const halfFov = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
	const distance = radius / Math.sin(halfFov) * 1.12;
	const direction = previousEye.clone().sub(target).setY(0);
	if (direction.lengthSq() < 0.001) direction.set(1, 0, 1);
	direction.normalize().setY(0.45).normalize();
	return { target, eye: target.clone().addScaledVector(direction, distance) };
}
