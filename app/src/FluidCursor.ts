import * as THREE from 'three';

/**
 * A GPU fluid simulation driven by the pointer, rendered to a texture that other
 * materials sample as a mask.
 *
 * This is the reference's cursor mechanic. Its shader set includes velocity,
 * divergence and pressure passes, and its head material takes a `tCursorEffect`
 * sampler alongside `uHelmetHover` — the cursor does not move the helmet, it
 * paints a field that decides where the helmet is visible. Sweeping the pointer
 * pushes dye through a velocity field, and the swirls that leaves behind are the
 * "blobs" that wipe the shell away.
 *
 * The method is standard published GPU fluid technique — semi-Lagrangian
 * advection with a BFECC error-correction pass, a Jacobi pressure solve, then a
 * gradient subtraction to make the field divergence-free. Written here from the
 * algorithm rather than lifted, so nothing third-party ships in this build.
 *
 * Runs at SIM_SIZE regardless of viewport: the output is a soft mask, so
 * resolution buys nothing visible and costs fill rate on every pass.
 */

const SIM_SIZE = 128;
/** Jacobi is iterative — more passes means a stiffer, less springy fluid. */
const PRESSURE_ITERATIONS = 12;

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Semi-Lagrangian advection: trace backwards along the velocity field and read
 * what was there. Unconditionally stable, which is why it is the standard
 * choice — but it is also lossy, and the loss shows up as a field that smears
 * into mush within a second or two.
 *
 * BFECC corrects that: advect forward, advect the result back, and the gap
 * between where you started and where you land is the error. Subtract half of it
 * and the swirls survive long enough to read as liquid.
 */
const advectFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uTarget;
  uniform sampler2D uVelocity;
  uniform float uDt;
  uniform float uDissipation;
  varying vec2 vUv;

  void main() {
    vec2 vel = texture2D(uVelocity, vUv).xy;

    vec2 back    = vUv - vel * uDt;
    vec2 forward = back + texture2D(uVelocity, back).xy * uDt;
    // The gap between where the round trip lands and where it started is the
    // advection error; half of it is the standard correction.
    vec2 error   = forward - vUv;

    gl_FragColor = texture2D(uTarget, back - error * 0.5) * uDissipation;
  }
`;

/**
 * Divergence: how much the field is gaining or losing at each cell. A real
 * incompressible fluid has none, so this is the error the pressure solve exists
 * to cancel out.
 */
const divergenceFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  varying vec2 vUv;

  void main() {
    float l = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
    float t = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
    gl_FragColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
  }
`;

