/** @typedef {import('./types.js').MediaItem} MediaItem */
/** @typedef {{ url: string, duration: number, peaks: number[], buffer?: AudioBuffer }} Source */
/** @typedef {'ready' | 'loading' | 'waiting' | 'silent' | `failed: ${string}`} SoundState */

/** @param {AudioBuffer} buffer */
export function peaksOf(buffer) {
	const data = buffer.getChannelData(0);
	const count = Math.min(8000, Math.ceil(buffer.duration * 100));
	const step = Math.floor(data.length / count);
	return Array.from({ length: count }, (_, index) => {
		let peak = 0;
		for (let sample = index * step; sample < (index + 1) * step; sample++) peak = Math.max(peak, Math.abs(data[sample] ?? 0));
		return peak;
	});
}

export class MediaSources {
	/** @type {Map<string, Source>} */
	cache = new Map();
	/** @type {Map<string, Promise<Source>>} */
	pending = new Map();
	/** @type {Map<string, Promise<void>>} */
	pendingSound = new Map();
	/** @type {Map<string, { state: SoundState, from?: string }>} */
	sounds = new Map();
	/** @type {Set<string>} */
	urls = new Set();
	/** @type {AbortController} */
	abort = new AbortController();
	/** @type {OfflineAudioContext | null} */
	decoder = null;
	/** @type {Promise<unknown>} */
	probeQueue = Promise.resolve();
	/** @type {Promise<unknown>} */
	soundQueue = Promise.resolve();
	/** @type {(() => void) | null} */
	cancelProbe = null;
	closed = false;
	/**
	 * @param {{ item: (hash: string) => MediaItem | undefined, reload: () => Promise<void>,
	 * url: (hash: string) => string, proxy: (item: MediaItem) => string | null | undefined,
	 * publish: (hash: string, source: Source) => void,
	 * command: (name: string, args: Record<string, unknown>) => Promise<unknown>,
	 * native: () => boolean, hasSound: (item: MediaItem) => boolean,
	 * publishSound: (hash: string, state: SoundState) => void,
	 * fetch?: typeof fetch, video?: () => HTMLVideoElement }} ports
	 */
	constructor(ports) { this.ports = ports; }
	assertOpen() {
		if (this.closed) throw new Error('Media sources are closed');
	}
	/** @param {string} hash @param {Source} source */
	update(hash, source) {
		this.assertOpen();
		this.cache.set(hash, source);
		this.ports.publish(hash, source);
		return source;
	}
	/** @param {ArrayBuffer} bytes */
	decode(bytes) {
		this.assertOpen();
		return (this.decoder ??= new OfflineAudioContext(1, 1, 48000)).decodeAudioData(bytes);
	}
	/** @param {string} hash */
	async bytesOf(hash) {
		this.assertOpen();
		const response = await (this.ports.fetch ?? fetch)(this.ports.url(hash), { signal: this.abort.signal });
		if (!response.ok) throw new Error(`the vault did not give ${hash.slice(0, 12)} (${response.status})`);
		const bytes = await response.arrayBuffer();
		this.assertOpen();
		return bytes;
	}
	/** @param {string} hash @returns {Promise<Source>} */
	source(hash) {
		if (this.closed) return Promise.reject(new Error('Media sources are closed'));
		const cached = this.cache.get(hash);
		if (cached) return Promise.resolve(cached);
		const pending = this.pending.get(hash);
		if (pending) return pending;
		const loading = this.load(hash).finally(() => this.pending.delete(hash));
		this.pending.set(hash, loading);
		return loading;
	}
	/** @param {string} hash @returns {Promise<Source>} */
	async load(hash) {
		let item = this.ports.item(hash);
		if (!item) {
			await this.ports.reload();
			this.assertOpen();
			item = this.ports.item(hash);
		}
		if (!item) throw new Error(`${hash.slice(0, 12)}… is not in the library (yet).`);
		if (item.kind === 'video') {
			const source = this.update(hash, { url: this.ports.url(hash), duration: Number(item.meta?.duration_s) || 3600, peaks: [] });
			this.probeQueue = this.probeQueue.then(() => this.probe(hash)).catch(() => {});
			return source;
		}
		if (item.kind === 'image') {
			return this.update(hash, { url: this.ports.url(this.ports.proxy(item) || hash), duration: 4, peaks: [] });
		}
		const bytes = await this.bytesOf(hash);
		const buffer = item.kind === 'audio' ? await this.decode(bytes.slice(0)) : undefined;
		this.assertOpen();
		const url = URL.createObjectURL(new Blob([bytes], { type: item.mime }));
		this.urls.add(url);
		return this.update(hash, { url, duration: buffer?.duration ?? 4, peaks: buffer ? peaksOf(buffer) : [], buffer });
	}
	/** @param {string} hash */
	async probe(hash) {
		if (this.closed) return;
		const duration = await new Promise((resolve) => {
			const video = this.ports.video?.() ?? document.createElement('video');
			video.preload = 'metadata';
			video.crossOrigin = 'anonymous';
			let finished = false;
			/** @param {number} duration */
			const done = (duration) => {
				if (finished) return;
				finished = true;
				clearTimeout(timeout);
				video.onloadedmetadata = video.onerror = null;
				video.removeAttribute('src');
				video.load();
				this.cancelProbe = null;
				resolve(duration);
			};
			const timeout = setTimeout(() => done(0), 8000);
			this.cancelProbe = () => done(0);
			video.onloadedmetadata = () => done(video.duration || 0);
			video.onerror = () => done(0);
			video.src = this.ports.url(hash);
		});
		const source = this.cache.get(hash);
		if (!this.closed && duration && source) this.update(hash, { ...source, duration: Number(duration) });
	}
	/** @param {string} hash @param {SoundState} state @param {string} [from] */
	setSound(hash, state, from) {
		if (this.closed) return;
		this.sounds.set(hash, { state, from });
		this.ports.publishSound(hash, state);
	}
	/** @param {string} hash */
	async sound(hash) {
		if (this.closed) return;
		const item = this.ports.item(hash);
		try { await this.source(hash); }
		catch (error) { if (!this.closed) throw error; }
		if (this.closed || item?.kind !== 'video') return;
		if (this.cache.get(hash)?.buffer) return this.setSound(hash, 'ready');
		if (!this.ports.hasSound(item)) return this.setSound(hash, 'silent');
		const waiting = this.pendingSound.get(hash);
		if (waiting) return waiting;
		const proxy = this.ports.proxy(item);
		const from = proxy || hash;
		const previous = this.sounds.get(hash);
		if (previous?.state.startsWith('failed') && previous.from === from) return;
		const loading = (async () => {
			this.setSound(hash, 'loading', from);
			try {
				const at = proxy ? (this.ports.item(proxy) ?? item) : item;
				const readable = proxy || (item.size && item.size <= 200 * 1024 * 1024 ? hash : null);
				const buffer = this.ports.native() ? await this.soundOnMac(at)
					: readable ? await this.decode(await this.bytesOf(readable)) : null;
				if (this.closed) return;
				if (!buffer) return this.setSound(hash, 'waiting', from);
				this.update(hash, { .../** @type {Source} */ (this.cache.get(hash)), buffer, peaks: peaksOf(buffer) });
				this.setSound(hash, 'ready', from);
			} catch (error) {
				this.setSound(hash, `failed: ${/** @type {Error} */ (error).message}`, from);
			}
		})();
		this.pendingSound.set(hash, loading);
		try { await loading; }
		finally { this.pendingSound.delete(hash); }
	}
	/** @param {MediaItem} item @returns {Promise<AudioBuffer | null>} */
	soundOnMac(item) {
		const turn = this.soundQueue.then(async () => {
			this.assertOpen();
			const rate = 48000;
			const got = await this.ports.command('studio_sound', { r: item.hash, name: item.original_name || item.title || 'movie.mov', rate });
			this.assertOpen();
			const bytes = got instanceof ArrayBuffer ? got : new Uint8Array(/** @type {number[]} */ (got)).buffer;
			const length = Math.floor(bytes.byteLength / 2);
			if (!length) return null;
			const pcm = new Int16Array(bytes, 0, length);
			const buffer = new AudioBuffer({ numberOfChannels: 1, length, sampleRate: rate });
			const channel = buffer.getChannelData(0);
			for (let index = 0; index < length; index++) channel[index] = pcm[index] / 32768;
			return buffer;
		});
		this.soundQueue = turn.catch(() => null);
		return turn;
	}
	close() {
		this.closed = true;
		this.abort.abort();
		this.cancelProbe?.();
		for (const url of this.urls) URL.revokeObjectURL(url);
		this.urls.clear();
		this.cache.clear();
		this.pending.clear();
		this.pendingSound.clear();
		this.sounds.clear();
		this.decoder = null;
	}
}
