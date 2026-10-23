/**
 * Map-style camera: MapControls (left-drag pan, right-drag rotate, wheel zoom to cursor) with
 * damping, keyboard pan (WASD / arrows), rotate (Q/E), tilt (Page Up/Down or Shift+W/S), distance / tilt / bounds clamping, terrain-following target
 * and smooth focus animations.
 */
import { MOUSE, type PerspectiveCamera, Spherical, TOUCH, Vector3 } from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { Heightfield } from './heightfield.ts';

const MIN_DIST = .7;
const MAX_DIST = 2200;
const MAX_POLAR = (80 * Math.PI) / 180; // never lower than 10° above the horizon

interface FocusAnim {
  t0: number;
  dur: number;
  fromT: Vector3;
  toT: Vector3;
  fromD: number;
  toD: number;
}

export class CameraRig {
  readonly controls: MapControls;
  private keys = new Set<string>();
  private anim: FocusAnim | null = null;
  private sph = new Spherical();
  private off = new Vector3();
  private fwd = new Vector3();
  private right = new Vector3();
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onBlur: () => void;
  hf: Heightfield | null = null;
  /** Q/E rotate the camera unless a tool uses them (building placement rotates the draft) */
  rotateKeys = true;
  private shift = false;

  constructor(
    readonly camera: PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    const c = new MapControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.screenSpacePanning = false;
    c.zoomToCursor = true;
    c.minDistance = MIN_DIST;
    c.maxDistance = MAX_DIST;
    c.maxPolarAngle = MAX_POLAR;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 1.1;
    c.panSpeed = 1;
    c.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    c.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
    this.controls = c;
    const typing = () => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return false;
      const tag = a.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
    };
    this.onKeyDown = (e) => {
      this.shift = e.shiftKey;
      if (e.ctrlKey || e.metaKey || e.altKey || typing()) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'pageup', 'pagedown', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        if ((k === 'q' || k === 'e') && !this.rotateKeys) return;
        this.keys.add(k);
        if (k.startsWith('arrow') || k.startsWith('page')) e.preventDefault();
        this.anim = null;
      }
    };
    this.onKeyUp = (e) => {
      this.shift = e.shiftKey;
      this.keys.delete(e.key.toLowerCase());
    };
    this.onBlur = () => this.keys.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    c.addEventListener('start', () => {
      this.anim = null;
    });
  }

  get distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  focus(x: number, z: number, distance?: number, instant = false): void {
    const hf = this.hf;
    const y = hf ? hf.y(x, z) : this.controls.target.y;
    const toT = new Vector3(hf ? hf.clampX(x) : x, y, hf ? hf.clampZ(z) : z);
    const toD = Math.min(MAX_DIST, Math.max(MIN_DIST, distance ?? this.distance));
    if (instant) {
      this.anim = null;
      this.off.copy(this.camera.position).sub(this.controls.target).setLength(toD);
      this.controls.target.copy(toT);
      this.camera.position.copy(toT).add(this.off);
      this.controls.update();
      return;
    }
    this.anim = { t0: performance.now(), dur: 900, fromT: this.controls.target.clone(), toT, fromD: this.distance, toD };
  }

  /**
   * keep the target on a moving point: the target and the camera move together by what the point moved (a smooth catch-up),
   * so the view's angle and distance stay as the player set them
   */
  follow(x: number, z: number, dt: number): void {
    if (this.anim) return;
    const hf = this.hf;
    const c = this.controls;
    const tx = hf ? hf.clampX(x) : x;
    const tz = hf ? hf.clampZ(z) : z;
    const k = 1 - Math.exp(-dt * 6);
    const dx = (tx - c.target.x) * k;
    const dz = (tz - c.target.z) * k;
    const ty = hf ? hf.y(c.target.x + dx, c.target.z + dz) : c.target.y;
    const dy = ty - c.target.y;
    c.target.x += dx;
    c.target.y += dy;
    c.target.z += dz;
    this.camera.position.x += dx;
    this.camera.position.y += dy;
    this.camera.position.z += dz;
  }

  /** set the view direction: compass azimuth the camera looks towards (° clockwise from north), tilt from vertical (°) */
  setView(azimuthDeg: number, polarDeg: number): void {
    this.off.copy(this.camera.position).sub(this.controls.target);
    this.sph.setFromVector3(this.off);
    this.sph.phi = Math.min(MAX_POLAR, Math.max(0.05, (polarDeg * Math.PI) / 180));
    // spherical theta: angle of the camera offset from +z towards +x; looking north = offset +z = 0
    this.sph.theta = (-azimuthDeg * Math.PI) / 180;
    this.off.setFromSpherical(this.sph);
    this.camera.position.copy(this.controls.target).add(this.off);
    this.controls.update();
  }

  update(dt: number, now: number): void {
    const c = this.controls;
    const cam = this.camera;
    // focus animation
    if (this.anim) {
      const a = this.anim;
      const f = Math.min(1, (now - a.t0) / a.dur);
      const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      this.off.copy(cam.position).sub(c.target);
      const d = a.fromD + (a.toD - a.fromD) * e;
      c.target.lerpVectors(a.fromT, a.toT, e);
      cam.position.copy(c.target).add(this.off.setLength(d));
      if (f >= 1) this.anim = null;
    }
    // keyboard
    if (this.keys.size) {
      const k = this.keys;
      const dist = this.distance;
      const pan = dist * 0.9 * dt;
      cam.getWorldDirection(this.fwd);
      this.fwd.y = 0;
      if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
      this.fwd.normalize();
      this.right.set(-this.fwd.z, 0, this.fwd.x);
      let mx = 0;
      let mz = 0;
      // Shift+W/S tilt instead of panning
      const tiltMode = this.shift;
      if ((k.has('w') && !tiltMode) || k.has('arrowup')) mz += 1;
      if ((k.has('s') && !tiltMode) || k.has('arrowdown')) mz -= 1;
      if (k.has('d') || k.has('arrowright')) mx += 1;
      if (k.has('a') || k.has('arrowleft')) mx -= 1;
      if (mx || mz) {
        this.off.set(0, 0, 0).addScaledVector(this.fwd, mz * pan).addScaledVector(this.right, mx * pan);
        c.target.add(this.off);
        cam.position.add(this.off);
      }
      let rot = 0;
      let tilt = 0;
      if (this.rotateKeys) {
        if (k.has('q')) rot += 1;
        if (k.has('e')) rot -= 1;
      }
      if (k.has('pageup') || (tiltMode && k.has('w'))) tilt -= 1;
      if (k.has('pagedown') || (tiltMode && k.has('s'))) tilt += 1;
      if (rot || tilt) {
        this.off.copy(cam.position).sub(c.target);
        this.sph.setFromVector3(this.off);
        this.sph.theta += rot * 1.4 * dt;
        this.sph.phi = Math.min(MAX_POLAR, Math.max(0.05, this.sph.phi + tilt * 0.9 * dt));
        this.off.setFromSpherical(this.sph);
        cam.position.copy(c.target).add(this.off);
      }
    }
    c.update(dt);
    const hf = this.hf;
    if (hf) {
      // keep the target inside the map, and on the ground
      const tx = hf.clampX(c.target.x);
      const tz = hf.clampZ(c.target.z);
      const dx = tx - c.target.x;
      const dz = tz - c.target.z;
      if (dx || dz) {
        c.target.x = tx;
        c.target.z = tz;
        cam.position.x += dx;
        cam.position.z += dz;
      }
      const gy = hf.y(c.target.x, c.target.z);
      const dy = (gy - c.target.y) * Math.min(1, dt * 6);
      c.target.y += dy;
      cam.position.y += dy;
      // never below the terrain
      const clearance = Math.max(.12, Math.min(4, this.distance * .08));
      const floor = hf.y(cam.position.x, cam.position.z) + clearance;
      if (cam.position.y < floor) cam.position.y = floor;
    }
    // depth precision: near plane scales with distance
    const near = Math.min(10, Math.max(0.02, this.distance / 100));
    if (Math.abs(near - cam.near) / cam.near > 0.1) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.controls.dispose();
    void this.dom;
  }
}
