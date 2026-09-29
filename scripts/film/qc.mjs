// QC before a delivery goes to the vault: what ffprobe says the file is (BT.709 tags, TV range, bit depth), that it
// has every frame of the timeline and runs its length, the platforms' limits — and its loudness (EBU R 128:
// integrated LUFS and true peak). A file that fails a hard check never reaches the vault.
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { probe } from './sources.mjs';

/**
 * @typedef {{ ok: boolean, errors: string[], warnings: string[], frames: number, expectedFrames: number, seconds: number,
 *   pixFmt: string, bitDepth: number, tags: { primaries?: string, transfer?: string, matrix?: string, range?: string },
 *   bitrate: number, bytes: number }} Qc
 */

/**
 * @param {string} file
 * @param {{ seconds: number, fps: number, bitDepth: 8 | 10, width: number, height: number, codec: 'hevc' | 'h264', maxBitrate?: number, maxBytes?: number, maxSeconds?: number }} want
 * @returns {Qc}
 */
export function qc(file, want) {
	const p = probe(file, { count: true });
	const v = p.streams.find((s) => s.codec_type === 'video');
	const a = p.streams.find((s) => s.codec_type === 'audio');
	/** @type {string[]} */
	const errors = [];
	/** @type {string[]} */
	const warnings = [];
	if (!v) return { ok: false, errors: ['no picture'], warnings, frames: 0, expectedFrames: 0, seconds: 0, pixFmt: '', bitDepth: 0, tags: {}, bitrate: 0, bytes: 0 };
	const tags = { primaries: v.color_primaries, transfer: v.color_transfer, matrix: v.color_space, range: v.color_range };
	for (const [k, x] of /** @type {const} */ ([['primaries', 'bt709'], ['transfer', 'bt709'], ['matrix', 'bt709'], ['range', 'tv']]))
		if (tags[k] !== x) errors.push(`${k} is tagged ${tags[k] ?? 'nothing'}, not ${x}`);
	const pixFmt = v.pix_fmt ?? '';
	const bitDepth = /p10(le|be)?$/.test(pixFmt) ? 10 : /p12/.test(pixFmt) ? 12 : 8;
	if (bitDepth !== want.bitDepth) errors.push(`${bitDepth}-bit picture (${pixFmt}), not ${want.bitDepth}-bit`);
	if (v.codec_name !== want.codec) errors.push(`codec ${v.codec_name}, not ${want.codec}`);
	if (Number(v.width) !== want.width || Number(v.height) !== want.height) errors.push(`${v.width}×${v.height}, not ${want.width}×${want.height}`);
	const frames = Number(v.nb_read_packets ?? v.nb_frames ?? 0);
	const expectedFrames = Math.round(want.seconds * want.fps);
	if (Math.abs(frames - expectedFrames) > 1) errors.push(`${frames} frames, the timeline has ${expectedFrames}`);
	const seconds = Number(p.format.duration ?? 0);
	if (Math.abs(seconds - want.seconds) > 2 / want.fps + 0.05) errors.push(`${seconds.toFixed(3)} s long, the timeline is ${want.seconds.toFixed(3)} s`);
	if (!a) errors.push('no sound');
	const bytes = statSync(file).size;
	const bitrate = Number(v.bit_rate ?? 0) || (seconds ? (bytes * 8) / seconds : 0);
	if (want.maxBitrate && bitrate > want.maxBitrate * 1.1) warnings.push(`video at ${(bitrate / 1e6).toFixed(1)} Mbps, over the ${(want.maxBitrate / 1e6).toFixed(0)} Mbps the platforms take`);
	if (want.maxBytes && bytes > want.maxBytes) warnings.push(`${(bytes / 1e6).toFixed(0)} MB, over the platform's ${(want.maxBytes / 1e6).toFixed(0)} MB`);
	if (want.maxSeconds && seconds > want.maxSeconds) warnings.push(`${seconds.toFixed(0)} s, over the platform's ${want.maxSeconds} s`);
	return { ok: errors.length === 0, errors, warnings, frames, expectedFrames, seconds, pixFmt, bitDepth, tags, bitrate: Math.round(bitrate), bytes };
}

/**
 * The loudness of a file's sound: integrated loudness (LUFS), loudness range (LU) and true peak (dBTP), by ffmpeg's
 * EBU R 128 meter.
 * @param {string} file @returns {{ lufs: number | null, lra: number | null, truePeak: number | null }}
 */
export function loudness(file) {
	const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
	const summary = (r.stderr ?? '').split('Summary:').pop() ?? '';
	const num = (/** @type {RegExp} */ re) => { const m = re.exec(summary); return m ? Number(m[1]) : null; };
	return { lufs: num(/I:\s+(-?[\d.]+|-inf)\s+LUFS/), lra: num(/LRA:\s+(-?[\d.]+)\s+LU/), truePeak: num(/Peak:\s+(-?[\d.]+|-inf)\s+dBFS/) };
}
