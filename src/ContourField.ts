import * as THREE from 'three';

/**
 * Pass one of the two-pass background: a simplex field reduced to a BINARY
 * map, written to a render target for the composite pass to trace.
 *
 * The reference builds its background the same way, in two passes, and this
 * one is tuned to it: the defaults below are its live values, read off
 * `window.landoGL.params.headScene`. The shader is ours, written from what the
 * field does on screen.
 *
 * Why two passes:
 *
 *   The output here is the parity of a band count, i.e. every texel is exactly
 *   0.0 or 1.0. There are no contour LINES in this target at
 *   all — only flat regions. The lines appear in pass two, which asks whether
 *   the map is level where it stands. Under bilinear filtering it is level
 *   everywhere inside a region and a ramp only within one texel of a
 *   boundary, so the line comes out exactly one texel wide, everywhere, for free
 *   — no smoothstep, no thickness tuning.
 *
 *   That is why pass two's PROBE is a thirty-second of a screen pixel. It is a
 *   reach, not a width: it only has to be long enough for the sampler to tell
 *   the two ends apart and far shorter than a texel. Line weight is set by
 *   this target's RESOLUTION. Reading the probe as a width and lengthening it
 *   to a texel or so steps clean over the ramp into the next region and turns
 *   the contours into blobs.
 *
 * `bandPairs` is the band count. At 3 the noise's range is cut into six
 * slices, three bands and the three gaps between them, giving six boundaries —
 * so the field reads as a few broad, sweeping contours rather than fine banding.
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

  /* What changes from frame to frame. */
  uniform float uFrameRatio;   // width over height
  uniform float uSeconds;
  uniform float uPointerPace;  // 0 while the pointer rests, up to 1 as it moves
  uniform float uIntro;        // 0 away, 1 in place
  uniform vec2  uPointerAt;    // -1..1, y up

  /* The tunables, keyed exactly as ContourParams is. */
  uniform float zoom;
  uniform float drift;
  uniform float warpZoom;
  uniform float warpReach;
  uniform float bandPairs;
  uniform float pointerReach;
  uniform float pointerFalloff;
  uniform float pointerFloor;
  uniform float introTravel;

  /* The warp's clock against the field's. A tenth, so the warp drifts far more
     slowly than the field it is warping, and the two never fall into step. */
  const float WARP_PACE = 0.1;

  /* Simplex on a plane at a depth, moved from -1..1 onto 0..1.

     Time is the depth, here and for the warp, so the surface DEFORMS in place
     rather than travelling: contours grow, split, merge and close where they
     are, the level sets of a solid that is slowly changing shape. */
  float unitNoise(vec2 plane, float depth) {
    return snoise(vec3(plane, depth)) * 0.5 + 0.5;
  }

  /* A place on the frame, in field units: one unit is the frame's height, so
     the shapes stay round at any aspect. The intro lifts the window a long way
     above the frame and squeezes it; at uIntro 1 it is the frame itself. */
  vec2 fieldPoint(vec2 frame) {
    float away = (1.0 - uIntro) * introTravel;
    return vec2(frame.x * uFrameRatio, (frame.y + away * 4.0 / 3.0) / (1.0 + away));
  }

  /* How far the pointer shoves a point of the field: a cone standing on the
     pointer, as tall as the pointer is fast.

     The floor is doing real work and is not a guard. Away from the pointer the
     cone runs negative, so the far field is shoved one way while the pointer's
     own neighbourhood goes the other, and that difference is what drags the
     contours as the pointer passes. The pace falls to zero when it stops, so
     the shove relaxes out again: the field springs back rather than staying
     dented. */
  float pointerShove(vec2 point) {
    vec2 pointer = (uPointerAt + 1.0) * 0.5;
    pointer.x *= uFrameRatio;
    float cone = 1.0 - pointerFalloff * length(point - pointer);
    return pointerReach * max(cone * uPointerPace, pointerFloor);
  }

  void main() {
    vec2 point = fieldPoint(vUv);
    float clock = uSeconds * drift;

    /* One read of the noise decides where the next one is taken: every point
       slides along the diagonal by the warp and by the pointer's shove. */
    float warp = unitNoise(point * warpZoom, clock * WARP_PACE);
    float slide = pointerShove(point) + warpReach * warp;
    float level = unitNoise((point + slide) * zoom, clock);

    /* The level cut into equal slices, counted from zero. The odd slices are
       the bands; the even ones are the gaps between them. */
    float slice = floor(level * bandPairs * 2.0);

    gl_FragColor = vec4(vec3(mod(slice, 2.0)), 1.0);
  }
