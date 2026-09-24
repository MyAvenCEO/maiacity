/**
 * THE CAMERA RIG — from orbit to a walk.
 *
 * One camera, one continuous control. Far out it orbits the globe looking
 * straight down at the point beneath it; as it comes closer it tilts up
 * toward the horizon, and at the bottom of the zoom it stands at eye height
 * on the cards and walks. Everything scales with altitude: a drag that
 * swings a hemisphere from orbit moves a few steps on the ground.
 *
 *   drag          far: pan the globe · near: turn (left–right) and walk (up–down)
 *   wheel / pinch altitude, on a log scale
 *   W A S D / ↑↓←→  walk and strafe · Q E turn
 *   the walk    zooming in past the threshold hands the gaze to the mouse by
 *                 itself (pointer lock): the cursor goes, a reticle marks the
 *                 centre, and every movement of the mouse turns the gaze — all
 *                 the way round if you like. Keys walk; a click picks what the
 *                 reticle is on. Esc lets go; a click takes it again; zooming
 *                 out gives it back. Where the page may not lock the pointer,
 *                 the cursor stays visible as a crosshair — it is the reticle —
 *                 and the gaze still turns one to one with it; pushed to the
 *                 edge of the view it keeps turning that way, so a full circle
 *                 is a push and a hold.
 *
 * The position is a unit vector on the sphere plus an altitude above the
 * surface, and a heading: a compass bearing from local north. The camera
 * looks along the heading, pitched from −89° (orbit) to −11° (walking).
 */
import * as THREE from 'three'

export type RigOptions = {
	/** Radius of the ground the walker stands on (the tallest card). */
	surface: number
	/** Eye height above the surface at the bottom of the zoom. */
	eye?: number
	/** Altitude at the top of the zoom. */
	ceiling?: number
	/** Where to start, as a direction from the globe's centre. */
	start: THREE.Vector3
	/** Starting altitude. */
	altitude: number
	/** A reticle to show while the mouse has the gaze. */
	reticle?: HTMLElement
}

