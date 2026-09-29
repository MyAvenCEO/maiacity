// What a library file is to the render worker: its bytes on this disk, what ffprobe says about it, how its YUV is
// read, and which colour profile it is in — and the ffmpeg input arguments for any stretch of it. An EXR sequence
// (one tar per clip in the library) is unpacked once into the cache and read as numbered frames.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detect, exrHeader, profileOf } from '../../game/film/color.js';
import { CACHE, codingOf } from './color/ffmpeg.mjs';

/** A file's extension by its type — the worker's cache names files <cid>.<ext>. */
export const EXT = /** @type {Record<string, string>} */ ({
	'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/x-exr': 'exr',
	'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
	'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
	'application/x-tar': 'tar', 'application/octet-stream': 'bin'
});

/**
 * @typedef {{ cid: string, mime: string, kind: string, size: number, title: string, tags: string[], meta: Record<string, any> }} Media
 * @typedef {{ codec_name?: string, codec_type?: string, pix_fmt?: string, width?: number, height?: number, color_primaries?: string,
 *   color_transfer?: string, color_space?: string, color_range?: string, bits_per_raw_sample?: string, r_frame_rate?: string,
 *   avg_frame_rate?: string, nb_frames?: string, nb_read_packets?: string, duration?: string, bit_rate?: string, tags?: Record<string, string> }} Stream
 * @typedef {{ duration?: string, bit_rate?: string, size?: string, tags?: Record<string, string> }} Format
 * @typedef {{ streams: Stream[], format: Format }} Probe
 */

/** ffprobe's streams and format of a file (with `count`, every packet counted: the true frame count). */
export function probe(/** @type {string} */ file, /** @type {{ count?: boolean }} */ o = {}) {
	const out = execFileSync('ffprobe', ['-v', 'error', ...(o.count ? ['-count_packets'] : []), '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
	return /** @type {Probe} */ (JSON.parse(out));
}

/** The first bytes of a file (an EXR's header). */
export function head(/** @type {string} */ file, n = 65536) {
	const fd = openSync(file, 'r');
	const buf = new Uint8Array(n);
	const got = readSync(fd, buf, 0, n, 0);
	closeSync(fd);
	return buf.subarray(0, got);
}

/** An EXR sequence's tar, unpacked once into the cache: the folder of its frames (000000.exr, 000001.exr, …). */
export function unpack(/** @type {string} */ tar, /** @type {string} */ cid) {
	const dir = join(CACHE, 'seq', cid);
	if (existsSync(join(dir, '.done'))) return dir;
	rmSync(dir, { recursive: true, force: true });
	const part = `${dir}.part`;
	rmSync(part, { recursive: true, force: true });
	mkdirSync(part, { recursive: true });
	execFileSync('tar', ['-xf', tar, '-C', part]);
	writeFileSync(join(part, '.done'), '');
	renameSync(part, dir);
	return dir;
}

/** The frames of an unpacked sequence, in order. */
export const framesIn = (/** @type {string} */ dir) => readdirSync(dir).filter((f) => /\.exr$/i.test(f)).sort();

/**
 * @typedef {{ media: Media | null, file: string, kind: 'video' | 'image' | 'sequence', stream: Stream, format: Format,
 *   coding: ReturnType<typeof codingOf>, profile: import('../../game/film/color.js').Profile | 'unknown',
 *   color: import('../../game/film/color.js').ColorInfo, width: number, height: number, fps: number, frames: number | null,
 *   dir: string | null, pattern: string | null, start: number, audio: boolean }} Source
 */

/**
 * What a file is: probed, its colour read (the library's meta.color when it has one — its override first — else
 * detected now), its YUV coding.
 * @param {string} file @param {Media | null} media
 * @param {{ profile?: string, fresh?: boolean }} [o] `profile` forces one (world plates); `fresh` detects anew, keeping only a
 *   hand-set override from the library (the proxy job)
 * @returns {Source}
 */
export function sourceOf(file, media, o = {}) {
	const seq = media?.mime === 'application/x-tar' || /\.tar$/.test(file);
	let dir = null, pattern = null, first = file, frames = null, start = 0;
	if (seq) {
		dir = unpack(file, media?.cid ?? file.replace(/[^a-z0-9]/gi, '_'));
		const list = framesIn(dir);
		if (!list.length) throw new Error(`${media?.title || file}: the sequence holds no .exr frames`);
		first = join(dir, list[0]);
		const digits = list[0].replace(/\.exr$/i, '');
		if (!/^\d+$/.test(digits)) throw new Error(`${media?.title || file}: sequence frames are named by number (000000.exr, …), not ${list[0]}`);
		pattern = join(dir, `%0${digits.length}d.exr`);
		start = Number(digits);
		frames = list.length;
	}
	const p = probe(first);
	const stream = p.streams.find((s) => s.codec_type === 'video') ?? p.streams[0];
	if (!stream) throw new Error(`${media?.title || file}: no picture in it`);
	const isExr = stream.codec_name === 'exr';
	const kind = seq ? 'sequence' : media?.kind === 'image' || (!media && /\.(png|jpe?g|webp|exr)$/i.test(file)) ? 'image' : 'video';
	const detected = detect(stream, p.format, kind === 'video' ? 'video' : 'image', { exr: isExr ? exrHeader(head(first)) : null, sequence: seq ? media?.meta ?? null : null });
	const known = media?.meta?.color;
	const color = o.fresh ? { ...detected, ...(known?.override ? { override: known.override } : {}) } : known?.profile ? { ...detected, ...known } : detected;
	const profile = /** @type {Source['profile']} */ (o.profile ?? profileOf(color));
	const rate = (/** @type {string | undefined} */ r) => { const [a, b] = String(r ?? '').split('/').map(Number); return a && b ? a / b : 0; };
	const fps = seq ? Number(media?.meta?.fps) || 24 : rate(stream.avg_frame_rate) || rate(stream.r_frame_rate) || 30;
	return {
		media, file, kind, stream, format: p.format, coding: codingOf(stream), profile, color,
		width: Number(stream.width), height: Number(stream.height), fps, frames, dir, pattern, start,
		audio: p.streams.some((s) => s.codec_type === 'audio')
	};
}

/**
 * ffmpeg input arguments for `seconds` of a source from `from` (seconds into it). A still loops; a sequence starts
 * at its frame.
 * @param {Source} s @param {number} from @param {number} seconds @param {number} fps the film's rate (stills)
 */
export function inputArgs(s, from, seconds, fps) {
	const t = seconds.toFixed(3);
	if (s.kind === 'image') return ['-loop', '1', '-framerate', String(fps), '-t', t, '-i', s.file];
	if (s.kind === 'sequence') {
		const at = s.start + Math.max(0, Math.min((s.frames ?? 1) - 1, Math.round(from * s.fps)));
		return ['-framerate', String(s.fps), '-start_number', String(at), '-t', t, '-i', /** @type {string} */ (s.pattern)];
	}
	return ['-ss', Math.max(0, from).toFixed(3), '-t', t, '-i', s.file];
}

/** Is the ffmpeg here able to read EXR? (Every build with the exr decoder is.) */
export function canReadExr() {
	const r = spawnSync('ffmpeg', ['-hide_banner', '-decoders'], { encoding: 'utf8' });
	return /\sexr\s/.test(r.stdout ?? '');
}
