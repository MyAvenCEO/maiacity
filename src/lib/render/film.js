/**
 * THE FILM RENDERER — a world's renderer as the film camera holds it (the studio's world shots, the Mac app's plates,
 * the shoot CLI): the purpose renderer for film on the core. A world under the film camera draws nothing itself (the
 * film draws the canvas, only when asked), runs on the shot's clock, and keeps the fixed size and resolution the shot
 * asks for (no adaptive resolution); every frame goes through the film's darkroom (../film/pipeline.js: shutter,
 * meter, the 10-bit ACEScct encode), which is the film's own post stack and stays as it is, byte for byte, so a render's
 * fingerprint (FILM_VERSION) never moves.
 *
 * The contract a world hands over (`window.__world`) is the sandbox kit's `connectFilm` ($lib/sandbox-kit/film.js);
 * film mode itself is ../film/index.js.
 */
/** the darkroom, loaded only by film mode (a world never pays for it) */
export const darkroom = () => import('$lib/film/pipeline.js');

const win = () => /** @type {{ __filmDraw?: boolean, __filmPlays?: boolean, __worldTime?: number, __film?: { virtual?: boolean }, __world?: unknown }} */ (/** @type {unknown} */ (window));
/** True while the film draws the canvas itself: the world must not spend a frame drawing for nobody. */
export const filmDraws = () => !!win().__filmDraw;
/**
 * True while a timeline plays through the film (the studio asks for a frame every animation frame): the world keeps
 * each piece of its own work short and never hurries a build, so no frame waits for it (a dome built in 70 ms slices
 * after a cut stuttered every frame until it stood).
 */
export const filmPlays = () => !!win().__filmPlays;
/** The world's clock in seconds while a film sets it (the shot's clock), else undefined: run animations on the world's own. */
export const worldTime = () => win().__worldTime;
/** True while a film holds the page's clock or draws: keep the resolution it asked for. */
export const filmHoldsSize = () => !!win().__film?.virtual || !!win().__filmDraw;
