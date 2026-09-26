/**
 * The 3D circuit map: a round's circuit as a lit ribbon under a slowly turning
 * camera, its corners numbered, swapping to the next round's circuit with a
 * two-second wipe. Shared: the calendar page's round panel mounts it, and On
 * Track's schedule panel can mount the same thing into its own host.
 *
 *   const map = mountTrackMap(host, 'baku');
 *   map.show('marina_bay');          // animates; 'backward' turns the other way
 *   map.dispose();
 *
 * What it reproduces -- the reference's `tracksScene`, read from its running
 * bundle and its `landoGL.params.tracksScene` (AUTOROTATE_SPEED 0.2,
 * TRANSITION_DURATION 2):
 *   - each circuit a low translucent wall along the track, doubled a hair
 *     inside itself, its top edge a bright line with light running along it
 *     in the racing direction, its foot a faint line;
 *   - a bloom over the render (strength 1.5, radius 0.5, threshold 0.25);
 *   - a camera 1 degree wide across the panel, orbiting at a fixed tilt
 *     (polar angle PI/2.5), turning on its own at 0.2 with damping, and
 *     draggable to spin -- no zoom;
 *   - numbered corner markers and a chequered start marker, drawn in HTML over
 *     the projected points, each a hairline 4rem tall with a dot at its foot;
 *   - the swap: 1s out (expo.in) -- the ribbon wipes away in eight runs while
 *     it and the markers turn 45 degrees and the markers rise a quarter and
 *     fade, 0.015s apart -- then 1s in (expo.out), mirrored.
 *
 * What it does NOT reuse: the reference's model file, its matcap texture and
 * its shaders stay in the reference (CLAUDE.md). The geometry comes from
 * content/generated/circuit-paths.json (MultiViewer and bacinger/f1-circuits,
 * MIT -- see tools/gen-circuit-paths.py for the sources), the shading is this
 * file's own, and the matcap's left-lit falloff is computed rather than
 * sampled.
 *
 * Where it differs on purpose:
 *   - No DRS labels: the 2026 regulations have no DRS.
 *   - The ink is Giallo Modena, the site's rule for a circuit on a dark
 *     ground (yellow on dark, red on light).
 *   - A swap asked for while one is running is queued, not dropped; the
 *     reference drops it and can end up showing a different circuit from its
 *     panel.
 *   - Under reduced motion there is no turning, no running light and no
 *     wipe: the circuit is cut in, and a frame is drawn only when something
 *     changes (a drag still turns it).
 *
 * Cost: one WebGL context per mounted map, rendering only while its host is
 * within half a screen of the viewport and the tab is visible.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import raw from '../content/generated/circuit-paths.json';
import { gsap, reducedMotion } from './motion';
import '../styles/track3d.css';

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */

interface CircuitPath {
  points: [number, number][];
  corners: { number: number; letter: string; index: number }[];
  source: string;
}

const PATHS = (raw as unknown as { size: number; circuits: Record<string, CircuitPath> }).circuits;
const PATH_SIZE = (raw as unknown as { size: number }).size;

/** Whether the map can draw a circuit. */
export const hasTrackMap = (circuitId: string): boolean => circuitId in PATHS;

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

/** The reference's own parameters. */
const AUTOROTATE_SPEED = 0.2;
const TRANSITION_DURATION = 2;
const BLOOM = { strength: 1.5, radius: 0.5, threshold: 0.25 } as const;
const POLAR = Math.PI / 2.5;
/** Horizontal field of view, degrees: all but orthographic. */
const FOV_ACROSS = 1;
/** The reference camera's starting place; the orbit keeps its distance and
    bearing and sets its tilt. */
const CAMERA_START = new THREE.Vector3(87.5, 70, 175);

/** Scene units. A circuit is this long on its longer side -- the reference's
    models run 2.0 to 3.3 units, most about 2.45. */
const LENGTH = 2.45;
const WALL = 0.1;
const RIBBON = 0.035;
/** Points along each circuit: the reference's models carry 324 to 444. */
const SAMPLES = 400;
/** Runs the ribbon wipes in, and bands of light running round a lap. */
const WIPE_RUNS = 8;
const LIGHT_BANDS = 5;
/** Closest two corner markers may stand, scene units. */
const MARKER_GAP = 0.08;

const hex = (value: string): THREE.Color => {
  /* Written straight through: the pipeline outputs the values it is given,
     as the reference's does, so these land on screen as the hex reads. */
  const n = Number.parseInt(value.replace('#', ''), 16);
  return new THREE.Color().setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace);
};

const INK = hex('#fff200');
const BODY = hex('#241f08');

/* ------------------------------------------------------------------ *
 * The ribbon's material
 * ------------------------------------------------------------------ */

