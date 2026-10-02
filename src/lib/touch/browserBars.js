/**
 * A phone browser's bars over a world in full screen: Safari's address bar and toolbar, Chrome's URL bar.
 *
 * No page can hide them; they tuck themselves away only when a finger scrolls the page. A world takes every finger
 * for itself (the canvas's touch-action: none, $lib/touch/TouchStick) and has nothing to scroll, so once they were
 * out they stayed out: a sandbox reached by scrolling down the dashboard opened with them already tucked away, a world
 * opened from the short Worlds page did not.
 *
 * So while a world is open on a phone (`watchBars()`, from the app's layout) the page has a little room to scroll
 * (html[data-world], src/app.css), and while the bars are out (html[data-bars]) a finger on the world scrolls the
 * page as it looks round: the first swipe up puts them away, and from then on every finger is the world's again.
 * Pinned to the home screen there are no bars, and none of this happens.
 */

/** whether the browser's bars are out over the world, so a finger on it may scroll them away */
export const barsOut = () => document.documentElement.hasAttribute('data-bars');

/** @returns {() => void} stop watching, and give the page back as it was */
export function watchBars() {
	const pinned = /** @type {Navigator & { standalone?: boolean }} */ (navigator).standalone || matchMedia('(display-mode: standalone)').matches;
	if (pinned) return () => {};
	const root = document.documentElement;
	// the screen's height with the bars tucked away (100lvh), against the height the page has now
	const probe = document.createElement('div');
	probe.style.cssText = 'position: fixed; top: 0; width: 0; height: 100lvh; visibility: hidden; pointer-events: none';
	document.body.append(probe);
	const check = () => root.toggleAttribute('data-bars', probe.offsetHeight - window.innerHeight > 2);
	root.setAttribute('data-world', '');
	check();
	window.addEventListener('resize', check);
	window.visualViewport?.addEventListener('resize', check);
	return () => {
		window.removeEventListener('resize', check);
		window.visualViewport?.removeEventListener('resize', check);
		probe.remove();
		root.removeAttribute('data-bars');
		root.removeAttribute('data-world');
	};
}
