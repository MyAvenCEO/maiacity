// A vault's profile picture (Samuel 2026-10-21): one file of its own Library named `profile.jpg`, which everyone may
// read, as its name is by default. Its owner drops a picture into its settings: the page cuts it to a square of
// `SIDE` pixels and brings it in, a new file the first time, shared Public by its entry alone (as an article's pictures
// are, ./flows.js), and a new version of that same file after, so the share holds on. avenDB's server serves it to
// everyone at /feed/files/<vault>/profile.jpg, where the Universe's cards show it (src/lib/universe/PostCard.svelte).

import { fileNamed } from './article.js';
import { EVERYONE } from './vaults.js';

/** the name of a vault's profile picture in its Library */
export const PICTURE = 'profile.jpg';
/** its side, in pixels */
export const SIDE = 512;

/** Vault `vault`'s profile picture as world `w` shows it, its file entry, if it has one.
 *  @param {import('./vaults.js').WorldView} w @param {string} vault */
export const pictureOf = (w, vault) => fileNamed(w, vault, PICTURE);

/** Image file `file` cut to its middle square and scaled to `SIDE` pixels, as a JPEG. @param {Blob} file */
export async function squared(file) {
	const img = await createImageBitmap(file);
	const cut = Math.min(img.width, img.height);
	const side = Math.min(SIDE, cut);
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = side;
	const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
	g.imageSmoothingQuality = 'high';
	g.drawImage(img, (img.width - cut) / 2, (img.height - cut) / 2, cut, cut, 0, 0, side, side);
	img.close();
	return /** @type {Promise<Blob>} */ (
		new Promise((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error('the picture could not be made'))), 'image/jpeg', 0.88))
	);
}

/**
 * Picture `picture` (a JPEG, `squared`) as vault `vault`'s profile picture, acting for it through `api`: a new version
 * of its picture `had` where it has one, else a new file, which everyone may then read. Whether it went through.
 * @param {any} api @param {string} vault @param {Blob} picture @param {{ entry: string } | undefined} had
 */
export async function setPicture(api, vault, picture, had) {
	if (had) return !!(await api.bring('Changing its picture', { op: 'put_file', entry: had.entry, as: vault }, picture));
	const made = await api.bring('Adding its picture', { op: 'put_file', vault, name: PICTURE, media: 'image/jpeg', tags: [], as: vault }, picture);
	if (!made?.entry) return false;
	return !!(await api.run('Showing its picture to everyone', publicPicture(vault, made.entry)));
}

/** The op by which vault `vault` lets everyone read its picture, file entry `entry`, and nothing else.
 *  @param {string} vault @param {string} entry */
export const publicPicture = (vault, entry) => ({ op: 'share', over: vault, who: EVERYONE, level: 'Public', what: { entry: [entry] }, as: vault });