const VERTEX = /* glsl */ `
  varying vec2 vAlong;
  varying float vLeft;

  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vec3 facing = normalize(normalMatrix * normal);
    /* The sphere-map coordinate of the view reflected off the wall, across:
       0 where it bounces to the camera's far left, 0.5 head on. The
       reference looks its matcap up here; this shades from it directly. */
    vec3 bounce = reflect(normalize(view.xyz), facing);
    float m = 2.0 * length(vec3(bounce.xy, bounce.z + 1.0));
    vLeft = clamp(0.5 - bounce.x / max(m, 1e-4), 0.0, 1.0);
    vAlong = uv;
    gl_Position = projectionMatrix * view;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uBody;
  uniform float uTime;
  uniform float uWipe;
  uniform float uDrawing;

  varying vec2 vAlong;
  varying float vLeft;

  void main() {
    float along = vAlong.x;
    float height = vAlong.y;

    /* The top edge: a thin line, the light running along it in the racing
       direction as a head that fades behind. */
    float band = fract(along * ${LIGHT_BANDS.toFixed(1)} - uTime);
    float lamp = 0.35 + 2.15 * band * band;
    float top = smoothstep(0.93, 0.975, height) * lamp;

    /* The foot: a faint line where the wall meets the ground. */
    float foot = (1.0 - step(0.025, height)) * 0.25;

    /* The side, lit from the left and falling off fast towards the right. */
    float side = max(pow(vLeft, 4.0), 0.05);

    vec3 colour = uBody + uInk * side + uInk * (top + foot);
    float alpha = clamp(0.35 + top + foot, 0.0, 1.0);

    /* The wipe, in runs: drawing in grows each run from its start, wiping
       out eats each run from its start. */
    float run = fract(along * ${WIPE_RUNS.toFixed(1)});
    float edge = mix(run, 1.0 - run, uDrawing);
    alpha *= smoothstep(uWipe * 1.2 - 0.2, uWipe * 1.2, edge);

    gl_FragColor = vec4(colour, alpha);
  }
`;

function ribbonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uInk: { value: INK },
      uBody: { value: BODY },
      uTime: { value: 0 },
      uWipe: { value: 0 },
      uDrawing: { value: 0 },
    },
    side: THREE.DoubleSide,
    transparent: true,
  });
}

/* ------------------------------------------------------------------ *
 * One circuit
 * ------------------------------------------------------------------ */

interface Marker {
  /** Where the marker stands, on top of the wall, in the circuit's frame. */
  at: THREE.Vector3;
  node: HTMLElement;
  content: HTMLElement;
}

interface Circuit {
  id: string;
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  geometries: THREE.BufferGeometry[];
  markers: Marker[];
}

/** A closed wall along points: u runs round the lap, v from foot to top. */
function wall(points: THREE.Vector3[], normals: THREE.Vector3[], offset: number): THREE.BufferGeometry {
  const count = points.length;
  const position = new Float32Array((count + 1) * 2 * 3);
  const normal = new Float32Array((count + 1) * 2 * 3);
  const uv = new Float32Array((count + 1) * 2 * 2);
  for (let i = 0; i <= count; i++) {
    const p = points[i % count] as THREE.Vector3;
    const n = normals[i % count] as THREE.Vector3;
    const x = p.x + n.x * offset;
    const z = p.z + n.z * offset;
    position.set([x, 0, z, x, WALL, z], i * 6);
    normal.set([n.x, 0, n.z, n.x, 0, n.z], i * 6);
    uv.set([i / count, 0, i / count, 1], i * 4);
  }
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

const SVG = 'http://www.w3.org/2000/svg';

/** A chequered flag, five squares by three. */
function chequer(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 25 15');
  svg.setAttribute('class', 'track3d__flag');
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const square = document.createElementNS(SVG, 'rect');
      square.setAttribute('x', String(col * 5));
      square.setAttribute('y', String(row * 5));
      square.setAttribute('width', '5');
      square.setAttribute('height', '5');
      square.setAttribute('fill', (row + col) % 2 === 0 ? '#ffffff' : '#111012');
      svg.appendChild(square);
    }
  }
  return svg;
}

function marker(layer: HTMLElement, at: THREE.Vector3, start: boolean, label: string): Marker {
  const node = document.createElement('div');
  node.className = start ? 'track3d__point track3d__point--start' : 'track3d__point';
  const content = document.createElement('div');
  content.className = 'track3d__mark';
  if (start) content.appendChild(chequer());
  else {
    const text = document.createElement('p');
    text.textContent = label;
    content.appendChild(text);
  }
  node.appendChild(content);
  layer.appendChild(node);
  return { at, node, content };
}

