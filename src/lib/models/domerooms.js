/*
 * THE DOME ROOMS' MODELS — what furnishes the inside of the village's domes, as the 3D models viewer lists it: the
 * private rooms in the master dome's galleries (../sandbox-2/interior/rooms.ts) and the house plants in them, the
 * terraces' furniture and their balcony doors, the workshops round the master's ground floor and the café squares
 * outside it (../sandbox-2/interior/spaces.ts), and the plain furniture they share (../sandbox-2/interior/interior.ts).
 * Each is built by the same function the domes build it with, with the domes' own surfaces; a set built round the
 * dome's middle (a room, a workshop) is brought to the viewer's middle. ./index.js adds every entry to the library.
 */
import * as THREE from 'three';
import { box, lantern, mats, sofa, table } from '$lib/sandbox-2/interior/interior';
import { balconyDoor, furnish, terraceSet } from '$lib/sandbox-2/interior/rooms';
import { awnings, bakery, bistro, cowork, kiosk, library, oven, parasol, pergola, pottery, repair, square, stool, studio, woodshop } from '$lib/sandbox-2/interior/spaces';
import { houseplant, potted } from '$lib/sandbox-2/interior/plants';

/** @typedef {import('$lib/sandbox-2/interior/spaces').Kit} Kit */

/** the domes' surfaces and furniture, as a dome lends them to its spaces; made once, when the first is built */
/** @type {Kit | null} */
let kit = null;
const kitOf = () => {
	if (kit) return kit;
	const m = mats();
	return (kit = {
		box,
		table: (len, chairs) => table(m, len, chairs),
		sofa: (len) => sofa(m, len),
		lantern: (r, y) => lantern(m, r, y),
		oak: m.oak(1),
		lime: m.lime(1),
		stone: (rep) => m.stone(rep),
		dark: m.dark,
		steel: m.steel,
		counter: m.counter,
		timber: m.timberFrame,
		linen: m.linen,
		cushion: m.cushion,
		rug: m.rug,
		paper: m.paper
	});
};

/** a set built round the dome's middle, brought to the viewer's: its foot at the middle, standing on y 0 */
function centred(/** @type {THREE.Object3D} */ o) {
	const g = new THREE.Group();
	g.add(o);
	o.updateMatrixWorld(true);
	const b = new THREE.Box3().setFromObject(o);
	const c = b.getCenter(new THREE.Vector3());
	o.position.x -= c.x;
	o.position.z -= c.z;
	o.position.y -= b.min.y;
	return g;
}

/** one of the master dome's private rooms, as its upper gallery has them: 16 to the ring, 9.5 m from walkway to glass */
const SPAN = (Math.PI * 2) / 16;
const room = (/** @type {number} */ seed) => centred(furnish({ a0: -SPAN / 2, span: SPAN, rIn: 57.2, rOut: 66.8, y: 0, seed }).group);

