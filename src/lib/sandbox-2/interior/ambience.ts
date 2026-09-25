/**
 * The sounds of the land: the forest always, the stream as you come near
 * it, the hens, the geese and the goats as you walk up to them. Each is a
 * looping recording (static/sounds), streamed rather than decoded, so the
 * five-minute forest costs next to nothing in memory; Web Audio sets its
 * volume, easing it up and down as the distances change. Under the glass of
 * a dome everything outside is muffled.
 *
 * Browsers only let a page make sound after you have touched it, so the
 * sounds start with your first click or key.
 */
import { base } from '$app/paths'

export type SoundName = 'forest' | 'water' | 'hens' | 'geese' | 'goats'
const FILES: Record<SoundName, string> = {
	forest: 'forest_nature.mp3',
	water: 'water_stream.mp3',
	hens: 'chickens.mp3',
	geese: 'geese.mp3',
	goats: 'sheep.mp3'
}
/** how loud each is at its loudest */
const LOUDEST: Record<SoundName, number> = { forest: 0.45, water: 0.55, hens: 0.5, geese: 0.45, goats: 0.4 }

export type Ambience = {
	/** how near each sound is, 0 (silent) to 1 (right there), and whether you are under glass */
	set: (levels: Partial<Record<SoundName, number>>, indoors: boolean) => void
	dispose: () => void
}

/** Loudness from distance: full within `near` metres, fading to nothing at `far`. */
export const nearness = (d: number, near: number, far: number) => {
	const t = Math.max(0, Math.min(1, (far - d) / (far - near)))
	return t * t
}

export function ambience(): Ambience {
	let ctx: AudioContext | null = null
	let filter: BiquadFilterNode | null = null
	const tracks = new Map<SoundName, { el: HTMLAudioElement; gain: GainNode }>()
	let wanted: Partial<Record<SoundName, number>> = {}
	let underGlass = false

	const start = () => {
		if (ctx) return void ctx.resume()
		ctx = new AudioContext()
		filter = ctx.createBiquadFilter()
		filter.type = 'lowpass'
		filter.frequency.value = 20000
		filter.connect(ctx.destination)
		for (const name of Object.keys(FILES) as SoundName[]) {
			const el = new Audio(`${base}/sounds/${FILES[name]}`)
			el.loop = true
			el.preload = 'auto'
			el.crossOrigin = 'anonymous'
			const gain = ctx.createGain()
			gain.gain.value = 0
			ctx.createMediaElementSource(el).connect(gain).connect(filter)
			// every loop starts somewhere else, so two visits never sound the same
			el.addEventListener('loadedmetadata', () => (el.currentTime = Math.random() * Math.max(0, el.duration - 1)), { once: true })
			void el.play().catch(() => {})
			tracks.set(name, { el, gain })
		}
		apply()
	}
	const apply = () => {
		if (!ctx || !filter) return
		const now = ctx.currentTime
		for (const [name, { gain }] of tracks) {
			const v = (wanted[name] ?? 0) * LOUDEST[name] * (underGlass && name !== 'forest' ? 0.5 : 1)
			// a slow glide, so nothing ever switches on or off
			gain.gain.setTargetAtTime(v, now, 0.6)
		}
		filter.frequency.setTargetAtTime(underGlass ? 900 : 20000, now, 0.5)
	}
	const gesture = () => start()
	window.addEventListener('pointerdown', gesture)
	window.addEventListener('keydown', gesture)

	return {
		set: (levels, indoors) => {
			wanted = levels
			underGlass = indoors
			// a dev hook: what is playing, and how loud
			;(window as unknown as { __ambience?: unknown }).__ambience = { levels, indoors, started: !!ctx, state: ctx?.state }
			apply()
		},
		dispose: () => {
			window.removeEventListener('pointerdown', gesture)
			window.removeEventListener('keydown', gesture)
			for (const { el } of tracks.values()) {
				el.pause()
				el.src = ''
			}
			void ctx?.close()
			ctx = null
		}
	}
}

type Where = () => { x: number; z: number }[]
/** The sounds a walker at (x, z) should hear: the forest outside, and how near the water and each herd are. */
export function levelsAt(x: number, z: number, indoors: boolean, water: { x: number; z: number }[], herds: Partial<Record<'hens' | 'geese' | 'goats', Where>>) {
	const nearest = (pts: { x: number; z: number }[]) => {
		let best = Infinity
		for (const p of pts) {
			const dx = p.x - x, dz = p.z - z
			if (Math.abs(dx) < best && Math.abs(dz) < best) best = Math.min(best, Math.hypot(dx, dz))
		}
		return best
	}
	return {
		forest: indoors ? 0.35 : 1,
		water: nearness(nearest(water), 3, 32),
		hens: herds.hens ? nearness(nearest(herds.hens()), 2, 26) : 0,
		geese: herds.geese ? nearness(nearest(herds.geese()), 3, 32) : 0,
		goats: herds.goats ? nearness(nearest(herds.goats()), 3, 30) : 0
	}
}