function build(id: string, layer: HTMLElement): Circuit {
  const path = PATHS[id];
  if (!path) throw new Error(`[track3d] no path for "${id}" -- add it in tools/gen-circuit-paths.py`);
  const scale = LENGTH / PATH_SIZE;

  /* The path's y is north; the ground here is x/z, north towards -z. */
  const toScene = ([x, y]: [number, number]): THREE.Vector3 => new THREE.Vector3(x * scale, 0, -y * scale);
  const curve = new THREE.CatmullRomCurve3(path.points.map(toScene), true, 'centripetal');
  const points = curve.getSpacedPoints(SAMPLES).slice(0, SAMPLES);

  /* Which way is inside: the ribbon's second wall stands a hair in from the
     first, as the reference's do on most circuits. */
  let area = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % SAMPLES] as THREE.Vector3;
    area += p.x * q.z - q.x * p.z;
  });
  const inward = area > 0 ? 1 : -1;
  const normals = points.map((_, i) => {
    const before = points[(i - 1 + SAMPLES) % SAMPLES] as THREE.Vector3;
    const after = points[(i + 1) % SAMPLES] as THREE.Vector3;
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    return new THREE.Vector3(-dz * inward, 0, dx * inward).normalize();
  });

  const material = ribbonMaterial();
  const geometries = [wall(points, normals, 0), wall(points, normals, RIBBON)];
  const group = new THREE.Group();
  for (const geometry of geometries) group.add(new THREE.Mesh(geometry, material));

  const top = (index: number): THREE.Vector3 => {
    const p = toScene(path.points[index] as [number, number]);
    return new THREE.Vector3(p.x, WALL, p.z);
  };
  const markers = [marker(layer, top(0), true, '')];
  /* A corner closer than MARKER_GAP to one already marked -- the second half
     of a tight chicane -- shares its marker, so two numbers never print on
     top of each other. Leaves each circuit within a couple of the
     reference's own count. */
  const marked: THREE.Vector3[] = [];
  for (const corner of path.corners) {
    const at = top(corner.index);
    if (marked.some((other) => other.distanceTo(at) < MARKER_GAP)) continue;
    marked.push(at);
    markers.push(marker(layer, at, false, `${String(corner.number).padStart(2, '0')}${corner.letter}`));
  }

  return { id, group, material, geometries, markers };
}

/* ------------------------------------------------------------------ *
 * The map
 * ------------------------------------------------------------------ */

export interface TrackMap {
  /** Shows a circuit, with the swap unless motion is reduced. */
  show(circuitId: string, direction?: 'forward' | 'backward'): void;
  dispose(): void;
}

