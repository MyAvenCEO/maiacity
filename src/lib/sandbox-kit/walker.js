/**
 * THE WALKER — the first-person camera every sandbox world is walked with.
 *
 * Taken out of Sandbox 4. WASD or the arrow keys walk (←/→ turn), Shift hurries; drag on
 * the canvas to look round (it takes the pointer, so the mouse alone looks on); on a phone
 * the page hands it a joystick and a finger (`move`, `look`: $lib/touch/TouchStick).
 *
 * The world says where you may stand and how high: `canStand(x, z, here, ground)` and
 * `floorAt(x, z, ground)`. You walk in short strides, each reaching up from the floor you
 * stand on, so a stair climbs as well at a hurry, and on a slow phone, as at a stroll; a
 * tree, a pillar or a wall in the way is walked round rather than stopped at; the eye
 * eases after the floor, so a step up is not a jolt.
 *
 * The film camera (src/lib/film) can take the camera from the walker (`fly`) and give it
 * back (`place`).
 */

/** @typedef {[x: number, y: number, z: number, yaw: number, pitch: number]} Pose */

/**
 * @typedef {object} WalkerHandle
 * @property {{ x: number, z: number }} position where the walker stands (live: it changes as they walk)
 * @property {() => number} yaw which way they face, radians (0 looks along -z)
 * @property {() => number} pitch how far up they look, radians
 * @property {() => number} ground the floor they stand on
 * @property {(dt: number) => void} update call every frame with the seconds since the last: walk, and put the camera where they are
 * @property {(x: number, y: number, hurry: boolean) => void} move walk from a touch joystick: x to the right, y ahead, each -1…1; hurry when pushed to the edge
 * @property {(dx: number, dy: number) => void} look turn the view by a finger's drag, in pixels
 * @property {(x: number, z: number, yaw: number, pitch: number, y?: number) => void} place stand here, facing so (on a floor `y` high, if given)
 * @property {(x: number, y: number, z: number, yaw: number, pitch: number) => void} fly hold the camera at a pose, free of the ground, until `place`
 * @property {() => Pose | null} flying the pose the camera is held at, if any
 * @property {() => void} stop let go of every key and the joystick (as the page is paused, so no key is left held)
 * @property {() => void} dispose
 */

const KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
/* round a tree, a pillar or a wall rather than stopping at it: the stride is turned a little
   at a time, either way, until it is free, and slowed the further it must turn */
const TURNS = [25, 50, 75, 90].map((d) => (d * Math.PI) / 180);

/**
 * @param {import('three').PerspectiveCamera} camera
 * @param {HTMLElement} dom the canvas: a drag on it looks round
 * @param {{
 *   x?: number, z?: number, yaw?: number, pitch?: number,
 *   eye?: number, walk?: number, hurry?: number, turn?: number,
 *   mouse?: number, touch?: number, maxPitch?: number, stride?: number,
 *   canStand?: (x: number, z: number, here: number, ground: number) => boolean,
 *   floorAt?: (x: number, z: number, ground: number) => number
 * }} [options]
 *   x, z, yaw, pitch: where they start and how they face; eye: eye height over the floor (m); walk, hurry: paces (m/s);
 *   turn: the arrow keys' turn (rad/s); mouse, touch: radians a pixel of drag turns; maxPitch: how far up or down they
 *   may look; stride: the longest stride (m); canStand: may they stand at x, z coming from a floor `here` high (the
 *   open ground, everywhere, if not given); floorAt: the floor at x, z for someone now on `ground` (0 if not given)
 * @returns {WalkerHandle}
 */
