/**
 * The gap at the foot of the pinned app on an iPhone.
 *
 * Pinned to the home screen, with the status bar see-through over the page (black-translucent, src/app.html), iOS
 * stops the page's frame short of the screen's foot by about the status bar's height: everything fixed to the screen
 * (a world, its joystick, the nav pill) ends there, and a strip of bare page shows below it. The screen is still
 * drawn there; only the frame is short. So while the app is pinned, `watchScreenGap()` measures how far a box fixed
 * to the screen falls short of the screen itself, and puts it on the page as `--screen-gap` (with
 * `html[data-screen-gap]` while there is one): a full-screen page reaches down over it (src/routes/app/+layout.svelte)
 * and the nav pill sits that much lower ($lib/app/NavPill.svelte).
 *
 * Measured, never assumed: in a browser tab, on a desktop, in the Mac app, in an iPad window beside another and on
 * the day iOS draws the frame to the foot again, the gap is 0 and nothing changes.
 */

/** the app pinned to the home screen: its own window, no browser around it */
const pinned = () =>
	/** @type {Navigator & { standalone?: boolean }} */ (navigator).standalone === true ||
	matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;

/** @returns {() => void} stop watching, and give the page back as it was */
export function watchScreenGap() {
	if (!pinned()) return () => {};
	const root = document.documentElement;
	// a box fixed to the screen from top to foot: the frame every full-screen page is drawn in
	const probe = document.createElement('div');
	probe.style.cssText = 'position: fixed; top: 0; bottom: 0; left: 0; width: 0; visibility: hidden; pointer-events: none';
	document.body.append(probe);

	const measure = () => {
		// iOS keeps screen.width and .height as the phone stands upright, whichever way it is turned
		const landscape = matchMedia('(orientation: landscape)').matches;
		const [short, long] = [Math.min(screen.width, screen.height), Math.max(screen.width, screen.height)];
		const tall = landscape ? short : long;
		const wide = landscape ? long : short;
		// only an app that fills the screen: an iPad window beside another is short on purpose
		const filling = Math.abs(window.innerWidth - wide) < 2;
		const gap = Math.round(tall - probe.getBoundingClientRect().height);
		const px = filling && gap > 0 && gap <= 100 ? gap : 0;
		root.style.setProperty('--screen-gap', `${px}px`);
		root.toggleAttribute('data-screen-gap', px > 0);
	};
	// a turned phone settles its frame only a moment after it says it turned
	let later = 0;
	const settle = () => {
		measure();
		clearTimeout(later);
		later = window.setTimeout(measure, 350);
	};

	measure();
	window.addEventListener('resize', settle);
	window.addEventListener('orientationchange', settle);
	window.addEventListener('pageshow', settle);
	window.visualViewport?.addEventListener('resize', settle);
	return () => {
		clearTimeout(later);
		window.removeEventListener('resize', settle);
		window.removeEventListener('orientationchange', settle);
		window.removeEventListener('pageshow', settle);
		window.visualViewport?.removeEventListener('resize', settle);
		probe.remove();
		root.style.removeProperty('--screen-gap');
		root.removeAttribute('data-screen-gap');
	};
}
