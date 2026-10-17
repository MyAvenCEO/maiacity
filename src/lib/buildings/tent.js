// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE BELL TENT AS A BUILDING — the Buildings' tent from v2 (`buildings/dome-tent@2`), built in the asset box like the
 * containers: the Things' bell tent ($lib/models/belltent.js, `things/bell-tent`), pitched, and its fire place where
 * the Things put it, in front of its door (BELL_TENT.fire), lit. Walked in from just outside its door, on the floors
 * and between the walls its own shape has (the viewer reads them off it, as it does a container's); pitched again with
 * the tent's own pitch, the fire lit or put out with its own, its flames flickering as the fire place's do.
 */
import * as THREE from 'three';
import { BELL_TENT, bellTent, firePlace } from '$lib/models/belltent.js';

/** The bell tent pitched, the fire place lit in front of its door: one object, the tent's foot at the origin. */
export function tentSite() {
	const g = new THREE.Group();
	g.name = 'bell-tent-site';
	const tent = bellTent();
	const fire = firePlace();
	fire.position.set(BELL_TENT.fire.x, 0, BELL_TENT.fire.z);
	g.add(tent, fire);
	g.userData = {
		setPitch: tent.userData.setPitch,
		fire: fire.userData.fire,
		tick: fire.userData.tick,
		// a metre out of its door, between it and the fire (its woodpile just behind), looking in
		walk: { x: 0, z: BELL_TENT.R + 1, yaw: 0, lamps: [] }
	};
	return g;
}
