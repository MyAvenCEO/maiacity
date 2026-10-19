/*
 * avenDB's server (avendb.maia.city, rolled out by .github/workflows/avendb.yml), which the app's way in
 * ($lib/app/entry.js) and avenDB's own page (./Account.svelte) both reach: its relay, and its offer as it logs it at
 * every start; and the name this browser goes by among the person's devices.
 */
import { native } from '$lib/native';

/** The server's relay. */
export const RELAY = 'https://avendb.maia.city';

/** The server's offer, the same as long as its shelf (g18, for good: avenDB is never reset) keeps its device's key. */
export const SERVER =
	'AVENDB1UAYTJU2GDDXXNHWO5YZJOJJBYJFXCKVEPNGILCF6ORDFGRZQXIYOKZOGNSNV64ZIP4VEW4HJPYXUPWZBQJWGRT75JV4CAO3N25TOCMYBAS6PKHZODTUQCGLIOR2HA4Z2F4XWC5TFNZSGELTNMFUWCLTDNF2HSLY';

/** In a dev build alone, a test server's for this tab ($lib/app/entry.js, scripts/entry-walk.mjs): a link can't lead
 *  a person's page to another server. @param {string} key */
const testing = (key) => {
	if (!import.meta.env.DEV) return '';
	try {
		return sessionStorage.getItem(key) ?? '';
	} catch {
		return '';
	}
};

/** The relay the app reaches avenDB's server by. */
export const relay = () => testing('avendb:relay') || RELAY;

/** The server's offer the app joins and founds through. */
export const server = () => testing('avendb:server') || SERVER;

/** A name for this browser that tells it from the person's other devices: its browser, on its system; or the app. */
export function deviceName() {
	if (native()) return 'maiaCITY Studio on Mac';
	const ua = navigator.userAgent;
	const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
	const system = /iPhone/.test(ua)
		? 'iPhone'
		: /iPad/.test(ua) || touchMac
			? 'iPad'
			: /Android/.test(ua)
				? 'Android'
				: /Mac/.test(ua)
					? 'Mac'
					: /Windows/.test(ua)
						? 'Windows'
						: /Linux|CrOS/.test(ua)
							? 'Linux'
							: '';
	const browser = /Edg(e|A|iOS)?\//.test(ua)
		? 'Edge'
		: /Firefox\/|FxiOS/.test(ua)
			? 'Firefox'
			: /Chrome\/|CriOS/.test(ua)
				? 'Chrome'
				: /Safari\//.test(ua)
					? 'Safari'
					: 'A browser';
	return system ? `${browser} on ${system}` : browser;
}
