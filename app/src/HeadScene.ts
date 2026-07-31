import * as THREE from 'three';

/**
 * Depth-map parallax portrait.
 *
 * This is my own implementation, not the original's code — that bundle is
 * minified past recovery. What it *is* built from is the original's texture
 * channel list, which spells the technique out:
 *
 *     head -> diffuse, depth, alpha, normal, roughness, shadow
 *
 * A flat photo, a greyscale depth map, a cutout mask and a baked shadow pass.
 * That combination only means one thing: displace the diffuse lookup by the
 * depth value in the direction the cursor moved, so nearer pixels slide further
 * than far ones and a still photograph reads as a volume.
 *
 * The webp variants are used rather than the ktx2 ones so this needs no Basis
 * transcoder. Swap to ktx2 later for the memory win, once it is worth the setup.
 */

const TEXTURE_BASE = '/assets/gl/textures/head/webp';

export interface HeadSceneOptions {
  /** How far the diffuse lookup slides at full depth. */
  parallax?: number;
  /** Strength of the baked shadow pass, 0..1. */
  shadow?: number;
  /** Cursor smoothing per frame, 0..1. Lower is heavier. */
  ease?: number;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uDiffuse;
  uniform sampler2D uDepth;
  uniform sampler2D uAlpha;
  uniform sampler2D uShadow;

  uniform vec2  uPointer;   // smoothed cursor, roughly -1..1
  uniform float uParallax;
  uniform float uShadow0;

  varying vec2 vUv;

  void main() {
    // Depth is greyscale; 0.5 is the pivot plane, so the sign of (d - 0.5)
    // decides whether a pixel leads or trails the cursor.
    float d = texture2D(uDepth, vUv).r;
    vec2 offset = uPointer * (d - 0.5) * uParallax;

    vec2 uv = vUv + offset;

    vec3 diffuse = texture2D(uDiffuse, uv).rgb;
    float alpha  = texture2D(uAlpha,  uv).r;
    float shade  = texture2D(uShadow, uv).r;

    // Shadow is a multiply pass, dialled in rather than applied flat.
    vec3 color = diffuse * mix(1.0, shade, uShadow0);

    // Discard rather than blend the fully transparent surround: it keeps the
    // silhouette crisp and avoids depth-sorting artefacts at the hairline.
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;

export class HeadScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;

  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;

  /** Raw pointer, updated on move. */
  private readonly pointerTarget = new THREE.Vector2();
  /** Eased pointer, what the shader actually sees. */
  private readonly pointer = new THREE.Vector2();

  private ease: number;
  private aspect = 1;

  constructor(opts: HeadSceneOptions = {}) {
    this.ease = opts.ease ?? 0.08;

    // Orthographic: the effect is a flat plane facing the viewer, so a
    // perspective camera would add its own foreshortening on top of the
    // parallax and make the two impossible to tune independently.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this.camera.position.z = 1;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      uniforms: {
        uDiffuse: { value: null },
        uDepth: { value: null },
        uAlpha: { value: null },
        uShadow: { value: null },
        uPointer: { value: this.pointer },
        uParallax: { value: opts.parallax ?? 0.035 },
        uShadow0: { value: opts.shadow ?? 0.65 },
      },
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.scene.add(this.mesh);
  }

  /** Load the four channels the effect needs. */
  async load(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const get = (name: string) =>
      loader.loadAsync(`${TEXTURE_BASE}/${name}.webp`).then((t) => {
        t.colorSpace = name === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        // The portrait must never wrap: a sampled offset that runs past the
        // edge should clamp, not reappear on the opposite side.
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
      });

    const [diffuse, depth, alpha, shadow] = await Promise.all([
      get('diffuse'),
      get('depth'),
      get('alpha'),
      get('shadow'),
    ]);

    this.material.uniforms.uDiffuse!.value = diffuse;
    this.material.uniforms.uDepth!.value = depth;
    this.material.uniforms.uAlpha!.value = alpha;
    this.material.uniforms.uShadow!.value = shadow;

    const img = diffuse.image as { width: number; height: number };
    this.aspect = img.width / img.height;
    this.layout();
  }

  setPointer(nx: number, ny: number): void {
    this.pointerTarget.set(nx, ny);
  }

  set parallax(v: number) {
    this.material.uniforms.uParallax!.value = v;
  }
  set shadow(v: number) {
    this.material.uniforms.uShadow0!.value = v;
  }
  set easing(v: number) {
    this.ease = v;
  }

  /** Fit the plane inside the viewport without distorting the portrait. */
  private layout(): void {
    const view = window.innerWidth / window.innerHeight;
    const scale = view > this.aspect ? 2 : (2 * view) / this.aspect;
    this.mesh.scale.set(scale * this.aspect, scale, 1);
  }

  resize(): void {
    const view = window.innerWidth / window.innerHeight;
    this.camera.left = -view;
    this.camera.right = view;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();
    this.layout();
  }

  update(): void {
    // Exponential smoothing. Frame-rate dependent, which is fine at 60fps and
    // the first thing to replace with a delta-time lerp if it ever isn't.
    this.pointer.lerp(this.pointerTarget, this.ease);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const key of ['uDiffuse', 'uDepth', 'uAlpha', 'uShadow'] as const) {
      (this.material.uniforms[key]!.value as THREE.Texture | null)?.dispose();
    }
    this.material.dispose();
  }
}
