import * as THREE from 'three';

import { ContourField } from './ContourField';
import { fieldFragment, quadVertex } from './HeadScene';

/**
 * The revealed screen behind the shrinking hero.
 *
 * This is the SAME contour field the hero draws, in the inverse palette — the
 * reference confirms it directly. Read off the running site, its
 * `landoGL.params` carries a `backgroundScene` whose THICKNESS and OUTLINE are
 * identical to `headScene`'s, and whose only differences are the four colours:
 *
 *     headScene        BACKGROUND #F8F8F3  OUTLINE #CBCBB9    (light ground)
 *     backgroundScene  BACKGROUND #282c20  FOREGROUND #363B25 (dark ground)
 *
 * So this is not a lookalike built to sit behind the hero. It is pass two of
 * the same two-pass field, pointed at its own noise and given the other set of
 * colours — which is why the topography reads as continuous when the hero
 * closes over it.
 *
 * WHY IT IS ITS OWN CANVAS
 *
 * The two marquee bands sit BETWEEN this field and the hero plate: the plate
 * occludes them, they occlude this. Three layers, and the middle one is DOM
 * text — which has to stay DOM text, because it is real copy a screen reader
 * has to reach. A single canvas cannot interleave with a DOM element, so the
 * sandwich forces two compositing layers. The reference dodges this by drawing
 * its marquee in GL too (`landoGL.params.carouselScene` carries TEXT_TOP and
 * TEXT_BOTTOM as strings), and pays for it with text no assistive technology
 * can reach. Not a trade worth copying.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No fluid. The hero's cursor blob is a full fluid solve with 20 pressure
 * iterations per frame, and running a second one for a background layer would
 * roughly double the per-frame GPU cost of the page to add an effect that is,
 * on the reference's own near-tonal background palette, close to invisible.
 * The field still answers the pointer — ContourField distorts its own noise by
 * cursor position and pace, so the topography swims under the cursor — it just
 * does not carry the second, blob-shaped palette on top. `tCursorEffect` is fed
 * a flat white texel, which is the fluid's REST value, so the blob term in the
 * shader resolves to exactly zero rather than being branched around.
 */
export class BackgroundField {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  private readonly renderer: THREE.WebGLRenderer;
  private readonly contour: ContourField;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly clock = new THREE.Clock();

  /** The fluid's resting value. See the class note on tCursorEffect. */
  private readonly restTexture: THREE.DataTexture;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.contour = new ContourField(renderer);

    // Pass one is already fully revealed here. The hero earns its topography
    // with an intro wipe; this screen is uncovered mid-scroll and has to be
    // complete the instant it is first seen behind the shrinking plate.
    this.contour.reveal = 1;

    // 1x1 white. The fluid's velocity-to-colour target RESTS at white and
    // darkens where it moves, so white means "perfectly still" — the shader's
    // step(0.1, 1.0 - sampled) then returns 0 and the blob contributes nothing.
    // Feeding black here would light the entire screen with the cursor palette.
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

    this.material = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: fieldFragment,
      uniforms: {
        tBackgroundNoise: { value: this.contour.texture },
        tCursorEffect: { value: this.restTexture },

        OUTLINE: { value: true },
        // The reference's epsilon, unchanged, and shared with the hero. This is
        // not a line width — see ContourField.
        THICKNESS: { value: 0.000005 },

        COLOR_BACKGROUND: { value: ground },
        // Unused while OUTLINE is on: the outline branch REPLACES the filled
        // colouring rather than adding to it. Set to the line colour anyway, so
        // toggling OUTLINE off from the console shows filled contours in the
        // right hue rather than a flat screen.
        COLOR_FOREGROUND: { value: line },
        COLOR_OUTLINE: { value: line },

        // No fluid, so the blob term is dead. Matched to the base palette so
        // that if one is ever wired up it starts from a sane place.
        COLOR_CURSOR_BACKGROUND: { value: ground },
        COLOR_CURSOR_FOREGROUND: { value: line },
        COLOR_CURSOR_OUTLINE: { value: line },

        uReveal: { value: 1 },
        uCursorIntensity: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    // The quad IS the viewport by construction, so culling it can only ever be
    // wrong — and is, on the frame the camera bounds are recomputed.
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** Pointer in -1..1, y up — the same convention `HeadScene.setPointer` takes. */
  setPointer(nx: number, ny: number): void {
    this.contour.setPointer(nx, ny);
  }

  resize(): void {
    // CSS pixels, not device pixels, and for the same reason as the hero's:
    // line weight IS this target's texel size. See ContourField.setSize.
    this.contour.setSize(window.innerWidth, window.innerHeight);
  }

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
