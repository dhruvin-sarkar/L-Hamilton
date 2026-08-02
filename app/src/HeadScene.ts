import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FluidCursor } from './FluidCursor';
import { ContourField } from './ContourField';

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
/**
 * GLB, not glTF + external .bin, and this is functional rather than cosmetic.
 *
 * The .gltf form references a separate `buffer.bin`, which gets served as
 * `application/octet-stream` — exactly the extension and content type download
 * managers (IDM and friends) are configured to intercept. When one does, it
 * takes the request over, the page receives an empty 204, and GLTFLoader fails
 * with "Failed to load buffer". Nothing on our side is wrong and no retry gets
 * past it; it presents as a broken asset and cost a long time to diagnose,
 * because curl and a cache-busted URL both succeed.
 *
 * A .glb is one request carrying JSON and binary in a single container, served
 * as model/gltf-binary, which those tools leave alone. Also one fewer round
 * trip and slightly smaller, since the JSON is minified on the way in.
 */
const HELMET_URL = '/assets/helmet/helmet.glb';
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
// The 3D gradient-noise path that used to live here is gone with the field it
// served. Pass one now uses real simplex (see ContourField) rather than a
// gradient-noise stand-in, and the portrait below only ever wanted the 2D fbm.

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

/**
 * Pass two: trace the outlines of the binary map ContourField wrote, and tint
 * the result. Ported from the reference's `118-offsets-for-neighboring-pixels`.
 *
 * The equality test is the whole mechanism and it is intentionally exact, not
 * a tolerance. Pass one emits only 0.0 and 1.0, so inside a region all five
 * taps return the identical interpolated constant and `!=` is false; within one
 * texel of a boundary bilinear filtering puts them on a ramp and `!=` is true.
 * A tolerance would only widen the line — badly, and non-uniformly.
 */
const fieldFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D tBackgroundNoise;
  uniform sampler2D tCursorEffect;

  uniform bool  OUTLINE;
  uniform float THICKNESS;
  uniform vec3  COLOR_BACKGROUND;
  uniform vec3  COLOR_FOREGROUND;
  uniform vec3  COLOR_OUTLINE;
  uniform vec3  COLOR_CURSOR_BACKGROUND;
  uniform vec3  COLOR_CURSOR_FOREGROUND;
  uniform vec3  COLOR_CURSOR_OUTLINE;

  uniform float uReveal;
  uniform float uCursorIntensity;

  varying vec2 vUv;

  void main() {
    vec4 textureBackgroundNoise = texture2D(tBackgroundNoise, vUv);
    float noiseBase = textureBackgroundNoise.r;

    // uReveal fades the field in from flat background during the intro, so the
    // topography draws itself on rather than being there from frame one.
    vec3 background = mix(
      COLOR_BACKGROUND,
      mix(COLOR_BACKGROUND, COLOR_FOREGROUND, uReveal),
      noiseBase
    );

    // The alternate palette shown inside a cursor blob. Built even when the
    // blob is elsewhere — a branch around it would cost more than the two mixes.
    vec3 cursorBackground = mix(COLOR_CURSOR_BACKGROUND, COLOR_CURSOR_FOREGROUND, noiseBase);

    if (OUTLINE) {
      float edge = 0.0;

      vec4 sampledRight = texture2D(tBackgroundNoise, vUv + vec2(THICKNESS, 0.0));
      vec4 sampledLeft  = texture2D(tBackgroundNoise, vUv + vec2(-THICKNESS, 0.0));
      vec4 sampledUp    = texture2D(tBackgroundNoise, vUv + vec2(0.0, THICKNESS));
      vec4 sampledDown  = texture2D(tBackgroundNoise, vUv + vec2(0.0, -THICKNESS));

      if (sampledRight.r != textureBackgroundNoise.r ||
          sampledLeft.r  != textureBackgroundNoise.r ||
          sampledUp.r    != textureBackgroundNoise.r ||
          sampledDown.r  != textureBackgroundNoise.r) {
        edge = 1.0;
      }

      // Note this REPLACES the filled-region colouring above rather than adding
      // to it: with OUTLINE on, the regions go flat and only their borders draw.
      background = mix(
        COLOR_BACKGROUND,
        mix(COLOR_BACKGROUND, COLOR_OUTLINE, uReveal),
        edge
      );

      cursorBackground = mix(cursorBackground, COLOR_CURSOR_OUTLINE, edge);
    }

    /* Cursor blob.
     *
     * The inset is the reference's own "gap fix on bottom and top": the fluid
     * solve has no boundary conditions, so its outermost texels carry garbage
     * that would otherwise paint a frame around the viewport. Sampling the
     * inner 95% steps past it.
     *
     * The inversion is required. tCursorEffect is the fluid's velocity field
     * rendered to colour, which rests at WHITE and darkens where the fluid
     * moves — so "how white" means "how still". Sampling it the same way round
     * as a dye buffer lights up the entire frame.
     *
     * step, not smoothstep. A hard threshold is what gives the blob a crisp,
     * liquid edge — feathering it is exactly what made the effect read as
     * "nothing is happening" before, because a soft ramp over a small opacity
     * range is indistinguishable from a uniform haze.
     */
    vec2 cursorUv = vec2(0.025) + vUv * 0.95;
    float cursorEffect = step(0.1, 1.0 - texture2D(tCursorEffect, cursorUv).r);

    background = mix(background, cursorBackground, cursorEffect * uCursorIntensity);

    gl_FragColor = vec4(background, 1.0);
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
  uniform float uHelmetHover;
  uniform float uTime;
  uniform vec2  uScanBounds;
  uniform float uScanSpeed;
  uniform bool  uScanAnimating;
  uniform vec3  uColor;
  uniform sampler2D uMap;
  uniform bool  uHasMap;

  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec2 vScreenUv;
  varying vec3 vViewPosition;

  void main() {
    // The fluid target is square and stretched to the viewport, and its splat is
    // pre-corrected for aspect, so a straight screen-space lookup matches. The
    // 0.025/0.95 inset is the reference's "gap fix" — see the field shader.
    vec2 uv = vec2(0.025) + (gl_FragCoord.xy / uResolution) * 0.95;

    /* THE BLOB MASK.
     *
     * step, not smoothstep, and this is the correction that makes the effect
     * exist at all. The reference reduces its fluid to a hard binary with
     * step(0.1, ...) and then composites the helmet with
     *
     *     mix(base, helmet.rgb, cursorEffect * helmet.a)
     *
     * so the shell has a crisp, liquid-edged boundary that swims across it. I
     * had smoothstep(0.03, 0.4, dye) feeding a narrow opacity range, which is a
     * soft gradient over a small delta — perceptually a uniform haze, and no
     * amount of tuning the endpoints turns a gradient into a blob. The edge IS
     * the effect.
     */
    // Inverted: tCursorEffect is the velocity field rendered to colour, resting
    // at white and darkening where the fluid moves. See the field shader.
    float cursorEffect = step(0.1, 1.0 - texture2D(tCursorEffect, uv).r);

    /* Hover wipe, from the reference's head shader. A band sweeps up the frame,
     * bowed by sin(x * PI) so it crests in the middle rather than crossing dead
     * level — the helmet arrives as a curve, not a rising horizon.
     *
     * Rests at 0, and deliberately is NOT driven by the intro clock. It adds
     * into the mask and saturates it, so anything that parks it at 1 pins the
     * shell fully visible and makes blob masking structurally impossible. It is
     * a hover input on the reference, not an intro one; wiring it to the intro
     * was my error and cost the entire effect. */
    float hoverTransition = vScreenUv.y
      + sin(vScreenUv.x * 3.141592) * sin(uHelmetHover * 3.141592) * 0.2;
    cursorEffect += step(1.0 - hoverTransition, uHelmetHover);
    cursorEffect = clamp(cursorEffect, 0.0, 1.0);

    /* Pulsating wireframe scan, from the reference's own scan-effect shader:
     *
     *     scanEffect = pow(fract(-y * 10.0 - uTime), 4.0) * 0.1
     *
     * fract() of a scaled position is a sawtooth — a repeating ramp up the
     * shell — and sliding it with time makes those ramps travel. The fourth
     * power is what turns it into a SCAN rather than a stripe: it crushes
     * everything below the crest toward zero, leaving a narrow bright band with
     * a long dark tail behind it. So the shell sits almost invisible and a
     * pulse sweeps through it, which is why it reads as a reveal instead of a
     * fade. With the flag off the reference substitutes a flat 0.1, so the
     * static case is the band's own ceiling held constant. */
    /* Normalised against the helmet's OWN vertical bounds, so exactly one
     * period spans the shell and exactly one pulse is ever in flight. Banding
     * on a raw frequency put several sawtooth periods across the helmet at
     * once, which is why it read as a stack of stripes rather than a pulse.
     * 0 at the crown, 1 at the chin, so the band runs top to bottom. */
    float h = clamp((uScanBounds.y - vViewPosition.y) / max(uScanBounds.y - uScanBounds.x, 1e-4), 0.0, 1.0);
    float scan = uScanAnimating
      ? pow(fract(h - uTime * uScanSpeed), 4.0)
      : 1.0;

    /* The scan modulates the IDLE alpha only. Under a cursor blob the shell
     * goes fully present — a band travelling through a revealed helmet would
     * read as a rendering fault rather than as an effect, and the reference
     * likewise composites its lit helmet without the scan. */
    float alpha = mix(uOpacity * scan, uRevealOpacity, cursorEffect);

    if (alpha < 0.002) discard;

    // Shading, so the shell reads as an object rather than a flat silhouette.
    // There is no light rig in this scene and adding one would mean lit
    // materials across 470 meshes, so this is a fixed two-term model evaluated
    // from the view-space normal: a key from the upper left, and a rim that
    // lifts the grazing angles. The rim is what makes the crown and the jaw
    // read as curved while the shell is this translucent.
    vec3 n = normalize(vNormal);
    float key = max(dot(n, normalize(vec3(-0.35, 0.55, 0.75))), 0.0);
    float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 2.4);

    // The DDS diffuse is the real 2020 Champion livery, so where a mesh has
    // one it replaces the flat baseColorFactor outright rather than tinting it
    // — multiplying the two would darken the artwork by whatever colour the
    // material happened to carry. baseColorFactor stays as the fallback for
    // the meshes the texture set does not cover.
    vec3 albedo = uHasMap ? texture2D(uMap, vUv).rgb : uColor;
    vec3 shaded = albedo * (0.42 + 0.58 * key) + vec3(rim * 0.35);

    gl_FragColor = vec4(shaded, alpha);
  }