/** @type {{ id: string, label: string, note: string, usedIn: string, make: () => THREE.Object3D }[]} */
export const DOME_ROOMS = [
	// the private rooms
	{ id: 'private-room', label: 'Private room', note: 'one of the master dome’s gallery rooms, built as a Waldorf school is: a curved plaster bench with felt cushions by the door, a round table and stools, a shelf of plaster niches, a round rug, a wide oak bed facing the glass, a natural stone bath sunk in pebbles, a round bathroom pod with a pebble shower and a stone basin, plants everywhere — about 9.5 m from the walkway to the glass', usedIn: 'Dome rooms', make: () => room(60) },
	{ id: 'private-room-2', label: 'Private room, sage', note: 'the same room in sage plaster and different felts, its things never quite where the last room had them', usedIn: 'Dome rooms', make: () => room(77) },
	{ id: 'room-monstera', label: 'Monstera, room', note: 'split leaves on their stalks in a round pot, by the bench', usedIn: 'Dome rooms', make: () => houseplant('monstera', 3, 1) },
	{ id: 'fiddle-leaf-fig', label: 'Fiddle-leaf fig', note: 'big leathery leaves up a slim stem, by the bed', usedIn: 'Dome rooms', make: () => houseplant('fig', 4, 1) },
	{ id: 'snake-plant', label: 'Snake plant', note: 'stiff upright blades, banded, in a low pot', usedIn: 'Dome rooms', make: () => houseplant('snake', 5, 1) },
	{ id: 'pothos', label: 'Pothos', note: 'heart-shaped leaves trailing from a hanging pot', usedIn: 'Dome rooms', make: () => houseplant('pothos', 6, 1) },
	{ id: 'potted-olive', label: 'Potted olive', note: 'a small olive tree in a terracotta pot', usedIn: 'Dome rooms', make: () => potted('olive', 7, 1) },
	{ id: 'potted-lemon', label: 'Potted lemon', note: 'a lemon tree in a pot, fruit among the leaves', usedIn: 'Dome rooms', make: () => potted('lemon', 8, 1) },
	{ id: 'potted-lavender', label: 'Potted lavender', note: 'a clump of lavender in flower in a pot', usedIn: 'Dome rooms', make: () => potted('lavender', 9, 1) },
	{ id: 'potted-rosemary', label: 'Potted rosemary', note: 'a bush of rosemary in a pot', usedIn: 'Dome rooms', make: () => potted('rosemary', 10, 1) },
	// the terraces
	{ id: 'balcony-door', label: 'Balcony door', note: 'a round-headed timber frame at the glass, its glazed leaf standing open onto the terrace, 0.95 × 2.1 m', usedIn: 'Dome rooms', make: () => balconyDoor() },
	{ id: 'terrace-vine-table', label: 'Terrace: table under the vines', note: 'a round table for six, round stools all round', usedIn: 'Dome rooms', make: () => terraceSet(0, 40) },
	{ id: 'terrace-daybeds', label: 'Terrace: daybeds', note: 'two rounded, cushioned daybeds facing out over the forest, a low round table between', usedIn: 'Dome rooms', make: () => terraceSet(1, 41) },
	{ id: 'terrace-bench', label: 'Terrace: plaster bench', note: 'a curved plaster bench round a low table, felt cushions, a big round planter at each end', usedIn: 'Dome rooms', make: () => terraceSet(2, 42) },
	{ id: 'terrace-egg-chairs', label: 'Terrace: egg chairs', note: 'two hanging egg chairs from a curved timber frame, a sheepskin in each', usedIn: 'Dome rooms', make: () => terraceSet(3, 43) },
	// the workshops round the master's ground floor
	{ id: 'coworking', label: 'Co-working', note: 'two long tables of eight with laptops open on them under paper lanterns, a pinboard of plans, a sofa corner for the calls', usedIn: 'Dome rooms', make: () => centred(cowork(kitOf(), 1).group) },
	{ id: 'woodshop', label: 'Woodshop', note: 'three workbenches, the saw, a timber rack along the glass, sawhorses with a plank across, a pegboard of tools', usedIn: 'Dome rooms', make: () => centred(woodshop(kitOf()).group) },
	{ id: 'art-studio', label: 'Art studio', note: 'easels in an arc facing the light, a paint table of jars, a finished canvas on the wall, a sculpture on its plinth', usedIn: 'Dome rooms', make: () => centred(studio(kitOf(), 10).group) },
	{ id: 'pottery', label: 'Pottery', note: 'three wheels with clay on them and a stool at each, a brick kiln with its flue, four shelves of glazed pots along the glass, the wedging table', usedIn: 'Dome rooms', make: () => centred(pottery(kitOf()).group) },
	{ id: 'bakery', label: 'Bakery & cooking school', note: 'the clay bread oven, two islands to cook at with pans on the hobs, bread and fruit set out, herbs drying from a rail, the long table where the class eats', usedIn: 'Dome rooms', make: () => centred(bakery(kitOf()).group) },
	{ id: 'library', label: 'Library', note: 'four tall oak cases of books along the glass, three sofas round a low table on a round rug, a paper lantern overhead', usedIn: 'Dome rooms', make: () => centred(library(kitOf(), 5).group) },
	{ id: 'repair-cafe', label: 'Repair café', note: 'a long bench along the glass with devices opened up on it, a bicycle on its stand, a table of parts sorted in trays', usedIn: 'Dome rooms', make: () => centred(repair(kitOf()).group) },
	{ id: 'bread-oven', label: 'Bread oven', note: 'a clay dome on a stone plinth, firewood under its lip: for the bakery inside and the pizza square outside', usedIn: 'Dome rooms', make: () => centred(oven(kitOf(), 0, 0)) },
	// the café squares round the master dome
	{ id: 'square-cafe', label: 'Café square', note: 'a round stone square 13 m across: a kiosk at the back, bistro tables under parasols, planters round the rim', usedIn: 'Dome rooms', make: () => square(kitOf(), 0, 50, 6.5).group },
	{ id: 'square-restaurant', label: 'Restaurant square', note: 'long tables under a pergola strung with lights', usedIn: 'Dome rooms', make: () => square(kitOf(), 1, 51, 6.5).group },
	{ id: 'square-fruit-bar', label: 'Fruit bar square', note: 'a counter of fruit crates, stools along it', usedIn: 'Dome rooms', make: () => square(kitOf(), 2, 52, 6.5).group },
	{ id: 'square-pizza', label: 'Pizza square', note: 'a wood-fired oven, and long tables round it', usedIn: 'Dome rooms', make: () => square(kitOf(), 3, 53, 6.5).group },
	{ id: 'kiosk', label: 'Kiosk', note: 'an oak kiosk 3.2 m wide, a counter and an awning, the coffee machine and the menu board', usedIn: 'Dome rooms', make: () => kiosk(kitOf(), awnings[0]) },
	{ id: 'bistro-set', label: 'Bistro set', note: 'a round limestone table on one leg, two or three timber chairs, a cup or a plate at each place', usedIn: 'Dome rooms', make: () => bistro(kitOf(), 0, 0, 3) },
	{ id: 'parasol', label: 'Parasol', note: 'an eight-sided canvas parasol 2.7 m across on a dark pole', usedIn: 'Dome rooms', make: () => parasol(kitOf(), 0, 0, awnings[1]) },
	{ id: 'pergola', label: 'Pergola with lights', note: 'a timber pergola 5 × 6 m, strings of bulbs sagging from beam to beam', usedIn: 'Dome rooms', make: () => pergola(kitOf(), 5, 6) },
	{ id: 'bar-stool-round', label: 'Round stool', note: 'a round oak seat on a dark post, 62 cm high', usedIn: 'Dome rooms', make: () => stool(kitOf(), 0, 0) },
	// the plain furniture the spaces share
	{ id: 'long-table', label: 'Long table', note: 'an oak table 2.6 m long on dark legs, six chairs', usedIn: 'Dome rooms', make: () => table(mats(), 2.6, 6) },
	{ id: 'sofa', label: 'Sofa', note: 'a low sofa 2.4 m long, three cushions', usedIn: 'Dome rooms', make: () => sofa(mats(), 2.4) },
	{ id: 'paper-lantern-big', label: 'Paper lantern, big', note: 'a glowing paper globe 90 cm across on a long cable, as over the co-working tables', usedIn: 'Dome rooms', make: () => lantern(mats(), 0.45, 1.2) }
];
