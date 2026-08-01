import * as THREE from 'three';

/**
 * The hero scene: a contour-line field, a depth-map portrait sitting on top of
 * it, and a cursor that reveals one through the other.
 *
 * Reconstructed from the reference's behaviour and its named parameters, not
 * from its code — that bundle is minified past recovery. The parameter names
 * are the specification:
 *
 *   REVEAL_SIZE 25        radius of the cursor reveal
 *   CURSOR_INTENSITY .15  how hard the cursor distorts the surface
 *   CURSOR_SCALE 3        scale of that distortion
 *   CURSOR_BOUNCE -.75    negative — the reveal springs INWARD, never overshoots
 *   NOISE_DETAIL 3        three octaves of fbm
 *   SPEED .1              ambient drift
 *
 * The head material is diffuse / depth / alpha / shadow, which only describes
 * one technique: displace the diffuse lookup by the depth value in the
 * direction the pointer moved, so near pixels slide further than far ones and a
 * still photograph reads as a volume.
 */

const TEXTURE_BASE = '/assets/gl/textures/head/webp';

export interface HeadSceneOptions {
  parallax?: number;
  shadow?: number;
  ease?: number;
  revealSize?: number;
}

/* ------------------------------------------------------------------ *
 * Shared GLSL — fbm noise, used by both the field and the reveal edge.
 * ------------------------------------------------------------------ */

const noiseChunk = /* glsl */ `
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  // Gradient noise. Smoother than value noise, which matters here because the
  // contour step is taken on the *derivative* — value noise leaves visible
  // grid creases once you threshold it.
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

/* ------------------------------------------------------------------ *
 * Contour field — the flowing line-art background.
 * ------------------------------------------------------------------ */

const fieldVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fieldFragment = /* glsl */ `
  precision highp float;

  uniform vec3  uBg;
  uniform vec3  uLine;
  uniform vec3  uCursorLine;
  uniform vec2  uPointerPx;    // pointer in pixels, origin bottom-left
  uniform vec2  uResolution;
  uniform vec2  uAspect;
  uniform float uTime;
  uniform float uRevealPx;     // reveal radius in pixels
  uniform float uCursorIntensity;
  uniform int   uOctaves;

  varying vec2 vUv;

  ${noiseChunk}

  void main() {
    vec2 p = (vUv - 0.5) * uAspect;

    // Ambient drift. Two different rates so the field never visibly loops.
    float n = fbm(p * 1.6 + vec2(uTime * 0.06, uTime * -0.035), uOctaves);

    // Distance from the pointer in PIXELS. Both this and the portrait measure
    // the reveal the same way — doing it in each mesh's own plane space made
    // the two discs disagree, because the meshes are scaled differently.
    float dPx = length(gl_FragCoord.xy - uPointerPx);

    // The cursor lifts the field where it sits, so contour rings bulge around
    // it rather than the whole plane sliding.
    float influence = exp(-pow(dPx / max(uRevealPx, 1.0), 2.0));
    n += influence * uCursorIntensity;

    // Contour extraction: take the fractional part of the field and threshold
    // it against its own screen-space derivative. fwidth is what keeps the
    // lines one pixel wide at every zoom and aspect — a fixed epsilon would
    // thicken them on wide viewports and alias them on tall ones.
    float bands = n * 9.0;
    float edge  = abs(fract(bands) - 0.5);
    float line  = 1.0 - smoothstep(0.0, fwidth(bands) * 1.6, edge);

    // Held well below full strength. On the reference this field reads as faint
    // topography you notice second, not as a graphic competing with the
    // portrait — at full opacity it draws the eye straight off his face.
    line *= 0.35;

    // Only inside the cursor radius do the lines take the accent colour, and
    // they come up to full strength there.
    float reveal = 1.0 - smoothstep(uRevealPx * 0.45, uRevealPx, dPx);
    vec3  lineCol = mix(uLine, uCursorLine, reveal);
    line = mix(line, min(line * 2.6, 1.0), reveal);

    gl_FragColor = vec4(mix(uBg, lineCol, line), 1.0);
  }