export function mountTrackMap(host: HTMLElement, circuitId: string): TrackMap {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.className = 'track3d__canvas';
  host.classList.add('track3d');
  host.appendChild(renderer.domElement);

  const layer = document.createElement('div');
  layer.className = 'track3d__points';
  layer.setAttribute('aria-hidden', 'true');
  host.appendChild(layer);

  const scene = new THREE.Scene();
  const ground = getComputedStyle(host).getPropertyValue('--track3d-ground').trim() || '#111012';
  scene.background = hex(ground);
  const turntable = new THREE.Group();
  scene.add(turntable);

  const camera = new THREE.PerspectiveCamera(FOV_ACROSS, 2, 0.1, 1000);
  camera.position.copy(CAMERA_START);

  const controls = new OrbitControls(camera, host);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.minPolarAngle = POLAR;
  controls.maxPolarAngle = POLAR;
  controls.enableDamping = !reducedMotion;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = AUTOROTATE_SPEED;
  controls.update();
  /* The controls claim every touch; give vertical ones back to the page so a
     phone can scroll past the map, and keep sideways drags for spinning it. */
  host.style.touchAction = 'pan-y';

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloom);

  const built = new Map<string, Circuit>();
  const circuitFor = (id: string): Circuit => {
    let circuit = built.get(id);
    if (!circuit) {
      circuit = build(id, layer);
      built.set(id, circuit);
    }
    return circuit;
  };

  const setShown = (circuit: Circuit, shown: boolean): void => {
    if (shown) turntable.add(circuit.group);
    else turntable.remove(circuit.group);
    for (const m of circuit.markers) m.node.hidden = !shown;
  };

  let current = circuitFor(circuitId);
  setShown(current, true);

  /* ---------------------------------------------------------- Frames */

  const clock = new THREE.Clock();
  let time = 0;
  let near = false;
  let frame = 0;
  const projected = new THREE.Vector3();

  const place = (): void => {
    const w = host.clientWidth / 2;
    const h = host.clientHeight / 2;
    for (const m of current.markers) {
      projected.copy(m.at);
      current.group.localToWorld(projected);
      projected.project(camera);
      m.node.style.transform = `translate(${(projected.x * w).toFixed(1)}px, ${(-projected.y * h).toFixed(1)}px)`;
    }
  };

  const draw = (): void => {
    current.material.uniforms.uTime!.value = time;
    composer.render();
    place();
  };

  const tick = (): void => {
    frame = 0;
    if (!near || document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    time += dt;
    controls.update(dt);
    draw();
    frame = requestAnimationFrame(tick);
  };

  const run = (): void => {
    if (frame || !near || document.hidden) return;
    if (reducedMotion) {
      draw();
      return;
    }
    clock.getDelta();
    frame = requestAnimationFrame(tick);
  };

  /* Under reduced motion nothing moves on its own: draw when a drag turns it. */
  if (reducedMotion) controls.addEventListener('change', () => near && draw());

  const resize = (): void => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    /* One degree across whatever the panel's proportion. */
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV_ACROSS) / 2) / camera.aspect));
    camera.updateProjectionMatrix();
    if (reducedMotion && near) draw();
  };
  const resizer = new ResizeObserver(resize);
  resizer.observe(host);
  resize();

  const watcher = new IntersectionObserver(
    ([entry]) => {
      near = entry?.isIntersecting ?? false;
      run();
    },
    { rootMargin: '50% 0px' },
  );
  watcher.observe(host);
  const onVisibility = (): void => run();
  document.addEventListener('visibilitychange', onVisibility);

  /* ------------------------------------------------------------ Swaps */

  let swapping: gsap.core.Timeline | null = null;
  let queued: { id: string; direction: 'forward' | 'backward' } | null = null;
  const half = TRANSITION_DURATION / 2;
  const quarter = TRANSITION_DURATION / 4;

  const swap = (id: string, direction: 'forward' | 'backward'): void => {
    const turn = direction === 'forward' ? -Math.PI / 4 : Math.PI / 4;
    const leaving = current;
    const arriving = circuitFor(id);
    const wipe = { out: 0, in: 1 };

    swapping = gsap
      .timeline({
        onComplete: () => {
          swapping = null;
          if (queued && queued.id !== current.id) {
            const next = queued;
            queued = null;
            swap(next.id, next.direction);
          } else queued = null;
        },
      })
      /* Out: the ribbon wipes away and turns off; its markers rise and fade. */
      .call(() => {
        leaving.material.uniforms.uDrawing!.value = 0;
      })
      .to(wipe, {
        out: 1,
        duration: half,
        ease: 'expo.in',
        onUpdate: () => {
          leaving.material.uniforms.uWipe!.value = wipe.out;
        },
      })
      .fromTo(leaving.group.rotation, { y: 0 }, { y: turn, duration: half, ease: 'expo.in' }, 0)
      .fromTo(
        leaving.markers.map((m) => m.content),
        { yPercent: 0, opacity: 1 },
        { yPercent: -25, opacity: 0, duration: quarter, ease: 'expo.in', stagger: 0.015 },
        0,
      )
      /* The change-over. */
      .call(() => {
        setShown(leaving, false);
        leaving.group.rotation.y = 0;
        leaving.material.uniforms.uWipe!.value = 0;
        gsap.set(leaving.markers.map((m) => m.content), { clearProps: 'transform,opacity' });
        current = arriving;
        arriving.material.uniforms.uDrawing!.value = 1;
        arriving.material.uniforms.uWipe!.value = 1;
        setShown(arriving, true);
      })
      /* In: the new ribbon draws itself in each run and turns home. */
      .to(wipe, {
        in: 0,
        duration: half,
        ease: 'expo.out',
        onUpdate: () => {
          arriving.material.uniforms.uWipe!.value = wipe.in;
        },
      })
      .fromTo(arriving.group.rotation, { y: -turn }, { y: 0, duration: half, ease: 'expo.out' }, '<')
      .fromTo(
        arriving.markers.map((m) => m.content),
        { yPercent: -25, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: quarter, ease: 'expo.out', stagger: 0.015 },
        '<',
      );
  };

  return {
    show(id, direction = 'forward') {
      if (reducedMotion) {
        if (id === current.id) return;
        setShown(current, false);
        current = circuitFor(id);
        setShown(current, true);
        if (near) draw();
        return;
      }
      if (swapping) {
        queued = { id, direction };
        return;
      }
      if (id === current.id) return;
      swap(id, direction);
      run();
    },

    dispose() {
      swapping?.kill();
      cancelAnimationFrame(frame);
      watcher.disconnect();
      resizer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      controls.dispose();
      for (const circuit of built.values()) {
        circuit.material.dispose();
        for (const geometry of circuit.geometries) geometry.dispose();
      }
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      layer.remove();
      host.classList.remove('track3d');
    },
  };
}