`;

/**
 * The field's tunables. The reference keeps the same nine dials on
 * `landoGL.params.headScene`, under the names given against each, so the two
 * can still be set to the same thing from the console.
 */
export interface ContourParams {
  /** Noise units to a frame height. Its SCALE. */
  zoom: number;
  /** Noise units the field moves through per second. Its SPEED. */
  drift: number;
  /** The same, for the slower read that warps the field. Its DISTORT_SCALE. */
  warpZoom: number;
  /** How far the warp slides a point, in frame heights. Its DISTORT_INTENSITY. */
  warpReach: number;
  /** Bands across the noise's range, each with its gap. Its NOISE_DETAIL. */
  bandPairs: number;
  /** How far a moving pointer shoves the field, in frame heights. Its CURSOR_INTENSITY. */
  pointerReach: number;
  /** How quickly that shove falls away from the pointer. Its CURSOR_SCALE. */
  pointerFalloff: number;
  /** The least the shove can be, far from the pointer. Its CURSOR_BOUNCE. */
  pointerFloor: number;
  /** How far above the frame the intro starts, in frame heights. Its REVEAL_SIZE. */
  introTravel: number;
}

/**
 * The reference's live values, read off `landoGL.params.headScene` on the
 * running site, which is the authority, and not copied from the docs.
 */
export const REFERENCE_PARAMS: ContourParams = {
  zoom: 1,
  drift: 0.1,
  warpZoom: 1,
  warpReach: 0.5,
  bandPairs: 3,
  pointerReach: 0.15,
  pointerFalloff: 3,
  pointerFloor: -0.75,
  introTravel: 25,
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
  uFrameRatio: THREE.IUniform<number>;
  uSeconds: THREE.IUniform<number>;
  uPointerPace: THREE.IUniform<number>;
  uIntro: THREE.IUniform<number>;
  uPointerAt: THREE.IUniform<THREE.Vector2>;
};

export class ContourField {
  /** The binary band map: 1 inside a band, 0 in the gap, on every channel. */
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
      // texel is identical, the map reads as level everywhere, and the pass
      // returns a blank frame.
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
      uFrameRatio: { value: 1 },
      uSeconds: { value: 0 },
      uPointerPace: { value: 0 },
      uIntro: { value: 0 },
      uPointerAt: { value: this.pointer },
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
    this.u.uFrameRatio.value = cssWidth / cssHeight;
  }

  /** Pointer in -1..1, y up — the same convention `HeadScene.setPointer` takes. */
  setPointer(nx: number, ny: number): void {
    this.pointer.set(nx, ny);
  }

  /** Intro, 0..1: brings the sampled window down onto the frame. See `introTravel`. */
  set reveal(v: number) {
    this.u.uIntro.value = v;
  }

  /** Push a parameter change through to the GPU. For live tuning from console. */
  syncParams(): void {
    for (const key of Object.keys(this.params) as (keyof ContourParams)[]) {
      this.u[key].value = this.params[key];
    }
  }

  /**
   * Compile the noise pass without blocking, against its own target for the
   * reason FluidCursor.compile gives. Resolves once the program is linked.
   */
  compile(): Promise<unknown> {
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    const linked = this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    return linked;
  }

  update(time: number): void {
    /* Mouse pace: distance moved this frame, normalised and smoothed.
     *
     * PACE_CEILING is the important number here and it is deliberately small.
     *
     * The shader's cone, (1 - distance * pointerFalloff), goes negative past
     * about a third of the frame, so at a high pace `pointerFloor` is what
     * almost every pixel gets. The far field is then displaced by
     * pointerFloor * pointerReach — a near-constant offset applied
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
    this.u.uPointerPace.value = this.pace;

    this.u.uSeconds.value = time;

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
