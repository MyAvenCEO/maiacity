// Whether this browser has been signed in: a hint only (the API decides), so the public site's nav can offer the
// dashboard without asking the API on every page.
const KEY = 'maia:signed-in';

export function remember(signedIn: boolean) {
	try {
		if (signedIn) localStorage.setItem(KEY, '1');
		else localStorage.removeItem(KEY);
	} catch {
		/* no storage */
	}
}

export function signedInHere(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}
