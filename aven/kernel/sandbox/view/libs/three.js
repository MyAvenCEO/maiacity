// @ts-nocheck — plain JS: three.js and its addons for a view's draw script, frozen as lib-three (../worker.js)
import * as THREE from 'three';
import * as OrbitControls from 'three/addons/controls/OrbitControls.js';
import * as MapControls from 'three/addons/controls/MapControls.js';
import * as TrackballControls from 'three/addons/controls/TrackballControls.js';
import * as RoundedBoxGeometry from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as ConvexGeometry from 'three/addons/geometries/ConvexGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as ImprovedNoise from 'three/addons/math/ImprovedNoise.js';
import * as SimplexNoise from 'three/addons/math/SimplexNoise.js';
import * as Sky from 'three/addons/objects/Sky.js';
import * as RoomEnvironment from 'three/addons/environments/RoomEnvironment.js';
import * as Line2 from 'three/addons/lines/Line2.js';
import * as LineMaterial from 'three/addons/lines/LineMaterial.js';
import * as LineGeometry from 'three/addons/lines/LineGeometry.js';

const define = self.__maiaDefine;
define('three', THREE);
const ADDONS = { 'controls/OrbitControls.js': OrbitControls, 'controls/MapControls.js': MapControls, 'controls/TrackballControls.js': TrackballControls, 'geometries/RoundedBoxGeometry.js': RoundedBoxGeometry, 'geometries/ConvexGeometry.js': ConvexGeometry, 'utils/BufferGeometryUtils.js': BufferGeometryUtils, 'utils/SkeletonUtils.js': SkeletonUtils, 'math/ImprovedNoise.js': ImprovedNoise, 'math/SimplexNoise.js': SimplexNoise, 'objects/Sky.js': Sky, 'environments/RoomEnvironment.js': RoomEnvironment, 'lines/Line2.js': Line2, 'lines/LineMaterial.js': LineMaterial, 'lines/LineGeometry.js': LineGeometry };
for (const [path, ns] of Object.entries(ADDONS)) {
	define(`three/addons/${path}`, ns);
	define(`three/examples/jsm/${path}`, ns);
}
