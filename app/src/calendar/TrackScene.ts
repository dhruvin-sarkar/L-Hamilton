/**
 * The track visualiser: the round's circuit in 3D, lit, under a slowly turning
 * camera, with its corners numbered.
 *
 * The reference's `tracksScene` draws a model of each circuit from its own
 * file (tracks-05.glb) through its site-wide WebGL layer. That model, its
 * textures and its shaders are its own and are not shipped here. This scene
 * builds the same object from the circuit's shape instead
 * (content/generated/circuit-paths.json, see tools/gen-circuit-paths.py):
 *
 *   - a glowing line along the top of a low wall that follows the track, the
 *     wall itself translucent and fading towards its foot, and the foot drawn
 *     again as a dim outline -- the reference's lit ribbon on its plinth;
 *   - a thin leader rising from each corner to its number, and a chequered
 *     flag on the start/finish line;
 *   - the reference's own tuning, read off `landoGL.params.tracksScene`:
 *     AUTOROTATE_SPEED 0.2 and TRANSITION_DURATION 2 -- one round's circuit
 *     sinks away and the next draws itself in along its length over two
 *     seconds.
 *
 * Ink: the circuit is a circuit graphic on a dark ground, so it glows in
 * Giallo Modena (the user's rule for every circuit drawing on the site:
 * yellow on dark, red on light).
 *
 * The 2026 calendar has no DRS -- the regulations replaced it -- so there are
 * no DRS zones to label, where the reference labels two.
 *
 * Cost: one renderer for the page, which renders only while its panel is on
 * screen and the tab is visible. Under reduced motion the camera holds still,
 * swaps are cuts, and a frame is drawn only when something changes.
 */

import * as THREE from 'three';
import raw from '../content/generated/circuit-paths.json';
import { reducedMotion } from '../lib/motion';

interface CircuitPath {
  points: [number, number][];
  corners: { number: number; letter: string; index: number }[];
  source: string;
}

const PATHS = (raw as unknown as { circuits: Record<string, CircuitPath> }).circuits;

/** Whether the visualiser can draw a circuit. */
export const hasPath = (circuitId: string): boolean => circuitId in PATHS;

/* ------------------------------------------------------------------ *
 * The reference's numbers, and the ones read off its rendering
 * ------------------------------------------------------------------ */

const AUTOROTATE_SPEED = 0.2;
const TRANSITION_DURATION = 2;

/** Radians the camera turns per second at speed 1. The reference's model
    turns about a degree and a half a second at its 0.2. */
const TURN_PER_SPEED = 0.13;

/** In path units, where a circuit is 100 across its longer side. */
const WALL = 3.2;
const CORE_RADIUS = 0.32;
const GLOW_RADIUS = 1.9;
const LEADER = [7, 10.5, 14] as const;

const INK = new THREE.Color('#fff200');

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */

