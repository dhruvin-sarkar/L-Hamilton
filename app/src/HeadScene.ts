import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The hero scene: a contour-line field, a depth-map portrait on top of it, a
 * wireframe helmet over the head, and a cursor that plays between them.
 *
 * Reconstructed from the reference's behaviour and its named parameters rather
 * than its code, which is minified past recovery. The parameter names are the
 * specification: REVEAL_SIZE, CURSOR_INTENSITY, CURSOR_SCALE, NOISE_DETAIL 3,
 * SPEED 0.1.
 */

const HERO_BASE = '/assets/hero';
const HELMET_URL = '/assets/helmet/helmet.gltf';

export interface HeadSceneOptions {
  parallax?: number;
  ease?: number;
  /** Multiplier on the fitted portrait size — see `layout()`. */
  subjectScale?: number;
}

/* ------------------------------------------------------------------ *
 * Shared GLSL
 * ------------------------------------------------------------------ */

const noiseChunk = /* glsl */ `
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  // Gradient noise. Smoother than value noise, which matters because the
  // contour step is taken on the derivative — value noise leaves grid creases
  // once you threshold it.
  float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
          dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
      mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
          dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
      u.y);
  }

  float fbm(vec2 p, int octaves) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      sum += amp * gnoise(p);
      p *= 2.02;
      amp *= 0.5;
    }
    return sum;
  }
`;

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* ------------------------------------------------------------------ *
 * Contour field
 * ------------------------------------------------------------------ */

const fieldFragment = /* glsl */ `
  precision highp float;

  uniform vec3  uBg;
  uniform vec3  uLine;
  uniform vec3  uCursorLine;
  uniform vec2  uPointerPx;
  uniform vec2  uAspect;
  uniform float uTime;
  uniform float uRevealPx;
  uniform float uCursorIntensity;
  uniform int   uOctaves;

  varying vec2 vUv;

  ${noiseChunk}

  void main() {
    vec2 p = (vUv - 0.5) * uAspect;

    // Ambient drift, two rates so the field never visibly loops.
    float n = fbm(p * 1.6 + vec2(uTime * 0.06, uTime * -0.035), uOctaves);

    // Distance from the pointer in PIXELS. The portrait measures the reveal
    // the same way — doing it in each mesh's plane space made the two discs
    // disagree, because the meshes are scaled differently.
    float dPx = length(gl_FragCoord.xy - uPointerPx);

    float influence = exp(-pow(dPx / max(uRevealPx, 1.0), 2.0));
    n += influence * uCursorIntensity;

    // Contour extraction: fractional part of the field, thresholded against
    // its own screen-space derivative. fwidth keeps the lines one pixel wide at
    // every aspect — a fixed epsilon thickens them on wide viewports.
    // Band frequency drives how many contour rings cross the frame. At 9 the
    // field is so flat that fwidth returns a sub-pixel threshold and the lines
    // vanish everywhere except where the cursor steepens the gradient — which
    // is exactly the "only lit under the pointer" failure.
    float bands = n * 26.0;
    float edge  = abs(fract(bands) - 0.5);
    // Floor the threshold so a line is never thinner than it can be drawn.
    float w     = max(fwidth(bands) * 1.6, 0.02);
    float line  = 1.0 - smoothstep(0.0, w, edge);

    // The field must be legible across the WHOLE frame, not only under the
    // cursor — on the reference it reads as faint topography everywhere. The
    // cursor then lifts its own neighbourhood to the accent colour.
    float reveal = 1.0 - smoothstep(uRevealPx * 0.45, uRevealPx * 1.35, dPx);
    vec3  lineCol = mix(uLine, uCursorLine, reveal);
    float strength = mix(0.85, 1.0, reveal);

    gl_FragColor = vec4(mix(uBg, lineCol, line * strength), 1.0);
  }
`;

/* ------------------------------------------------------------------ *
 * Portrait
 * ------------------------------------------------------------------ */

const headFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uDiffuse;
  uniform sampler2D uDepth;
  uniform sampler2D uAlpha;
  uniform sampler2D uShadow;
  uniform bool      uHasShadow;

  uniform vec2  uPointer;
  uniform vec2  uPointerPx;
  uniform float uParallax;
  uniform float uShadowAmount;
  uniform float uRevealPx;
  uniform float uCursorIntensity;
  uniform float uCursorScale;
  uniform float uTime;
  uniform float uIntro;
  uniform int   uOctaves;

  varying vec2 vUv;

  ${noiseChunk}

  void main() {
    float d = texture2D(uDepth, vUv).r;

    // Depth parallax: 0.5 is the pivot plane, so the sign of (d - 0.5) decides
    // whether a pixel leads or trails the pointer.
    vec2 offset = uPointer * (d - 0.5) * uParallax;

    float dPx = length(gl_FragCoord.xy - uPointerPx);
    float near = 1.0 - smoothstep(0.0, uRevealPx * 1.6, dPx);

    float swirl = fbm(vUv * uCursorScale + uTime * 0.05, uOctaves);
    offset += vec2(swirl) * near * uCursorIntensity * 0.05;

    vec2 uv = vUv + offset;

    vec3  diffuse = texture2D(uDiffuse, uv).rgb;
    float alpha   = texture2D(uAlpha,  uv).r;

    vec3 color = diffuse;
    if (uHasShadow) {
      color *= mix(1.0, texture2D(uShadow, uv).r, uShadowAmount);
    }

    // Intro wipe, bottom up. uIntro is driven past 1 so the leading edge clears
    // the top of the plane; comparing against it directly leaves everything
    // above the softening band masked forever.
    alpha *= smoothstep(vUv.y - 0.25, vUv.y, uIntro * 1.3);

    // The portrait stays fully opaque. On the reference the cursor reveals the
    // HELMET over the face; the face itself never fades.

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */

const tokenColor = (css: string) => new THREE.Color(css).convertSRGBToLinear();

export class HeadScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;

  private readonly field: THREE.ShaderMaterial;
  private readonly head: THREE.ShaderMaterial;
  private readonly fieldMesh: THREE.Mesh;
  private readonly headMesh: THREE.Mesh;

  /** Wireframe helmet, parented so it scales with the portrait. */
  private helmet: THREE.Group | null = null;
  private helmetMat: THREE.MeshBasicMaterial | null = null;

  private readonly pointerTarget = new THREE.Vector2();
  private readonly pointer = new THREE.Vector2();
  private readonly pointerPx = new THREE.Vector2();
  private readonly pointerPxTarget = new THREE.Vector2();

  private readonly ease: number;
  private readonly subjectScale: number;
  private aspect = 1;
  private readonly clock = new THREE.Clock();
  private intro = 0;
  private dpr = 1;

  constructor(opts: HeadSceneOptions = {}) {
    this.ease = opts.ease ?? 0.08;
    this.subjectScale = opts.subjectScale ?? 1;

    // Orthographic: the effect is flat planes facing the viewer. A perspective
    // camera adds foreshortening on top of the parallax and makes the two
    // impossible to tune independently.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.camera.position.z = 1;

    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      tokenColor(css.getPropertyValue(name).trim() || fallback);

    this.field = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: fieldFragment,
      uniforms: {
        uBg: { value: token('--gl-bg', '#1a1416') },
        uLine: { value: token('--gl-outline', '#4a3438') },
        uCursorLine: { value: token('--gl-cursor-fg', '#ff2800') },
        uPointerPx: { value: this.pointerPx },
        uAspect: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uRevealPx: { value: 220 },
        uCursorIntensity: { value: 0.12 },
        uOctaves: { value: 3 },
      },
    });

    this.head = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: headFragment,
      transparent: true,
      uniforms: {
        uDiffuse: { value: null },
        uDepth: { value: null },
        uAlpha: { value: null },
        uShadow: { value: null },
        uHasShadow: { value: false },
        uPointer: { value: this.pointer },
        uPointerPx: { value: this.pointerPx },
        uParallax: { value: opts.parallax ?? 0.02 },
        uShadowAmount: { value: 0.65 },
        uRevealPx: { value: 220 },
        uCursorIntensity: { value: 0.15 },
        uCursorScale: { value: 3 },
        uTime: { value: 0 },
        uIntro: { value: 0 },
        uOctaves: { value: 3 },
      },
    });

    const quad = new THREE.PlaneGeometry(1, 1);

    this.fieldMesh = new THREE.Mesh(quad, this.field);
    this.fieldMesh.position.z = -1;
    this.fieldMesh.renderOrder = 0;

    this.headMesh = new THREE.Mesh(quad, this.head);
    this.headMesh.renderOrder = 1;

    this.scene.add(this.fieldMesh, this.headMesh);
  }

  async load(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const get = (name: string, srgb = false) =>
      loader.loadAsync(`${HERO_BASE}/${name}`).then((t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        // Never wrap: a sampled offset running past the edge must clamp, not
        // reappear on the opposite side of the face.
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
      });

    const [diffuse, depth, alpha] = await Promise.all([
      get('lewis-hero.webp', true),
      get('depth-map.webp'),
      get('alpha-map.webp'),
    ]);

    this.head.uniforms.uDiffuse!.value = diffuse;
    this.head.uniforms.uDepth!.value = depth;
    this.head.uniforms.uAlpha!.value = alpha;
    // No shadow pass yet. The shader branches on this rather than sampling a
    // missing texture, which would render the face black.
    this.head.uniforms.uHasShadow!.value = false;

    const img = diffuse.image as { width: number; height: number };
    this.aspect = img.width / img.height;
    this.layout();
  }

  /**
   * Load and fit the wireframe helmet. Deliberately separate from `load()` and
   * failure-tolerant: the helmet is ~11 MB, and the hero must be usable long
   * before it lands — and still usable if it never does.
   */
  async loadHelmet(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(HELMET_URL);

    this.helmetMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      // A 470-mesh model has enough edges that even a low opacity reads as
      // solid noise. Kept faint so it registers as a ghosted shell.
      opacity: 0.09,
      depthWrite: false,
    });

    // Keep the glTF's own node hierarchy and only swap materials. Reparenting
    // the raw geometries into a flat group drops every node's world transform,
    // which collapses a 470-mesh model into a tangle of stray edges.
    const group = gltf.scene;
    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.material = this.helmetMat!;
    });

    // Normalise: the model arrives at an arbitrary scale and origin, so fit it
    // into a unit box and re-centre before parenting to the portrait.
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);
    const longest = Math.max(size.x, size.y, size.z) || 1;

    group.position.sub(centre);

    // Two nested groups, deliberately. The inner one owns the normalisation to
    // unit size; the outer one owns placement. Sharing a single group means
    // fitHelmet's setScalar wipes out the 1/longest normalisation and the model
    // renders at its raw glTF scale — which is how it ended up filling the
    // whole viewport.
    const normalised = new THREE.Group();
    normalised.add(group);
    normalised.scale.setScalar(1 / longest);

    const wrapper = new THREE.Group();
    wrapper.add(normalised);

    this.helmet = wrapper;
    this.helmet.renderOrder = 2;
    this.headMesh.add(this.helmet); // inherits the portrait's fit
    this.fitHelmet();
  }

  /** Place the helmet over the head, in the portrait's local space. */
  private fitHelmet(): void {
    if (!this.helmet) return;
    // The portrait plane is scaled non-uniformly (aspect on x, 1 on y), and a
    // child inherits that — so an unmodified helmet comes out stretched. Divide
    // the x scale back out to keep it round.
    const size = 0.34;
    this.helmet.scale.set(size / this.aspect, size, size);
    // Local space is the unit plane, -0.5..0.5. Sits on the upper third, where
    // a head falls in a portrait crop; needs a nudge when the final model lands.
    this.helmet.position.set(0, 0.2, 0.02);
  }

  setPointer(nx: number, ny: number): void {
    this.pointerTarget.set(nx, ny);
    // gl_FragCoord is device pixels, origin bottom-left, so the conversion has
    // to carry the device pixel ratio or the disc drifts on HiDPI displays.
    this.pointerPxTarget.set(
      ((nx + 1) / 2) * window.innerWidth * this.dpr,
      ((ny + 1) / 2) * window.innerHeight * this.dpr,
    );
  }

  set parallax(v: number) {
    this.head.uniforms.uParallax!.value = v;
  }

  /** Reveal radius, in CSS pixels. */
  set revealSize(v: number) {
    this.head.uniforms.uRevealPx!.value = v * this.dpr;
    this.field.uniforms.uRevealPx!.value = v * this.dpr * 1.25;
  }

  set helmetOpacity(v: number) {
    if (this.helmetMat) this.helmetMat.opacity = v;
  }

  /**
   * Fit the portrait. The source is 4:3 landscape where the reference's was
   * square, so fitting by height alone leaves the subject small — hence the
   * subjectScale multiplier rather than a plain contain.
   */
  private layout(): void {
    const view = window.innerWidth / window.innerHeight;
    const base = view > this.aspect ? 2 : (2 * view) / this.aspect;
    const scale = base * this.subjectScale;
    this.headMesh.scale.set(scale * this.aspect, scale, 1);

    this.fieldMesh.scale.set(view * 2, 2, 1);
    this.field.uniforms.uAspect!.value.set(view, 1);
  }

  resize(dpr = Math.min(window.devicePixelRatio, 2)): void {
    this.dpr = dpr;
    const view = window.innerWidth / window.innerHeight;
    this.camera.left = -view;
    this.camera.right = view;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();

    // Reveal radius scales with the viewport so the composition holds on a
    // phone as well as a 4K monitor.
    this.revealSize = Math.max(140, Math.min(window.innerWidth, window.innerHeight) * 0.26);

    this.layout();
    this.fitHelmet();
  }

  update(): void {
    const t = this.clock.getElapsedTime();
    this.field.uniforms.uTime!.value = t;
    this.head.uniforms.uTime!.value = t;

    if (this.intro < 1) {
      this.intro = Math.min(this.intro + 0.012, 1);
      this.head.uniforms.uIntro!.value = this.intro;
    }

    // Exponential smoothing. Frame-rate dependent, fine at 60fps and the first
    // thing to replace with a delta-time lerp if it ever isn't.
    this.pointer.lerp(this.pointerTarget, this.ease);
    this.pointerPx.lerp(this.pointerPxTarget, this.ease);

    // The helmet tilts with the pointer, giving the flat portrait a sense of
    // a third axis without moving the face itself.
    if (this.helmet) {
      this.helmet.rotation.y = this.pointer.x * 0.22;
      this.helmet.rotation.x = -this.pointer.y * 0.14;
    }
  }

  dispose(): void {
    this.fieldMesh.geometry.dispose();
    for (const key of ['uDiffuse', 'uDepth', 'uAlpha', 'uShadow'] as const) {
      (this.head.uniforms[key]!.value as THREE.Texture | null)?.dispose();
    }
    this.helmetMat?.dispose();
    this.field.dispose();
    this.head.dispose();
  }
}
