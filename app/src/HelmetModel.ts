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
 * The strip lights of the studio, as [azimuth, elevation, width, height,
 * radiance]. Azimuth in degrees round the helmet from the camera (0) towards
 * its right; elevation in degrees above the horizon; size in world units at
 * STUDIO_RADIUS; radiance in linear units, where the room itself is well
 * under 1.
 *
 * Long and narrow on purpose. A polished surface shows its surroundings, and a
 * strip reads on it as a sharp line of light that slides across the shell as
 * the helmet turns -- which is what says "metal" rather than "plastic".
 */
const STRIPS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [-38, 8, 0.7, 9, 24], // key, front left, standing
  [52, 4, 0.45, 8, 12], // fill, front right, standing
  [168, 10, 0.6, 9, 20], // rim, behind
  [-115, 0, 0.35, 7, 8], // side kicker, back left
];
/** And one across the ceiling, for a line along the crown. */
const CROWN_STRIP = { length: 11, width: 0.8, height: 7, depth: 1.2, radiance: 16 };
const STUDIO_RADIUS = 9;

/**
 * The studio light both scenes use: a dim room with a few strip lights,
 * prefiltered for PBR. Built once, owned by the caller, who disposes it.
 *
 * Ours, generated here: the reference lights its helmet with an HDRI of its
 * own, which is its artwork and not ours to ship, and a downloaded HDRI would
 * bring a licence nobody has checked.
 */
export async function createStudioEnvironment(renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  const studio = new THREE.Scene();
  const disposables: Array<{ dispose(): void }> = [];
  const lit = (radiance: number): THREE.MeshBasicMaterial => {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    // Above 1 on purpose: PMREM keeps the range, and tone mapping brings it home.
    material.color.setScalar(radiance);
    disposables.push(material);
    return material;
  };

  /* The room: dim at the floor, lifting towards the ceiling. It is what the
     black paint shows between the lights, and the fill that keeps the gold
     reading as gold away from them -- a darker room left the ink a dull brown.
     Linear radiance, per vertex. */
  const roomGeometry = new THREE.SphereGeometry(STUDIO_RADIUS * 2, 48, 24);
  const heights = roomGeometry.getAttribute('position');
  const colours = new Float32Array(heights.count * 3);
  for (let i = 0; i < heights.count; i++) {
    const up = heights.getY(i) / (STUDIO_RADIUS * 2); // -1 floor .. 1 ceiling
    const radiance = up < 0 ? 0.06 + 0.19 * (1 + up) : 0.25 + 0.55 * up;
    colours.fill(radiance, i * 3, i * 3 + 3);
  }
  roomGeometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const roomMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  disposables.push(roomGeometry, roomMaterial);
  studio.add(new THREE.Mesh(roomGeometry, roomMaterial));

  const plane = new THREE.PlaneGeometry(1, 1);
  disposables.push(plane);
  for (const [azimuth, elevation, width, height, radiance] of STRIPS) {
    const strip = new THREE.Mesh(plane, lit(radiance));
    const a = THREE.MathUtils.degToRad(azimuth);
    const e = THREE.MathUtils.degToRad(elevation);
    strip.position.set(
      Math.sin(a) * Math.cos(e) * STUDIO_RADIUS,
      Math.sin(e) * STUDIO_RADIUS,
      Math.cos(a) * Math.cos(e) * STUDIO_RADIUS,
    );
    strip.scale.set(width, height, 1);
    strip.lookAt(0, strip.position.y, 0);
    studio.add(strip);
  }
  const crown = new THREE.Mesh(plane, lit(CROWN_STRIP.radiance));
  crown.position.set(0, CROWN_STRIP.height, CROWN_STRIP.depth);
  crown.scale.set(CROWN_STRIP.length, CROWN_STRIP.width, 1);
  crown.rotation.x = Math.PI / 2;
  studio.add(crown);

  const pmrem = new THREE.PMREMGenerator(renderer);
  // A light blur only: enough to keep the strips from aliasing on a
  // mirror-smooth visor, not so much that they turn back into blobs.
  const texture = pmrem.fromScene(studio, 0.01).texture;
  pmrem.dispose();
  for (const item of disposables) item.dispose();
  return texture;
}

/**
 * The finish, by part. Paint is metallic under a hard clearcoat; the metal
 * hardware is metal; the vents and seals stay satin so the polish has
 * something to stand against; the visor is a dark mirror.
 *
 * Every part keeps a clearcoat, even the satin ones: three builds a shader per
 * combination of features, and one variant compiles once.
 */
interface Finish {
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}
const PAINT: Finish = { metalness: 0.7, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04 };
const POLISHED_METAL: Finish = { metalness: 1, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.04 };
const SATIN: Finish = { metalness: 0.1, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.35 };
const MIRROR: Finish = { metalness: 1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 };
/** Material name -> finish, for the parts that are not a painted sheet. */
const PART_FINISH: Readonly<Record<string, Finish>> = {
  ORO: POLISHED_METAL, // visor pivot hardware
  'GRIG METALLO': POLISHED_METAL,
  'VIOLA METALLO': POLISHED_METAL,
  'NERO PLATIC': SATIN, // vents
  'NERO GUARNIZ': SATIN, // visor and neck seals
  'Nuovo materiale 001': MIRROR, // the visor
};
/**
 * The visor's tint and cover. Its own colour is a clear purple at 40%, which
 * as a mirror would reflect almost nothing; a mirror's colour IS its
 * reflectance, so this is the same purple, darkened to a smoked iridium, and
 * made near-opaque so the reflection is not thinned out by the blend.
 */
const VISOR_TINT = new THREE.Color().setRGB(0.22, 0.15, 0.28, THREE.SRGBColorSpace);
const VISOR_OPACITY = 0.9;

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
    const isVisor = PART_FINISH[from.name] === MIRROR;
    // A painted sheet is paint: opaque, whatever alpha its flat colour had.
    const opacity = map ? 1 : isVisor ? VISOR_OPACITY : from.opacity;
    // Fail loudly on a part the bake did not expect, rather than guessing.
    const finish = map ? PAINT : PART_FINISH[from.name];
    if (!finish) throw new Error(`[helmet] no finish for material "${from.name}"`);
    /* Metallic paint under a lacquer: the gold ink takes the light as metal
       does, the black shows only the clearcoat's reflection, and the strips of
       the studio slide across both as the helmet moves. */
    const material = new THREE.MeshPhysicalMaterial({
      color: map ? 0xffffff : isVisor ? VISOR_TINT : from.color,
      map,
      ...finish,
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
