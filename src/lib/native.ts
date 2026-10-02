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

/**
 * The app's web view has no console anyone can read: its warnings and errors (and those of a same-origin frame, like
 * the world's) go into the app's own log instead, tagged with where they came from.
 */
export function forwardConsole(win: Window, from: string) {
	if (!native()) return;
	const w = win as Window & { __forwarded?: boolean; console: Console };
	if (w.__forwarded) return;
	w.__forwarded = true;
	// an error says its name, message and where (WebKit's stack can be empty; a DOMException stringifies to {})
	const one = (a: unknown): string => {
		if (typeof a === 'string') return a;
		if (a instanceof Error || (a && typeof a === 'object' && 'message' in a)) {
			const e = a as Error;
			return [`${e.name ?? 'Error'}: ${e.message ?? ''}`, e.stack].filter(Boolean).join('\n');
		}
		if (a === undefined) return 'undefined';
		try {
			return JSON.stringify(a) ?? String(a);
		} catch {
			return String(a);
		}
	};
	const text = (args: unknown[]) => args.map(one).join(' ').slice(0, 4000);
	const send = (level: string, message: string) => void command('log_js', { level, from, message }).catch(() => {});
	for (const level of ['warn', 'error'] as const) {
		const was = w.console[level].bind(w.console);
		w.console[level] = (...args: unknown[]) => (was(...args), send(level, text(args)));
	}
	w.addEventListener('error', (e) => send('error', `${e.message} (${e.filename}:${e.lineno})`));
	w.addEventListener('unhandledrejection', (e) => send('error', `unhandled: ${text([e.reason])}`));
}

/** Inside the app, library files come through the app (key and Range) instead of straight from the API. */
export const APP_API = 'maiaapi://localhost';
