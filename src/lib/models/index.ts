/*
 * THE 3D MODELS — every reusable model, as the 3D models viewer (/app/models/) lists it: its name, what it is, where
 * it is used, and the function that builds it (./furniture.ts, ./hallway.ts, ./kitchen.ts, ./bathroom.ts,
 * ./outdoor.ts, ./terrace.ts, ./yard.ts, ./containers.js; a machine that works is an actor, ./actors). A world places
 * them (src/lib/worlds); a new one is a function there and a line here. Each has its version and history
 * ($lib/app/versions.js): a changed model goes up a version, its old builder kept in HISTORY below.
 */
import type * as THREE from 'three';
import type { Cast } from '$lib/actors/rig';
import { bed, chair, crateTower, edisonBulb, framedPicture, neewerCb60, sheepskin, truck, wineCrate } from './furniture';
import { barCounter, barStool, canvasPrint, coatStand, door, palletShelf, pendantLamp, retroFridge } from './hallway';
import { gasBoiler, kitchenRun, panRail, pedalBin, xShelf } from './kitchen';
import { glassShower, towelRadiator, washbasin, wallToilet } from './bathroom';
import { bridgeLamp, equestrianStatue, limestoneBlock, parkBench, tree } from './outdoor';
import { bambooTable, bistroChair, bistroTable, clubSofa, festoonLights, ficusTree, geraniumPot, monstera, oliveTree, paperLantern, ribbedPlanter, strelitzia, terracottaPot, toyBee, toyMonkey } from './terrace';
import { excavator } from '$lib/actors/excavator.js';
import { kitchenContainer, sanitaryContainer, techContainer, workshopContainer } from './containers';
import { ashtray, barnLamp, casementWindow, cityBike, doorCanopy, entranceDoor, floodlight, foldingChair, hedge, insectHotel, ivyCone, mailboxPost, rainBarrel, redTin, stationClock, steelWindow, stonewareCrock, teakRecliner, teakTable, windowBox, workshopDoor } from './yard';

import { versioned, type Version, type Change } from '$lib/app/versions.js';

/** A rigged machine as a model: its rig in the world, playing one of its moves (`userData.tick(t)`, as the viewer's clock runs). */
function working(cast: Cast, clip: string): THREE.Object3D {
	const play = (t: number) => cast.rig.pose(cast.clips[clip]!(t));
	play(0);
	cast.rig.object.userData.tick = play;
	return cast.rig.object;
}

type Make = () => THREE.Object3D;
export type Model = { id: string; label: string; note: string; usedIn: string; make: Make; versions: Version<Make>[]; version: number };

/** the models' older versions, by id, each with its frozen builder (none yet: everything is at v1) */
const HISTORY: Record<string, (Change & { build?: Make })[]> = {};

