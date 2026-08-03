import * as THREE from 'three';

import { ContourField } from './ContourField';
import { fieldFragment, quadVertex } from './HeadScene';

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

  /** Noise steps at 30Hz. See update(). */
  private static readonly NOISE_INTERVAL = 1 / 30;
  private lastNoiseStep = -Infinity;

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
      },
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    // The quad is the viewport, so culling it is never right.
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
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
   * Step the noise, at 30Hz rather than every frame.
   *
   * Pass one evaluates a three-octave simplex over the whole viewport and is
   * the most expensive thing on this layer. The field drifts at SPEED 0.1 — ten
   * seconds to travel one noise cell — so halving its rate is not perceivable.
   * Pass two still traces every frame, so nothing judders.
   *
   * Not applied to the hero's field, which sits under a moving cursor.
   */
  update(): void {
    const now = this.clock.getElapsedTime();
    if (now - this.lastNoiseStep < BackgroundField.NOISE_INTERVAL) return;
    this.lastNoiseStep = now;
    this.contour.update(now);
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
