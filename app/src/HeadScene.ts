import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FluidCursor } from './FluidCursor';
import { ContourField } from './ContourField';
import { createStudioEnvironment, HELMET_UPRIGHT, loadHelmetModel } from './HelmetModel';
import type { HelmetModel } from './HelmetModel';
import { gsap, reducedMotion } from './lib/motion';

/**
 * The hero scene: a contour-line field, the portrait on top of it, the helmet
 * fitted over the head, and a pointer fluid that plays between them.
 *
 * Rebuilt on the reference's own mechanism, read out of its bundle
 * (lando-gl.js: the head scene `O9`, its helmet `F9`, the composite shader
 * `104-includes.frag`) and checked against the running site:
 *
 *   - At rest the helmet is a faint wireframe shell, fitted round the head as
 *     though worn. Black lines at a tenth opacity on the reference's cream; the
 *     same weight in light lines on our dark ground. A pulse runs down it.
 *   - Wherever the fluid is moving, the helmet itself shows -- lit, painted,
 *     visor and all -- composited as `mix(base, helmet, cursorEffect)`, with
 *     `cursorEffect` the fluid thresholded to a hard edge.
 *   - Under the same mask the portrait swaps to a shadowed version: the helmet
 *     casting its shadow onto the neck below the chin bar.
 *   - Hovering the next-race card's second row reveals the whole helmet in a
 *     bowed wipe up the screen, and the helmet stops following the pointer.
 *   - Idle for a couple of seconds and a synthetic pointer zigzags down the
 *     face and back, so the helmet keeps surfacing on its own.
 *
 * The helmet is the one On Track flies (HelmetModel), so the two pages show the
 * same object. Nothing of the reference's -- model, textures, HDRI, shaders --
 * is shipped; only its mechanics and numbers.
 */

const HERO_BASE = '/assets/hero';

export interface HeadSceneOptions {
  parallax?: number;
  ease?: number;
  /** Multiplier on the fitted portrait size — see `layout()`. */
  subjectScale?: number;
}

/* ------------------------------------------------------------------ *
 * Shared GLSL
 * ------------------------------------------------------------------ */

export const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The reveal mask, shared by every material that answers the fluid.
 *
 * `cursorEffect` is the reference's, exactly: the fluid's colour target
 * inverted (it rests at white) and reduced to a HARD binary with step(0.1).
 * The hard edge is the effect -- a smoothstep reads as a haze, not as liquid.
 * The 0.025/0.95 inset is the reference's "gap fix": the solve has no real
 * boundary, so its outermost texels are never trusted.
 *
 * `helmetHover` is the reference's hover wipe: a front that climbs the screen,
 * bowed by sin(x * PI) while it moves so the helmet arrives as a curve.
 */
const revealChunk = /* glsl */ `
  uniform sampler2D tCursorEffect;
  uniform vec2  uResolution;
  uniform float uHelmetHover;

  float cursorEffectAt(vec2 screenUv) {
    return step(0.1, 1.0 - texture2D(tCursorEffect, vec2(0.025) + screenUv * 0.95).r);
  }

  float helmetHoverAt(vec2 screenUv) {
    float front = screenUv.y + sin(screenUv.x * 3.141592) * sin(uHelmetHover * 3.141592) * 0.2;
    return step(1.0 - front, uHelmetHover);
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
 *
 * Shared with BackgroundField, which leaves tCursorEffect at rest and
 * uHelmetHover at zero, so the fluid and hover terms fall away there.
 */
export const fieldFragment = /* glsl */ `
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
  uniform float uHelmetHover;

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

    /* Cursor blob, and the hover wipe, both in the reference's order. The
     * cursor term is scaled by uCursorIntensity, which the scroll takes to zero;
     * the hover term is not. step, not smoothstep: the hard threshold is what
     * gives the blob its crisp, liquid edge. */
    vec2 cursorUv = vec2(0.025) + vUv * 0.95;
    float cursorEffect = step(0.1, 1.0 - texture2D(tCursorEffect, cursorUv).r);
    background = mix(background, cursorBackground, cursorEffect * uCursorIntensity);

    float hoverFront = vUv.y + sin(vUv.x * 3.141592) * sin(uHelmetHover * 3.141592) * 0.2;
    background = mix(background, cursorBackground, step(1.0 - hoverFront, uHelmetHover));

    gl_FragColor = vec4(background, 1.0);
  }
