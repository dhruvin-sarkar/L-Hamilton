import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gsap, ScrollTrigger } from './lib/motion';

/**
 * The helmet that flies through the top of /on-track.
 *
 * The reference's mechanic, read out of its bundle (lando-gl.js, the
 * `helmet-scroll` scene and the `_L` function that drives it), and rebuilt
 * around the helmet supplied for this build:
 *
 *   - Three empty boxes in the page are the stops: a huge one hanging off the
 *     left of the hero, one centred on the statement, one inside the laurel
 *     wreath under it. The helmet's centre rides two cubic Beziers through
 *     their centres, with the reference's own control points, and its size
 *     eases from one box's width to the next.
 *   - One progress value drives all of it: 0 when the hero's top meets the top
 *     of the screen, 1 when the statement's bottom is a quarter of the way
 *     down it. Scrubbed, no easing of its own.
 *   - The same progress scrubs a paused timeline of rotations: 1.77 turns
 *     about the vertical axis, power1.inOut, and a nod on the horizontal one
 *     that dips through the first half and recovers through the second.
 *   - A narrow lens (20 degrees) two units back, so the helmet reads almost
 *     orthographic, as the reference's does.
 *
 * Where it departs: the reference renders into a square render target and
 * draws that on a plane. Here the camera's frustum is skewed instead, so the
 * square the helmet belongs in is simply a region of one full-screen canvas --
 * same framing, one pass, and nothing is clipped at the square's edge.
 *
 * The surface is ours: the black-and-gold livery supplied with the model, under
 * a clearcoat, lit by a generated studio environment. The reference's gold
 * chrome is its artwork and not copied.
 */

const HELMET_URL = '/assets/helmet/helmet.glb';
const DRACO_PATH = '/assets/draco/';
const MAPS = '/assets/helmet/textures/';

/** The reference's lens: PerspectiveCamera(20, 1, 0.1, 1000) at z = 2. */
const FOV = 20;
const CAMERA_Z = 2;
/**
 * The helmet's longest side, in scene units; the square spans 2 * 2 * tan(10deg)
 * = 0.705 of them at this lens. Sized so the SHELL matches the reference's
 * helmet (0.44 x 0.463 x 0.575 at its scale of 6), not the bounds: this file's
 * bounds also take in a chin wing and roof fins that stand proud of the shell,
 * and matching those would leave the helmet itself a size too small.
 */
const HELMET_LENGTH = 0.62;

interface Box {
  x: number;
  y: number;
  w: number;
}

export interface HelmetScrollOptions {
  /** The progress runs from this element's top meeting the top of the screen… */
  from: HTMLElement;
  /** …to this one's bottom sitting a quarter of the way down it. */
  to: HTMLElement;
  /** The three boxes the helmet passes through, in order. */
  stops: [HTMLElement, HTMLElement, HTMLElement];
  /** Park at the last stop and never move (prefers-reduced-motion). */
  still: boolean;
}

/** A point on a cubic Bezier -- the reference's own `z()`. */
function bezier(p0: Box, c1: Box, c2: Box, p1: Box, t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

/**
 * The file carries two liveries. Its own 300-odd flat-coloured decal meshes
 * make a purple one; underneath them, the bare shell (`__DEFAULT`) is UV-mapped
 * to the black-and-gold sheet supplied with it, and the fins to its wing sheet.
 * The black and gold is the one drawn here -- the nearest thing this helmet has
 * to the reference's gold-and-black chrome -- so only the shell, the fins and
 * the parts both liveries share are kept: visor, seals, vents and the visor
 * pivots. Everything else is the purple decal layer, left out.
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
 * Where the reference's model has its origin, as fractions of its own size:
 * 5.6% of its height below the centre of its bounds and 3.2% of its length
 * behind it (helmet-21.glb, `helmet` mesh). The helmet turns about that point,
 * so its centre swings a little as it spins -- copied, not centred.
 */
const PIVOT_BELOW = 0.0564;
const PIVOT_BEHIND = 0.0324;

/**
 * The model, merged by material into a handful of draw calls and turned the
 * right way up. Same orientation as HeadScene's: authored Z-up with the face on
 * -y, so -90 degrees about X brings the crown up and the visor to the camera.
 */
async function loadHelmet(renderer: THREE.WebGLRenderer): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(HELMET_URL);
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
         across the helmet as it turns, which is what makes the spin legible. */
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
    // Baked into the vertices, because merging throws the scene graph away.
    bucket.parts.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  });
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
    if (!geometry) throw new Error('[helmet-scroll] merge failed -- mismatched vertex attributes');
    const mesh = new THREE.Mesh(geometry, material);
    // See-through parts after the opaque shell, or the fins hide what is behind them.
    mesh.renderOrder = material.transparent ? 1 : 0;
    merged.add(mesh);
  }

  const box = new THREE.Box3().setFromObject(merged);
  const size = box.getSize(new THREE.Vector3());
  merged.position.sub(box.getCenter(new THREE.Vector3()));
  // Authored axes: +z is up, -y is forward. Raising and advancing the helmet
  // leaves the origin below and behind its centre, where the reference's is.
  merged.position.z += PIVOT_BELOW * size.z;
  merged.position.y -= PIVOT_BEHIND * size.y;

  const normalised = new THREE.Group();
  normalised.add(merged);
  normalised.scale.setScalar(HELMET_LENGTH / (Math.max(size.x, size.y, size.z) || 1));
  normalised.rotation.set(-Math.PI / 2, 0, 0);
  return normalised;
}

