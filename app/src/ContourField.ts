import * as THREE from 'three';

/**
 * Pass one of the reference's two-pass background: a simplex field reduced to a
 * BINARY map, written to a render target for the composite pass to trace.
 *
 * Ported from the reference's own `136-fragment.frag`, parameter names intact,
 * because those names are the specification. Its live values, read off
 * `window.landoGL.params.headScene`, are the defaults below.
 *
 * Why two passes:
 *
 *   The output here is `step(0.5, fract(noise * NOISE_DETAIL))`, i.e. every
 *   texel is exactly 0.0 or 1.0. There are no contour LINES in this target at
 *   all — only flat regions. The lines appear in pass two, which asks whether a
 *   neighbouring sample differs. Under bilinear filtering that comparison is
 *   false everywhere inside a region and true only within one texel of a
 *   boundary, so the line comes out exactly one texel wide, everywhere, for free
 *   — no derivative, no smoothstep, no thickness tuning.
 *
 *   That is why THICKNESS is 0.000005. It is an EPSILON, not a width: it only
 *   has to be small enough to stay on the interpolation ramp and larger than
 *   zero. Line weight is set by this target's RESOLUTION. Reading it as a width
 *   and substituting something "reasonable" like 1/1024 steps clean over the
 *   ramp into the next region and turns the contours into blobs.
 *
 * NOISE_DETAIL is the band count. `fract(n * 3)` wraps three times across the
 * noise range and `step(0.5, ...)` splits each wrap, giving six boundaries — so
 * the field reads as a few broad, sweeping contours rather than fine banding.
 */

/** Simplex 3D, Ashima Arts / Stefan Gustavson (MIT). The reference's `<simplex>`.
 *
 * Not interchangeable with the gradient noise this file used to reach for.
 * Gradient noise is built on a cubic lattice and keeps a faint axis-aligned
 * grain, which survives thresholding and shows up as contours that prefer the
 * diagonals. Simplex is built on a tetrahedral one and has no preferred
 * direction, so its level sets curve freely — which is the whole look here. */
const simplexChunk = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const noiseVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Clip space directly. This quad only ever covers its own render target, so
    // it needs no camera and must never be culled against one.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const noiseFragment = /* glsl */ `
  precision highp float;

  ${simplexChunk}

  varying vec2 vUv;

  uniform float uAspect;
  uniform float uTime;
  uniform float uMousePace;
  uniform float uReveal;
  uniform vec2  uMouseCoords;

  uniform float SCALE;
  uniform float SPEED;
  uniform float DISTORT_SCALE;
  uniform float DISTORT_INTENSITY;
  uniform float NOISE_DETAIL;
  uniform float CURSOR_INTENSITY;
  uniform float CURSOR_SCALE;
  uniform float CURSOR_BOUNCE;
  uniform float REVEAL_SIZE;

  void main() {
    /* UVs. Aspect-corrected so the field stays round, then pushed down and
       compressed by the intro reveal — at uReveal 0 the sampled window sits far
       above the frame and slides into place as it drives to 1. */
    vec2 uv = vUv;
    uv.x *= uAspect;
    uv.y += (REVEAL_SIZE + REVEAL_SIZE / 3.0) * (1.0 - uReveal);
    uv.y /= 1.0 + (REVEAL_SIZE) * (1.0 - uReveal);

    /* Cursor. A cone falling away from the pointer, scaled by how fast the
       pointer is actually moving and floored at CURSOR_BOUNCE.

       The floor is doing real work and is not a guard: at -0.75 the whole field
       away from the pointer is displaced by -0.75 * CURSOR_INTENSITY while the
       pointer's own neighbourhood goes to +CURSOR_INTENSITY. That difference is
       what drags the contours around as the cursor passes. Because uMousePace
       falls to zero when the pointer stops, the displacement relaxes out again
       — the field springs back rather than staying dented. Hence "bounce". */
    vec2 mouse = uMouseCoords * 0.5 + 0.5;
    mouse.x *= uAspect;

    float cursor = 1.0 - distance(mouse, uv) * CURSOR_SCALE;
    cursor *= uMousePace;
    cursor = clamp(cursor, CURSOR_BOUNCE, 1.0);

    /* Noise. The first sample warps the domain of the second — and note the
       time axes differ by a factor of ten, so the warp drifts far more slowly
       than the field it is warping. Two clocks that do not divide into each
       other give a combined period long enough that the loop never shows. */
    float noiseDistort = 0.5 + snoise(vec3(
      uv.x * DISTORT_SCALE,
      uv.y * DISTORT_SCALE,
      uTime * SPEED * 0.1
    )) * 0.5;

    float noiseFinal = 0.5 + snoise(vec3(
      (uv.x + (cursor * CURSOR_INTENSITY) + (noiseDistort * DISTORT_INTENSITY)) * SCALE,
      (uv.y + (cursor * CURSOR_INTENSITY) + (noiseDistort * DISTORT_INTENSITY)) * SCALE,
      uTime * SPEED
    )) * 0.5;

    /* Time rides the third noise axis, so the surface DEFORMS in place rather
       than travelling. Contours grow, split, merge and close where they are —
       the level sets of a solid that is itself slowly changing shape. No
       amount of retuning a translation reaches this. */
    noiseFinal *= NOISE_DETAIL;
    noiseFinal = fract(noiseFinal);

    float noiseBase = step(0.5, noiseFinal);

    // R: the binary map the outline pass traces. G: the raw value, kept because
    // the reference's hover effect thresholds against it.
    gl_FragColor = vec4(noiseBase, noiseFinal, 0.0, 1.0);
  }
