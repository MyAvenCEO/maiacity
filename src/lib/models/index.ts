/*
 * THE 3D MODELS — every reusable model, as the 3D models viewer (/app/models/) lists it: its name, what it is, where
 * it is used, and the function that builds it (./furniture.ts, ./hallway.ts, ./kitchen.ts, ./bathroom.ts,
 * ./outdoor.ts). A world places them (src/lib/worlds); a new one is a function there and a line here.
 */
import type * as THREE from 'three';
import { bed, chair, crateTower, edisonBulb, framedPicture, neewerCb60, sheepskin, truck, wineCrate } from './furniture';
import { barCounter, barStool, canvasPrint, coatStand, door, palletShelf, pendantLamp, retroFridge } from './hallway';
import { gasBoiler, kitchenRun, panRail, pedalBin, xShelf } from './kitchen';
import { glassShower, towelRadiator, washbasin, wallToilet } from './bathroom';
import { bridgeLamp, equestrianStatue, limestoneBlock, parkBench, tree } from './outdoor';

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
	{ id: 'retro-fridge', label: 'Retro fridge', note: 'a red retro fridge, rounded and glossy, one door, its chrome lever on the left, 56 × 63 × 127 cm', usedIn: 'The hallway', make: () => retroFridge() },
	{ id: 'bar-counter', label: 'Bar counter', note: 'a thick rustic plank along a wall at 1.05 m, 45 cm deep, on black steel brackets', usedIn: 'The hallway', make: () => barCounter() },
	{ id: 'bar-stool-red', label: 'Bar stool, red', note: 'a round seat at 75 cm on four splayed tubes, a foot ring', usedIn: 'The hallway', make: () => barStool('red') },
	{ id: 'bar-stool-white', label: 'Bar stool, white', note: 'the same stool, white', usedIn: 'The hallway', make: () => barStool('white') },
	{ id: 'pallet-shelf', label: 'Pallet shelf', note: 'old pallet wood on the wall, 2 m long, a low rail at its front', usedIn: 'The hallway', make: () => palletShelf() },
	{ id: 'enamel-pendant', label: 'Enamel pendant', note: 'a red enamel shade, white inside, on a black cord', usedIn: 'The hallway', make: () => pendantLamp() },
	{ id: 'coat-stand', label: 'Coat stand', note: 'a black pole on a round foot, hooks at the top, 1.75 m', usedIn: 'The hallway', make: () => coatStand() },
	{ id: 'canvas-print', label: 'Canvas print', note: 'a meadow under an evening sky, on a stretcher frame, 1.0 × 0.66 m', usedIn: 'The hallway', make: () => canvasPrint() },
	{ id: 'door', label: 'Door', note: 'an interior door in its frame, 86 × 200 cm, a lever handle each side, the vent at its foot', usedIn: 'The hallway', make: () => door() },
	{ id: 'door-mirror', label: 'Door with a mirror', note: 'the bathroom door, a mirror on its inside, standing open', usedIn: 'The bathroom', make: () => door({ finish: 'mirror', open: 1.2 }) },
	{ id: 'kitchen-run', label: 'Kitchen run', note: 'washing machine, oven under a four-burner gas hob, the black sink over three drawers: 60 cm modules under a rustic worktop at 90 cm', usedIn: 'The kitchen', make: () => kitchenRun() },
	{ id: 'x-shelf', label: 'X-shelf', note: 'a tall open shelf of light wood, X braces on its sides and back, 45 × 40 × 190 cm', usedIn: 'The kitchen', make: () => xShelf() },
	{ id: 'gas-boiler', label: 'Gas boiler', note: 'the white box on the wall, its flue up, its pipes below, 44 × 72 × 34 cm', usedIn: 'The kitchen', make: () => gasBoiler() },
	{ id: 'pan-rail', label: 'Pan rail', note: 'a steel rail on the wall, a wok and a pot hanging from it', usedIn: 'The kitchen', make: () => panRail() },
	{ id: 'pedal-bin', label: 'Pedal bin', note: 'red, its lid domed, 30 cm across, 65 cm high', usedIn: 'The kitchen', make: () => pedalBin() },
	{ id: 'wall-toilet', label: 'Wall-hung WC', note: 'the bowl off the floor, its seat at 42 cm, the flush plate on the wall above', usedIn: 'The bathroom', make: () => wallToilet() },
	{ id: 'washbasin', label: 'Washbasin', note: 'a wall-hung basin, 60 × 42 cm, its spout from the wall', usedIn: 'The bathroom', make: () => washbasin() },
	{ id: 'glass-shower', label: 'Glass shower', note: 'frameless glass, a rain head under the ceiling, a hand shower on its rail', usedIn: 'The bathroom', make: () => glassShower() },
	{ id: 'towel-radiator', label: 'Towel radiator', note: 'white, a ladder of round rails, 50 × 140 cm', usedIn: 'The bathroom', make: () => towelRadiator() },
	{ id: 'truck', label: 'Truck', note: 'a cab and a box trailer, about 16 × 2.55 × 4 m', usedIn: 'The tired land', make: () => truck({ cab: '#a33a2a', box: '#e0ddd6' }) },
	{ id: 'tree-broadleaf', label: 'Tree, broadleaf', note: "an ash or a maple of the Isar's banks, about 19 m high, its crown 12 m across: limbs and branches, leaf cards lit as one soft crown", usedIn: 'The Isar', make: () => tree('broadleaf') },
	{ id: 'tree-willow', label: 'White willow', note: 'two leaning trunks and a broad silvery crown, about 15 m', usedIn: 'The Isar', make: () => tree('willow') },
	{ id: 'tree-poplar', label: 'Black poplar', note: 'tall and oval, about 27 m', usedIn: 'The Isar', make: () => tree('poplar') },
	{ id: 'willow-shrub', label: 'Willow shrub', note: "thin stems in a clump at the water's edge, about 4.5 m", usedIn: 'The Isar', make: () => tree('shrub') },
	{ id: 'park-bench', label: 'Park bench', note: 'wooden slats on two cast-iron frames, 1.80 m long, the seat at 45 cm, the back up to 85 cm', usedIn: 'The Isar', make: () => parkBench() },
	{ id: 'bridge-lamp', label: 'Wittelsbacherbrücke lamp', note: 'a dark cast-iron post, 5.4 m, a crossbar and a lantern hanging from each end', usedIn: 'The Isar', make: () => bridgeLamp() },
	{ id: 'limestone-block', label: 'Limestone block', note: "shell limestone, its edges worn round, 1.6 × 0.9 × 0.8 m, as they lie by the Isar's paths and in its steps", usedIn: 'The Isar', make: () => limestoneBlock() },
	{ id: 'equestrian-statue', label: 'Otto von Wittelsbach', note: 'the bronze rider on his pillar of the Wittelsbacherbrücke (Georg Wrba, 1905), about 4.4 m, seen from far below', usedIn: 'The Isar', make: () => equestrianStatue() }
];
