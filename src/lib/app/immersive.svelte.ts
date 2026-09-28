// A game can go full screen over its own page (Sandbox 3 opens a dome over its cards): while it does, the app's top
// bar and nav pill step out of the way. A page calls enter() and gets back the function that leaves again.
import { untrack } from 'svelte';

let depth = $state(0);

export const immersive = {
	get on() {
		return depth > 0;
	}
};

// (untracked: called from an effect, it must not make that effect depend on the count it changes)
export function enter(): () => void {
	untrack(() => depth++);
	let left = false;
	return () => {
		if (!left) (left = true), untrack(() => depth--);
	};
}