/** Below this zoom the walk is on: the mouse takes the gaze here, and gives it back here. */
const WALK = 0.38
/** Radians of gaze per pixel of mouse: a full circle in about 1,250 px. */
const LOOK = 0.005

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const smooth = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export class CameraRig {
	/** Direction from the centre to the point the camera stands over. */
	readonly pos: THREE.Vector3
	/** Bearing from local north, clockwise, radians. */
	heading = 0
	altitude: number
	private target: number
	private readonly eye: number
	private readonly ceiling: number
	private dragging = false
	private last = { x: 0, y: 0 }
	private readonly inertia = new THREE.Vector2()
	private readonly keys = new Set<string>()
	private readonly off: (() => void)[] = []
	/** The walker's free gaze, up or down from the level, radians. */
	private lookPitch = 0
	/** Set by the click that took the lock, so the same click does not also pick. */
	private lockClick = false
	/** The gaze follows the mouse without a lock — the fallback where locking is refused. */
	private softLook = false
	/** The walk has taken the gaze once for this descent; Esc can let go without it grabbing again. */
	private engaged = false
	/** Where the mouse is, −1..1 across and down the view — the unlocked gaze steers by it. */
	private readonly stick = new THREE.Vector2()
	/** While a sheet is open the camera holds still and the mouse is its own again. */
	frozen = false
	/** A flight in progress: the point on the globe to bring into the middle of the view. */
	private flight: THREE.Vector3 | null = null
	/** Where on the screen the flight should land it, in normalised view units (0,0 is the middle). */
	private flightAt = new THREE.Vector2()
	private readonly reticle?: HTMLElement

	constructor(private readonly camera: THREE.PerspectiveCamera, private readonly dom: HTMLElement, opts: RigOptions) {
		this.pos = opts.start.clone().normalize()
		this.eye = opts.eye ?? 0.9
		this.ceiling = opts.ceiling ?? opts.surface * 5
		this.altitude = this.target = Math.min(this.ceiling, Math.max(this.eye, opts.altitude))
		this.surface = opts.surface
		this.reticle = opts.reticle
		dom.style.touchAction = 'none'
		this.listen()
		this.place()
	}
	private readonly surface: number

	/** 0 at eye height, 1 at the ceiling, on a log scale — the zoom the controls feel. */
	get zoom(): number {
		return Math.log(this.altitude / this.eye) / Math.log(this.ceiling / this.eye)
	}

	/** Local frame at the position: up, and the heading's forward and right, all tangent-true. */
	frame(at: THREE.Vector3 = this.pos) {
		const up = at.clone()
		const east = new THREE.Vector3().crossVectors(WORLD_UP, up)
		if (east.lengthSq() < 1e-8) east.set(1, 0, 0)
		east.normalize()
		const north = new THREE.Vector3().crossVectors(up, east).normalize()
		const forward = north.clone().multiplyScalar(Math.cos(this.heading)).addScaledVector(east, Math.sin(this.heading))
		const right = east.clone().multiplyScalar(Math.cos(this.heading)).addScaledVector(north, -Math.sin(this.heading))
		return { up, forward, right }
	}

	/** Step along a tangent direction by an angle (radians of the great circle). */
	private step(dir: THREE.Vector3, angle: number) {
		if (!angle) return
		this.pos.multiplyScalar(Math.cos(angle)).addScaledVector(dir, Math.sin(angle)).normalize()
	}

	/** Ground angle per pixel of drag: proportional to altitude, so the ground under the pointer stays under it. */
	private get anglePerPixel() {
		return (0.0016 * this.altitude) / this.surface
	}

	/** How much the controls are "orbit" (1) versus "walk" (0). */
	private get orbitness() {
		return smooth(WALK, WALK + 0.22, this.zoom)
	}

	/** Whether the pointer is locked to the view — the cursor gone, the reticle the only aim. */
	get lockedGaze() {
		return document.pointerLockElement === this.dom
	}

	/** Whether the mouse has the gaze right now, locked or not. */
	get looking() {
		return document.pointerLockElement === this.dom || this.softLook
	}

	private letGo() {
		this.softLook = false
		this.stick.set(0, 0)
		if (document.pointerLockElement === this.dom) document.exitPointerLock()
		this.lockClick = false
		this.show()
	}

	/** Locked, the cursor goes and the reticle marks the centre. Unlocked, the cursor stays as a crosshair and is the reticle itself. */
	private show() {
		const looking = this.looking
		if (this.reticle) this.reticle.hidden = !looking || this.softLook
		this.dom.style.cursor = looking ? (this.softLook ? 'crosshair' : 'none') : ''
	}

	/** Hand the gaze to the mouse: lock the pointer, or follow it unlocked where that is refused. */
	private engage() {
		const soft = () => {
			this.softLook = true
			this.show()
		}
		try {
			const p = this.dom.requestPointerLock?.() as Promise<void> | undefined
			if (p?.catch) p.catch(soft)
			else if (!this.dom.requestPointerLock) soft()
		} catch {
			soft()
		}
	}

	/** Hold the camera where it is and give the mouse back — for while an overlay is open. */
	freeze(on: boolean) {
		this.frozen = on
		if (on) {
			this.letGo()
			this.keys.clear()
			this.dragging = false
			this.inertia.set(0, 0)
			this.target = this.altitude
		}
	}

	/** True once, for the click that took the lock; the world skips picking on it. */
	consumeLockClick() {
		const was = this.lockClick
		this.lockClick = false
		return was
	}

	private drag(dx: number, dy: number) {
		const { forward, right } = this.frame()
		const o = this.orbitness
		const a = this.anglePerPixel
		/* Grab the ground: drag right, the world goes right — the camera moves left. */
		this.step(right, -dx * a * o)
		this.step(forward, dy * a)
		/* Near the ground a sideways drag turns you instead. */
		this.heading += dx * 0.0035 * (1 - o)
	}

	private listen() {
		const dom = this.dom
		const down = (e: PointerEvent) => {
			if (e.button !== 0 || this.looking || this.frozen) return
			this.dragging = true
			this.last = { x: e.clientX, y: e.clientY }
			this.inertia.set(0, 0)
			dom.setPointerCapture(e.pointerId)
		}
		const move = (e: PointerEvent) => {
			if (!this.dragging) return
			this.flight = null
			const dx = e.clientX - this.last.x
			const dy = e.clientY - this.last.y
			this.last = { x: e.clientX, y: e.clientY }
			this.drag(dx, dy)
			this.inertia.set(dx, dy)
		}
		const up = (e: PointerEvent) => {
			if (!this.dragging) return
			this.dragging = false
			if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId)
			/* A still click at walking height: the mouse takes the gaze. */
			const still = Math.hypot(e.clientX - this.last.x, e.clientY - this.last.y) < 6 && this.inertia.lengthSq() < 1
			if (still && this.zoom < WALK && !this.looking && e.pointerType === 'mouse') {
				this.lockClick = true
				this.engaged = true
				this.engage()
			}
		}
		/* With the gaze, the mouse moves it one to one: every pixel of mouse
		   turns the gaze, round and round. Unlocked, the mouse's place in the
		   view is noted too, so the edge can keep the turn going (in update()). */
		const look = (e: MouseEvent) => {
			if (!this.looking || this.frozen) return
			this.heading += e.movementX * LOOK
			this.lookPitch = Math.min(THREE.MathUtils.degToRad(70), Math.max(THREE.MathUtils.degToRad(-55), this.lookPitch - e.movementY * LOOK))
			if (this.softLook) {
				const r = dom.getBoundingClientRect()
				this.stick.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
			}
		}
		const lockChange = () => {
			this.show()
			if (!this.looking) this.lockClick = false
		}
		const wheel = (e: WheelEvent) => {
			if (this.frozen) return
			e.preventDefault()
			this.flight = null
			const k = e.deltaMode === 1 ? 0.05 : 0.0012
			this.target = Math.min(this.ceiling, Math.max(this.eye, this.target * Math.exp(e.deltaY * k)))
		}
		const typing = (e: KeyboardEvent) => e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]') != null
		const keydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && this.softLook) this.letGo()
			if (this.frozen || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
			this.flight = null
			if (KEYS.has(e.key)) {
				this.keys.add(e.key)
				e.preventDefault()
			}
		}
		const keyup = (e: KeyboardEvent) => this.keys.delete(e.key)
		const blur = () => this.keys.clear()
		dom.addEventListener('pointerdown', down)
		dom.addEventListener('pointermove', move)
		dom.addEventListener('pointerup', up)
		dom.addEventListener('pointercancel', up)
		dom.addEventListener('wheel', wheel, { passive: false })
		document.addEventListener('mousemove', look)
		document.addEventListener('pointerlockchange', lockChange)
		window.addEventListener('keydown', keydown)
		window.addEventListener('keyup', keyup)
		window.addEventListener('blur', blur)
		this.off.push(
			() => dom.removeEventListener('pointerdown', down),
			() => dom.removeEventListener('pointermove', move),
			() => dom.removeEventListener('pointerup', up),
			() => dom.removeEventListener('pointercancel', up),
			() => dom.removeEventListener('wheel', wheel),
			() => document.removeEventListener('mousemove', look),
			() => document.removeEventListener('pointerlockchange', lockChange),
			() => window.removeEventListener('keydown', keydown),
			() => window.removeEventListener('keyup', keyup),
			() => window.removeEventListener('blur', blur)
		)
	}

	/** Advance by `dt` seconds: keys, inertia, the eased zoom, then place the camera. */
	update(dt: number) {
		if (this.frozen) return this.place()
		const k = this.keys
		if (k.size) {
			const { forward, right } = this.frame()
			/* Ground speed grows with altitude — a stroll at eye height, a sweep from orbit — up to a cap. */
			const a = Math.min(1.2, (2.8 * Math.max(this.altitude, this.eye)) / this.surface) * dt
			const f = (k.has('w') || k.has('W') || k.has('ArrowUp') ? 1 : 0) - (k.has('s') || k.has('S') || k.has('ArrowDown') ? 1 : 0)
			const r = (k.has('d') || k.has('D') ? 1 : 0) - (k.has('a') || k.has('A') ? 1 : 0)
			const turn = (k.has('e') || k.has('E') || k.has('ArrowRight') ? 1 : 0) - (k.has('q') || k.has('Q') || k.has('ArrowLeft') ? 1 : 0)
			this.step(forward, f * a)
			this.step(right, r * a)
			this.heading += turn * 1.6 * dt
		}
		if (this.softLook) {
			/* Unlocked, a mouse runs out of view at the edge. Pushed into the outer
			   tenth, the turn keeps going that way, faster the harder the push. */
			const x = this.stick.x, edge = 0.8
			const push = Math.abs(x) > edge ? Math.sign(x) * ((Math.abs(x) - edge) / (1 - edge)) : 0
			this.heading += push * 3.6 * dt
		}
		if (!this.dragging && this.inertia.lengthSq() > 0.01) {
			this.inertia.multiplyScalar(0.9)
			this.drag(this.inertia.x, this.inertia.y)
		}
		if (this.flight) {
			const aim = this.standFor(this.flight)
			if (this.pos.angleTo(aim) < 1e-4) this.flight = null
			else {
				const turn = new THREE.Quaternion().setFromUnitVectors(this.pos, aim)
				this.pos.applyQuaternion(new THREE.Quaternion().slerp(turn, 1 - Math.pow(0.02, dt))).normalize()
			}
		}
		this.altitude = lerp(this.altitude, this.target, 1 - Math.pow(0.001, dt))
		/* One threshold: descending through it hands the gaze to the mouse by itself,
		   once per descent; rising through it gives the mouse back. */
		const z = this.zoom
		if (z < WALK && !this.looking && !this.engaged) {
			this.engaged = true
			this.engage()
		}
		if (z > WALK) {
			this.engaged = false
			if (this.looking) this.letGo()
		}
		this.place()
	}

	/** Put the camera where the rig says: over the position, pitched for the altitude. */
	/** The gaze's pitch at a zoom: straight down from orbit, toward the horizon on the way in. */
	private pitchAt(z: number) {
		return THREE.MathUtils.degToRad(lerp(-11, -89, smooth(0, 0.85, z)))
	}

	/**
	 * Fly to a point on the globe and settle with it in the middle of the view,
	 * high enough to see its neighbours. Any drag, scroll or key takes over again.
	 */
	flyTo(point: THREE.Vector3, zoom = 0.5, at = new THREE.Vector2()) {
		this.flight = point.clone().normalize()
		this.flightAt.copy(at)
		this.inertia.set(0, 0)
		this.target = this.eye * Math.pow(this.ceiling / this.eye, zoom)
	}

	/**
	 * Where to stand so the point shows at flightAt on the screen: behind it along
	 * the heading for a tilted gaze (further for a spot higher up the view), and to
	 * the side for a spot left or right of the middle.
	 */
	private standFor(point: THREE.Vector3) {
		const half = THREE.MathUtils.degToRad(this.camera.fov) / 2
		const pitch = Math.min(-0.05, this.pitchAt(this.zoom) + Math.atan(this.flightAt.y * Math.tan(half)))
		const ahead = this.altitude / Math.tan(-pitch) / this.surface
		const range = this.altitude / Math.sin(-pitch)
		const aside = (-this.flightAt.x * Math.tan(half) * this.camera.aspect * range) / this.surface
		const { forward, right } = this.frame(point)
		return point.clone().addScaledVector(forward, -Math.tan(ahead)).addScaledVector(right, Math.tan(aside)).normalize()
	}

	private place() {
		const { up, forward } = this.frame()
		const z = this.zoom
		/* Straight down from orbit, toward the horizon on the way in, a walker's gaze at the bottom —
		   and there the mouse's own tilt, which fades as the walker rises. */
		const walk = 1 - smooth(WALK, WALK * 1.8, z)
		const pitch = this.pitchAt(z) + this.lookPitch * walk
		const dir = forward.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch))
		/* The camera's up is the surface up, less what the gaze already takes — heading-up when looking straight down. */
		const camUp = up.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(forward, -Math.sin(pitch)).normalize()
		this.camera.position.copy(up).multiplyScalar(this.surface + this.altitude)
		this.camera.up.copy(camUp)
		this.camera.lookAt(this.camera.position.clone().add(dir))
		const fov = lerp(62, 40, smooth(0, 0.6, z))
		if (Math.abs(this.camera.fov - fov) > 0.01) {
			this.camera.fov = fov
			this.camera.updateProjectionMatrix()
		}
	}

	dispose() {
		this.letGo()
		for (const f of this.off) f()
	}
}

const KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'W', 'A', 'S', 'D', 'Q', 'E', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
