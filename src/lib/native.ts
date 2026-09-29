// The Mac app (maiaCITY Studio) and the website share these pages. Inside the app, every call to the API and every
// library file goes out natively, with the app's own key (the passkey approved it once) — never with a browser
// session. The studio and the admin's media functions live only there.

/** Is this page running inside maiaCITY Studio, the Mac app? */
export const native = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Call one of the app's own commands. */
export async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
	const { invoke } = await import('@tauri-apps/api/core');
	return invoke<T>(name, args);
}

/** Inside the app, library files come through the app (key and Range) instead of straight from the API. */
export const APP_API = 'maiaapi://localhost';