`;

const helmetVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec2 vScreenUv;
  varying vec3 vViewPosition;
  void main() {
    // View space, not world: the shading rig is defined relative to the camera,
    // so the key light stays put on the shell rather than sweeping across it.
    vNormal = normalMatrix * normal;
    vUv = uv;

    vec4 view = modelViewMatrix * vec4(position, 1.0);
    /* View space for the scan band. The reference bands on OBJECT-space y, but
     * our model arrives Z-up and is rotated -90 about X by a parent group, so
     * the attribute's own y is the depth axis here and banding on it would send
     * the scan through the helmet front-to-back instead of top-to-bottom. View
     * space is the axis the viewer actually reads as vertical, and since the
     * helmet faces the camera it comes to the same thing on the reference. */
    vViewPosition = view.xyz;

    vec4 clip = projectionMatrix * view;
    // Screen position, for the intro wipe. Taken here rather than from
    // gl_FragCoord because the wipe is a property of where the helmet sits in
    // the FRAME — it has to agree with the field's own reveal, which works in
    // the same 0..1 viewport space.
    vScreenUv = (clip.xy / clip.w) * 0.5 + 0.5;

    gl_Position = clip;
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
  /** Livery sheets, held only so dispose() can release their GPU memory. */
  private helmetMaps: THREE.Texture[] = [];
  /** Opacity the helmet returns to when the cursor is clear of it. */
  /**
   * Three clean shells, so alpha barely accumulates and the wireframe can carry
   * real weight. The old 470-mesh model needed 0.028 to avoid reading as solid
   * white, which left individual edges invisible.
   */
  /**
   * Back to wire mesh, so the lines carry the read again — but not back to the
   * old 0.07. That value predated the livery: an untextured white cage needed
   * to stay near-invisible to avoid reading as a net over the face, whereas
   * textured lines are already dark and self-shading over most of the shell.
   *
   * 0.16 is the floor. The cursor lifts it to uRevealOpacity, and the GAP
   * between the two is the entire blob effect — at 0.30/0.92 there was barely
   * a stop of range left to show, which is why the masking read as absent.
   */
  /**
   * Idle ceiling, not idle brightness — the scan band multiplies this.
   *
   * The mean of pow(x, 4) over a uniform sawtooth is 1/5, so the shell's
   * AVERAGE alpha here is about 0.022 — the same near-invisible ghost as
   * before — while the travelling crest peaks at this full value and actually
   * reads. Lowering this to what the old flat value was would make the pulse
   * itself invisible, which is the whole effect.
   */
  private baseHelmetOpacity = 0.11;
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

  /**
   * Pass one of the background. Exposed so its parameters can be dialled in
   * from the console against the live render — `hamiltonGL.head.contour.params`
   * mirrors `landoGL.params.headScene` name for name, so the two sites can be
   * compared by setting the same value on both.
   */
  readonly contour: ContourField;

  /**
   * Intro reveal, 0..1, over REVEAL_DURATION seconds.
   *
   * Drives three things at once, which is why it is one number: the field's UV
   * window slides down into frame, the outline colour fades up from the
   * background, and the helmet's wipe sweeps across. They share a clock because
   * on the reference they visibly resolve together.
   */
  private reveal = 0;
  /** Seconds. The reference's REVEAL_DURATION, read off its live params. */
  private readonly revealDuration = 1.1;

  /* ---------------------------------------------------------------- *
   * Idle auto-swipe
   *
   * The reference sweeps the helmet by itself when the pointer goes quiet. It
   * is NOT a shader animation — instrumenting its WebGL uniform traffic over a
   * 22s idle window showed uHelmetHover, uIsWireframeAnimating and
   * uHelmetTransition all completely static, while the FLUID's own `center` and
   * `force` uniforms kept animating. In other words the site simply feeds the
   * fluid a synthetic pointer path, and the ordinary cursor mask does the rest.
   * That is a much better mechanism than a bespoke animation: the auto-swipe is
   * automatically identical in character to a real one.
   *
   * Every number below is measured off that capture rather than guessed:
   *   - swipe duration ~2.47s (samples: 2469, 2492, 2467, 2467, 2468ms)
   *   - swipe STARTS alternate 4.00s and 5.50s apart
   *   - travel is clamped within x [-0.75, 0.75], y [-0.5, 0.5] of centre
   * ---------------------------------------------------------------- */

  /** Seconds since the last real pointer movement. */
  private idleFor = 0;
  /** Seconds until the next auto-swipe begins. */
  private nextSwipeIn = 0;
  /** Progress through the current swipe, 0..1. Negative means none running. */
  private swipeT = -1;
  private swipeIndex = 0;
  private readonly swipeFrom = new THREE.Vector2();
  private readonly swipeTo = new THREE.Vector2();

  /** How long the pointer must be still before the site starts sweeping. */
  /* Faster than the reference by request. Its own cadence was 2.47s swipes
   * starting 4.0s/5.5s apart; these keep the same alternating shape but tighten
   * it, and start sweeping sooner after the pointer goes quiet. The alternation
   * is worth keeping — a single fixed interval reads as a metronome. */
  private readonly idleBeforeAuto = 1.6;
  private readonly swipeDuration = 1.9;
  private readonly swipeIntervals = [2.6, 3.4];

  private readonly ease: number;
  private readonly subjectScale: number;
  private aspect = 1;
  private readonly clock = new THREE.Clock();
  private intro = 0;
  private dpr = 1;

  /**
   * Viewport size in DEVICE pixels, shared by reference with the helmet
   * material's uResolution.
   *
   * Shared, not copied, and that is the entire point. resize() runs on load;
   * loadHelmet() is async and resolves after it, so the old
   * `this.helmetMat?.uniforms.uResolution.value.set(...)` silently did nothing
   * — the optional chain short-circuited on a material that did not exist yet,
   * and the uniform kept its constructor value of (1, 1). The helmet then
   * divided gl_FragCoord by one, sampled the dye texture hundreds of units
   * outside its range, clamped to a corner texel and read zero everywhere. The
   * cursor mask could never fire, whatever the threshold or the opacities.
   *
   * Handing the material this same Vector2 makes load order irrelevant.
   */
  private readonly viewportPx = new THREE.Vector2(1, 1);

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

    // Pass one lives in its own object with its own render target; this
    // material is pass two, and does nothing but trace what that wrote.
    this.contour = new ContourField(renderer);

    this.field = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: fieldFragment,
      uniforms: {
        tBackgroundNoise: { value: this.contour.texture },
        tCursorEffect: { value: this.fluid.texture },

        OUTLINE: { value: true },
        // The reference's epsilon, unchanged. See ContourField: this is not a
        // width, and 0.0001 is already dramatic.
        THICKNESS: { value: 0.000005 },

        COLOR_BACKGROUND: { value: token('--gl-bg', '#241b1e') },
        COLOR_OUTLINE: { value: token('--gl-outline', '#9c6a71') },
        COLOR_FOREGROUND: { value: token('--gl-outline', '#9c6a71') },
        COLOR_CURSOR_BACKGROUND: { value: token('--gl-cursor-bg', '#33262a') },
        COLOR_CURSOR_FOREGROUND: { value: token('--gl-cursor-fg', '#ff2800') },
        COLOR_CURSOR_OUTLINE: { value: token('--gl-cursor-outline', '#ff2800') },

        uReveal: { value: 0 },
        /* How strongly a blob repaints the background under it.
         *
         * The reference's blob is a very small tonal step — its cursor colours
         * sit within ~16/255 of its background, so what you see is a patch of
         * slightly different tone drifting over the topography, with the
         * contour lines running straight through it. Ours has to work on a dark
         * ground where that ratio would vanish, so the colours are further
         * apart; this pulls the blend back so the result stays a tint rather
         * than a flood. The blob COLOURS the field — it does not replace it. */
        // 1.0, so the blob REPLACES the field rather than tinting it. Anything
        // below full leaves a percentage of the black-ground/red-line pass
        // showing through the red-ground/black-line one, which reads as the
        // fluid sitting behind the contours instead of in front of them.
        uCursorIntensity: { value: 1.0 },
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
      transparent: true,
      // Depth writing ON, which is unusual for a transparent material and is
      // the point. Without it all 470 nested shells draw their interiors and
      // the alphas stack to opaque white. Writing depth removes the hidden
      // lines, so only the shell facing the viewer contributes.
      depthWrite: true,
      depthTest: true,
      uniforms: {
        tCursorEffect: { value: this.fluid.texture },
        // The live viewport vector, not a copy — see viewportPx.
        uResolution: { value: this.viewportPx },
        uOpacity: { value: this.baseHelmetOpacity },
        // What a blob lifts the shell to. The gap between these two is the
        // whole effect — too close and the fluid has nothing to show.
        uRevealOpacity: { value: 0.92 },
        // Intro wipe progress. Shared by reference, so one write in update()
        // reaches every per-colour variant.
        uHelmetHover: { value: 0 },
        uTime: { value: 0 },
        // The helmet's view-space y range, filled in by fitHelmet. One scan
        // period spans exactly this, so exactly one pulse exists at a time.
        uScanBounds: { value: new THREE.Vector2(-0.5, 0.5) },
        // Cycles per second. One pulse, top to bottom, every second.
        uScanSpeed: { value: 1.0 },
        uScanAnimating: { value: true },
        uColor: { value: new THREE.Color(0xffffff) },
      },
    });

    /* ---------------------------------------------------------------- *
     * Livery
     *
     * The model ships 27 materials and ZERO textures — no images, no maps,
     * just flat PBR colours (Italian names: VIOLA the shell, NERO the visor
     * and gasket, ORO the trim). So there is nothing to sample; the colour a
     * region should be is the baseColorFactor the file already carries.
     *
     * Taken verbatim rather than remapped onto the site palette. That is a
     * deliberate call, not an oversight — the helmet keeps its own violet and
     * gold instead of being pulled toward the page's red.
     * ---------------------------------------------------------------- */

    // One material per distinct source colour, sharing the template's uniform
    // OBJECTS. Spreading copies the references, not the values, so the single
    // writes to helmetMat.uniforms elsewhere (opacity, resolution, the fluid
    // texture) still reach every variant — without that, each would need
    // updating by hand every frame.
    // The real 2020 Champion livery, as DDS. The glTF embeds no images at all,
    // so these are the only artwork the helmet has — the mesh does carry
    // TEXCOORD_0, which is what makes them applicable.
    // PNG rather than the DDS directly. The source files carry DX10 headers
    // with DXGI formats 78 (BC3_UNORM_SRGB) and 98 (BC7_UNORM); Three's
    // DDSLoader only walks the legacy FourCC DXT1/3/5 path and cannot decode
    // BC7 at all, so it rejected them outright. Converted offline to PNG at
    // full 2048 resolution instead — build-time cost rather than a runtime
    // transcoder, and no decoder ships to the client.
    const tex2d = new THREE.TextureLoader();
    const loadMap = (file: string): THREE.Texture => {
      const tex = tex2d.load(`/assets/helmet/textures/${file}`);
      // glTF UVs have their origin at the top left, which is the opposite of
      // the loader's default flip.
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      return tex;
    };
    const maps = {
      shell: loadMap('helmet_d.png'),
      wing: loadMap('wing_d.png'),
      // The visor sheet is DXGI 78, which the converter could not read either.
      // That group falls back to its baseColorFactor, which is near-black —
      // the correct colour for a visor gasket regardless.
      visor: null as THREE.Texture | null,
    };
    this.helmetMaps = Object.values(maps).filter((m): m is THREE.Texture => m !== null);

    // Which of the three sets a mesh belongs to, read off the material names —
    // ALETTE is the aero fins, the GUARNIZ/visor group the aperture furniture,
    // everything else the shell.
    const mapFor = (name: string): THREE.Texture | null => {
      const n = name.toUpperCase();
      if (n.startsWith('ALETTE')) return maps.wing;
      if (n.includes('GUARNIZ') || n.includes('VISOR')) return maps.visor;
      if (n === '__DEFAULT' || n === '') return null;
      return maps.shell;
    };

    const shared = this.helmetMat.uniforms;
    const byVariant = new Map<string, THREE.ShaderMaterial>();
    const variantFor = (colour: THREE.Color, map: THREE.Texture | null): THREE.ShaderMaterial => {
      // Keyed on both, since two regions can share a base colour but take
      // different sheets — collapsing on colour alone would texture the fins
      // with the shell's artwork.
      const key = `${colour.getHexString()}|${map ? map.uuid : 'none'}`;
      let mat = byVariant.get(key);
      if (!mat) {
        mat = new THREE.ShaderMaterial({
          vertexShader: helmetVertex,
          fragmentShader: helmetFragment,
          // Wire mesh, but textured: the lines still sample the livery, so the
          // shell reads as the 2020 Champion helmet drawn in wire rather than
          // as a uniform white cage. Solid filled it in and hid the face.
          wireframe: true,
          transparent: true,
          depthWrite: true,
          depthTest: true,
          uniforms: {
            ...shared,
            uColor: { value: colour },
            uMap: { value: map },
            uHasMap: { value: map !== null },
          },
        });
        byVariant.set(key, mat);
      }
      return mat;
    };

    /* Merge by material.
     *
     * The model arrives as 470 separate meshes, which is 470 draw calls every
     * frame — measured at ~8.5fps on its own, and by far the largest single
     * cost in the scene. They only ever differ by base colour and texture
     * sheet, so collapsing them into one mesh per distinct pairing takes that
     * to fourteen. The geometry, and the ~1M wireframe segments it carries, is
     * unchanged; what goes away is per-draw CPU overhead.
     */
    const source = gltf.scene;
    // World matrices have to be current before they can be baked, and nothing
    // has rendered yet at this point, so Three has not computed them.
    source.updateMatrixWorld(true);

    const buckets = new Map<
      string,
      { material: THREE.ShaderMaterial; geometries: THREE.BufferGeometry[] }
    >();
    const originals: THREE.BufferGeometry[] = [];

    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const from = mesh.material;
      // baseColorFactor lands on .color, which is the entire livery this file
      // has. Anything without one (the glTF's __DEFAULT) falls back to a mid
      // grey rather than to black, which would read as a hole in the shell.
      const single = Array.isArray(from) ? from[0] : from;
      const colour =
        (single as THREE.MeshStandardMaterial | undefined)?.color?.clone() ??
        new THREE.Color(0x8a8a8a);
      const sourceName = (single as THREE.Material | undefined)?.name ?? '';
      // The glTF's own materials are replaced, so release them here rather
      // than leaving 27 orphaned programs alive for the page's lifetime.
      if (!Array.isArray(from)) (from as THREE.Material | undefined)?.dispose();

      const map = mapFor(sourceName);
      const key = `${colour.getHexString()}|${map ? map.uuid : 'none'}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material: variantFor(colour, map), geometries: [] };
        buckets.set(key, bucket);
      }

      // Bake the node's world transform into the vertices. Merging discards the
      // scene graph, so geometry that does not carry its own placement collapses
      // onto the origin — which is exactly how a 470-part model turns into a
      // tangle of stray edges at the centre.
      bucket.geometries.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      originals.push(mesh.geometry);
    });

    const group = new THREE.Group();
    for (const { material, geometries } of buckets.values()) {
      // useGroups false: one material per merged mesh, so draw groups would
      // reintroduce exactly the per-part draw calls this is removing.
      const geometry = mergeGeometries(geometries, false);
      for (const g of geometries) g.dispose();
      if (!geometry) {
        // Fail loudly. A silent skip here would drop part of the shell and look
        // like a modelling problem rather than a merge problem.
        throw new Error('helmet: geometry merge failed — mismatched vertex attributes');
      }
      const mesh = new THREE.Mesh(geometry, material);
      // renderOrder must be set per mesh — Three reads it off the object being
      // drawn and does not inherit it from a parent Group. Left at the default
      // 0 these draw before the transparent portrait, which then paints over
      // them, and the helmet never appears however opaque it is.
      mesh.renderOrder = 3;
      group.add(mesh);
    }
    for (const g of originals) g.dispose();

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

    /* Measure where the helmet actually sits, for the scan band.
     *
     * The band has to span the shell exactly, so this cannot be a constant —
     * the helmet's height on screen depends on the portrait fit, which depends
     * on the viewport. Measured after every fit instead.
     *
     * World y is used directly as view y: the camera is orthographic, unrotated
     * and looking down -z, so the view matrix contributes only a z offset.
     */
    if (this.helmetMat) {
      this.helmet.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.helmet);
      (this.helmetMat.uniforms.uScanBounds!.value as THREE.Vector2).set(box.min.y, box.max.y);
    }
  }

  /**
   * Drive the fluid from a synthetic pointer path while the user is idle.
   *
   * Only the FLUID and the contour field are driven, never `pointerTarget`.
   * The portrait's parallax and depth shift stay bound to the real pointer, so
   * the face does not drift on its own — which matches the reference, where the
   * head sits still through the whole idle sequence and only the mask moves.
   */
  private runAutoSwipe(dt: number): void {
    this.idleFor += dt;
    if (this.idleFor < this.idleBeforeAuto) return;

    if (this.swipeT < 0) {
      this.nextSwipeIn -= dt;
      if (this.nextSwipeIn > 0) return;
      this.beginSwipe();
    }

    this.swipeT += dt / this.swipeDuration;
    if (this.swipeT >= 1) {
      this.swipeT = -1;
      // Starts alternate 4.00s and 5.50s apart, so the wait after a 2.47s
      // swipe is the remainder of whichever interval is next.
      const interval = this.swipeIntervals[this.swipeIndex % this.swipeIntervals.length]!;
      this.nextSwipeIn = Math.max(0, interval - this.swipeDuration);
      return;
    }

    // Ease in and out. The pointer is meant to read as something being moved,
    // not as a linear tween — a constant-velocity sweep starts and stops with a
    // jolt that no hand makes, and the fluid shows it as a hard-ended streak.
    const e = this.swipeT * this.swipeT * (3 - 2 * this.swipeT);
    const x = this.swipeFrom.x + (this.swipeTo.x - this.swipeFrom.x) * e;
    const y = this.swipeFrom.y + (this.swipeTo.y - this.swipeFrom.y) * e;

    this.fluid.setPointer((x + 1) / 2, (y + 1) / 2);
    this.contour.setPointer(x, y);
  }

  /** Pick the next swipe's endpoints, in -1..1 pointer space. */
  private beginSwipe(): void {
    this.swipeT = 0;
    const i = this.swipeIndex++;

    // Measured bounds: the reference's auto-cursor clamps to +/-0.75 across and
    // +/-0.5 up. Alternating a traverse with a vertical sweep reproduces both
    // the long crossing and the edge runs seen in the capture — and the
    // traverse is the one that carries the fluid over the helmet.
    const X = 0.75;
    const Y = 0.5;
    // Deterministic drift so successive swipes do not retrace one line, without
    // reaching for randomness that would make the sequence untestable.
    const drift = Math.sin(i * 2.399) * 0.45;

    if (i % 2 === 0) {
      // Traverse across the frame, through the head.
      const dir = i % 4 === 0 ? 1 : -1;
      this.swipeFrom.set(-X * dir, drift * Y);
      this.swipeTo.set(X * dir, drift * Y * 0.4);
    } else {
      // Vertical sweep, offset from centre.
      const dir = i % 4 === 1 ? 1 : -1;
      this.swipeFrom.set(drift, Y * dir);
      this.swipeTo.set(drift * 0.6, -Y * dir);
    }
  }

  setPointer(nx: number, ny: number): void {
    // Any real movement cancels the idle sequence outright — including a swipe
    // already in flight, so the user's own gesture never fights an automatic
    // one for control of the fluid.
    this.idleFor = 0;
    this.swipeT = -1;
    this.nextSwipeIn = 0;

    this.pointerTarget.set(nx, ny);
    // Raw, not eased: the fluid takes its force from how fast the pointer is
    // actually moving, so smoothing first would flatten every flick into the
    // same gentle push and lose the character of the effect.
    this.fluid.setPointer((nx + 1) / 2, (ny + 1) / 2);
    // Same reasoning — the contour field derives its own pace from the raw
    // positions, and CURSOR_BOUNCE only reads as a bounce if the input is live.
    this.contour.setPointer(nx, ny);
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
    // Portrait only. The field's cursor response is no longer a pixel radius —
    // it is CURSOR_SCALE against an aspect-corrected UV distance, which lives
    // in ContourField's params alongside the rest of the reference's names.
    this.head.uniforms.uRevealPx!.value = v * this.dpr;
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

    // Aspect now belongs to pass one, where the noise is actually sampled;
    // pass two only reads a texture and needs no notion of shape.
    this.fieldMesh.scale.set(view * 2, 2, 1);
  }

  resize(dpr = Math.min(window.devicePixelRatio, 2)): void {
    this.dpr = dpr;
    const view = window.innerWidth / window.innerHeight;
    this.fluid.setAspect(view);
    // CSS pixels, not device — the noise target's texel size IS the contour
    // line weight, so this is a visual decision rather than a quality one.
    this.contour.setSize(window.innerWidth, window.innerHeight);
    // The helmet mask samples by gl_FragCoord, which is in device pixels, so
    // the divisor must carry the DPR or the mask lands offset on HiDPI.
    // Written unconditionally into the shared vector, so it is already correct
    // whenever the helmet finishes loading.
    this.viewportPx.set(window.innerWidth * dpr, window.innerHeight * dpr);
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

    // Both offscreen stages step before the scene draws. Each binds and
    // restores its own render target, so neither may run mid-draw.
    // The fluid runs on a FIXED timestep now, matching the reference — its
    // force, dissipation and dt terms are all tuned around that number, so
    // feeding it real frame time made the effect change character with the
    // frame rate. It no longer takes a delta.
    this.fluid.update();
    this.contour.update(t);
    this.head.uniforms.uTime!.value = t;

    if (this.intro < 1) {
      this.intro = Math.min(this.intro + 0.012, 1);
      this.head.uniforms.uIntro!.value = this.intro;
    }

    // The reference's REVEAL_DURATION is in seconds, so this is driven off the
    // clock rather than off a per-frame increment — the intro then takes the
    // same 1.1s whether the machine is managing 30fps or 120.
    if (this.reveal < 1) {
      this.reveal = Math.min(this.reveal + dt / this.revealDuration, 1);
      // Cubic ease-out. The reference's UV window is divided by
      // (1 + REVEAL_SIZE * (1 - uReveal)), which is violently non-linear near
      // 0 — feeding it a linear ramp spends most of the second on a frame that
      // has barely changed and then snaps.
      const eased = 1 - Math.pow(1 - this.reveal, 3);
      this.contour.reveal = eased;
      this.field.uniforms.uReveal!.value = eased;
    }

    /* The fluid's dye is a PING-PONG pair, and `fluid.texture` is a getter that
     * returns whichever half is currently the read side — so it names a
     * different texture every frame. It has to be re-read here, not bound once
     * at construction: a cached handle points at the half the simulation is
     * writing half the time, and sampling a target mid-write returns velocity
     * and pressure data rather than dye. Thresholded, that lights up most of
     * the frame. */
    this.field.uniforms.tCursorEffect!.value = this.fluid.texture;
    this.runAutoSwipe(dt);

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
      // Idle drift removed. It was reasoned from the reference exposing
      // IS_WIREFRAME_ANIMATING, but that flag animates the WIREFRAME, not the
      // object's transform — the shell is meant to sit dead still on the head
      // and be animated only by the mask deciding where it survives. The drift
      // also fought the portrait's own pointer parallax, since the helmet is a
      // child of that plane and inherited its motion on top of its own.
      this.helmet.rotation.set(0, 0, 0);

      this.helmetMat.uniforms.tCursorEffect!.value = this.fluid.texture;
      // Drives the travelling scan band. Shared uniform object, so this one
      // write reaches every per-colour variant.
      this.helmetMat.uniforms.uTime!.value = t;
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
    // ~11MB of compressed livery, so worth releasing explicitly rather than
    // waiting on the material teardown to reach it.
    for (const map of this.helmetMaps) map.dispose();
    this.fluid.dispose();
    this.contour.dispose();
    this.field.dispose();
    this.head.dispose();
  }
}
