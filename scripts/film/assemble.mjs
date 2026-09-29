// Cut the film: the shots from shoot.mjs, the voice and the music from the media library, and captions.
//
//   node scripts/film/assemble.mjs scripts/film/day-19.mjs
//
// The shots dissolve into one another where the shot list cuts them; each voice take comes in where the list places it; the music
// sits under it at the levels the list gives and fades out at the end. The captions are the voice's own words, in
// short phrases, timed to the moment each is spoken — set in the site's display face by Chrome, laid over by ffmpeg.
// Voice and music are taken from library/ by their CIDs.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const listFile = process.argv[2];
if (!listFile) throw new Error('usage: node scripts/film/assemble.mjs <shot list>');
const film = (await import(pathToFileURL(resolve(listFile)).href)).default;
const SIZE = film.size ?? 1080, FPS = film.fps ?? 30, XF = 0.6;
const DIR = resolve('studio/film', film.name);
// a file by its CID: library/<cid>.<ext>, and what library/<cid>.json says about it
const fromLibrary = (ref) => {
	const cid = ref.replace(/\.[a-z0-9]+$/, '');
	if (!existsSync(resolve('library', `${cid}.json`))) throw new Error(`library/ does not hold ${cid}`);
	const doc = JSON.parse(readFileSync(resolve('library', `${cid}.json`), 'utf8'));
	return { file: resolve('library', doc.file), meta: doc };
};
// every voice take, where the shot list places it on the film
const voices = film.voices.map((v) => ({ ...v, ...fromLibrary(v.cid) }));
// the game's recordings are not equally loud: the same factors as the game's ambience (src/lib/sandbox-2/interior/ambience.ts)
const NORMALIZE = { 'ef0770d0d1b2927adbb95158dcf2a7c1a3abf74bf35f4aab4da3b2885374f25e.mp3': 22.1, '1934113f408410383c16336a37d2e274579e0cc0802e574dcc232982cca02a84.mp3': 0.35, '7605ffd5723a4511ba9320009d5e2beda3f9a734ad244d7765a6120bf4200e82.mp3': 0.66, '646b67cf337fdfdb3446e55b1f1edd4bfc3e6469bc12ea3acd07901cc71cda8f.mp3': 1.5 };
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const music = fromLibrary(film.music);
const total = film.cuts.at(-1).end;

// ── captions: each take's words, in phrases of a few words broken at the punctuation, on the film's clock ──
const phrases = [];
for (const v of voices) {
	let cur = [];
	const flush = () => cur.length && phrases.push({ text: cur.map((x) => x.word).join(' '), start: v.at + cur[0].start, end: v.at + cur.at(-1).end });
	for (const w of v.words) {
		cur.push(w);
		const text = cur.map((x) => x.word).join(' ');
		if ((/[.,;:!?…]$/.test(w.word) && (cur.length >= 3 || /[.;:!?…]$/.test(w.word))) || text.length > 34) flush(), (cur = []);
	}
	flush();
}

const CAPS = join(DIR, '.captions');
rmSync(CAPS, { recursive: true, force: true });
mkdirSync(CAPS, { recursive: true });
const font = pathToFileURL(resolve('node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2')).href;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: SIZE, height: SIZE });
for (const [i, p] of phrases.entries()) {
	await page.setContent(`<!doctype html><html><head><style>
		@font-face { font-family: F; src: url(${font}) format('woff2'); font-weight: 100 900; }
		html, body { margin: 0; width: ${SIZE}px; height: ${SIZE}px; background: transparent; }
		p { position: absolute; left: 9%; right: 9%; bottom: 8.5%; margin: 0; text-align: center;
			font: 460 ${Math.round(SIZE / 24)}px/1.3 F, Georgia, serif; color: #fff; letter-spacing: 0.005em;
			text-shadow: 0 2px 18px rgba(0,0,0,.65), 0 0 3px rgba(0,0,0,.45); }
	</style></head><body><p>${p.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p></body></html>`);
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: join(CAPS, `${String(i).padStart(3, '0')}.png`), omitBackground: true });
}
await browser.close();
console.log(`${phrases.length} caption phrases`);

// ── the cut ────────────────────────────────────────────────────────────────
const shots = film.shots.map((s, i) => join(DIR, `${String(i + 1).padStart(2, '0')}-${s.name}.mp4`));
for (const s of shots) if (!existsSync(s)) throw new Error(`missing ${s} — run shoot.mjs first`);

