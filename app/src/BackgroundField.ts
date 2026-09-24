import * as THREE from 'three';

import { ContourField } from './ContourField';
import { fieldFragment, quadVertex } from './HeadScene';

/** Straight sRGB components, 0..1. See the palette fields for why not a Color. */
type RGB = readonly [number, number, number];

/** Pull a Color's components back out in sRGB, undoing three's linear working space. */
function srgb(c: THREE.Color): RGB {
  const out = c.clone().convertLinearToSRGB();
  return [out.r, out.g, out.b];
}

/**
 * The screen revealed behind the hero once it shrinks to a plate.
 *
 * Same two-pass contour field as the hero, in the inverse palette. The
 * reference does the same: its `backgroundScene` shares `headScene`'s THICKNESS
 * and OUTLINE and differs only in colour.
 *
 * It needs its own canvas because the marquee bands sit between this and the
 * plate, and they are DOM text. One canvas cannot interleave with a DOM
 * element. (The reference draws its marquee in GL instead, which costs it text
 * a screen reader can reach.)
 *
 * No fluid here. The hero's cursor blob is a full fluid solve; a second one for
 * a background layer would roughly double the page's per-frame GPU cost for an
 * effect that is barely visible on a near-tonal palette. The field still
 * answers the pointer through ContourField's own noise distortion.
 */
export class BackgroundField {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  private readonly renderer: THREE.WebGLRenderer;
  private readonly contour: ContourField;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly clock = new THREE.Clock();
  private readonly restTexture: THREE.DataTexture;

  /** Ground and line, at each end of the darkening. sRGB components, 0..1. */
  private readonly lightPalette: [RGB, RGB];
  private readonly darkPalette: [RGB, RGB];
  /** The live uniforms, held by reference so a write lands in the shader. */
  private groundUniform!: THREE.Color;
  private lineUniform!: THREE.Color;
  private darkAmount = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.contour = new ContourField(renderer);

    // No intro wipe. This screen is uncovered mid-scroll and has to be complete
    // the first time it is seen.
    this.contour.reveal = 1;

    /* The fluid's colour target rests at WHITE and darkens where it moves, so a
       white texel means "still" and the shader's blob term resolves to zero.
       Black here would light the whole screen with the cursor palette. */
    this.restTexture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    this.restTexture.needsUpdate = true;

    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      new THREE.Color(css.getPropertyValue(name).trim() || fallback);

    const ground = token('--gl-rev-bg', '#f7f3f1');
    const line = token('--gl-rev-outline', '#f08d78');

    /* The two ends of the darkening, stored as sRGB components rather than as
     * Colors.
     *
     * three converts a hex into its linear working space, and lerping there
     * takes a different path between two colours than lerping the channels you
     * can read off a screen. The reference interpolates in plain sRGB — checked
     * against its own mid-transition values, where all three channels agree on
     * the same t — so this matches it by keeping the raw components and writing
     * back through setRGB with an explicit colour space. */
    this.lightPalette = [srgb(ground), srgb(line)];
    this.darkPalette = [
      srgb(token('--gl-bg', '#241b1e')),
      srgb(token('--gl-outline', '#9c6a71')),
    ];

    this.material = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: fieldFragment,
      uniforms: {
        tBackgroundNoise: { value: this.contour.texture },
        tCursorEffect: { value: this.restTexture },

        OUTLINE: { value: true },
        // The reference's epsilon. Not a line width — see ContourField.
        THICKNESS: { value: 0.000005 },

        COLOR_BACKGROUND: { value: ground },
        // Unused while OUTLINE is on, since the outline branch replaces the
        // filled colouring. Set anyway so toggling OUTLINE off from the console
        // gives the right hue.
        COLOR_FOREGROUND: { value: line },
        COLOR_OUTLINE: { value: line },

        // No fluid, so the blob term is dead. Matched to the base palette.
        COLOR_CURSOR_BACKGROUND: { value: ground },
        COLOR_CURSOR_FOREGROUND: { value: line },
        COLOR_CURSOR_OUTLINE: { value: line },

        uReveal: { value: 1 },
        uCursorIntensity: { value: 0 },
        // The hero's helmet-hover wipe. This screen has no helmet, so never.
        uHelmetHover: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    /* These two ARE the uniform values — the map above assigns the Color
       objects themselves, not copies — so writing into them lands in the
       shader. Held from the consts rather than dug back out of
       material.uniforms, which would need a cast and a non-null assertion to
       say something already known here.

       One object covers several uniforms: `ground` is both COLOR_BACKGROUND and
       COLOR_CURSOR_BACKGROUND, and `line` is the foreground, the outline and
       both cursor equivalents. That is deliberate — the whole palette should
       cross together, not just the parts that happen to be visible. */
    this.groundUniform = ground;
    this.lineUniform = line;

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    // The quad is the viewport, so culling it is never right.
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /**
   * How far the field has crossed back to the hero's dark palette, 0..1.
   *
   * The gallery scrolls sideways over this layer and takes the ground with it,
   * light back to black and red. A fade rather than a switch, and it is the
   * FIELD that changes rather than something painted over it — so the contour
   * lines cross with their own ground and the topography never disappears
   * behind a tint.
   */
  set darkness(t: number) {
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    if (clamped === this.darkAmount) return;
    this.darkAmount = clamped;

    const mix = (from: RGB, to: RGB, target: THREE.Color) => {
      target.setRGB(
        from[0] + (to[0] - from[0]) * clamped,
        from[1] + (to[1] - from[1]) * clamped,
        from[2] + (to[2] - from[2]) * clamped,
        THREE.SRGBColorSpace,
      );
    };

    mix(this.lightPalette[0], this.darkPalette[0], this.groundUniform);
    mix(this.lightPalette[1], this.darkPalette[1], this.lineUniform);
  }

  /** Pointer in -1..1, y up. Same convention as HeadScene.setPointer. */
  setPointer(nx: number, ny: number): void {
    this.contour.setPointer(nx, ny);
  }

  resize(): void {
    // CSS pixels, not device pixels: line weight is this target's texel size.
    // See ContourField.setSize.
    this.contour.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Step the noise, every frame, exactly as the hero's field does.
   *
   * This was throttled to 30Hz. Both passes together measure 0.015ms, so the
   * throttle bought 0.008ms and cost the field half its frame rate — visible as
   * stutter in the drift and lag in the cursor response, on the layer that
   * carries the whole screen once the hero has closed.
   */
  update(): void {
    this.contour.update(this.clock.getElapsedTime());
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.contour.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.restTexture.dispose();
  }
}
