/*
 * THE 3D MODELS — every reusable model, as the 3D models viewer (/app/models/) lists it: its name, what it is, where
 * it is used, and the function that builds it (./furniture.ts). A world places them (src/lib/worlds); a new one is a
 * function there and a line here.
 */
import type * as THREE from 'three';
import { bed, chair, crateTower, edisonBulb, framedPicture, neewerCb60, sheepskin, standIn, truck, wineCrate } from './furniture';

export type Model = { id: string; label: string; note: string; usedIn: string; make: () => THREE.Object3D };

export const MODELS: Model[] = [
	{ id: 'bed', label: 'Bed', note: '140 × 200, a solid oak frame, the blue fitted sheet, a crumpled grey duvet, two mustard pillows', usedIn: 'The room', make: () => bed() },
	{ id: 'wine-crate', label: 'Wine crate', note: '50 × 33 × 42 cm, slatted boards, handle cut-outs, on its end as a shelf', usedIn: 'The room', make: () => wineCrate('pine') },
	{ id: 'crate-tower-left', label: 'Crate shelf, left', note: 'white, pine, dark pine: the shelf left of the bed, 1.26 m high', usedIn: 'The room', make: () => crateTower(['white', 'pine', 'dark']) },
	{ id: 'crate-tower-right', label: 'Crate shelf, right', note: 'white, white, pine: the shelf right of the bed', usedIn: 'The room', make: () => crateTower(['white', 'white', 'pine']) },
	{ id: 'chair-red', label: 'Chair, red', note: 'a wooden café chair painted red, the seat at 45 cm', usedIn: 'The room', make: () => chair('red') },
	{ id: 'chair-leather', label: 'Chair, leather', note: 'a steel-tube school chair, moulded brown leather seat and back', usedIn: 'The room', make: () => chair('leather') },
	{ id: 'neewer-cb60', label: 'Neewer CB60 RGB', note: '70 W RGB COB, 2700–6500 K, HSI, 17 effects, 18,000 lux at 1 m with its 18 cm reflector — on a black light stand, the beam at 1.5 m', usedIn: 'The room', make: () => neewerCb60() },
	{ id: 'edison-bulb', label: 'Edison bulb', note: 'a yellow retro bulb on a short black cord, its filament glowing', usedIn: 'The room', make: () => edisonBulb() },
	{ id: 'framed-picture', label: 'Framed picture', note: 'a painted face in a slim orange frame, 50 × 65 cm', usedIn: 'The room', make: () => framedPicture() },
	{ id: 'sheepskin', label: 'Sheepskin', note: 'a white sheepskin rug, about 1 × 0.7 m', usedIn: 'The room', make: () => sheepskin() },
	{ id: 'stand-in', label: 'Stand-in', note: 'a neutral clay figure of 1.80 m — standing, sitting on an edge, or fallen back — to block shots before they are filmed', usedIn: 'The room', make: () => standIn('sit') },
	{ id: 'truck', label: 'Truck', note: 'a cab and a box trailer, about 16 × 2.55 × 4 m', usedIn: 'The tired land', make: () => truck({ cab: '#a33a2a', box: '#e0ddd6' }) }
];