const inputs = [];
for (const s of shots) inputs.push('-i', s);
for (const v of voices) inputs.push('-i', v.file);
inputs.push('-i', music.file);
phrases.forEach((_, i) => inputs.push('-loop', '1', '-t', String(total), '-framerate', String(FPS), '-i', join(CAPS, `${String(i).padStart(3, '0')}.png`)));
// the sound of each shot: its recordings, looped, from somewhere in the middle, for the length of the shot and its dissolve
const sounds = [];
film.shots.forEach((s, i) => {
	const start = film.cuts[i].start, dur = s.seconds;
	for (const [path, level] of s.sfx ?? []) {
		const src = fromLibrary(path);
		const length = Number(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', src.file]).toString());
		sounds.push({ start, dur, level: level * (NORMALIZE[path] ?? 1), input: inputs.filter((x) => x === '-i').length });
		inputs.push('-stream_loop', '-1', '-ss', (rand() * Math.max(0, length - 1)).toFixed(2), '-i', src.file);
	}
});

const f = [];
// every shot on the same clock, then dissolves at the cut points
// read with the shot's own matrix (tagged, or BT.709 for HD), and every step in BT.709 / TV range from here on
shots.forEach((_, i) => f.push(`[${i}:v]settb=AVTB,fps=${FPS},scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv,format=yuv420p[s${i}]`));
let last = 's0';
for (let i = 1; i < shots.length; i++) {
	f.push(`[${last}][s${i}]xfade=transition=fade:duration=${XF}:offset=${film.cuts[i].start.toFixed(3)}[x${i}]`);
	last = `x${i}`;
}
f.push(`[${last}]trim=0:${total.toFixed(3)},fade=t=in:st=0:d=1.4,fade=t=out:st=${(total - 2.5).toFixed(3)}:d=2.5[pic]`);
// captions in, each fading in and out on its phrase
const V = shots.length, A = V, M = V + voices.length, C0 = M + 1;
last = 'pic';
phrases.forEach((p, i) => {
	const a = p.start - 0.08, b = p.end + 0.3;
	// the caption's RGB into YUV with BT.709's matrix (ffmpeg's default would be BT.601: a hue shift on the shadow)
	f.push(`[${C0 + i}:v]scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,fade=t=in:st=${a.toFixed(2)}:d=0.25:alpha=1,fade=t=out:st=${(b - 0.25).toFixed(2)}:d=0.25:alpha=1[c${i}]`);
	f.push(`[${last}][c${i}]overlay=0:0:shortest=1[o${i}]`);
	last = `o${i}`;
});
f.push(`[${last}]format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[vout]`);
// every take where it lands; the music low under the voice, lifting later, fading out at its end or the film's
const [low, high, liftAt] = film.musicLevels ?? [0.24, 0.42, 55];
voices.forEach((v, k) => {
	const ms = Math.max(0, Math.round(v.at * 1000));
	f.push(`[${A + k}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms}[vo${k}]`);
});
const musicLength = Number(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', music.file]).toString());
const musicEnd = Math.min(total, musicLength);
f.push(
	`[${M}:a]atrim=0:${musicEnd.toFixed(3)},volume=eval=frame:volume='if(lt(t,${liftAt}),${low},if(lt(t,${liftAt + 4}),${low}+(t-${liftAt})/4*${(high - low).toFixed(3)},${high}))',` +
		`afade=t=in:d=1.5,afade=t=out:st=${(musicEnd - 4).toFixed(3)}:d=4[mu]`
);
// each recording fades in over the dissolve into its shot and out over the dissolve out of it
sounds.forEach((x, i) => {
	const fade = Math.min(1.2, x.dur / 3);
	f.push(`[${x.input}:a]atrim=0:${x.dur.toFixed(3)},asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,volume=${x.level.toFixed(3)},afade=t=in:d=${fade.toFixed(2)},afade=t=out:st=${(x.dur - fade).toFixed(3)}:d=${fade.toFixed(2)},adelay=${Math.round(x.start * 1000)}|${Math.round(x.start * 1000)}[fx${i}]`);
});
const beds = sounds.map((_, i) => `[fx${i}]`).join('');
const vox = voices.map((_, k) => `[vo${k}]`).join('');
f.push(`${vox}[mu]${beds}amix=inputs=${voices.length + 1 + sounds.length}:normalize=0:duration=longest,alimiter=limit=0.95,atrim=0:${total.toFixed(3)}[aout]`);

const out = resolve('studio/film', `${film.name}.mp4`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]',
	'-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
	'-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
	'-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'inherit' });
rmSync(CAPS, { recursive: true, force: true });
console.log(`${out} · ${total.toFixed(1)} s · ${SIZE}×${SIZE}`);
