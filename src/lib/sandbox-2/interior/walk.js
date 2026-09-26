/**
 * THE WALKER — the one way to walk on foot, wherever you walk: inside a dome on
 * its own (interior.ts: Sandbox 2 and 3) and round the dome cell (village.ts:
 * Sandbox 4). Each place only says what its ground is; how you walk on it is
 * decided here, once.
 *
 *   W A S D / ↑↓     walk and strafe · ← → turn · Shift hurry
 *   drag or click    look round (the pointer is locked while you look)
 *   a phone          move() and look() from $lib/touch/TouchStick
 *
 * Stairs: every floor is found by reaching up from the floor you truly stand
 * on (`ground`), never from the eased eye height (`feet`), which trails it on a
 * stair. And you walk in strides of a quarter metre at most, each reaching up
 * from where the last one landed, so a stair climbs as well at a hurry, or on
 * a slow phone, as at a stroll. The feet still ease after the ground, for a
 * smooth eye.
 *
 * Obstacles: a tree, a pillar or a wall is walked round rather than stopped
 * at; only when nothing can be stepped round to do you slide along it.
 */
import * as THREE from 'three'

/** Eye height above the floor you stand on, metres. */
export const EYE = 1.65
/** Walking and hurrying pace, metres a second. */
export const PACE = 6.45
export const HURRY = 14.6
/** Turning on ← and →, radians a second. */
export const TURN = 1.8
/** The longest stride taken at once, metres: short enough for any stair. */
export const STRIDE = 0.25
/** How fast the eye follows the floor underfoot. */
const EASE = 12
/** Radians of gaze per pixel: of a mouse, of a finger's swipe. */
export const MOUSE_LOOK = 0.0042
export const SWIPE_LOOK = 0.0065
const PITCH = 1.4
const KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']
/* round an obstacle: the stride turned a little at a time, either way, until it is free */
const TURNS = [25, 50, 75, 90].map((d) => (d * Math.PI) / 180)

/** Clearance kept from anything standing, metres. */
const CLEAR = 0.25
/** The cells obstacles are filed by, metres: a step looks in its own and the eight round it. */
const CELL = 8

/**
 * Everything that stands in the way on foot (trunks, pillars, tables, hives), filed
 * by 8 m cells so that a step looks only at what is near it. Whatever you already
 * stand in (set down there, or come in through a door beside it) never keeps you
 * from stepping out of it: only a step further in is refused.
 * @param {{ x: number, z: number, r: number, y?: number }[]} list each at the floor height y (0 if none)
 * @returns {(x: number, z: number, y: number, from?: { x: number, z: number }) => boolean} whether something stands in the way of a step from `from` to x, z on the floor at height y
 */
