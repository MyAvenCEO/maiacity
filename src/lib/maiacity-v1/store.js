// @ts-nocheck — plain JS, kept loose on purpose
// MaiaCity V1's link to the one shared game on the server (api/src/maiacity-v1.js).
import { apiCall } from '$lib/auth/client';
import { session } from '$lib/avendb/session.svelte.js';

const post = (path, body) => apiCall(path, { method: 'POST', body: JSON.stringify(body) });

/** the founder's seat goes by their name as their avenDB profile has it: the server keeps no name of theirs */
const named = () => (session.name ? `?${new URLSearchParams({ name: session.name })}` : '');

/** { game, me, admin, now } */
export const loadGame = () => apiCall(`/api/maiacity-v1${named()}`);
export const takeSeat = (seat) => post('/api/maiacity-v1/seat', { seat, name: session.name });
export const sendMove = (seat, action) => post('/api/maiacity-v1/move', { seat, action });
export const resetGame = () => post('/api/maiacity-v1/reset', {});
