/*
 * Ported from AirSup's factory-skill (https://github.com/AirsupHQ/factory-skill, commit 9fde755, MIT licence:
 * Copyright (c) 2026 Air Supply Technologies Inc., .claude/skills/factory-skill/LICENSE) into maiaCITY as an ES module
 * (2026-10-15). Only this head and the foot changed: the browser globals (FactorySkill, THREE) became imports and
 * exports; the body is theirs, line for line, under `@ts-nocheck` so it stays theirs. Our additions, where there are
 * any, sit at the end under "maiaCITY additions".
 */
// @ts-nocheck
import { T } from './three.js'
/*
 * Factory Skill: the miniature look.
 *
 * A tilt-shift photograph of a model factory on a table: soft warm sun with
 * soft shadows, a studio environment for reflections, ground truth ambient
 * occlusion, a little bloom on lit parts, a narrow band of focus with the
 * blur growing toward the top and bottom of the frame, then a warm grade with
 * extra saturation, contrast, vignette and fine grain.
 */

  const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

  // Separable blur whose radius follows the distance from a tilted band of focus.
  // Depth also feeds in, so a tall object in the band stays sharp while the
  // table behind it softens, which is what a tilted lens plane does.
  const TILT = {
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null }, dir: { value: new T.Vector2(1, 0) }, res: { value: new T.Vector2(1, 1) },
      focusY: { value: 0.46 }, band: { value: 0.07 }, amount: { value: 20 }, tilt: { value: 0.0 }, power: { value: 1.25 },
    },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 dir, res; uniform float focusY, band, amount, tilt, power;
      varying vec2 vUv;
      float coc(vec2 uv){
        float y = uv.y + (uv.x - 0.5) * tilt;
        float d = abs(y - focusY);
        float k = clamp((d - band) / max(0.05, 0.62 - band), 0.0, 1.0);
        return pow(k, power) * amount;
      }
      void main(){
        float c = coc(vUv);
        if (c < 0.35) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
        vec4 sum = vec4(0.0); float ws = 0.0;
        for (int i = -14; i <= 14; i++) {
          float x = float(i) / 14.0;
          vec2 uv = vUv + dir * x * c / res;
          // gather only from samples at least as blurred, so sharp edges do not bleed outward
          float w = exp(-x * x * 2.2) * clamp(coc(uv) / max(c, 1e-3) * 1.5, 0.15, 1.0);
          sum += texture2D(tDiffuse, uv) * w; ws += w;
        }
        gl_FragColor = sum / ws;
      }`,
  }

  const GRADE = {
    uniforms: {
      tDiffuse: { value: null }, res: { value: new T.Vector2(1, 1) }, time: { value: 0 },
      sat: { value: 1.32 }, contrast: { value: 1.14 }, warm: { value: new T.Vector3(1.02, 1.0, 0.965) },
      lift: { value: 0.0 }, vig: { value: 0.38 }, grain: { value: 0.018 },
    },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 res; uniform float time, sat, contrast, lift, vig, grain; uniform vec3 warm;
      varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        c = c * warm;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, sat);
        c = (c - 0.5) * contrast + 0.5 + lift * (1.0 - c);
        vec2 q = (vUv - 0.5) * vec2(res.x / res.y, 1.0);
        c *= 1.0 - vig * smoothstep(0.35, 1.05, length(q));
        c += (h(vUv * res + fract(time) * 91.7) - 0.5) * grain;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  }

  export class Look {
    constructor(canvas, opts = {}) {
      this.opts = opts
      const r = (this.renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve }))
      r.outputColorSpace = T.SRGBColorSpace
      r.toneMapping = T.ACESFilmicToneMapping
      r.toneMappingExposure = opts.exposure || 0.98
      r.shadowMap.enabled = true
      r.shadowMap.type = T.PCFShadowMap
      this.pixelRatio = Math.min(opts.pixelRatio || globalThis.devicePixelRatio || 1, opts.maxPixelRatio || 2)
      r.setPixelRatio(this.pixelRatio)

      const scene = (this.scene = new T.Scene())
      this.bg = new T.Color(opts.background || '#e8e1d4')
      scene.background = this.bg
      scene.fog = new T.Fog(this.bg, 260, 900)

      const pm = new T.PMREMGenerator(r)
      scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture
      scene.environmentIntensity = opts.envIntensity != null ? opts.envIntensity : 0.42

      this.camera = new T.PerspectiveCamera(opts.fov || 22, 1, 1, 2000)

      // light: a warm low-ish sun from the back left, a sky dome, a cool fill from the front right
      const sun = (this.sun = new T.DirectionalLight('#ffeed2', 4.0))
      sun.castShadow = true
      sun.shadow.mapSize.set(4096, 4096)
      sun.shadow.bias = -0.00025
      sun.shadow.normalBias = 0.025
      sun.shadow.radius = 2.2
      scene.add(sun, sun.target)
      this.hemi = new T.HemisphereLight('#dfe9f5', '#a8957a', 0.62)
      scene.add(this.hemi)
      const fill = (this.fill = new T.DirectionalLight('#dbe6ff', 0.45))
      fill.position.set(60, 30, 80)
      scene.add(fill)

      // post: AO, bloom, tone map, tilt shift (two passes), grade
      const size = new T.Vector2(1, 1)
      const rt = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: opts.samples != null ? opts.samples : 4 })
      const comp = (this.composer = new T.EffectComposer(r, rt))
      comp.addPass(new T.RenderPass(scene, this.camera))
      if (opts.ao !== false) {
        const ao = (this.ao = new T.GTAOPass(scene, this.camera, 1, 1))
        ao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.6, thickness: 1.2, scale: 1.15, samples: 16, distanceFallOff: 1 })
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 })
        ao.blendIntensity = 1.0
        comp.addPass(ao)
      }
      this.bloom = new T.UnrealBloomPass(size, 0.3, 0.45, 2.6)
      if (opts.bloom !== false) comp.addPass(this.bloom)
      comp.addPass(new T.OutputPass())
      this.tiltH = new T.ShaderPass(TILT)
      this.tiltV = new T.ShaderPass(TILT)
      this.tiltV.uniforms.dir.value.set(0, 1)
      if (opts.tilt !== false) { comp.addPass(this.tiltH); comp.addPass(this.tiltV) }
      this.grade = new T.ShaderPass(GRADE)
      if (opts.grade !== false) comp.addPass(this.grade)
      this.time = 0
    }
    /** focus band in screen space: y of the sharp line (0 bottom, 1 top), half width, blur in px at 1080p */
    setTilt({ focusY, band, amount, tilt } = {}) {
      for (const p of [this.tiltH, this.tiltV]) {
        if (focusY != null) p.uniforms.focusY.value = focusY
        if (band != null) p.uniforms.band.value = band
        if (amount != null) p.uniforms.amount.value = amount
        if (tilt != null) p.uniforms.tilt.value = tilt
      }
      this._amount = amount != null ? amount : this._amount
      this._applyAmount()
    }
    _applyAmount() {
      const h = this.h || 1080
      const a = (this._amount != null ? this._amount : 9) * (h * this.pixelRatio) / 1080
      this.tiltH.uniforms.amount.value = a
      this.tiltV.uniforms.amount.value = a
    }
    /** fit the sun's shadow camera around a box {x0,x1,z0,z1,h} */
    fitSun(b, dir = [-0.55, 1, -0.42]) {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2
      const R = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2 + 6
      const d = new T.Vector3(...dir).normalize()
      this.sun.position.set(cx + d.x * R * 2, d.y * R * 2, cz + d.z * R * 2)
      this.sun.target.position.set(cx, 0, cz)
      const c = this.sun.shadow.camera
      c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = R * 5
      c.updateProjectionMatrix()
    }
    setSize(w, h) {
      this.w = w; this.h = h
      this.renderer.setSize(w, h, false)
      this.composer.setPixelRatio(this.pixelRatio)
      this.composer.setSize(w, h)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      const W = w * this.pixelRatio, H = h * this.pixelRatio
      for (const p of [this.tiltH, this.tiltV]) p.uniforms.res.value.set(W, H)
      this.grade.uniforms.res.value.set(W, H)
      this._applyAmount()
    }
    render(dt) {
      this.time += dt || 0
      this.grade.uniforms.time.value = this.time
      this.composer.render(dt)
    }
  }