export function mountHelmetScroll(opts: HelmetScrollOptions): () => void {
  const canvas = document.createElement('canvas');
  canvas.className = 'helmet-scroll';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  /* Two groups for the two rotations, as the reference nests them: the outer
     one spins, the inner one nods, so the nod always tilts about the helmet's
     own ear-to-ear axis however far round it has turned. */
  const spin = new THREE.Group();
  const nod = new THREE.Group();
  spin.add(nod);
  scene.add(spin);

  const timeline = gsap.timeline({ paused: true });
  timeline.fromTo(
    spin.rotation,
    { y: Math.PI / 2.2 },
    { y: Math.PI * 4, duration: 1, ease: 'power1.inOut' },
    0,
  );
  timeline.fromTo(
    nod.rotation,
    { x: Math.PI / 12 },
    { x: -Math.PI / 10, duration: 0.5, ease: 'power1.in' },
    0,
  );
  timeline.fromTo(
    nod.rotation,
    { x: -Math.PI / 10 },
    { x: Math.PI / 20, duration: 0.5, ease: 'power1.out' },
    0.5,
  );

  /* The three stops, in page coordinates, re-read on every refresh: they are
     sized in rem against a fluid root, so every resize moves them. */
  let stops: Box[] = [];
  const measure = (): void => {
    stops = opts.stops.map((node) => {
      const r = node.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 + window.scrollX,
        y: r.top + r.height / 2 + window.scrollY,
        w: r.width,
      };
    });
  };

  let progress = opts.still ? 1 : 0;
  let visible = false;
  let loaded = false;

  /** Where the helmet's square is at `p`, and how big: the reference's `T()`. */
  const place = (p: number): Box => {
    const [a, b, c] = stops as [Box, Box, Box];
    // The reference's control points, as fractions of the legs they bend.
    const c1 = { x: a.x, y: a.y + (b.y - a.y) * 0.4, w: 0 };
    const c2 = { x: b.x, y: b.y - (b.y - a.y) * 0.3, w: 0 };
    const c3 = { x: b.x, y: b.y + (c.y - b.y) * 0.3, w: 0 };
    const c4 = { x: b.x + (c.x - b.x) * 0.6, y: c.y - (c.y - b.y) * 0.2, w: 0 };
    if (p <= 0.5) {
      const t = p * 2;
      return { ...bezier(a, c1, c2, b, t), w: a.w + (b.w - a.w) * t };
    }
    const t = (p - 0.5) * 2;
    return { ...bezier(b, c3, c4, c, t), w: b.w + (c.w - b.w) * t };
  };

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  resize();

  const render = (): void => {
    if (!visible || !loaded || stops.length !== 3) return;
    timeline.progress(Math.min(1, progress + 0.001));

    const square = place(progress);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cx = square.x - window.scrollX;
    const cy = square.y - window.scrollY;

    /* An off-axis frustum: the same 20-degree view the reference renders into
       its square, extended out to the edges of the screen, so the square lands
       at (cx, cy) with side square.w and nothing outside it is cut off. */
    const near = camera.near;
    const k = (2 * near * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / square.w;
    camera.projectionMatrix.makePerspective(
      -cx * k,
      (W - cx) * k,
      cy * k,
      -(H - cy) * k,
      near,
      camera.far,
    );
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    renderer.render(scene, camera);
  };

  const triggers: ScrollTrigger[] = [];
  measure();

  /* Only draw while the helmet can be on screen: from half a screen before the
     hero arrives to half a screen after the statement has gone -- the
     reference's own `setIsRendering` window. */
  triggers.push(
    ScrollTrigger.create({
      trigger: opts.from,
      start: () => `top-=${window.innerHeight / 2} bottom`,
      endTrigger: opts.to,
      end: () => `bottom+=${window.innerHeight / 2} top`,
      invalidateOnRefresh: true,
      onToggle: (self) => {
        visible = self.isActive;
        canvas.style.visibility = visible ? '' : 'hidden';
      },
      onRefresh: (self) => {
        measure();
        visible = self.isActive;
        canvas.style.visibility = visible ? '' : 'hidden';
      },
    }),
  );

  if (!opts.still) {
    triggers.push(
      ScrollTrigger.create({
        trigger: opts.from,
        start: 'top top',
        endTrigger: opts.to,
        end: 'bottom 25%',
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          progress = self.progress;
        },
        onRefresh: (self) => {
          measure();
          progress = self.progress;
        },
      }),
    );
  }

  window.addEventListener('resize', resize);
  gsap.ticker.add(render);

  let disposed = false;
  void loadHelmet(renderer).then(
    (helmet) => {
      if (disposed) return;
      nod.add(helmet);
      loaded = true;
      ScrollTrigger.refresh();
    },
    (error: unknown) => {
      // Decoration: the page is complete without it, so say so and stand down.
      console.warn('[helmet-scroll] the helmet did not load', error);
      canvas.remove();
    },
  );

  return () => {
    disposed = true;
    gsap.ticker.remove(render);
    window.removeEventListener('resize', resize);
    for (const t of triggers) t.kill();
    timeline.kill();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    scene.environment?.dispose();
    renderer.dispose();
    canvas.remove();
  };
}
