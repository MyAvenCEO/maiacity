// @ts-nocheck — plain JS, kept loose on purpose
// MaiaCity V1's link to the one shared game on the server (api/src/maiacity-v1.js).
import { apiCall } from '$lib/auth/client';

const post = (path, body) => apiCall(path, { method: 'POST', body: JSON.stringify(body) });

/** { game, me, admin, now } */
export const loadGame = () => apiCall('/api/maiacity-v1');
export const takeSeat = (seat) => post('/api/maiacity-v1/seat', { seat });
export const sendMove = (seat, action) => post('/api/maiacity-v1/move', { seat, action });
export const resetGame = () => post('/api/maiacity-v1/reset', {});