/** A soft halo round a tube: bright along the axis, gone at the silhouette. */
function glowMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: INK }, uOpacity: { value: opacity }, uReveal: { value: 1 } },
    vertexShader: /* glsl */ `
      varying float vFacing;
      varying float vU;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        vU = uv.x;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uReveal;
      varying float vFacing;
      varying float vU;
      void main() {
        if (vU > uReveal) discard;
        float a = pow(vFacing, 2.5) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** The wall: the ink at the top, falling away to almost nothing at the foot. */
function wallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: INK }, uOpacity: { value: 1 }, uReveal: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uReveal;
      varying vec2 vUv;
      void main() {
        if (vUv.x > uReveal) discard;
        float a = (0.05 + 0.33 * pow(vUv.y, 1.6)) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/** A solid core line, revealed along its length. */
function coreMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: INK }, uOpacity: { value: opacity }, uReveal: { value: 1 } },
    vertexShader: /* glsl */ `
      varying float vU;
      void main() {
        vU = uv.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uReveal;
      varying float vU;
      void main() {
        if (vU > uReveal) discard;
        // Lifted past the ink towards white, as a lit tube's core reads.
        vec3 c = mix(uColor, vec3(1.0), 0.35);
        gl_FragColor = vec4(c * uOpacity, uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/* ------------------------------------------------------------------ *
 * One circuit's object
 * ------------------------------------------------------------------ */

interface Built {
  id: string;
  group: THREE.Group;
  materials: THREE.ShaderMaterial[];
  anchors: { position: THREE.Vector3; label: HTMLElement; base: THREE.Vector3 }[];
  flag: { position: THREE.Vector3; node: HTMLElement };
  geometries: THREE.BufferGeometry[];
}

/** A wall along a closed curve: u runs along the track, v from foot to top. */
function wallGeometry(points: THREE.Vector3[]): THREE.BufferGeometry {
  const count = points.length;
  const positions = new Float32Array((count + 1) * 2 * 3);
  const uvs = new Float32Array((count + 1) * 2 * 2);
  const lengths = [0];
  for (let i = 1; i <= count; i++) {
    const a = points[i - 1] as THREE.Vector3;
    const b = points[i % count] as THREE.Vector3;
    lengths.push((lengths[i - 1] as number) + a.distanceTo(b));
  }
  const total = lengths[count] as number;
  for (let i = 0; i <= count; i++) {
    const p = points[i % count] as THREE.Vector3;
    const u = (lengths[i] as number) / total;
    positions.set([p.x, 0, p.z, p.x, WALL, p.z], i * 6);
    uvs.set([u, 0, u, 1], i * 4);
  }
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

function build(id: string, labels: HTMLElement): Built {
  const path = PATHS[id];
  if (!path) throw new Error(`[tracks] no path for "${id}" -- run tools/gen-circuit-paths.py`);

  /* The path's y is north; the scene's ground is x/z with z towards the
     viewer, so north is -z. */
  const flat = path.points.map(([x, y]) => new THREE.Vector3(x, 0, -y));
  const curve = new THREE.CatmullRomCurve3(flat, true, 'centripetal');
  const samples = Math.max(400, flat.length * 4);
  const along = curve.getSpacedPoints(samples).slice(0, -1);

  const top = new THREE.CatmullRomCurve3(
    along.map((p) => new THREE.Vector3(p.x, WALL, p.z)),
    true,
    'centripetal',
  );
  const foot = new THREE.CatmullRomCurve3(along, true, 'centripetal');

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, order: number): void => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = order;
    geometries.push(geometry);
    materials.push(material);
    group.add(mesh);
  };

  const segments = samples;
  add(wallGeometry(along), wallMaterial(), 1);
  add(new THREE.TubeGeometry(foot, segments, CORE_RADIUS * 0.6, 6, true), coreMaterial(0.22), 2);
  add(new THREE.TubeGeometry(top, segments, GLOW_RADIUS, 10, true), glowMaterial(0.55), 3);
  add(new THREE.TubeGeometry(top, segments, CORE_RADIUS, 8, true), coreMaterial(1), 4);

  /* Corner leaders: a hairline up from the wall's top to the number, and a
     dot where it meets the track. */
  const leaderPositions: number[] = [];
  const anchors: Built['anchors'] = [];
  path.corners.forEach((corner, i) => {
    const [x, y] = path.points[corner.index] as [number, number];
    const height = WALL + (LEADER[i % LEADER.length] as number);
    leaderPositions.push(x, WALL, -y, x, height, -y);
    const label = document.createElement('span');
    label.className = 'track-gl__label';
    label.textContent = `${String(corner.number).padStart(2, '0')}${corner.letter}`;
    labels.appendChild(label);
    anchors.push({ position: new THREE.Vector3(x, height, -y), base: new THREE.Vector3(x, WALL, -y), label });
  });
  if (leaderPositions.length) {
    const leaders = new THREE.BufferGeometry();
    leaders.setAttribute('position', new THREE.Float32BufferAttribute(leaderPositions, 3));
    const leaderMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: INK }, uOpacity: { value: 0.55 }, uReveal: { value: 1 } },
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 uColor; uniform float uOpacity; void main() { gl_FragColor = vec4(uColor * uOpacity, uOpacity); }',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(leaders, leaderMaterial);
    lines.renderOrder = 5;
    geometries.push(leaders);
    materials.push(leaderMaterial);
    group.add(lines);
  }

  const [sx, sy] = path.points[0] as [number, number];
  const flagNode = document.createElement('span');
  flagNode.className = 'track-gl__flag';
  labels.appendChild(flagNode);

  return {
    id,
    group,
    materials,
    anchors,
    flag: { position: new THREE.Vector3(sx, WALL + 1.2, -sy), node: flagNode },
    geometries,
  };
}

/* ------------------------------------------------------------------ *
 * The scene
 * ------------------------------------------------------------------ */

