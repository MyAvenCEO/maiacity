// @ts-nocheck — plain JS
/*
 * WHAT THE ENGINE LENDS A RECIPE — every module a recipe may `require` of the engine (./engine.js), by the name it
 * imports it by: three.js and the addons our recipes use. A frozen engine lists them in ../engines.json; a recipe that
 * needs another needs a newer engine (./plugin.js refuses to make it otherwise).
 */
import * as THREE from 'three';
import * as RoundedBoxGeometry from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as Reflector from 'three/addons/objects/Reflector.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const MODULES = {
	three: THREE,
	'three/addons/geometries/RoundedBoxGeometry.js': RoundedBoxGeometry,
	'three/addons/objects/Reflector.js': Reflector,
	'three/addons/utils/BufferGeometryUtils.js': BufferGeometryUtils,
	'three/addons/utils/SkeletonUtils.js': SkeletonUtils
};