/** One Jacobi relaxation step toward the pressure that cancels the divergence. */
const pressureFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexel;
  varying vec2 vUv;

  void main() {
    float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float t = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    float d = texture2D(uDivergence, vUv).x;
    gl_FragColor = vec4((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0);
  }
`;

/** Subtract the pressure gradient — this is what makes the motion curl. */
const gradientFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  varying vec2 vUv;

  void main() {
    float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float b = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float t = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    vec2 vel = texture2D(uVelocity, vUv).xy;
    gl_FragColor = vec4(vel - vec2(r - l, t - b), 0.0, 1.0);
  }
`;

/**
 * Inject at the pointer. The falloff is gaussian in aspect-corrected space, so
 * the splat stays round on a wide viewport instead of stretching into an ellipse.
 */
const splatFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uTarget;
  uniform vec2  uPoint;
  uniform vec3  uValue;
  uniform float uRadius;
  uniform float uAspect;
  varying vec2 vUv;

  void main() {
    vec2 d = vUv - uPoint;
    d.x *= uAspect;
    vec3 splat = exp(-dot(d, d) / uRadius) * uValue;
    gl_FragColor = vec4(splat + texture2D(uTarget, vUv).xyz, 1.0);
  }
`;

/** A ping-pong pair. Every pass reads one and writes the other, then swaps. */
class DoubleTarget {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;

  constructor(size: number, type: THREE.TextureDataType) {
    const opts = {
      type,
      format: THREE.RGBAFormat,
      // Bilinear: advection reads at arbitrary sub-texel positions, and nearest
      // sampling turns that into visible blocking.
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.a = new THREE.WebGLRenderTarget(size, size, opts);
    this.b = new THREE.WebGLRenderTarget(size, size, opts);
  }

  get read(): THREE.WebGLRenderTarget {
    return this.a;
  }
  get write(): THREE.WebGLRenderTarget {
    return this.b;
  }
  swap(): void {
    [this.a, this.b] = [this.b, this.a];
  }
  dispose(): void {
    this.a.dispose();
    this.b.dispose();
  }
}

export class FluidCursor {
  /** Sample this as the cursor mask. Red channel carries the dye. */
  get texture(): THREE.Texture {
    return this.dye.read.texture;
  }

  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private readonly quad: THREE.Mesh;

  private readonly velocity: DoubleTarget;
  private readonly dye: DoubleTarget;
  private readonly pressure: DoubleTarget;
  private readonly divergence: THREE.WebGLRenderTarget;

  private readonly advect: THREE.ShaderMaterial;
  private readonly divergenceMat: THREE.ShaderMaterial;
  private readonly pressureMat: THREE.ShaderMaterial;
  private readonly gradientMat: THREE.ShaderMaterial;
  private readonly splat: THREE.ShaderMaterial;

  private readonly pointer = new THREE.Vector2(0.5, 0.5);
  private readonly lastPointer = new THREE.Vector2(0.5, 0.5);
  private moved = false;
  private aspect = 1;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // Half float, not full float: it is universally renderable where full float
    // is not, and the field never needs more precision than this.
    const type = THREE.HalfFloatType;
    this.velocity = new DoubleTarget(SIM_SIZE, type);
    this.dye = new DoubleTarget(SIM_SIZE, type);
    this.pressure = new DoubleTarget(SIM_SIZE, type);
    this.divergence = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
      type,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    const texel = new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE);
    const shader = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader, uniforms });

    this.advect = shader(advectFragment, {
      uTarget: { value: null },
      uVelocity: { value: null },
      uDt: { value: 0.016 },
      uDissipation: { value: 1 },
    });
    this.divergenceMat = shader(divergenceFragment, {
      uVelocity: { value: null },
      uTexel: { value: texel },
    });
    this.pressureMat = shader(pressureFragment, {
      uPressure: { value: null },
      uDivergence: { value: null },
      uTexel: { value: texel },
    });
    this.gradientMat = shader(gradientFragment, {
      uPressure: { value: null },
      uVelocity: { value: null },
      uTexel: { value: texel },
    });
    this.splat = shader(splatFragment, {
      uTarget: { value: null },
      uPoint: { value: new THREE.Vector2() },
      uValue: { value: new THREE.Vector3() },
      // Blob size. Small values give a thin thread that reads as a scratch
      // rather than a blob — this is the single knob that decides whether the
      // effect looks like liquid or like a pen line.
      uRadius: { value: 0.0022 },
      uAspect: { value: 1 },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.advect);
    // The quad is written in clip space by the vertex shader, so it must never
    // be culled against the camera's frustum.
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Pointer position in 0..1 UV space, y up. */
  setPointer(u: number, v: number): void {
    this.pointer.set(u, v);
    this.moved = true;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt: number): void {
    // Clamp: a backgrounded tab resumes with a huge delta, and advecting by it
    // throws the whole field off the edge in a single step.
    const step = Math.min(dt, 1 / 30);

    if (this.moved) {
      const dx = (this.pointer.x - this.lastPointer.x) * 6;
      const dy = (this.pointer.y - this.lastPointer.y) * 6;

      // Force follows pointer velocity, which is what makes a flick throw a
      // longer streak than a slow drag — the behaviour the effect is built on.
      this.splat.uniforms.uPoint!.value.copy(this.pointer);
      this.splat.uniforms.uAspect!.value = this.aspect;

      this.splat.uniforms.uTarget!.value = this.velocity.read.texture;
      this.splat.uniforms.uValue!.value.set(dx, dy, 0);
      this.pass(this.splat, this.velocity.write);
      this.velocity.swap();

      this.splat.uniforms.uTarget!.value = this.dye.read.texture;
      this.splat.uniforms.uValue!.value.set(0.9, 0, 0);
      this.pass(this.splat, this.dye.write);
      this.dye.swap();

      this.lastPointer.copy(this.pointer);
      this.moved = false;
    }

    this.advect.uniforms.uDt!.value = step;
    this.advect.uniforms.uVelocity!.value = this.velocity.read.texture;
    this.advect.uniforms.uTarget!.value = this.velocity.read.texture;
    // Velocity decays slowly; the field should keep drifting after the pointer
    // stops rather than freezing in place.
    this.advect.uniforms.uDissipation!.value = 0.985;
    this.pass(this.advect, this.velocity.write);
    this.velocity.swap();

    this.divergenceMat.uniforms.uVelocity!.value = this.velocity.read.texture;
    this.pass(this.divergenceMat, this.divergence);

    this.pressureMat.uniforms.uDivergence!.value = this.divergence.texture;
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      this.pressureMat.uniforms.uPressure!.value = this.pressure.read.texture;
      this.pass(this.pressureMat, this.pressure.write);
      this.pressure.swap();
    }

    this.gradientMat.uniforms.uPressure!.value = this.pressure.read.texture;
    this.gradientMat.uniforms.uVelocity!.value = this.velocity.read.texture;
    this.pass(this.gradientMat, this.velocity.write);
    this.velocity.swap();

    this.advect.uniforms.uVelocity!.value = this.velocity.read.texture;
    this.advect.uniforms.uTarget!.value = this.dye.read.texture;
    // Dye fades faster than velocity so the trail has a tail rather than
    // saturating the whole frame after a few seconds of movement. Kept high
    // enough that a blob survives long enough to actually be looked at.
    this.advect.uniforms.uDissipation!.value = 0.978;
    this.pass(this.advect, this.dye.write);
    this.dye.swap();

    // Hand the default framebuffer back — the caller renders the scene next,
    // and leaving a target bound here draws the whole hero into it.
    this.renderer.setRenderTarget(null);
  }

  dispose(): void {
    this.velocity.dispose();
    this.dye.dispose();
    this.pressure.dispose();
    this.divergence.dispose();
    this.quad.geometry.dispose();
    for (const m of [
      this.advect,
      this.divergenceMat,
      this.pressureMat,
      this.gradientMat,
      this.splat,
    ]) {
      m.dispose();
    }
  }
}