export class TrackScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 2, 1, 1000);
  private readonly turntable = new THREE.Group();
  private readonly labels: HTMLElement;
  private readonly clock = new THREE.Clock();

  private current: Built | null = null;
  private leaving: Built | null = null;
  /** 0..1 through the swap: the old one sinks over the first half, the new
      one draws over the whole. */
  private swapStart = -1;
  private visible = false;
  private frame = 0;
  private dirty = true;
  private readonly observer: IntersectionObserver;
  private readonly resizer: ResizeObserver;
  private readonly projected = new THREE.Vector3();

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'track-gl__canvas';
    host.appendChild(this.renderer.domElement);

    this.labels = document.createElement('div');
    this.labels.className = 'track-gl__labels';
    host.appendChild(this.labels);

    this.scene.add(this.turntable);
    /* Elevated about 38 degrees and pulled back to fit a 100-unit circuit
       across the panel with room to turn, as the reference frames Baku. */
    this.camera.position.set(0, 88, 112);
    this.camera.lookAt(0, -2, 0);

    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(host);
    this.resize();

    this.observer = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? false;
      if (this.visible) this.start();
    });
    this.observer.observe(host);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.visible) this.start();
    });
  }

  /** Shows a circuit. An id with no path empties the stage. */
  show(circuitId: string): void {
    if (this.current?.id === circuitId) return;
    const next = hasPath(circuitId) ? build(circuitId, this.labels) : null;

    if (this.leaving) this.dispose(this.leaving);
    this.leaving = this.current;
    this.current = next;
    if (next) this.turntable.add(next.group);

    if (reducedMotion || !this.leaving) {
      if (this.leaving) this.dispose(this.leaving);
      this.leaving = null;
      this.swapStart = -1;
      if (next) this.setProgress(next, 1, 1);
    } else {
      this.swapStart = this.clock.getElapsedTime();
      if (next) this.setProgress(next, 0, 0);
    }
    this.dirty = true;
    this.start();
  }

  private setProgress(built: Built, reveal: number, opacity: number): void {
    for (const material of built.materials) {
      const u = material.uniforms;
      if (u.uReveal) u.uReveal.value = reveal;
      if (u.uOpacity && material.userData.base === undefined) material.userData.base = u.uOpacity.value;
      if (u.uOpacity) u.uOpacity.value = (material.userData.base as number) * opacity;
    }
    const labelsOn = reveal >= 1 ? opacity : 0;
    for (const anchor of built.anchors) anchor.label.style.opacity = String(labelsOn);
    built.flag.node.style.opacity = String(labelsOn);
    built.group.position.y = 0;
  }

  private dispose(built: Built): void {
    this.turntable.remove(built.group);
    for (const geometry of built.geometries) geometry.dispose();
    for (const material of built.materials) material.dispose();
    for (const anchor of built.anchors) anchor.label.remove();
    built.flag.node.remove();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    /* Fit the circuit's 100 units to the panel's width at any aspect: the
       reference's model keeps its share of the frame as the page narrows. */
    const fit = Math.max(1, 1.9 / this.camera.aspect);
    this.camera.position.set(0, 88 * fit, 112 * fit);
    this.camera.lookAt(0, -2, 0);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.start();
  }

  private start(): void {
    if (this.frame || !this.visible || document.hidden) return;
    this.clock.getDelta();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.frame = 0;
    if (!this.visible || document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const now = this.clock.getElapsedTime();
    let moving = false;

    if (!reducedMotion) {
      this.turntable.rotation.y += AUTOROTATE_SPEED * TURN_PER_SPEED * dt;
      moving = true;
    }

    if (this.swapStart >= 0) {
      const t = Math.min(1, (now - this.swapStart) / TRANSITION_DURATION);
      const ease = (x: number): number => 1 - (1 - x) ** 3;
      if (this.leaving) {
        const out = Math.min(1, t * 2);
        this.setProgress(this.leaving, 1, 1 - out);
        this.leaving.group.position.y = -WALL * 2 * ease(out);
        if (out >= 1) {
          this.dispose(this.leaving);
          this.leaving = null;
        }
      }
      if (this.current) {
        const draw = ease(Math.max(0, (t - 0.25) / 0.75));
        this.setProgress(this.current, draw, 1);
      }
      if (t >= 1) this.swapStart = -1;
      moving = true;
    }

    if (moving || this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.place();
      this.dirty = false;
    }
    if (moving) this.frame = requestAnimationFrame(this.tick);
  };

  /** Puts the HTML labels over their points. */
  private place(): void {
    const built = this.current;
    if (!built) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const at = (point: THREE.Vector3, node: HTMLElement): void => {
      this.projected.copy(point);
      built.group.localToWorld(this.projected);
      this.projected.project(this.camera);
      const x = (this.projected.x * 0.5 + 0.5) * w;
      const y = (-this.projected.y * 0.5 + 0.5) * h;
      node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    };
    for (const anchor of built.anchors) at(anchor.position, anchor.label);
    at(built.flag.position, built.flag.node);
  }
}
