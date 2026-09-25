import type * as THREE from 'three';

/**
 * Put textures on the GPU one per animation frame, before anything draws them.
 *
 * A texture's first upload -- the image decode and the texImage call -- runs
 * synchronously inside whichever draw first samples it. Left to that, every map
 * a scene uses lands in its first frame, and that one frame carries all of them
 * at once. Uploaded here instead, each frame carries at most one.
 */
export async function uploadAcrossFrames(
  renderer: THREE.WebGLRenderer,
  textures: readonly THREE.Texture[],
): Promise<void> {
  for (const texture of textures) {
    renderer.initTexture(texture);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}