`;

/* ------------------------------------------------------------------ *
 * Helmet: the resting wireframe
 * ------------------------------------------------------------------ */

/**
 * The reference's wireframe (its `102-float-scaneffect`), reproduced:
 *
 *     scanEffect = IS_WIREFRAME_ANIMATING ? pow(fract(-y * 10.0 - uTime), 4.0) * 0.1 : 0.1
 *     gl_FragColor = vec4(vec3(0.0), scanEffect * uOpacity)
 *
 * fract() of a scaled height is a sawtooth, and sliding it with time makes it
 * travel; the fourth power crushes all but the crest, so the shell sits almost
 * invisible and a pulse runs down it once a second. Its model is 0.0771 units
 * tall, so `y * 10` puts 0.771 of a period across the helmet: one pulse at a
 * time, with a gap before the next. `uScanSpan` is that 0.771, applied to our
 * model's own normalised height so the rhythm is the same.
 *
 * Light lines instead of black: our ground is dark where the reference's is
 * cream, and the palette inverts with it. `uWeight` scales for our denser mesh
 * so the shell carries the reference's weight -- see makeWireUniforms.
 */
const wireVertex = /* glsl */ `
  uniform vec2 uHeightRange;
  varying float vHeight;
  void main() {
    // Authored z is up. 0 at the base of the helmet, 1 at the crown.
    vHeight = (position.z - uHeightRange.x) / (uHeightRange.y - uHeightRange.x);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const wireFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uScanSpan;
  uniform bool  uIsWireframeAnimating;
  uniform vec3  uColor;
  uniform float uWeight;
  varying float vHeight;

  void main() {
    float scanEffect = 0.1;
    if (uIsWireframeAnimating) {
      scanEffect = pow(fract(-vHeight * uScanSpan - uTime), 4.0) * 0.1;
    }
    gl_FragColor = vec4(uColor, scanEffect * uOpacity * uWeight);
  }
`;

/* ------------------------------------------------------------------ *
 * Portrait
 * ------------------------------------------------------------------ */

/**
 * The photo, its depth parallax, and the shadow the helmet casts.
 *
 * The shadow is the reference's `tShadowDiffuse` swap: under the fluid (and
 * under the hover wipe) its head samples a second photo that is identical
 * except for a dark band on the neck just below the chin bar. Measured off
 * that texture against its diffuse, row by row: untouched down to the mouth,
 * about a quarter of the light left just below the rim, half at ~15% of the
 * helmet's height below it, and nothing past ~30%. Strongest down the middle,
 * over the neck, and weaker out on the collar. We have no second photo and do
 * not want one, so the same band is computed from where the helmet sits.
 */
const headFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uDiffuse;
  uniform sampler2D uDepth;
  uniform sampler2D uAlpha;

  uniform vec2  uPointer;
  uniform float uParallax;
  uniform float uIntro;
  uniform float uSaturation;

  /* The helmet's lower rim and footprint, in this plane's UV. See fitHelmet. */
  uniform float uShadowRim;
  uniform float uShadowCentre;
  uniform vec2  uShadowSize;

  ${revealChunk}

  varying vec2 vUv;

  void main() {
    float d = texture2D(uDepth, vUv).r;

    // Depth parallax: 0.5 is the pivot plane, so the sign of (d - 0.5) decides
    // whether a pixel leads or trails the pointer. Stands in for the
    // reference's head turning toward the pointer on a displaced mesh.
    vec2 uv = vUv + uPointer * (d - 0.5) * uParallax;

    vec3  color = texture2D(uDiffuse, uv).rgb;
    float alpha = texture2D(uAlpha, uv).r;

    // Intro wipe, bottom up. uIntro is driven past 1 so the leading edge clears
    // the top of the plane; comparing against it directly leaves everything
    // above the softening band masked forever.
    alpha *= smoothstep(vUv.y - 0.25, vUv.y, uIntro * 1.3);

    if (alpha < 0.004) discard;

    /* The helmet's shadow, only where the helmet is showing. */
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    float shade = min(cursorEffectAt(screenUv) + helmetHoverAt(screenUv), 1.0);
    if (shade > 0.0) {
      float below = (uShadowRim - vUv.y) / uShadowSize.y;
      float band = smoothstep(-0.3, 0.1, below) * (1.0 - smoothstep(0.2, 1.0, below));
      float across = 1.0 - smoothstep(0.2, 0.75, abs(vUv.x - uShadowCentre) / uShadowSize.x);
      color *= 1.0 - 0.75 * band * across * shade;
    }

    /* Mute, applied here rather than as a CSS filter on the wrapper.
       filter: saturate() on a full-viewport element makes the compositor
       rasterise the layer, run a filter pass over it and composite the result,
       every frame the value changes. Rec. 709 luma, the CSS filter's weights. */
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, uSaturation);

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
 * therefore double-darkens everything. Straight sRGB in, straight sRGB out.
 */
const tokenColor = (css: string) => new THREE.Color(css);

/* ------------------------------------------------------------------ *
 * Uniforms
 *
 * Built by factories so the scene holds the objects themselves rather than
 * reaching back through `material.uniforms`, where every entry is
 * `IUniform | undefined` and a misspelt name compiles and writes to nothing.
 * ------------------------------------------------------------------ */

/** The mask inputs every masked material shares, by reference. */
const makeRevealUniforms = (cursor: THREE.Texture, viewportPx: THREE.Vector2) => ({
  tCursorEffect: { value: cursor },
  // The live viewport vector, not a copy — see viewportPx.
  uResolution: { value: viewportPx },
  uHelmetHover: { value: 0 },
});
type RevealUniforms = ReturnType<typeof makeRevealUniforms>;

const makeFieldUniforms = (
  noise: THREE.Texture,
  reveal: RevealUniforms,
  token: (name: string, fallback: string) => THREE.Color,
) => ({
  tBackgroundNoise: { value: noise },
  tCursorEffect: reveal.tCursorEffect,
  uHelmetHover: reveal.uHelmetHover,

  OUTLINE: { value: true },
  // The reference's epsilon, unchanged. See ContourField: this is not a width.
  THICKNESS: { value: 0.000005 },

  COLOR_BACKGROUND: { value: token('--gl-bg', '#241b1e') },
  COLOR_OUTLINE: { value: token('--gl-outline', '#9c6a71') },
  COLOR_FOREGROUND: { value: token('--gl-outline', '#9c6a71') },
  COLOR_CURSOR_BACKGROUND: { value: token('--gl-cursor-bg', '#33262a') },
  COLOR_CURSOR_FOREGROUND: { value: token('--gl-cursor-fg', '#ff2800') },
  COLOR_CURSOR_OUTLINE: { value: token('--gl-cursor-outline', '#ff2800') },

  uReveal: { value: 0 },
  // The reference's composite uCursorIntensity: 1 at rest, taken to 0 as the
  // scroll hands the hero over. Shared with the helmet's mask.
  uCursorIntensity: { value: 1.0 },
});
type FieldUniforms = ReturnType<typeof makeFieldUniforms>;

const makeHeadUniforms = (pointer: THREE.Vector2, parallax: number, reveal: RevealUniforms) => ({
  ...reveal,
  uDiffuse: { value: null as THREE.Texture | null },
  uDepth: { value: null as THREE.Texture | null },
  uAlpha: { value: null as THREE.Texture | null },
  uPointer: { value: pointer },
  uParallax: { value: parallax },
  uIntro: { value: 0 },
  uSaturation: { value: 1 },
  // Parked off the plane until the helmet is fitted, so no shadow falls.
  uShadowRim: { value: -10 },
  uShadowCentre: { value: 0.5 },
  uShadowSize: { value: new THREE.Vector2(1, 1) },
});
type HeadUniforms = ReturnType<typeof makeHeadUniforms>;

const makeWireUniforms = (heightRange: THREE.Vector2, color: THREE.Color) => ({
  uTime: { value: 0 },
  // The reference's wireframe uOpacity: 1 at rest, 0 once the scroll takes over.
  uOpacity: { value: 1 },
  uScanSpan: { value: 0.771 },
  /* Line weight against the reference's. Its wireframe is 45.5k triangles;
     ours is 212.8k, so at the same alpha the same shell draws 4.7x the ink and
     the dense parts (visor frame, fins, rim) burn solid. Measured as mean
     luminance change over the helmet's box, static scan, both sites: the
     reference 7.6, ours 36.1 at 1.0 and 7.8 at 0.11. */
  uWeight: { value: 0.11 },
  uIsWireframeAnimating: { value: !reducedMotion },
  uHeightRange: { value: heightRange },
  uColor: { value: color },
});
type WireUniforms = ReturnType<typeof makeWireUniforms>;

/** Everything a revealed helmet material adds to its program. */
const makeMaskUniforms = (reveal: RevealUniforms, intensity: THREE.IUniform<number>) => ({
  ...reveal,
  uCursorIntensity: intensity,
  uShowHelmet: { value: 0 },
});
type MaskUniforms = ReturnType<typeof makeMaskUniforms>;

/**
 * Fit the helmet to the head, in the portrait's own units: offsets and sizes
 * are fractions of the portrait's HEIGHT, so the fit rides along with the
 * photo at any viewport. `size` is the model's longest side.
 *
 * Measured, not eyeballed: see the note on `helmetFit` below.
 */
export interface HelmetFit {
  /** Centre of the helmet from the centre of the portrait. */
  x: number;
  y: number;
  /** Longest side of the model. */
  size: number;
  /** Stretch across and down the screen, on top of `size`. */
  width: number;
  height: number;
  /** Forward tilt at rest, radians. The reference's is PI * 0.06. */
  tilt: number;
}

/** The two things a helmet is drawn as: the lit object, and the resting wire. */
interface HelmetRig {
  model: HelmetModel;
  /** The lit helmet, masked by the fluid. */
  lit: THREE.Group;
  litPose: THREE.Group;
  /** The resting wireframe. */
  wire: THREE.Group;
  wirePose: THREE.Group;
  wireMesh: THREE.Mesh;
  wireMaterial: THREE.ShaderMaterial;
  wireU: WireUniforms;
  environment: THREE.Texture;
  /** Longest side of the model, in authored units. */
  longest: number;
}

export class HeadScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly field: THREE.ShaderMaterial;
  private readonly head: THREE.ShaderMaterial;
  private readonly revealU: RevealUniforms;
  private readonly fieldU: FieldUniforms;
  private readonly headU: HeadUniforms;
  private readonly maskU: MaskUniforms;
  private readonly fieldMesh: THREE.Mesh;
  private readonly headMesh: THREE.Mesh;

  private helmet: HelmetRig | null = null;

  /**
   * Live switches, named as the reference names them in
   * `landoGL.params.headScene`, so the two sites can be compared by flipping
   * the same switch on both from the console.
   */
  readonly params = {
    SHOW_HELMET_PERMANENTLY: false,
    IS_WIREFRAME_ANIMATING: !reducedMotion,
  };

  /**
   * Where the helmet sits on the head. Solved from measurements, not placed by
   * eye -- the reference's helmet against Lando's face at 1728x1080, then the
   * same relationships put on Lewis's:
   *
   *   shell 1.52x as wide as the temples      (reference 695px over Lando's)
   *   crown ~7% of the helmet's height above the hair (reference 58px of 823)
   *   eyes inside the visor opening, a little above its middle
   *
   * This helmet's visor opening is a different shape from the reference's, so
   * "eyes in the opening" and "crown clearance" cannot both hold at the width
   * above with the model's own proportions. `height` squashes it 6% down the
   * screen to get both, which reads as the same helmet worn a touch lower.
   *
   * `hamiltonGL.head.helmetFit` plus `fitHelmet()` re-fits it live.
   */
  helmetFit: HelmetFit = { x: -0.0071, y: 0.1399, size: 0.7731, width: 1, height: 0.94, tilt: Math.PI * 0.06 };

  /** Where layout() put the portrait, before any pointer drift is added. */
  private readonly headBase = new THREE.Vector2();
  /** Portrait height in world units, from layout(). The fit's unit. */
  private portraitHeight = 1;
  /** How far the whole plane travels with the pointer, in world units. */
  imageShift = 0.02;

  private readonly pointerTarget = new THREE.Vector2();
  private readonly pointer = new THREE.Vector2();
  /** The helmet's own eased pointer — the reference eases it far more slowly. */
  private readonly helmetPointer = new THREE.Vector2();

  /** Pointer-driven fluid field. The helmet is masked by it, per fragment. */
  readonly fluid: FluidCursor;

  /**
   * Pass one of the background. Exposed so its parameters can be dialled in
   * from the console against the live render — `hamiltonGL.head.contour.params`
   * mirrors `landoGL.params.headScene` name for name.
   */
  readonly contour: ContourField;

  /** True once the plate has collapsed to a still picture. See `set inert`. */
  private still = false;
  /** Wants to be still; `still` follows once the reveal has faded out. */
  private goingStill = false;

  /** Intro reveal, 0..1, over REVEAL_DURATION seconds. */
  private reveal = 0;
  /** Seconds. The reference's REVEAL_DURATION, read off its live params. */
  private readonly revealDuration = 1.1;

  /**
   * How much the helmet follows the pointer, 1 at rest. The reference's
   * helmetRevealValue: the hover wipe takes it to 0 so the helmet settles
   * square-on while it is shown whole.
   */
  private readonly hover = { wipe: 0, follow: 1 };

  /* ---------------------------------------------------------------- *
   * Idle sweep
   *
   * The reference's idle state (`c9`), read out of its bundle: two seconds
   * after the pointer stops (2.5s after load if it never moves) a synthetic
   * cursor takes over the FLUID -- not the head, which stays put -- and runs a
   * repeating timeline:
   *
   *   0.0-2.5s  down the face: y 0.5 -> -0.5 linear, x = -cos(4 PI p) * 0.75
   *             with p eased power1.inOut, i.e. two full zigzags across
   *   2.5-4.0s  hold
   *   4.0-6.5s  the same zigzag back up
   *   then 3s   before it repeats
   *
   * Played here at IDLE_TEMPO of the reference's speed. The auto-sweep was
   * asked to run faster than the reference's in an earlier pass, and that
   * request stands; the path, the rhythm and every ratio between the phases
   * are the reference's. IDLE_TEMPO = 1 is the reference to the millisecond.
   * ---------------------------------------------------------------- */

  private static readonly IDLE_TEMPO = 1.3;
  private readonly idleAfterLoad = 2.5 / HeadScene.IDLE_TEMPO;
  private readonly idleAfterMove = 2.0 / HeadScene.IDLE_TEMPO;
  /** Seconds the pointer has been still. */
  private stillFor = 0;
  private moved = false;
  /** Seconds into the idle timeline, or -1 when the pointer is in charge. */
  private idleTime = -1;
  private readonly idleCursor = new THREE.Vector2();

  private readonly ease: number;
  private readonly subjectScale: number;
  private aspect = 1;
  private readonly clock = new THREE.Clock();
  private intro = 0;

  /**
   * Viewport size in DEVICE pixels, shared by reference with every material
   * that reads the fluid by gl_FragCoord. Shared, not copied: the helmet loads
   * after the first resize, and a copied vector would keep its constructor
   * value and put the mask hundreds of units off the texture.
   */
  private readonly viewportPx = new THREE.Vector2(1, 1);

  constructor(renderer: THREE.WebGLRenderer, opts: HeadSceneOptions = {}) {
    this.renderer = renderer;
    this.fluid = new FluidCursor(renderer);
    this.ease = opts.ease ?? 0.08;
    this.subjectScale = opts.subjectScale ?? 1;

    /* The helmet is lit and painted, so it gets the same tone curve On Track's
       does, or the one object would read differently on the two pages. The
       scene's other materials are raw shaders that never include the
       tonemapping chunk, so this touches the helmet and nothing else. */
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    // Orthographic: the portrait is a flat plane facing the viewer, and a
    // perspective camera would add foreshortening on top of its parallax.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.camera.position.z = 1;

    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      tokenColor(css.getPropertyValue(name).trim() || fallback);

    this.contour = new ContourField(renderer);
    this.revealU = makeRevealUniforms(this.fluid.texture, this.viewportPx);

    this.fieldU = makeFieldUniforms(this.contour.texture, this.revealU, token);
    this.field = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: fieldFragment,
      uniforms: this.fieldU,
    });

    // Parallax is subtle by default: the depth map is strong enough that
    // anything higher reads as the photo sliding rather than the head having
    // volume.
    this.headU = makeHeadUniforms(this.pointer, opts.parallax ?? 0.011, this.revealU);
    this.head = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: headFragment,
      transparent: true,
      uniforms: this.headU,
    });

    this.maskU = makeMaskUniforms(this.revealU, this.fieldU.uCursorIntensity);

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

    this.headU.uDiffuse.value = diffuse;
    this.headU.uDepth.value = depth;
    this.headU.uAlpha.value = alpha;

    const img = diffuse.image as { width: number; height: number };
    this.aspect = img.width / img.height;
    this.layout();
  }

  /**
   * Load the helmet and fit it. Separate from `load()` so the portrait is up
   * and interactive before the model lands, and still complete if it never
   * does.
   */
  async loadHelmet(): Promise<void> {
    const model = await loadHelmetModel(this.renderer);
    const { merged, size } = model;
    const longest = Math.max(size.x, size.y, size.z) || 1;

    /* The lit helmet.
     *
     * Each shared material gets the reveal mask spliced in at the top of its
     * fragment shader: where the fluid is still, the fragment is discarded
     * before any lighting runs. That is the reference's
     * `mix(base, helmet, cursorEffect * helmet.a)` with a binary cursorEffect,
     * done in place rather than through a second full-screen render target --
     * same pixels, one pass fewer.
     */
    const maskU = this.maskU;
    merged.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      // After the portrait, whatever list the material lands in.
      mesh.renderOrder = 3;
      const material = mesh.material as THREE.Material;
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, maskU);
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            ${revealChunk}
            uniform float uCursorIntensity;
            uniform float uShowHelmet;`,
          )
          .replace(
            'void main() {',
            `void main() {
              vec2 revealUv = gl_FragCoord.xy / uResolution;
              float revealed = clamp((cursorEffectAt(revealUv) + helmetHoverAt(revealUv)) * uCursorIntensity, 0.0, 1.0);
              if (max(revealed, uShowHelmet) < 0.5) discard;`,
          )
          /* The inside of the shell is black, as it is on the reference, whose
             helmet shader paints every back face vec3(0.0). Seen head-on, the
             inside is what shows through the visor, and painted it reads as
             the livery printed backwards; black, it reads as a dark visor. */
          .replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
            if (!gl_FrontFacing) gl_FragColor.rgb = vec3(0.0);`,
          );
      };
      material.customProgramCacheKey = () => 'hero-helmet-reveal';
    });

    /* The resting wireframe: every kept part merged into ONE mesh by position
     * alone, so the whole shell is a single draw call. The reference does the
     * same (its wireframeMesh is mergeGeometries over the model's parts). */
    const parts: THREE.BufferGeometry[] = [];
    merged.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const shape = new THREE.BufferGeometry();
      shape.setAttribute('position', mesh.geometry.getAttribute('position'));
      const index = mesh.geometry.getIndex();
      if (index) shape.setIndex(index);
      parts.push(shape);
    });
    const wireGeometry = mergeGeometries(parts, false);
    if (!wireGeometry) throw new Error('[hero] helmet wireframe merge failed');
    wireGeometry.computeBoundingBox();
    const bounds = wireGeometry.boundingBox as THREE.Box3;

    const wireU = makeWireUniforms(
      new THREE.Vector2(bounds.min.z, bounds.max.z),
      // The page's cream, as the line colour: the reference's black, inverted.
      tokenColor(getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#f0ebe9'),
    );
    const wireMaterial = new THREE.ShaderMaterial({
      vertexShader: wireVertex,
      fragmentShader: wireFragment,
      uniforms: wireU,
      wireframe: true,
      transparent: true,
      depthWrite: false,
    });
    const wireMesh = new THREE.Mesh(wireGeometry, wireMaterial);
    // Same offset the lit model carries, so the two are the same object.
    wireMesh.position.copy(merged.position);
    // After the portrait, so the half of the shell behind the head plane is
    // hidden by the head, as the reference's is.
    wireMesh.renderOrder = 2;

    /* One stack per drawing, identical but for depth:
     *
     *   root  (placement, screen-axis stretch)
     *     pose  (tilt, and the turn toward the pointer)
     *       upright  (authored z-up -> y-up, longest side 1)
     *         model
     *
     * The wire sits centred on the portrait plane, so its back half is behind
     * the head -- the reference's arrangement. The lit helmet sits wholly in
     * front of the plane, so the head never cuts into it and the visor shows
     * the helmet's own dark interior, as the reference's opaque visor does.
     * The camera is orthographic, so the two project identically. */
    const stack = (content: THREE.Object3D): { root: THREE.Group; pose: THREE.Group } => {
      const upright = new THREE.Group();
      upright.rotation.copy(HELMET_UPRIGHT);
      upright.scale.setScalar(1 / longest);
      upright.add(content);
      const pose = new THREE.Group();
      pose.add(upright);
      const root = new THREE.Group();
      root.add(pose);
      this.scene.add(root);
      return { root, pose };
    };
    const litStack = stack(merged);
    const wireStack = stack(wireMesh);

    const environment = createStudioEnvironment(this.renderer);
    this.scene.environment = environment;

    this.helmet = {
      model,
      lit: litStack.root,
      litPose: litStack.pose,
      wire: wireStack.root,
      wirePose: wireStack.pose,
      wireMesh,
      wireMaterial,
      wireU,
      environment,
      longest,
    };
    this.applyStill();
    this.fitHelmet();
  }

  /** Place the helmet over the head, and aim the neck shadow at it. */
  fitHelmet(): void {
    const rig = this.helmet;
    if (!rig) return;
    const { size, width, height, tilt } = this.helmetFit;
    const S = this.portraitHeight;

    for (const root of [rig.lit, rig.wire]) {
      root.scale.set(size * S * width, size * S * height, size * S);
    }
    /* Depth. The wire straddles the plane; the lit helmet sits a whole model
       length in front of it, so its back is still ahead of the wire's front
       and no scan line can show through the visor. Orthographic, so this moves
       nothing on screen. */
    rig.lit.position.z = size * S * 1.1;
    rig.wire.position.z = 0;
    this.placeHelmet();
    rig.litPose.rotation.set(tilt, 0, 0);
    rig.wirePose.rotation.set(tilt, 0, 0);

    /* Where the helmet's lower rim lands on the portrait, for the neck shadow.
       Measured off the fitted helmet itself rather than derived, so it holds
       whatever the fit. */
    rig.lit.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig.lit);
    const planeW = S * this.aspect;
    this.headU.uShadowRim.value = (box.min.y - this.headBase.y) / S + 0.5;
    this.headU.uShadowCentre.value = ((box.min.x + box.max.x) / 2 - this.headBase.x) / planeW + 0.5;
    // Half the helmet's width across, and its full height as the depth unit.
    this.headU.uShadowSize.value.set((box.max.x - box.min.x) / 2 / planeW, ((box.max.y - box.min.y) / S) * 0.3);
  }

  /** Put both helmet stacks on the head, wherever the head has drifted to. */
  private placeHelmet(): void {
    const rig = this.helmet;
    if (!rig) return;
    const S = this.portraitHeight;
    const px = this.headMesh.position.x + this.helmetFit.x * S;
    const py = this.headMesh.position.y + this.helmetFit.y * S;
    rig.lit.position.x = px;
    rig.lit.position.y = py;
    rig.wire.position.x = px;
    rig.wire.position.y = py;
  }

  /**
   * Drive the fluid from the reference's idle path while the pointer is still.
   *
   * Only the FLUID is driven, never the pointer the portrait and the contours
   * follow: on the reference the head sits still through the idle sequence
   * and only the mask moves.
   */
  private runIdle(dt: number): void {
    if (reducedMotion) return;
    this.stillFor += dt;
    const wait = this.moved ? this.idleAfterMove : this.idleAfterLoad;
    if (this.idleTime < 0) {
      if (this.stillFor < wait) return;
      this.idleTime = 0;
    }

    const T = HeadScene.IDLE_TEMPO;
    const sweep = 2.5 / T;
    const backAt = 4 / T;
    const cycle = (6.5 + 3) / T;
    const t = this.idleTime % cycle;
    this.idleTime += dt;

    // power1.inOut, GSAP's: a quadratic in, a quadratic out.
    const inOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
    let px: number;
    let py: number;
    if (t < sweep) {
      py = t / sweep;
      px = inOut(t / sweep);
    } else if (t < backAt) {
      py = 1;
      px = 1;
    } else if (t < backAt + sweep) {
      py = 1 - (t - backAt) / sweep;
      px = 1 - inOut((t - backAt) / sweep);
    } else {
      py = 0;
      px = 0;
    }

    this.idleCursor.set(-Math.cos(px * Math.PI * 4) * 0.75, Math.cos(py * Math.PI) * 0.5);
    this.fluid.setPointer((this.idleCursor.x + 1) / 2, (this.idleCursor.y + 1) / 2);
  }

  setPointer(nx: number, ny: number): void {
    // Any real movement hands the fluid back to the pointer at once, including
    // mid-sweep, so the visitor's own gesture never fights an automatic one.
    this.stillFor = 0;
    this.moved = true;
    this.idleTime = -1;

    this.pointerTarget.set(nx, ny);
    // Raw, not eased: the fluid takes its force from how fast the pointer is
    // actually moving, so smoothing first would flatten every flick.
    this.fluid.setPointer((nx + 1) / 2, (ny + 1) / 2);
    this.contour.setPointer(nx, ny);
  }

  /**
   * Reveal the whole helmet, or put it away — the reference's hover on its
   * next-race card. A bowed wipe up the screen (1.5s in, 1s out, expo.inOut),
   * while the helmet eases square-on and stops following the pointer.
   */
  setHelmetHover(on: boolean): void {
    const instant = reducedMotion;
    gsap.to(this.hover, {
      wipe: on ? 1 : 0,
      duration: instant ? 0 : on ? 1.5 : 1,
      ease: 'expo.inOut',
      overwrite: 'auto',
    });
    gsap.to(this.hover, {
      follow: on ? 0 : 1,
      duration: instant ? 0 : on ? 1.5 : 1,
      ease: 'power1.inOut',
      overwrite: 'auto',
    });
  }

  set parallax(v: number) {
    this.headU.uParallax.value = v;
  }

  /**
   * Draw the contour field behind the portrait, or don't. Toggling `visible`
   * skips the draw entirely rather than blending a transparent one.
   */
  set fieldVisible(v: boolean) {
    this.fieldMesh.visible = v;
  }

  /**
   * Collapse the plate to a still picture — the end state the reference lands
   * on: flat ground, face on it, no contours, no helmet, nothing moving.
   *
   * The helmet does not cut out. As on the reference, the reveal
   * (uCursorIntensity) and the wireframe (uOpacity) fade to nothing over a
   * quarter second, and only then does the scene stop simulating. Scrolling
   * back brings them back the same way.
   */
  set inert(v: boolean) {
    if (this.goingStill === v) return;
    this.goingStill = v;
    const fade = { duration: reducedMotion ? 0 : 0.25, ease: 'power1.inOut', overwrite: 'auto' as const };

    if (v) {
      gsap.to(this.fieldU.uCursorIntensity, { ...fade, value: 0, onComplete: () => this.applyStill() });
      if (this.helmet) gsap.to(this.helmet.wireU.uOpacity, { ...fade, value: 0 });
    } else {
      this.applyStill();
      gsap.to(this.fieldU.uCursorIntensity, { ...fade, value: 1 });
      if (this.helmet) gsap.to(this.helmet.wireU.uOpacity, { ...fade, value: 1 });
    }
  }

  /** Bring the scene in line with `goingStill` — see `set inert`. */
  private applyStill(): void {
    this.still = this.goingStill;
    this.fieldMesh.visible = !this.still;
    if (this.helmet) {
      this.helmet.lit.visible = !this.still;
      this.helmet.wire.visible = !this.still;
    }
  }

  /**
   * Drain the portrait's colour as the plate closes, 1 down to 0. In the
   * shader rather than as a CSS filter, which would cost a full-viewport
   * filter pass every frame of the scrub.
   */
  set saturation(v: number) {
    this.headU.uSaturation.value = v;
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
    this.portraitHeight = scale;
    this.headMesh.scale.set(scale * this.aspect, scale, 1);

    // Bottom edge on the bottom of the hero, so the subject stands in frame
    // rather than floating in it; nudged right of centre to break symmetry.
    this.headBase.set(0.08, -1 + scale / 2);
    this.headMesh.position.set(this.headBase.x, this.headBase.y, 0);

    this.fieldMesh.scale.set(view * 2, 2, 1);
  }

  resize(dpr = Math.min(window.devicePixelRatio, 2)): void {
    const view = window.innerWidth / window.innerHeight;
    this.fluid.setSize(window.innerWidth, window.innerHeight);
    // CSS pixels, not device — the noise target's texel size IS the contour
    // line weight, so this is a visual decision rather than a quality one.
    this.contour.setSize(window.innerWidth, window.innerHeight);
    // gl_FragCoord is in device pixels, so the divisor carries the DPR.
    this.viewportPx.set(window.innerWidth * dpr, window.innerHeight * dpr);
    this.camera.left = -view;
    this.camera.right = view;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();

    this.layout();
    this.fitHelmet();
  }

  update(): void {
    /* CLAMPED. rAF does not fire in a background tab, so the first frame back
     * would otherwise integrate the whole gap: the intro would be over and the
     * idle sweep would teleport. A 15fps frame is the ceiling; longer is a gap,
     * not a frame, and a gap should not be integrated. */
    const dt = Math.min(this.clock.getDelta(), 1 / 15);
    const t = this.clock.getElapsedTime();

    /* A still picture is one that is not being simulated. getDelta() above
       still runs, so the clock does not bank the gap for when the plate
       reopens. */
    if (this.still) return;

    // The idle path is fed in before the step that consumes it.
    this.runIdle(dt);
    this.fluid.update(dt);
    this.contour.update(t);

    if (this.intro < 1) {
      this.intro = Math.min(this.intro + 0.012, 1);
      this.headU.uIntro.value = this.intro;
    }

    // REVEAL_DURATION is in seconds, so this runs off the clock rather than a
    // per-frame increment. Cubic ease-out: the reference's UV window is
    // divided by (1 + REVEAL_SIZE * (1 - uReveal)), which is violently
    // non-linear near 0, and a linear ramp would sit still and then snap.
    if (this.reveal < 1) {
      this.reveal = Math.min(this.reveal + dt / this.revealDuration, 1);
      const eased = 1 - Math.pow(1 - this.reveal, 3);
      this.contour.reveal = eased;
      this.fieldU.uReveal.value = eased;
    }

    this.revealU.tCursorEffect.value = this.fluid.texture;
    this.revealU.uHelmetHover.value = this.hover.wipe;

    // Exponential smoothing on the portrait's pointer.
    this.pointer.lerp(this.pointerTarget, this.ease);
    this.headMesh.position.x = this.headBase.x + this.pointer.x * this.imageShift * this.hover.follow;
    this.headMesh.position.y = this.headBase.y + this.pointer.y * this.imageShift * 0.6 * this.hover.follow;

    const rig = this.helmet;
    if (rig) {
      this.placeHelmet();

      /* The helmet turns toward the pointer, as the reference's does: its head
       * turns 0.075 rad at full reach and the helmet copies that at 1/1.5,
       * eased at 0.025 a frame. The hover takes the follow to zero. */
      const k = 1 - Math.pow(1 - 0.025, dt * 60);
      this.helmetPointer.lerp(this.pointerTarget, k);
      const reach = (0.075 / 1.5) * this.hover.follow;
      const turnY = this.helmetPointer.x * reach;
      const turnX = this.helmetFit.tilt - this.helmetPointer.y * reach;
      rig.litPose.rotation.set(turnX, turnY, 0);
      rig.wirePose.rotation.set(turnX, turnY, 0);

      rig.wireU.uTime.value = t;
      rig.wireU.uIsWireframeAnimating.value = this.params.IS_WIREFRAME_ANIMATING;
      this.maskU.uShowHelmet.value = this.params.SHOW_HELMET_PERMANENTLY ? 1 : 0;
    }
  }

  /**
   * Release everything this scene owns. Nothing calls it yet — the page never
   * tears the hero down — so this is for when navigation starts swapping
   * scenes. Kept complete, because a half-written dispose looks handled.
   */
  dispose(): void {
    this.fieldMesh.geometry.dispose();
    this.headMesh.geometry.dispose();
    for (const map of [this.headU.uDiffuse, this.headU.uDepth, this.headU.uAlpha]) {
      map.value?.dispose();
    }
    if (this.helmet) {
      this.helmet.model.dispose();
      this.helmet.wireMesh.geometry.dispose();
      this.helmet.wireMaterial.dispose();
      this.helmet.environment.dispose();
    }
    this.fluid.dispose();
    this.contour.dispose();
    this.field.dispose();
    this.head.dispose();
  }
}
