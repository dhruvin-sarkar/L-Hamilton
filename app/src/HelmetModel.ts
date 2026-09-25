import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The helmet, as one object shared by every scene that draws it: the flight
 * through the top of /on-track and the reveal over the face in the home hero.
 *
 * One loader, one set of materials, one light. The two scenes differ only in
 * where they put the helmet and what they do with it, so everything that makes
 * it look like this helmet lives here and nowhere else.
 */

/**
 * GLB, not glTF + external .bin, and this is functional rather than cosmetic.
 *
 * A separate `buffer.bin` is served as `application/octet-stream`, exactly what
 * download managers (IDM and friends) intercept: the page then receives an
 * empty 204 and GLTFLoader fails with "Failed to load buffer", while curl and a
 * cache-busted URL both succeed. A .glb is one request served as
 * model/gltf-binary, which those tools leave alone.
 */
const HELMET_URL = '/assets/helmet/helmet.glb';
const DRACO_PATH = '/assets/draco/';
const MAPS = '/assets/helmet/textures/';

/**
 * The file carries two liveries. Its own 300-odd flat-coloured decal meshes
 * make a purple one; underneath them, the bare shell (`__DEFAULT`) is UV-mapped
 * to the black-and-gold sheet supplied with it, and the fins to its wing sheet.
 * The black and gold is the one drawn -- the nearest thing this helmet has to
 * the reference's gold-and-black chrome -- so only the shell, the fins and the
 * parts both liveries share are kept: visor, seals, vents and the visor pivots.
 * Everything else is the purple decal layer, left out.
 */
const SHARED_PARTS = new Set([
  'Nuovo materiale 001', // the visor
  'NERO GUARNIZ', // visor and neck seals
  'NERO PLATIC', // vents
  'ORO', // visor pivot hardware
  'GRIG METALLO',
  'VIOLA METALLO',
]);

/**
 * Authored Z-up with the face on -y. -90 degrees about X is the single rotation
 * that brings the crown up out of -z AND swings the -y face round to +z, the
 * camera. Apply it to a group holding `HelmetModel.merged`.
 */
export const HELMET_UPRIGHT = new THREE.Euler(-Math.PI / 2, 0, 0);

export interface HelmetModel {
  /**
   * Every kept part, merged by material into a handful of meshes and centred
   * on the centre of its bounds. Still in AUTHORED axes (z up, face on -y):
   * orient it with HELMET_UPRIGHT on a parent.
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
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const texture = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  return texture;
}

/**
 * Load the helmet and build its materials.
 *
 * 470 meshes arrive and are merged by material into one mesh per distinct
 * look, because 470 draw calls cost more than the rest of either scene put
 * together. Each part's world transform is baked into its vertices first --
 * merging throws the scene graph away, and a part that does not carry its own
 * placement collapses onto the origin.
 */
export async function loadHelmetModel(renderer: THREE.WebGLRenderer): Promise<HelmetModel> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(HELMET_URL);
  // The decoder holds a worker pool, and nothing else on either page is Draco.
  draco.dispose();

  const textures = new THREE.TextureLoader();
  const sheet = (file: string): THREE.Texture => {
    const tex = textures.load(`${MAPS}${file}`);
    tex.flipY = false; // glTF UVs start top-left
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
  };
  const sheets: Readonly<Record<string, THREE.Texture>> = {
    __DEFAULT: sheet('helmet_d.webp'),
    ALETTE: sheet('wing_d.webp'),
  };

  const source = gltf.scene;
  source.updateMatrixWorld(true);
  const buckets = new Map<string, { material: THREE.Material; parts: THREE.BufferGeometry[] }>();

  source.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const from = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | THREE.MeshStandardMaterial
      | undefined;
    const name = from?.name ?? '';
    const map = sheets[name] ?? null;
    if (!map && !SHARED_PARTS.has(name)) return; // the purple decal layer

    const colour = from?.color?.clone() ?? new THREE.Color(0x8a8a8a);
    // A painted sheet is paint: opaque, whatever alpha its flat colour had.
    const opacity = map ? 1 : (from?.opacity ?? 1);
    const key = `${colour.getHexString()}|${opacity}|${map ? map.uuid : '-'}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      /* Lacquered paint: gold ink that catches the light as metal does, over a
         black that only the clearcoat reflects -- so the environment slides
         across the helmet as it moves, which is what makes the shape legible. */
      const material = new THREE.MeshPhysicalMaterial({
        color: map ? 0xffffff : colour,
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
      bucket = { material, parts: [] };
      buckets.set(key, bucket);
    }
    bucket.parts.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  });
  // The loader's own copies, decal layer included, are finished with.
  source.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  const merged = new THREE.Group();
  for (const { material, parts } of buckets.values()) {
    const geometry = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    // Fail loudly: a silent skip would drop part of the shell and read as a
    // modelling fault rather than a merge fault.
    if (!geometry) throw new Error('[helmet] merge failed -- mismatched vertex attributes');
    const mesh = new THREE.Mesh(geometry, material);
    // See-through parts after the opaque shell, or the fins hide what is behind them.
    mesh.renderOrder = material.transparent ? 1 : 0;
    merged.add(mesh);
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
