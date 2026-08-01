import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FluidCursor } from './FluidCursor';

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
/**
 * The supplied helmet: 470 meshes, 27 materials, ~11 MB.
 *
 * That mesh count is the reason this needs depth writing turned on. Transparent
 * materials normally skip the depth buffer, so every interior surface of every
 * shell draws and their alphas composite to 1-(1-a)^N — at N=470 even a=0.028
 * saturates to solid white, and no opacity exists that shows edges without the
 * stack filling in. Writing depth culls the hidden lines, which both fixes the
 * accumulation and gives a cleaner hidden-line wireframe. See loadHelmet.
 */
const HELMET_URL = '/assets/helmet/helmet.gltf';
const DRACO_PATH = '/assets/draco/';

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
    float bands = n * 18.0;
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

/**
 * Helmet wireframe, masked per-fragment by the fluid field.
 *
 * Per-fragment is the point. A single opacity fades the whole shell together;
 * sampling the fluid at each fragment's own screen position lets a swirl erase
 * only the part of the helmet it passes over. That is what the reference means
 * by masking it on and off with blobs, and why its head material takes a
 * tCursorEffect sampler rather than a hover scalar.
 */
const helmetFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tCursorEffect;
  uniform vec2  uResolution;
  uniform float uOpacity;
  uniform float uRevealOpacity;
  uniform vec3  uColor;

  void main() {
    // The fluid target is square and stretched to the viewport, and its splat is
    // pre-corrected for aspect, so a straight screen-space lookup matches.
    vec2 uv = gl_FragCoord.xy / uResolution;
    float dye = clamp(texture2D(tCursorEffect, uv).r, 0.0, 1.0);

    // The cursor REVEALS the shell — it does not wipe it away. The reference
    // names this uHoverReveal / REVEAL_SIZE, and describes rendering the helmet
    // and then deciding what to show. Having it the other way round meant
    // sweeping the pointer erased something already near-invisible, so no blob
    // ever registered. Idle opacity is a ghost; the fluid brings it forward.
    float reveal = smoothstep(0.03, 0.4, dye);
    float alpha = mix(uOpacity, uRevealOpacity, reveal);

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

const helmetVertex = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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

/**
 * Colours are used as authored, NOT converted to linear.
 *
 * These shaders write gl_FragColor directly, and a raw ShaderMaterial gets no
 * linear -> sRGB conversion applied on output. Converting the input to linear
 * therefore double-darkens everything: it put a warm cast over the portrait and
 * rendered the contour lines almost black, so the field only appeared where the
 * cursor brightened it. Straight sRGB in, straight sRGB out, no cast.
 */
const tokenColor = (css: string) => new THREE.Color(css);

export class HeadScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;

  private readonly field: THREE.ShaderMaterial;
  private readonly head: THREE.ShaderMaterial;
  private readonly fieldMesh: THREE.Mesh;
  private readonly headMesh: THREE.Mesh;

  /** Wireframe helmet, parented so it scales with the portrait. */
  private helmet: THREE.Group | null = null;
  private helmetMat: THREE.ShaderMaterial | null = null;
  /** Opacity the helmet returns to when the cursor is clear of it. */
  /**
   * Three clean shells, so alpha barely accumulates and the wireframe can carry
   * real weight. The old 470-mesh model needed 0.028 to avoid reading as solid
   * white, which left individual edges invisible.
   */
  /**
   * Very low on purpose. On the reference the shell reads as a faint glass dome
   * you notice at the silhouette, not as a visible triangulated mesh sitting on
   * the face — the wireframe density is only legible once the cursor is near.
   */
  private baseHelmetOpacity = 0.07;
  /** Where layout() put the portrait, before any pointer drift is added. */
  private readonly headBase = new THREE.Vector2();
  /** How far the whole plane travels with the pointer, in world units. */
  imageShift = 0.02;

  private readonly pointerTarget = new THREE.Vector2();
  private readonly pointer = new THREE.Vector2();
  private readonly pointerPx = new THREE.Vector2();
  private readonly pointerPxTarget = new THREE.Vector2();

  /** Pointer-driven fluid field. The helmet is masked by it, per fragment. */
  readonly fluid: FluidCursor;

  private readonly ease: number;
  private readonly subjectScale: number;
  private aspect = 1;
  private readonly clock = new THREE.Clock();
  private intro = 0;
  private dpr = 1;

  constructor(renderer: THREE.WebGLRenderer, opts: HeadSceneOptions = {}) {
    this.fluid = new FluidCursor(renderer);
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
        // Subtle. The depth map is strong enough that anything higher reads as
        // the photo sliding rather than the head having volume.
        uParallax: { value: opts.parallax ?? 0.011 },
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
    // NoColorSpace on every map, diffuse included. Tagging the diffuse sRGB
    // makes the GPU decode it to linear on sample, and nothing converts back on
    // output — see tokenColor. Passthrough shows the photo exactly as authored.
    const get = (name: string) =>
      loader.loadAsync(`${HERO_BASE}/${name}`).then((t) => {
        t.colorSpace = THREE.NoColorSpace;
        // Never wrap: a sampled offset running past the edge must clamp, not
        // reappear on the opposite side of the face.
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
      });

    const [diffuse, depth, alpha] = await Promise.all([
      get('lewis-hero.webp'),
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
    const loader = new GLTFLoader();
    // The model is Draco-compressed, so the decoder has to be wired up before
    // the parse or GLTFLoader rejects on the unhandled extension.
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    loader.setDRACOLoader(draco);

    const gltf = await loader.loadAsync(HELMET_URL);
    // The decoder holds a worker pool; nothing else loads Draco, so release it.
    draco.dispose();

    this.helmetMat = new THREE.ShaderMaterial({
      vertexShader: helmetVertex,
      fragmentShader: helmetFragment,
      wireframe: true,
      transparent: true,
      // Depth writing ON, which is unusual for a transparent material and is
      // the point. Without it all 470 nested shells draw their interiors and
      // the alphas stack to opaque white. Writing depth removes the hidden
      // lines, so only the shell facing the viewer contributes.
      depthWrite: true,
      depthTest: true,
      uniforms: {
        tCursorEffect: { value: this.fluid.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uOpacity: { value: this.baseHelmetOpacity },
        // What a blob lifts the shell to. The gap between these two is the
        // whole effect — too close and the fluid has nothing to show.
        uRevealOpacity: { value: 0.5 },
        uColor: { value: new THREE.Color(0xffffff) },
      },
    });

    // Keep the glTF's own node hierarchy and only swap materials. Reparenting
    // the raw geometries into a flat group drops every node's world transform,
    // which collapses a 470-mesh model into a tangle of stray edges.
    const group = gltf.scene;
    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.helmetMat!;
      // renderOrder must be set per mesh — Three reads it off the object being
      // drawn and does not inherit it from a parent Group. Left at the default
      // 0 these draw before the transparent portrait, which then paints over
      // them, and the helmet never appears however opaque it is.
      mesh.renderOrder = 3;
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
    // The model is authored Z-UP with the face on -y. Two separate things were
    // wrong about how it arrives, which is why fixing one at a time never
    // worked:
    //
    //   +z is the NECK OPENING, not the facing. As authored you look straight
    //   into the shell through the neck hole and see the liner from inside, so
    //   the crown has to come up out of -z.
    //
    //   The face is on -y, not +y. The material names settle it: the visor
    //   gasket (NERO GUARNIZ) sits at y -20 and the full-width visor at y -15.9,
    //   while the black rear band (NERO) is at y +24.8.
    //
    // So: -90 about X is the single rotation that satisfies both at once — it
    // swings the crown up out of -z AND brings the -y face round to the camera.
    // Every pose that fixed only one of the two (+90 X, or +90 X with a yaw or
    // roll stacked on it) left the visor on the back of the head. Applied to
    // the normalised group so the idle animation on the wrapper stays a small
    // offset from a correct rest pose rather than oscillating around a wrong one.
    normalised.rotation.set(-Math.PI / 2, 0, 0);

    const wrapper = new THREE.Group();
    wrapper.add(normalised);

    this.helmet = wrapper;
    this.helmet.renderOrder = 2;
    this.headMesh.add(this.helmet); // inherits the portrait's fit
    this.fitHelmet();
  }

  /**
   * Where the helmet sits, in the portrait's local space (the unit plane,
   * -0.5..0.5). Exposed so it can be dialled in from the console against the
   * live render rather than by editing and reloading — see window.hamiltonGL.
   */
  /**
   * Measured, not guessed: the helmet's bounding box is projected to screen
   * pixels and compared against the head in the portrait. At these values it
   * spans x 315-635 / y 363-723 over a head at x 350-590 / y 385-700 — i.e. it
   * encases the head with clearance, rather than sitting on the face as a mask.
   */
  /**
   * width/height are a deliberate departure from the model's own proportions.
   * The scan is a road-helmet shape — rounder and wider than a race lid — so
   * narrowing it and drawing it out lengthens the crown and tucks the sides in
   * off the ears. Small numbers on purpose: past about 0.93/1.09 the chin bar
   * overruns the collar and the silhouette stops reading as a helmet.
   *
   * These multiply size rather than replacing it, so size stays the single
   * knob for "bigger or smaller" and these two only ever shape it.
   */
  helmetFit = { size: 0.95, x: 0, y: 0.137, width: 0.95, height: 1.05 };

  /** Place the helmet over the head, in the portrait's local space. */
  fitHelmet(): void {
    if (!this.helmet) return;
    // The portrait plane is scaled non-uniformly (aspect on x, 1 on y) and a
    // child inherits that, so an unmodified helmet comes out stretched. Divide
    // the x scale back out to keep it round.
    //
    // This scale lands on the wrapper, whose child carries the -90 X rotation,
    // and a parent's scale applies after a child's rotation — so x and y here
    // are screen axes, not model axes. That is what makes width/height mean
    // "narrower on screen" and "longer on screen" rather than something that
    // depends on how the glTF happened to be authored.
    const { size, x, y, width, height } = this.helmetFit;
    this.helmet.scale.set((size * width) / this.aspect, size * height, size);
    this.helmet.position.set(x, y, 0.02);
  }

  setPointer(nx: number, ny: number): void {
    this.pointerTarget.set(nx, ny);
    // Raw, not eased: the fluid takes its force from how fast the pointer is
    // actually moving, so smoothing first would flatten every flick into the
    // same gentle push and lose the character of the effect.
    this.fluid.setPointer((nx + 1) / 2, (ny + 1) / 2);
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
    this.baseHelmetOpacity = v;
    if (this.helmetMat) this.helmetMat.uniforms.uOpacity!.value = v;
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

    // Anchor the portrait's bottom edge to the bottom of the hero rather than
    // centring it. The camera spans -1..1 vertically and the plane's origin is
    // its centre, so pushing it up by half its height sits it on the floor —
    // the subject stands in frame instead of floating in it.
    // Nudged right of centre. The camera spans -view..view horizontally and one
    // world unit is half the viewport height, so this is roughly 37px at
    // 1908x926 — enough to break dead-centre symmetry, not enough to read as
    // off-centre.
    this.headBase.set(0.08, -1 + scale / 2);
    this.headMesh.position.set(this.headBase.x, this.headBase.y, 0);

    this.fieldMesh.scale.set(view * 2, 2, 1);
    this.field.uniforms.uAspect!.value.set(view, 1);
  }

  resize(dpr = Math.min(window.devicePixelRatio, 2)): void {
    this.dpr = dpr;
    const view = window.innerWidth / window.innerHeight;
    this.fluid.setAspect(view);
    // The helmet mask samples by gl_FragCoord, which is in device pixels, so
    // the divisor must carry the DPR or the mask lands offset on HiDPI.
    this.helmetMat?.uniforms.uResolution!.value.set(
      window.innerWidth * dpr,
      window.innerHeight * dpr,
    );
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
    const dt = this.clock.getDelta();
    const t = this.clock.getElapsedTime();

    // Step the fluid before the scene draws. It binds and restores its own
    // render targets, so it must not run mid-draw.
    this.fluid.update(dt);
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

    if (this.helmet && this.helmetMat) {
      // The helmet does NOT track the pointer. It sits on the head and is only
      // ever masked — the cursor drives the fluid field, and the field decides
      // per fragment where the shell survives. Rotating it to follow the pointer
      // was my own addition and is not what the reference does.
      //
      // It is not static either: the reference runs its wireframe with
      // IS_WIREFRAME_ANIMATING true. This is that — a slow idle drift, on its
      // own clock, independent of input.
      this.helmet.rotation.y = Math.sin(t * 0.28) * 0.045;
      this.helmet.rotation.x = Math.sin(t * 0.21 + 1.3) * 0.028;

      this.helmetMat.uniforms.tCursorEffect!.value = this.fluid.texture;
    }

    // The whole portrait drifts with the pointer, on top of the per-pixel depth
    // parallax. Two scales of the same idea: the plane shifts as one object
    // while the depth map moves features against each other within it. Eased
    // pointer, so it settles rather than snapping.
    this.headMesh.position.x = this.headBase.x + this.pointer.x * this.imageShift;
    this.headMesh.position.y = this.headBase.y + this.pointer.y * this.imageShift * 0.6;
  }

  dispose(): void {
    this.fieldMesh.geometry.dispose();
    for (const key of ['uDiffuse', 'uDepth', 'uAlpha', 'uShadow'] as const) {
      (this.head.uniforms[key]!.value as THREE.Texture | null)?.dispose();
    }
    this.helmetMat?.dispose();
    this.fluid.dispose();
    this.field.dispose();
    this.head.dispose();
  }
}