const LIST: Omit<Model, 'versions' | 'version'>[] = [
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
	{ id: 'equestrian-statue', label: 'Otto von Wittelsbach', note: 'the bronze rider on his pillar of the Wittelsbacherbrücke (Georg Wrba, 1905), about 4.4 m, seen from far below', usedIn: 'The Isar', make: () => equestrianStatue() },
	{ id: 'club-sofa', label: 'Club sofa', note: 'three seats in worn cognac leather, rolled arms, 1.95 × 0.92 m, 80 cm high, the seat at 45 cm', usedIn: 'The backyard', make: () => clubSofa() },
	{ id: 'bamboo-table', label: 'Bamboo coffee table', note: 'dark bamboo canes, their nodes ringed, a smoked glass top, a shelf of canes: 66 × 48 × 45 cm', usedIn: 'The backyard', make: () => bambooTable() },
	{ id: 'bistro-table', label: 'Bistro table', note: 'a round white top 60 cm across at 73 cm, on white tube legs', usedIn: 'The backyard', make: () => bistroTable() },
	{ id: 'bistro-chair', label: 'Moulded chair', note: 'black polypropylene in one piece, the seat at 46 cm, the back to 84 cm', usedIn: 'The backyard', make: () => bistroChair() },
	{ id: 'paper-lantern', label: 'Paper lantern', note: 'white paper on wire ribs, 35 cm across, on a wire under its hook; it glows at night', usedIn: 'The backyard', make: () => paperLantern() },
	{ id: 'planter-mint', label: 'Planter, mint', note: 'tall white fibreglass, ribbed across, 40 × 40 × 85 cm, mint growing out of it', usedIn: 'The backyard', make: () => ribbedPlanter({ plant: 'mint' }) },
	{ id: 'planter-lavender', label: 'Planter, lavender', note: 'the same planter, 45 cm, 95 cm high, silver lavender', usedIn: 'The backyard', make: () => ribbedPlanter({ w: 0.45, h: 0.95, plant: 'lavender' }) },
	{ id: 'planter-rosemary', label: 'Planter, rosemary', note: 'rosemary in flower, its stiff stems up through it', usedIn: 'The backyard', make: () => ribbedPlanter({ w: 0.45, h: 0.9, plant: 'rosemary in flower' }) },
	{ id: 'planter-trailing', label: 'Planter, trailing', note: 'a pale trailing plant hanging over its rim', usedIn: 'The backyard', make: () => ribbedPlanter({ h: 0.7, plant: 'trailing' }) },
	{ id: 'olive-tree', label: 'Olive tree', note: 'old and gnarled in a bowl 84 cm across, a round silver-green crown, 1.9 m', usedIn: 'The backyard', make: () => oliveTree() },
	{ id: 'strelitzia', label: 'Bird of paradise', note: 'paddle leaves fanned on long stalks, in a brass pot, 1.2 m', usedIn: 'The backyard', make: () => strelitzia() },
	{ id: 'monstera', label: 'Monstera', note: 'split leaves on their stalks in a white pot, for a window sill, 55 cm', usedIn: 'The backyard', make: () => monstera() },
	{ id: 'ficus', label: 'Ficus', note: 'a slim trunk, long narrow drooping leaves, in a white glazed pot, 2.2 m', usedIn: 'The backyard', make: () => ficusTree() },
	{ id: 'geranium', label: 'Geranium', note: 'pink, in a small green-bronze glazed pot, for a table', usedIn: 'The backyard', make: () => geraniumPot() },
	{ id: 'terracotta-pot', label: 'Terracotta pot', note: 'a flower pot 34 cm across with a small shrub in it', usedIn: 'The backyard', make: () => terracottaPot({ plant: 'shrub' }) },
	{ id: 'festoon-lights', label: 'Festoon lights', note: 'round bulbs on a black cable, 2.2 m, sagging between its ends', usedIn: 'The backyard', make: () => festoonLights() },
	{ id: 'toy-monkey', label: 'Toy monkey', note: 'plush, sitting, in a red shirt, about 30 cm', usedIn: 'The backyard', make: () => toyMonkey() },
	{ id: 'toy-bee', label: 'Toy bee', note: 'plush, sitting, yellow banded black, two pale wings, about 30 cm', usedIn: 'The backyard', make: () => toyBee() },
	{ id: 'steel-window', label: 'Steel window', note: "an old workshop's window: 6 × 7 small panes between slim steel bars, some frosted, 2.2 × 1.6 m", usedIn: 'The backyard', make: () => steelWindow() },
	{ id: 'casement-window', label: 'Casement window', note: 'white, two casements under a top light, 1.05 × 1.45 m', usedIn: 'The backyard', make: () => casementWindow() },
	{ id: 'entrance-door', label: 'Front door', note: 'two leaves of old wood, glazed over raised panels, a top light: 1.30 × 2.67 m', usedIn: 'The backyard', make: () => entranceDoor() },
	{ id: 'workshop-door', label: 'Workshop door', note: 'brown, two leaves, tall panes over steel plates, a letterbox: 1.80 × 2.55 m', usedIn: 'The backyard', make: () => workshopDoor() },
	{ id: 'door-canopy', label: 'Door canopy', note: 'glass in a grey steel frame on two arched brackets, 1.70 × 0.95 m', usedIn: 'The backyard', make: () => doorCanopy() },
	{ id: 'barn-lamp', label: 'Barn lamp', note: 'grey enamel on a gooseneck from the wall, the shade 30 cm across', usedIn: 'The backyard', make: () => barnLamp() },
	{ id: 'mailbox-post', label: 'Letterbox on a post', note: 'galvanised, a rounded lid, its top at 1.37 m', usedIn: 'The backyard', make: () => mailboxPost() },
	{ id: 'window-box', label: 'Window box', note: 'black, 80 cm long, herbs and flowers grown over its edge', usedIn: 'The backyard', make: () => windowBox() },
	{ id: 'city-bike', label: 'City bike', note: 'a black e-bike on its stand: 28-inch wheels, mudguards, a rack, about 1.8 m long', usedIn: 'The backyard', make: () => cityBike() },
	{ id: 'rain-barrel', label: 'Rain barrel', note: 'blue, 200 litres, 58 cm across, 93 cm high', usedIn: 'The backyard', make: () => rainBarrel() },
	{ id: 'insect-hotel', label: 'Insect hotel', note: 'a sunflower of yellow wooden petals round a disc of canes, 62 cm across', usedIn: 'The backyard', make: () => insectHotel() },
	{ id: 'floodlight', label: 'Floodlight', note: 'LED, tilted down on its bracket, a motion sensor under it, 24 × 18 cm', usedIn: 'The backyard', make: () => floodlight() },
	{ id: 'station-clock', label: 'Station clock', note: 'two faces, 32 cm across, under a bracket', usedIn: 'The backyard', make: () => stationClock() },
	{ id: 'teak-table', label: 'Teak table', note: 'oval, slatted, 1.60 × 0.95 m at 74 cm, a parasol hole', usedIn: 'The backyard', make: () => teakTable() },
	{ id: 'teak-recliner', label: 'Teak recliner', note: 'folding, high-backed, oiled red-brown: the seat at 40 cm, the back to 1.08 m', usedIn: 'The backyard', make: () => teakRecliner() },
	{ id: 'teak-recliner-grey', label: 'Teak recliner, weathered', note: 'the same chair gone silver-grey in the weather', usedIn: 'The backyard', make: () => teakRecliner({ weathered: true }) },
	{ id: 'folding-chair', label: 'Folding chair', note: 'fresh pine, a ladder back, the seat at 43 cm', usedIn: 'The backyard', make: () => foldingChair() },
	{ id: 'stoneware-crock', label: 'Stoneware crock', note: 'grey salt glaze, a blue flower painted on it, 40 cm high', usedIn: 'The backyard', make: () => stonewareCrock() },
	{ id: 'red-tin', label: 'Red tin', note: 'red, a chrome lid, a wire handle, 19 cm high', usedIn: 'The backyard', make: () => redTin() },
	{ id: 'ashtray', label: 'Ashtray', note: 'brushed steel, windproof, 11 cm across', usedIn: 'The backyard', make: () => ashtray() },
	{ id: 'hedge', label: 'Clipped hedge', note: 'box-leaved honeysuckle, 1.5 × 0.6 m, 70 cm high', usedIn: 'The backyard', make: () => hedge() },
	{ id: 'ivy-cone', label: 'Ivy cone', note: 'ivy grown over a stake, 1.3 m high', usedIn: 'The backyard', make: () => ivyCone() },
	{ id: 'tree-lilac', label: 'Lilac', note: 'an old lilac, many stems from one root, about 5.5 m', usedIn: 'The backyard', make: () => tree('lilac') },
	{ id: 'tree-corkscrew', label: 'Corkscrew willow', note: 'two twisted trunks, a drooping crown of narrow leaves, about 5.5 m', usedIn: 'The backyard', make: () => tree('corkscrew') },
	{ id: 'tree-maple', label: 'Field maple', note: 'small, by a door, about 4.3 m', usedIn: 'The backyard', make: () => tree('maple') },
	{ id: 'tree-privet', label: 'Privet tree', note: 'several stems, narrow leaves, about 4.5 m', usedIn: 'The backyard', make: () => tree('privet') },
	{ id: 'sapling', label: 'Sapling', note: 'one thin stem and a few leaves, about 2.2 m', usedIn: 'The backyard', make: () => tree('sapling') },
	{ id: 'container-kitchen', label: 'Kitchen container', note: "a 40' high cube (12.19 × 2.44 × 2.90 m) fitted as the crew's central kitchen: six-burner range under its hood, combi steamer, sinks, dishwasher, fridges and freezer, the serving hatch — and the pantry behind a partition. Walk in", usedIn: 'Sandbox 1', make: () => kitchenContainer() },
	{ id: 'container-workshop', label: 'Workshop container', note: "the workshop: a 4 m bench under a pegboard of hand tools, timber rack, pillar drill, grinder, mitre saw, table saw, welder, compressor, cordless tools in their cases, spades, ladder, wheelbarrow; a mixer outside. Walk in", usedIn: 'Sandbox 1', make: () => workshopContainer() },
	{ id: 'container-tech', label: 'Tech container', note: "28 solar panels (about 11 kWp) on the roof and fold-out wings, 40 kWh of batteries, inverters, a hydrogen fuel cell and electrolyser, Starlink, and the AI server room behind glass. Walk in", usedIn: 'Sandbox 1', make: () => techContainer() },
	{ id: 'container-sanitary', label: 'Sanitary container', note: 'washing machines and dryers, three washbasins, three showers and three toilets in cubicles, the hot-water heat pump; a rainwater tank outside. Walk in', usedIn: 'Sandbox 1', make: () => sanitaryContainer() },
	{ id: 'mini-excavator', label: 'Mini excavator', note: 'a 1.7 t digger on rubber tracks, 1.55 m long, 0.99 m wide, 2.3 m to its canopy, 3.9 m reach — rigged: it digs, slews and dumps (its other moves in the Actors gallery)', usedIn: 'Sandbox 1', make: () => working(excavator(), 'dig') }
];

export const MODELS: Model[] = versioned(LIST, 'make', HISTORY);