export function createWalker(camera, dom, options = {}) {
	const {
		eye = 1.65,
		walk = 6.45,
		hurry = 14.6,
		turn = 1.8,
		mouse = 0.0042,
		touch = 0.0065,
		maxPitch = 1.4,
		stride = 0.25,
		canStand = () => true,
		floorAt = () => 0
	} = options;
	const pos = { x: options.x ?? 0, z: options.z ?? 0 };
	let yaw = options.yaw ?? Math.PI;
	let pitch = options.pitch ?? 0.08;
	/** the floor you truly stand on, and your feet easing after it (for a smooth eye) */
	let ground = 0;
	let feet = 0;
	/** @type {Pose | null} */
	let flying = null;
	const tilt = (/** @type {number} */ dy, /** @type {number} */ k) => (pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch - dy * k)));

	const keys = new Set();
	const onKey = (/** @type {KeyboardEvent} */ e, /** @type {boolean} */ down) => {
		const k = e.key.toLowerCase();
		if (!KEYS.includes(k)) return;
		if (down) keys.add(k);
		else keys.delete(k);
		e.preventDefault();
	};
	const kd = (/** @type {KeyboardEvent} */ e) => onKey(e, true);
	const ku = (/** @type {KeyboardEvent} */ e) => onKey(e, false);
	window.addEventListener('keydown', kd);
	window.addEventListener('keyup', ku);
	let dragging = false;
	const onDown = () => {
		dragging = true;
		dom.requestPointerLock?.();
	};
	const onMove = (/** @type {MouseEvent} */ e) => {
		if (document.pointerLockElement !== dom && !dragging) return;
		yaw -= e.movementX * mouse;
		tilt(e.movementY, mouse);
	};
	const onUp = () => (dragging = false);
	dom.addEventListener('mousedown', onDown);
	window.addEventListener('mousemove', onMove);
	window.addEventListener('mouseup', onUp);
	// on a phone the page's fingers walk (move) and look round (look)
	dom.style.touchAction = 'none';
	const stick = { x: 0, y: 0, hurry: false };

	/** the side last taken round something is tried first, so you keep going round the same way and do not waver */
	let side = 1;
	const round = (/** @type {(mx: number, mz: number) => boolean} */ go, /** @type {number} */ sx, /** @type {number} */ sz) => {
		for (const a of TURNS) {
			const len = Math.max(0.4, Math.cos(a));
			for (const sg of [side, -side]) {
				const c = Math.cos(a * sg), sn = Math.sin(a * sg);
				if (go((sx * c - sz * sn) * len, (sx * sn + sz * c) * len)) {
					side = sg;
					return true;
				}
			}
		}
		return false;
	};
	const step = (/** @type {number} */ dt) => {
		const clamp = (/** @type {number} */ v) => Math.max(-1, Math.min(1, v));
		const f = clamp((keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) + stick.y);
		const s = clamp((keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) + stick.x);
		yaw += ((keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0)) * turn * dt;
		if (f || s) {
			const speed = (keys.has('shift') || stick.hurry ? hurry : walk) * dt;
			const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed;
			const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed;
			// in short strides, each reaching up from the floor you stand on
			const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / stride));
			const sx = dx / n, sz = dz / n;
			for (let k = 0; k < n; k++) {
				const here = floorAt(pos.x, pos.z, ground);
				const go = (/** @type {number} */ mx, /** @type {number} */ mz) => {
					if (!canStand(pos.x + mx, pos.z + mz, here, ground)) return false;
					pos.x += mx;
					pos.z += mz;
					return true;
				};
				if (!go(sx, sz) && !round(go, sx, sz)) {
					// nothing to step round to: slide along the ground's own axes
					if (!go(sx, 0)) go(0, sz);
				}
				ground = floorAt(pos.x, pos.z, ground);
			}
		}
		ground = floorAt(pos.x, pos.z, ground);
		feet += (ground - feet) * Math.min(1, dt * 12);
		camera.position.set(pos.x, feet + eye, pos.z);
		camera.rotation.set(pitch, yaw, 0, 'YXZ');
	};

	return {
		position: pos,
		yaw: () => yaw,
		pitch: () => pitch,
		ground: () => ground,
		update(dt) {
			if (!flying) return step(dt);
			camera.position.set(flying[0], flying[1], flying[2]);
			camera.rotation.set(flying[4], flying[3], 0, 'YXZ');
		},
		move: (x, y, h) => Object.assign(stick, { x, y, hurry: h }),
		look: (dx, dy) => {
			yaw -= dx * touch;
			tilt(dy, touch);
		},
		place(x, z, yw, p, y) {
			flying = null;
			if (y !== undefined) ground = feet = y;
			pos.x = x;
			pos.z = z;
			yaw = yw;
			pitch = p;
		},
		fly: (x, y, z, yw, p) => void (flying = [x, y, z, yw, p]),
		flying: () => flying,
		stop() {
			keys.clear();
			Object.assign(stick, { x: 0, y: 0, hurry: false });
		},
		dispose() {
			window.removeEventListener('keydown', kd);
			window.removeEventListener('keyup', ku);
			dom.removeEventListener('mousedown', onDown);
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			if (document.pointerLockElement === dom) document.exitPointerLock();
		}
	};
}
