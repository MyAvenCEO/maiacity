// @ts-nocheck
import { expect, test } from 'bun:test';
import { MediaSources, peaksOf } from './media-sources.js';

const deferred = () => {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
};
function fixture(overrides = {}) {
	const published = [];
	const service = new MediaSources({
		item: (hash) => ({ hash, kind: 'audio', mime: 'audio/wav' }),
		reload: async () => {}, url: (hash) => `/media/${hash}`, proxy: () => null,
		publish: (...args) => published.push(args), command: async () => new ArrayBuffer(0),
		native: () => false, hasSound: () => true, publishSound: () => {},
		fetch: async () => new Response(new Uint8Array([1, 2])), ...overrides
	});
	service.decode = async () => ({ duration: 1, getChannelData: () => new Float32Array(100).fill(0.5) });
	return { service, published };
}

test('one in-flight load and decoded buffer per source; owned URLs are revoked on close', async () => {
	const response = deferred();
	let reads = 0;
	const { service, published } = fixture({ fetch: () => { reads++; return response.promise; } });
	const first = service.source('audio');
	expect(service.source('audio')).toBe(first);
	response.resolve(new Response(new Uint8Array([1, 2])));
	const source = await first;
	expect(await service.source('audio')).toBe(source);
	expect(reads).toBe(1);
	expect(published).toHaveLength(1);
	expect(source.peaks).toEqual(new Array(100).fill(0.5));
	expect((await fetch(source.url)).ok).toBe(true);
	service.close();
	await expect(fetch(source.url)).rejects.toThrow();
	expect(service.cache.size).toBe(0);
});

test('a failed read is retryable, not permanently cached', async () => {
	let reads = 0;
	const { service } = fixture({ fetch: async () => new Response('', { status: ++reads === 1 ? 503 : 200 }) });
	await expect(service.source('audio')).rejects.toThrow('503');
	expect((await service.source('audio')).buffer).toBeDefined();
	expect(reads).toBe(2);
	service.close();
});

test('a late fetch cannot publish or create an owned URL after disposal', async () => {
	const response = deferred();
	let signal;
	const { service, published } = fixture({ fetch: (_, options) => { signal = options.signal; return response.promise; } });
	const loading = service.source('audio');
	service.close();
	expect(signal.aborted).toBe(true);
	response.resolve(new Response('late'));
	await expect(loading).rejects.toThrow('closed');
	expect(published).toEqual([]);
	expect(service.urls.size).toBe(0);
	await expect(service.source('another')).rejects.toThrow('closed');
});

test('new images are classified after a library reload without downloading them as audio', async () => {
	let item;
	const { service } = fixture({
		item: () => item, reload: async () => { item = { hash: 'still', kind: 'image' }; },
		proxy: () => 'proxy', fetch: () => { throw new Error('must not fetch'); }
	});
	expect(await service.source('still')).toEqual({ url: '/media/proxy', duration: 4, peaks: [] });
	service.close();
});

test('disposal quietly cancels background sound preparation without publishing late state', async () => {
	const response = deferred();
	const states = [];
	const { service, published } = fixture({ fetch: () => response.promise, publishSound: (_, state) => states.push(state) });
	const preparing = service.sound('audio');
	service.close();
	response.resolve(new Response('late'));
	await preparing;
	await service.sound('closed');
	expect(states).toEqual([]);
	expect(published).toEqual([]);
});

test('video metadata probes are serialized and disposal releases the active player', async () => {
	const videos = [];
	const { service, published } = fixture({
		item: (hash) => ({ hash, kind: 'video', meta: { duration_s: 12 } }),
		video: () => {
			const video = { duration: 20, removeAttribute() { this.removed = true; }, load() {} };
			videos.push(video);
			return video;
		}
	});
	await service.source('one');
	await service.source('two');
	expect(videos).toHaveLength(1);
	videos[0].onloadedmetadata();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(service.cache.get('one').duration).toBe(20);
	expect(videos).toHaveLength(2);
	const before = published.length;
	service.close();
	await service.probeQueue;
	expect(videos.every((video) => video.removed && video.onloadedmetadata === null)).toBe(true);
	expect(published).toHaveLength(before);
});

test('native reads serialize, recover after failure, and queued reads stop on disposal', async () => {
	const first = deferred();
	let reads = 0;
	const { service } = fixture({ command: () => ++reads === 1 ? first.promise : Promise.resolve(new ArrayBuffer(0)) });
	const one = service.soundOnMac({ hash: 'one' });
	const two = service.soundOnMac({ hash: 'two' });
	await Promise.resolve();
	expect(reads).toBe(1);
	first.reject(new Error('native failure'));
	await expect(one).rejects.toThrow('native failure');
	expect(await two).toBeNull();
	expect(reads).toBe(2);
	const three = service.soundOnMac({ hash: 'three' });
	service.close();
	await expect(three).rejects.toThrow('closed');
	expect(reads).toBe(2);
});

test('waveforms preserve the original 8000-bar bound', () => {
	expect(peaksOf({ duration: 1000, getChannelData: () => new Float32Array(16000).fill(-0.75) })).toEqual(new Array(8000).fill(0.75));
});

test('large browser originals wait for a proxy; failures retry only when the source changes', async () => {
	let proxy = null;
	let reads = 0;
	const states = [];
	const { service } = fixture({
		item: (hash) => ({ hash, kind: 'video', size: 300 * 1024 * 1024 }),
		proxy: () => proxy,
		video: () => ({ removeAttribute() {}, load() {} }),
		publishSound: (_, state) => states.push(state),
		fetch: async () => { reads++; return new Response('', { status: reads === 1 ? 503 : 200 }); }
	});
	await service.sound('movie');
	expect(states.at(-1)).toBe('waiting');
	expect(reads).toBe(0);
	proxy = 'proxy-1';
	await service.sound('movie');
	expect(states.at(-1)).toContain('failed');
	await service.sound('movie');
	expect(reads).toBe(1);
	proxy = 'proxy-2';
	await Promise.all([service.sound('movie'), service.sound('movie')]);
	expect(reads).toBe(2);
	expect(states.at(-1)).toBe('ready');
	expect(service.cache.get('movie').buffer).toBeDefined();
	service.close();
});
