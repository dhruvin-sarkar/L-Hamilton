import * as THREE from 'three';
import { uploadAcrossFrames } from './lib/upload';

/**
 * The helmet, as one object shared by every scene that draws it: the flight
 * through the top of /on-track and the reveal over the face in the home hero.
 *
 * One loader, one set of materials, one light. The two scenes differ only in
 * where they put the helmet and what they do with it, so everything that makes
 * it look like this helmet lives here and nowhere else.
 *
 * The loaders are imported on demand, not up front: neither page needs them
 * until the helmet is asked for, which is after its first paint.
 */

/**
 * GLB, not glTF + external .bin, and this is functional rather than cosmetic.
 *
 * A separate `buffer.bin` is served as `application/octet-stream`, exactly what
 * download managers (IDM and friends) intercept: the page then receives an
 * empty 204 and GLTFLoader fails with "Failed to load buffer", while curl and a
 * cache-busted URL both succeed. A .glb is one request served as
 * model/gltf-binary, which those tools leave alone.
 *
 * Baked by tools/bake-helmet.mjs: the supplied model's purple decal layer is
 * already gone, and what is left arrives as one mesh per material -- the shell
 * and the fins, UV-mapped to the black-and-gold sheets below, and the parts
 * both liveries share (visor, seals, vents, visor pivots) in flat colour.
 */
const HELMET_URL = '/assets/helmet/helmet.glb';
const DRACO_PATH = '/assets/draco/';
const MAPS = '/assets/helmet/textures/';

/**
 * Authored Z-up with the face on -y. -90 degrees about X is the single rotation
 * that brings the crown up out of -z AND swings the -y face round to +z, the
 * camera. Apply it to a group holding `HelmetModel.merged`.
 */
export const HELMET_UPRIGHT = new THREE.Euler(-Math.PI / 2, 0, 0);

export interface HelmetModel {
  /**
   * The helmet, one mesh per distinct material, centred on the centre of its
   * bounds. Still in AUTHORED axes (z up, face on -y): orient it with
   * HELMET_UPRIGHT on a parent.
   */
  readonly merged: THREE.Group;
  /** Size of the bounds, in authored axes. */
  readonly size: THREE.Vector3;
  /** Release the geometry, materials and livery sheets. */
  dispose(): void;
}

/**
 * The studio light both scenes use: a generated room, prefiltered for PBR.
 * Owned by the caller, who disposes it.
 *
 * The reference lights its helmet with an HDRI of its own; that file is its
 * artwork and not ours to ship, so this is three's procedural room instead.
 */
export async function createStudioEnvironment(renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const texture = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  return texture;
}

/** Load the helmet and give it its materials. */
export async function loadHelmetModel(renderer: THREE.WebGLRenderer): Promise<HelmetModel> {
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
  ]);
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco);

  const textures = new THREE.TextureLoader();
  const sheet = (file: string): Promise<THREE.Texture> =>
    textures.loadAsync(`${MAPS}${file}`).then((tex) => {
      tex.flipY = false; // glTF UVs start top-left
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return tex;
    });

  // Model and sheets download together; the sheets then go up a frame apiece.
  const [gltf, helmetSheet, wingSheet] = await Promise.all([
    loader.loadAsync(HELMET_URL),
    sheet('helmet_d.webp'),
    sheet('wing_d.webp'),
  ]);
  // The decoder holds a worker pool, and nothing else on either page is Draco.
  draco.dispose();
  await uploadAcrossFrames(renderer, [helmetSheet, wingSheet]);

  const sheets: Readonly<Record<string, THREE.Texture>> = {
    __DEFAULT: helmetSheet,
    ALETTE: wingSheet,
  };

  const merged = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const from = mesh.material as THREE.MeshStandardMaterial;
    const map = sheets[from.name] ?? null;
    // A painted sheet is paint: opaque, whatever alpha its flat colour had.
    const opacity = map ? 1 : from.opacity;
    /* Lacquered paint: gold ink that catches the light as metal does, over a
       black that only the clearcoat reflects -- so the environment slides
       across the helmet as it moves, which is what makes the shape legible. */
    const material = new THREE.MeshPhysicalMaterial({
      color: map ? 0xffffff : from.color,
      map,
      metalness: map ? 0.5 : 0.4,
      roughness: map ? 0.18 : 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.5,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    });
    from.dispose();
    const part = new THREE.Mesh(mesh.geometry, material);
    // See-through parts after the opaque shell, or the fins hide what is behind them.
    part.renderOrder = material.transparent ? 1 : 0;
    merged.add(part);
  }

  const box = new THREE.Box3().setFromObject(merged);
  const size = box.getSize(new THREE.Vector3());
  merged.position.sub(box.getCenter(new THREE.Vector3()));

  return {
    merged,
    size,
    dispose() {
      merged.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      for (const tex of Object.values(sheets)) tex.dispose();
    },
  };
}
