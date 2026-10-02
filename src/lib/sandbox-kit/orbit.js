/**
 * THE ORBIT RIG — the map camera of a sandbox seen from above (Sandbox 1's island, Sandbox 2's city islands).
 *
 * One scheme, the city-builder one, after Age of Empires, Anno and Cities: Skylines:
 *   · WASD / arrow keys travel the map, and so does a phone's joystick ($lib/touch/TouchStick: `move`)
 *   · the wheel zooms toward whatever the cursor is over
 *   · drag turns and tilts, right-drag slides, Q/E turn from the keyboard
 *   · a click stays a click, so it can still select
 *
 * The two gestures stay strictly separate: dragging sets the ANGLE and the wheel sets the DISTANCE. Coupling them
 * (zooming in also tilting toward eye level, the way Cities: Skylines does) reads as the camera fighting you once you
 * have chosen an angle you want to keep. With `freeMove: false` it is a turntable: orbit one fixed point, never leave.
 *
 * It is a camera hold (./film.js): the film camera flies it to a pose (`fly`) and lets go (`release`), and the map
 * takes over from wherever the camera was left, looking where it looked.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** @typedef {import('./film.js').Pose} Pose */

/**
 * @typedef {object} OrbitRig
 * @property {OrbitControls} controls
 * @property {(x: number, y: number, hurry: boolean) => void} move travel from a touch joystick: x to the right, y ahead, each -1…1; hurry when pushed to the edge
 * @property {(dt: number) => void} update call once per frame with the frame delta in seconds
 * @property {(x: number, y: number, z: number, yaw: number, pitch: number) => void} fly hold the camera at a pose, free of the controls
 * @property {() => Pose | null} flying
 * @property {() => boolean} apply put the camera at the held pose now (false when nothing is held)
 * @property {() => void} release give the camera back to the map, looking where it looked
 * @property {() => void} dispose
 */

const PAN_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const TURN_KEYS = new Set(['q', 'e']);
const TURN_SPEED = 1.4;

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} dom
 * @param {{ minDistance?: number, maxDistance?: number, moveSpeed?: number, target?: THREE.Vector3, floorY?: number, freeMove?: boolean }} [options]
 *   minDistance, maxDistance: how near and far the camera may be from what it looks at; moveSpeed: world units per
 *   second of keyboard travel; target: where it looks as it starts; floorY: the camera never drops below this height —
 *   no going under the board; freeMove: false locks the view to orbiting one fixed point (a turntable)
 * @returns {OrbitRig}
 */
export function createOrbitRig(camera, dom, options = {}) {
	const minDistance = options.minDistance ?? 1.2;
	const maxDistance = options.maxDistance ?? 300;
	const freeMove = options.freeMove ?? true;
	const floorY = options.floorY ?? 0;
	const speed = options.moveSpeed ?? 26;

	const controls = new OrbitControls(camera, dom);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = minDistance;
	controls.maxDistance = maxDistance;
	controls.minPolarAngle = 0.05;
	controls.maxPolarAngle = Math.PI * 0.495;
	controls.screenSpacePanning = false;
	// zoom lands where you are pointing, the way every map does
	controls.zoomToCursor = true;
	// drag turns and tilts; right-drag slides the map; a click is still a click
	controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
	controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
	if (options.target) controls.target.copy(options.target);

	if (!freeMove) {
		// a specimen turntable: look at it from any angle, never leave it
		controls.enablePan = false;
		controls.mouseButtons.RIGHT = null;
		controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
	}

	const held = new Set();
	const stick = { x: 0, y: 0, hurry: false };
	const forward = new THREE.Vector3();
	const right = new THREE.Vector3();
	const move = new THREE.Vector3();
	const spherical = new THREE.Spherical();
	const offset = new THREE.Vector3();
	/** @type {Pose | null} */
	let flying = null;

	/** Swings the view around its focus point — the Q/E keys. @param {number} radians */
	function turn(radians) {
		offset.copy(camera.position).sub(controls.target);
		spherical.setFromVector3(offset);
		spherical.theta += radians;
		camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
	}

	/** @param {KeyboardEvent} e */
	function onKeyDown(e) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const target = /** @type {HTMLElement | null} */ (e.target);
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
		const k = e.key.toLowerCase();
		if (!TURN_KEYS.has(k) && !(freeMove && PAN_KEYS.has(k))) return;
		held.add(k);
		e.preventDefault();
	}
	/** @param {KeyboardEvent} e */
	function onKeyUp(e) {
		held.delete(e.key.toLowerCase());
	}
	/** Losing focus must not leave a key stuck down mid-travel. */
	function onBlur() {
		held.clear();
	}
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', onBlur);

	function apply() {
		if (!flying) return false;
		camera.position.set(flying[0], flying[1], flying[2]);
		camera.rotation.set(flying[4], flying[3], 0, 'YXZ');
		return true;
	}

	/** @param {number} dt */
	function update(dt) {
		if (apply()) return;
		const step = Math.min(dt, 0.05);

		if (held.has('q')) turn(TURN_SPEED * step);
		if (held.has('e')) turn(-TURN_SPEED * step);

		if (freeMove && (held.size > 0 || stick.x || stick.y)) {
			camera.getWorldDirection(forward);
			forward.y = 0;
			if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
			forward.normalize();
			right.crossVectors(forward, camera.up).normalize();

			move.set(0, 0, 0);
			if (held.has('w') || held.has('arrowup')) move.add(forward);
			if (held.has('s') || held.has('arrowdown')) move.sub(forward);
			if (held.has('d') || held.has('arrowright')) move.add(right);
			if (held.has('a') || held.has('arrowleft')) move.sub(right);
			move.addScaledVector(forward, stick.y).addScaledVector(right, stick.x);

			const length = move.length();
			if (length > 0) {
				// travel scales with how far out you are: a step that feels right
				// on the board view would be a teleport at ground level
				const zoomScale = Math.max(0.08, camera.position.distanceTo(controls.target) / 60);
				// never faster than one key's worth; a half-pushed stick goes at half pace
				const pace = Math.min(1, length) / length;
				move.multiplyScalar(pace * speed * zoomScale * step * (stick.hurry ? 2.2 : 1));
				camera.position.add(move);
				controls.target.add(move);
			}
		}

		controls.update();

		// never let the view sink under the ground — orbiting low, travelling
		// downhill or dollying in all try to, and the world has no underside
		if (camera.position.y < floorY) {
			camera.position.y = floorY;
			if (controls.target.y < floorY) controls.target.y = floorY;
		}
	}

	return {
		controls,
		move(x, y, hurry) {
			Object.assign(stick, { x, y, hurry });
		},
		update,
		fly(x, y, z, yaw, pitch) {
			flying = [x, y, z, yaw, pitch];
			controls.enabled = false;
		},
		flying: () => flying,
		apply,
		release() {
			if (!flying) return;
			// the map looks on from where the film left the camera, at what it was looking at
			const distance = Math.max(minDistance, Math.min(maxDistance, camera.position.distanceTo(controls.target)));
			camera.getWorldDirection(forward);
			controls.target.copy(camera.position).addScaledVector(forward, distance);
			flying = null;
			controls.enabled = true;
		},
		dispose() {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
			controls.dispose();
		}
	};
}