export function obstacles(list) {
	/** @type {Map<string, typeof list>} */
	const cells = new Map()
	/** too wide for a cell and its neighbours: looked at from anywhere @type {typeof list} */
	const wide = []
	for (const c of list) {
		if (c.r + CLEAR > CELL) {
			wide.push(c)
			continue
		}
		const key = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`
		const near = cells.get(key)
		if (near) near.push(c)
		else cells.set(key, [c])
	}
	/**
	 * @param {typeof list} near
	 * @param {number} x
	 * @param {number} z
	 * @param {number} y
	 * @param {{ x: number, z: number } | undefined} from
	 */
	const hit = (near, x, z, y, from) =>
		near.some((c) => {
			if (Math.abs(y - (c.y ?? 0)) >= 1) return false
			const d = Math.hypot(c.x - x, c.z - z)
			return d < c.r + CLEAR && !(from && d > Math.hypot(c.x - from.x, c.z - from.z))
		})
	return (x, z, y, from) => {
		if (hit(wide, x, z, y, from)) return true
		const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL)
		for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (hit(cells.get(`${ix + dx},${iz + dz}`) ?? [], x, z, y, from)) return true
		return false
	}
}

/**
 * What a place tells the walker about its ground.
 * @typedef {object} Ground
 * @property {(x: number, z: number, from: number) => number} floorAt the floor at x, z for someone standing at height `from`: the highest within reach above it
 * @property {(x: number, z: number, here: number, from: THREE.Vector3) => boolean} canStep whether someone standing at `from`, on the floor at height `here`, may step to x, z
 */

/**
 * Where the walker starts.
 * @typedef {object} Start
 * @property {number} x
 * @property {number} z
 * @property {number} yaw
 * @property {number} pitch
 * @property {number} [y] the floor it stands on
 */

/**
 * Walk a camera over a ground: keys, mouse and a phone's fingers in, the camera placed each step.
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} dom the view, for the mouse and the pointer lock
 * @param {Ground} ground
 * @param {Start} start
 * @param {(key: string, down: boolean) => boolean} [action] a place's own keys, taken before walking (the factory lift's ↑ and ↓)
 */
export function createWalker(camera, dom, ground, start, action) {
	const pos = new THREE.Vector3(start.x, 0, start.z)
	/** @type {Set<string>} */
	const keys = new Set()
	const stick = { x: 0, y: 0, hurry: false }
	let side = 1

	const walker = {
		/** where you stand (y stays 0: the height is `ground`) */
		pos,
		yaw: start.yaw,
		pitch: start.pitch,
		/** the floor you truly stand on */
		ground: start.y ?? 0,
		/** your feet, easing after the ground for a smooth eye */
		feet: start.y ?? 0,

		/** Take one frame of walking, `dt` seconds, and place the camera. */
		step(/** @type {number} */ dt) {
			const clamp = (/** @type {number} */ v) => Math.max(-1, Math.min(1, v))
			const f = clamp((keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) + stick.y)
			const s = clamp((keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) + stick.x)
			walker.yaw += ((keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0)) * TURN * dt
			if (f || s) {
				const speed = (keys.has('shift') || stick.hurry ? HURRY : PACE) * dt
				const dx = (-Math.sin(walker.yaw) * f + Math.cos(walker.yaw) * s) * speed
				const dz = (-Math.cos(walker.yaw) * f - Math.sin(walker.yaw) * s) * speed
				const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / STRIDE))
				const sx = dx / n, sz = dz / n
				for (let k = 0; k < n; k++) {
					const here = ground.floorAt(pos.x, pos.z, walker.ground)
					const go = (/** @type {number} */ mx, /** @type {number} */ mz) => {
						if (!ground.canStep(pos.x + mx, pos.z + mz, here, pos)) return false
						pos.x += mx
						pos.z += mz
						return true
					}
					// straight on; else round it, the side last taken first so you do not waver;
					// else slide along the ground's own axes
					if (!go(sx, sz) && !round(go, sx, sz) && !go(sx, 0)) go(0, sz)
					walker.ground = ground.floorAt(pos.x, pos.z, here)
				}
			}
			walker.ground = ground.floorAt(pos.x, pos.z, walker.ground)
			walker.feet += (walker.ground - walker.feet) * Math.min(1, dt * EASE)
			camera.position.set(pos.x, walker.feet + EYE, pos.z)
			camera.rotation.set(walker.pitch, walker.yaw, 0, 'YXZ')
		},

		/** Stand somewhere, facing somewhere, on the floor at height y. */
		place(/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ yaw, /** @type {number} */ pitch, y = 0) {
			pos.set(x, 0, z)
			walker.yaw = yaw
			walker.pitch = pitch
			walker.ground = walker.feet = y
		},

		/** Walk from a touch joystick: x to the right, y ahead, each −1…1; hurry when pushed to the edge. */
		move(/** @type {number} */ x, /** @type {number} */ y, /** @type {boolean} */ hurry) {
			Object.assign(stick, { x, y, hurry })
		},

		/** Turn the view by a finger's drag, in pixels. */
		look(/** @type {number} */ dx, /** @type {number} */ dy) {
			turn(dx, dy, SWIPE_LOOK)
		},

		/** Let go of every key and the joystick: for when walking stops and starts again. */
		halt() {
			keys.clear()
			Object.assign(stick, { x: 0, y: 0, hurry: false })
		},

		dispose() {
			window.removeEventListener('keydown', onKeyDown)
			window.removeEventListener('keyup', onKeyUp)
			window.removeEventListener('mousemove', onMouseMove)
			window.removeEventListener('mouseup', onMouseUp)
			dom.removeEventListener('mousedown', onMouseDown)
			if (document.pointerLockElement === dom) document.exitPointerLock()
		}
	}

	/**
	 * @param {(mx: number, mz: number) => boolean} go
	 * @param {number} sx
	 * @param {number} sz
	 */
	const round = (go, sx, sz) => {
		for (const a of TURNS) {
			// slowed the further it must turn
			const len = Math.max(0.4, Math.cos(a))
			for (const sg of [side, -side]) {
				const c = Math.cos(a * sg), sn = Math.sin(a * sg)
				if (go((sx * c - sz * sn) * len, (sx * sn + sz * c) * len)) {
					side = sg
					return true
				}
			}
		}
		return false
	}

	const turn = (/** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ rate) => {
		walker.yaw -= dx * rate
		walker.pitch = Math.max(-PITCH, Math.min(PITCH, walker.pitch - dy * rate))
	}

	const onKey = (/** @type {KeyboardEvent} */ e, /** @type {boolean} */ down) => {
		const k = e.key.toLowerCase()
		if (action?.(k, down)) {
			e.preventDefault()
			keys.delete(k)
			return
		}
		if (!KEYS.includes(k)) return
		if (down) keys.add(k)
		else keys.delete(k)
		e.preventDefault()
	}
	const onKeyDown = (/** @type {KeyboardEvent} */ e) => onKey(e, true)
	const onKeyUp = (/** @type {KeyboardEvent} */ e) => onKey(e, false)
	let dragging = false
	const onMouseDown = () => {
		dragging = true
		dom.requestPointerLock?.()
	}
	const onMouseMove = (/** @type {MouseEvent} */ e) => {
		if (document.pointerLockElement === dom || dragging) turn(e.movementX, e.movementY, MOUSE_LOOK)
	}
	const onMouseUp = () => (dragging = false)
	window.addEventListener('keydown', onKeyDown)
	window.addEventListener('keyup', onKeyUp)
	dom.addEventListener('mousedown', onMouseDown)
	window.addEventListener('mousemove', onMouseMove)
	window.addEventListener('mouseup', onMouseUp)
	// on a phone the page's fingers walk (move) and look round (look)
	dom.style.touchAction = 'none'

	return walker
}