`;

/* ------------------------------------------------------------------ *
 * Portrait — depth-map parallax with a cursor reveal.
 * ------------------------------------------------------------------ */

const headVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const headFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uDiffuse;
  uniform sampler2D uDepth;
  uniform sampler2D uAlpha;
  uniform sampler2D uShadow;

  uniform vec2  uPointer;
  uniform vec2  uPointerPx;
  uniform float uParallax;
  uniform float uShadowAmount;
  uniform float uRevealPx;
  uniform float uCursorIntensity;
  uniform float uCursorScale;
  uniform float uTime;
  uniform float uIntro;        // 0..1, the load-in wipe
  uniform int   uOctaves;

  varying vec2 vUv;

  ${noiseChunk}

  void main() {
    float d = texture2D(uDepth, vUv).r;

    // Depth parallax. 0.5 is the pivot plane, so the sign of (d - 0.5) decides
    // whether a pixel leads or trails the pointer.
    vec2 offset = uPointer * (d - 0.5) * uParallax;

    // Same pixel-space measure the contour field uses, so the two discs agree.
    float dPx = length(gl_FragCoord.xy - uPointerPx);
    float near = 1.0 - smoothstep(0.0, uRevealPx * 1.6, dPx);

    // Cursor distortion: a local swirl that falls off with distance, so the
    // surface deforms under the pointer rather than the whole plane shearing.
    float swirl = fbm(vUv * uCursorScale + uTime * 0.05, uOctaves);
    offset += vec2(swirl) * near * uCursorIntensity * 0.05;

    vec2 uv = vUv + offset;

    vec3  diffuse = texture2D(uDiffuse, uv).rgb;
    float alpha   = texture2D(uAlpha,  uv).r;
    float shade   = texture2D(uShadow, uv).r;

    vec3 color = diffuse * mix(1.0, shade, uShadowAmount);

    // Intro wipe: the portrait is uncovered from the bottom up on load rather
    // than faded in — same reason the DOM reveals use clip-path.
    // uIntro is driven past 1 so the leading edge clears the top of the plane;
    // comparing against uIntro directly leaves everything above the softening
    // band masked forever.
    float wipe = smoothstep(vUv.y - 0.25, vUv.y, uIntro * 1.3);
    alpha *= wipe;

    // The portrait stays fully opaque. On the reference the cursor reveals the
    // wireframe HELMET over the face — the face itself never fades. Dimming it
    // here was backwards, and it let the background contours read through skin.

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

  private readonly pointerTarget = new THREE.Vector2();
  private readonly pointer = new THREE.Vector2();
  /** Pointer in device pixels, origin bottom-left, matching gl_FragCoord. */
  private readonly pointerPx = new THREE.Vector2();
  private readonly pointerPxTarget = new THREE.Vector2();

  private readonly ease: number;
  private aspect = 1;
  private readonly clock = new THREE.Clock();
  private intro = 0;
  private dpr = 1;

  constructor(opts: HeadSceneOptions = {}) {
    this.ease = opts.ease ?? 0.08;

    // Orthographic: the effect is flat planes facing the viewer. A perspective
    // camera would add its own foreshortening on top of the parallax and make
    // the two impossible to tune independently.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this.camera.position.z = 1;

    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      tokenColor(css.getPropertyValue(name).trim() || fallback);

    this.field = new THREE.ShaderMaterial({
      vertexShader: fieldVertex,
      fragmentShader: fieldFragment,
      uniforms: {
        uBg: { value: token('--gl-bg', '#0a0809') },
        uLine: { value: token('--gl-outline', '#4a3f41') },
        uCursorLine: { value: token('--gl-cursor-fg', '#ff2800') },
        uPointerPx: { value: this.pointerPx },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uAspect: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uRevealPx: { value: 220 },
        uCursorIntensity: { value: 0.12 },
        uOctaves: { value: 3 }, // NOISE_DETAIL
      },
    });

    this.head = new THREE.ShaderMaterial({
      vertexShader: headVertex,
      fragmentShader: headFragment,
      transparent: true,
      uniforms: {
        uDiffuse: { value: null },
        uDepth: { value: null },
        uAlpha: { value: null },
        uShadow: { value: null },
        uPointer: { value: this.pointer },
        uPointerPx: { value: this.pointerPx },
        uParallax: { value: opts.parallax ?? 0.035 },
        uShadowAmount: { value: opts.shadow ?? 0.65 },
        uRevealPx: { value: opts.revealSize ?? 220 },
        uCursorIntensity: { value: 0.15 },
        uCursorScale: { value: 3 },
        uTime: { value: 0 },
        uIntro: { value: 0 },
        uOctaves: { value: 3 },
      },
    });

    const quad = new THREE.PlaneGeometry(1, 1);

    this.fieldMesh = new THREE.Mesh(quad, this.field);
    this.fieldMesh.position.z = -0.1;
    this.fieldMesh.renderOrder = 0;

    this.headMesh = new THREE.Mesh(quad, this.head);
    this.headMesh.renderOrder = 1;

    this.scene.add(this.fieldMesh, this.headMesh);
  }

  async load(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const get = (name: string) =>
      loader.loadAsync(`${TEXTURE_BASE}/${name}.webp`).then((t) => {
        t.colorSpace = name === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        // Never wrap: a sampled offset running past the edge must clamp, not
        // reappear on the opposite side of the face.
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
      });

    const [diffuse, depth, alpha, shadow] = await Promise.all([
      get('diffuse'),
      get('depth'),
      get('alpha'),
      get('shadow'),
    ]);

    this.head.uniforms.uDiffuse!.value = diffuse;
    this.head.uniforms.uDepth!.value = depth;
    this.head.uniforms.uAlpha!.value = alpha;
    this.head.uniforms.uShadow!.value = shadow;

    const img = diffuse.image as { width: number; height: number };
    this.aspect = img.width / img.height;
    this.layout();
  }

  /** @param nx @param ny normalised device coords, -1..1, y up. */
  setPointer(nx: number, ny: number): void {
    this.pointerTarget.set(nx, ny);
    // gl_FragCoord is in device pixels with the origin bottom-left, so the
    // conversion has to carry the device pixel ratio or the disc drifts on
    // HiDPI displays — where it would be exactly half a screen out.
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
  set cursorIntensity(v: number) {
    this.head.uniforms.uCursorIntensity!.value = v;
    this.field.uniforms.uCursorIntensity!.value = v * 0.8;
  }

  /** Fit the portrait inside the viewport without distorting it. */
  private layout(): void {
    const view = window.innerWidth / window.innerHeight;
    const scale = view > this.aspect ? 2 : (2 * view) / this.aspect;
    this.headMesh.scale.set(scale * this.aspect, scale, 1);

    // The field always covers the full frame.
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

    this.field.uniforms.uResolution!.value.set(
      window.innerWidth * dpr,
      window.innerHeight * dpr,
    );
    // Reveal radius scales with the viewport so the composition holds on a
    // phone as well as a 4K monitor.
    this.revealSize = Math.max(140, Math.min(window.innerWidth, window.innerHeight) * 0.26);

    this.layout();
  }

  update(): void {
    const t = this.clock.getElapsedTime();
    this.field.uniforms.uTime!.value = t;
    this.head.uniforms.uTime!.value = t;

    // Intro wipe runs once, then stays open.
    if (this.intro < 1) {
      this.intro = Math.min(this.intro + 0.012, 1);
      this.head.uniforms.uIntro!.value = this.intro;
    }

    // Exponential smoothing. Frame-rate dependent, which is fine at 60fps and
    // the first thing to replace with a delta-time lerp if it ever isn't.
    this.pointer.lerp(this.pointerTarget, this.ease);
    this.pointerPx.lerp(this.pointerPxTarget, this.ease);
  }

  dispose(): void {
    this.fieldMesh.geometry.dispose();
    for (const key of ['uDiffuse', 'uDepth', 'uAlpha', 'uShadow'] as const) {
      (this.head.uniforms[key]!.value as THREE.Texture | null)?.dispose();
    }
    this.field.dispose();
    this.head.dispose();
  }
}
