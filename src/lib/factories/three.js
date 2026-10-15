/*
 * THREE FOR THE FACTORIES — the app's own three.js (package.json: three ^0.186) with the addons AirSup's factory
 * runtime uses, gathered behind one name `T`, as their vendored bundle (three.js r185 plus the same addons on
 * `globalThis.THREE`) gave them. The ported runtime (des.js, kit.js, world.js, look.js, app.js) reads `T.…` exactly as
 * AirSup wrote it, so a newer AirSup version can be diffed against ours line by line.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/** three.js and the addons the factory runtime uses, under one name */
export const T = /** @type {typeof THREE & { EffectComposer: typeof EffectComposer, RenderPass: typeof RenderPass, ShaderPass: typeof ShaderPass, UnrealBloomPass: typeof UnrealBloomPass, GTAOPass: typeof GTAOPass, OutputPass: typeof OutputPass, RoomEnvironment: typeof RoomEnvironment, OrbitControls: typeof OrbitControls, RoundedBoxGeometry: typeof RoundedBoxGeometry, BufferGeometryUtils: typeof BufferGeometryUtils }} */ ({
	...THREE,
	EffectComposer,
	RenderPass,
	ShaderPass,
	UnrealBloomPass,
	GTAOPass,
	OutputPass,
	RoomEnvironment,
	OrbitControls,
	RoundedBoxGeometry,
	BufferGeometryUtils
});