`;

export interface ContourParams {
  SCALE: number;
  SPEED: number;
  DISTORT_SCALE: number;
  DISTORT_INTENSITY: number;
  NOISE_DETAIL: number;
  CURSOR_INTENSITY: number;
  CURSOR_SCALE: number;
  CURSOR_BOUNCE: number;
  REVEAL_SIZE: number;
}

/**
 * The reference's live values, verbatim from `landoGL.params.headScene`.
 * Not copied from the docs — read off the running site, which is the authority.
 */
export const REFERENCE_PARAMS: ContourParams = {
  SCALE: 1,
  SPEED: 0.1,
  DISTORT_SCALE: 1,
  DISTORT_INTENSITY: 0.5,
  NOISE_DETAIL: 3,
  CURSOR_INTENSITY: 0.15,
  CURSOR_SCALE: 3,
  CURSOR_BOUNCE: -0.75,
  REVEAL_SIZE: 25,
};

/** The params, one uniform each, keyed the same so `syncParams` can pair them. */
type ParamUniforms = { [K in keyof ContourParams]: THREE.IUniform<number> };

/**
 * Every uniform in the noise pass, by name and type.
 *
 * The class keeps these objects rather than reading them back off
 * `material.uniforms`, where each one is `IUniform | undefined` and so needs a
 * `!` at every write. That assertion is what makes a misspelt uniform name
 * type-check: it writes to nothing, the shader quietly keeps its constructor
 * value, and there is no error anywhere to follow. Here it does not compile.
 */
type NoiseUniforms = ParamUniforms & {
  uAspect: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uMousePace: THREE.IUniform<number>;
  uReveal: THREE.IUniform<number>;
  uMouseCoords: THREE.IUniform<THREE.Vector2>;
};

export class ContourField {
  /** The binary noise map. Sample `.r` for regions, `.g` for the raw value. */
  get texture(): THREE.Texture {
    return this.target.texture;
  }

  readonly params: ContourParams = { ...REFERENCE_PARAMS };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly u: NoiseUniforms;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;

  /** Pointer in -1..1, and a 0..1 measure of how fast it is moving. */
  private readonly pointer = new THREE.Vector2();
  private readonly lastPointer = new THREE.Vector2();
  private pace = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    this.target = new THREE.WebGLRenderTarget(2, 2, {
      // LINEAR is load-bearing, not a default worth leaving alone. The whole
      // outline trick is that sampling a hair to the side of a boundary returns
      // a slightly different value; under NearestFilter every sample inside a
      // texel is identical, the equality test never fails, and the pass returns
      // a blank frame.
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      // Clamp, so the four neighbour taps at the frame edge do not wrap around
      // and draw a false contour down the opposite side.
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    });

    // Built from the params object rather than listed again, so the two cannot
    // drift apart. The cast is the one place the key-by-key correspondence is
    // asserted instead of checked; every use of it after this is typed.
    const params = Object.fromEntries(
      Object.entries(this.params).map(([key, value]) => [key, { value }]),
    ) as ParamUniforms;

    this.u = {
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uMousePace: { value: 0 },
      uReveal: { value: 0 },
      uMouseCoords: { value: this.pointer },
      ...params,
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: noiseVertex,
      fragmentShader: noiseFragment,
      uniforms: this.u,
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /**
   * Size the target.
   *
   * Deliberately CSS pixels rather than device pixels. Line weight IS this
   * target's texel size, so rendering at DPR 2 would halve the contours to a
   * single device pixel — which on our dark, high-contrast palette crawls and
   * shimmers as the field moves, where the reference gets away with it only
   * because its lines sit ~13/255 off their background. It also doubles the
   * cost of a fullscreen simplex evaluation for a line nobody asked to be finer.
   */
  setSize(cssWidth: number, cssHeight: number): void {
    this.target.setSize(Math.max(1, Math.round(cssWidth)), Math.max(1, Math.round(cssHeight)));
    this.u.uAspect.value = cssWidth / cssHeight;
  }

  /** Pointer in -1..1, y up — the same convention `HeadScene.setPointer` takes. */
  setPointer(nx: number, ny: number): void {
    this.pointer.set(nx, ny);
  }

  /** Intro wipe, 0..1. Drives the UV window down over REVEAL_DURATION. */
  set reveal(v: number) {
    this.u.uReveal.value = v;
  }

  /** Push a parameter change through to the GPU. For live tuning from console. */
  syncParams(): void {
    for (const key of Object.keys(this.params) as (keyof ContourParams)[]) {
      this.u[key].value = this.params[key];
    }
  }

  update(time: number): void {
    /* Mouse pace: distance moved this frame, normalised and smoothed.
     *
     * PACE_CEILING is the important number here and it is deliberately small.
     *
     * CURSOR_BOUNCE is the LOWER clamp on `cursor`, and since (1 - dist * 3)
     * goes negative past about a third of the frame, that floor is what almost
     * every pixel gets. So the far field is displaced by
     * CURSOR_BOUNCE * pace * CURSOR_INTENSITY — a near-constant offset applied
     * to the ENTIRE noise domain. At pace 1 that is 0.11 UV, and the whole
     * background visibly slides sideways the moment the pointer moves, which
     * reads as the field getting out of the cursor's way. It is not what the
     * reference does: there the same term exists but stays imperceptible, and
     * the contours run straight through a passing blob undisturbed.
     *
     * Capping pace holds the global shift near 0.02 UV — enough that the field
     * breathes around the pointer, not enough to look like it is dodging. The
     * cursor's visible contribution is meant to be the fluid COLOURING the
     * background, not deforming it.
     */
    const PACE_CEILING = 0.18;
    const moved = this.pointer.distanceTo(this.lastPointer);
    this.lastPointer.copy(this.pointer);
    const impulse = Math.min(moved * 6, 1) * PACE_CEILING;
    // Still asymmetric — it climbs faster than it falls, so a flick registers
    // and then relaxes — but both are gentler now, so nothing snaps.
    this.pace += (impulse - this.pace) * (impulse > this.pace ? 0.12 : 0.03);
    this.u.uMousePace.value = this.pace;

    this.u.uTime.value = time;

    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    // Restore rather than force null: the caller may itself be mid-target, and
    // clearing to null here would send its next draw to the screen.
    this.renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
