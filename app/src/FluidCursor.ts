import * as THREE from 'three';

/**
 * The reference's pointer fluid, ported from its own shader set
 * (`140-velocity`, `143-velocity`, `144-velocity`, `145-pressure`,
 * `146-pressure`, `138-velocity`).
 *
 * THE THING TO UNDERSTAND FIRST, because it drives every other decision here:
 *
 *   There is no dye. `138-velocity.frag` — which is what the site samples as
 *   tCursorEffect — renders the VELOCITY FIELD to colour:
 *
 *       vel = texture(velocity, uv).xy;  len = length(vel);
 *       color = mix(vec3(1.0), vec3(vel * 0.5 + 0.5, 1.0), len);
 *
 *   White where the fluid is still, tinted where it is moving. The consumer
 *   then inverts and thresholds it. So the blob IS live velocity magnitude.
 *
 * The previous implementation here advected a dye and sampled that. That is a
 * different effect and it is why the cursor felt slow and sludgy: dye is a
 * passive passenger that smears and lingers, so making it visible at all meant
 * cranking its persistence, which made it slower still. Velocity moves at the
 * speed of the fluid and dies the moment the fluid stops. Fast, liquid, and it
 * colours the background rather than staining it.
 *
 * The solve is the standard BFECC-advection / Jacobi-pressure-projection
 * scheme, matched to the reference's exact formulation — the dt placement in
 * particular (divergence divided by it, pressure gradient multiplied by it) is
 * what sets the timescale, and dropping it is most of why a hand-rolled version
 * feels wrong.
 */

/**
 * Simulation height in texels; width follows the viewport aspect.
 *
 * Rectangular, not square. The advection shader corrects anisotropy with a
 * `ratio` term derived from the FBO's own dimensions, so the buffer has to
 * actually know its shape — a square buffer stretched to a 2:1 viewport makes
 * the fluid travel at different speeds horizontally and vertically.
 */
const SIM_HEIGHT = 224;

/**
 * Jacobi iterations for the pressure solve.
 *
 * This fluid's reference implementation ships 32. That is the single most
 * expensive thing in the scene at full count, and the measured cost of the old
 * (cheaper) solve was already ~11fps. 20 keeps the swirls tight enough to read
 * as incompressible while giving most of that back; below about 12 the field
 * starts to visibly puff outward instead of curling.
 */
const PRESSURE_ITERATIONS = 20;

/**
 * Fixed timestep, from the reference. Deliberately NOT the frame delta.
 *
 * Force magnitude, dissipation and the dt terms in the divergence and
 * projection passes all assume it. Real frame time makes the fluid change
 * character with the frame rate.
 */
const DT = 0.014;

/** Reference's mouse_force. Two orders of magnitude above what a naive
 *  pointer-delta gives, and the reason the reference's fluid actually moves. */
const MOUSE_FORCE = 20;

/**
 * Injection radius, as a fraction of viewport HEIGHT.
 *
 * This is the number that decides whether the cursor makes a teardrop or a
 * disc, and the previous value was catastrophically wrong: it was expressed as
 * texels over the buffer height (80 / 160), which is a radius of 0.5 — half the
 * screen. Force was being dumped into an enormous ellipse every frame, so the
 * threshold caught a huge round region and advection never got a chance to
 * shape it.
 *
 * The teardrop is what advection DOES to a small injection. Inject tight, and
 * the velocity field drags that spot along the pointer's path, stretching it
 * and tapering the tail behind it. A sharp change of direction strands the old
 * lobe while a new one forms at the cursor — which is the separation into
 * distinct shapes rather than one travelling blob. None of that emerges unless
 * the injection is small compared to the distance the fluid moves per frame.
 */
/* Nudge this in small steps. The shape does not scale with the radius: force
 * falls off as d-squared across a disc whose area already grows as r-squared,
 * so the region clearing the mask threshold grows much faster than the number
 * does. 0.105 -> 0.125 looked like a modest bump and flooded half the frame. */
const CURSOR_RADIUS = 0.113;

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * BFECC advection.
 *
 * Semi-Lagrangian advection is unconditionally stable but lossy, and the loss
 * shows up as a field that smears into mush within a second. BFECC advects
 * forward, advects that result back, and treats the gap as the error — then
 * re-advects from a point corrected by half of it. Three lookups instead of
 * one, and the swirls survive long enough to read as liquid.
 *
 * `ratio` is the part that is easy to omit and expensive to omit: it rescales
 * the step so a velocity of a given magnitude covers the same DISTANCE on both
 * axes. Without it the fluid runs visibly faster along the short axis.
 */
const advectFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D velocity;
  uniform float dt;
  uniform float dissipation;
  uniform vec2  fboSize;
  varying vec2 vUv;

  void main() {
    vec2 ratio = max(fboSize.x, fboSize.y) / fboSize;

    vec2 spotNew = vUv;
    vec2 velOld  = texture2D(velocity, vUv).xy;

    vec2 spotOld = spotNew - velOld * dt * ratio;
    vec2 velNew1 = texture2D(velocity, spotOld).xy;

    vec2 spotNew2 = spotOld + velNew1 * dt * ratio;
    vec2 error    = spotNew2 - spotNew;

    vec2 spotNew3 = spotNew - error / 2.0;
    vec2 vel2     = texture2D(velocity, spotNew3).xy;

    vec2 spotOld2 = spotNew3 - vel2 * dt * ratio;
    gl_FragColor = vec4(texture2D(velocity, spotOld2).xy * dissipation, 0.0, 1.0);
  }
`;

/**
 * Viscous diffusion, one Jacobi step. This is what the old implementation had
 * no equivalent of, and it is a large part of the "water-like" quality — it
 * couples neighbouring velocities so the field moves as a body rather than as
 * independent pixels.
 */
const viscousFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D velocity;
  uniform sampler2D velocityNew;
  uniform float v;
  uniform float dt;
  uniform vec2  px;
  varying vec2 vUv;

  void main() {
    vec2 old  = texture2D(velocity, vUv).xy;
    vec2 new0 = texture2D(velocityNew, vUv + vec2(px.x * 2.0, 0.0)).xy;
    vec2 new1 = texture2D(velocityNew, vUv - vec2(px.x * 2.0, 0.0)).xy;
    vec2 new2 = texture2D(velocityNew, vUv + vec2(0.0, px.y * 2.0)).xy;
    vec2 new3 = texture2D(velocityNew, vUv - vec2(0.0, px.y * 2.0)).xy;

    vec2 result = 4.0 * old + v * dt * (new0 + new1 + new2 + new3);
    result /= 4.0 * (1.0 + v * dt);

    gl_FragColor = vec4(result, 0.0, 1.0);
  }
`;

/** Divergence — how much the field gains or loses per cell. Divided by dt,
 *  which is what puts the pressure solve on the same timescale as advection. */
const divergenceFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D velocity;
  uniform float dt;
  uniform vec2  px;
  varying vec2 vUv;

  void main() {
    float x0 = texture2D(velocity, vUv - vec2(px.x, 0.0)).x;
    float x1 = texture2D(velocity, vUv + vec2(px.x, 0.0)).x;
    float y0 = texture2D(velocity, vUv - vec2(0.0, px.y)).y;
    float y1 = texture2D(velocity, vUv + vec2(0.0, px.y)).y;
    float divergence = (x1 - x0 + y1 - y0) / 2.0;
    gl_FragColor = vec4(divergence / dt);
  }
`;

/** One Jacobi relaxation toward the pressure that cancels the divergence.
 *
 *  `straightness` in the divisor is a small leak. The domain has no real
 *  boundary conditions, so without it pressure accumulates at the frame edges
 *  and pushes the fluid back inward as a visible rim. */
const pressureFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D pressure;
  uniform sampler2D divergence;
  uniform float straightness;
  uniform vec2  px;
  varying vec2 vUv;

  void main() {
    float p0 = texture2D(pressure, vUv + vec2(px.x * 2.0, 0.0)).r;
    float p1 = texture2D(pressure, vUv - vec2(px.x * 2.0, 0.0)).r;
    float p2 = texture2D(pressure, vUv + vec2(0.0, px.y * 2.0)).r;
    float p3 = texture2D(pressure, vUv - vec2(0.0, px.y * 2.0)).r;
    float div = texture2D(divergence, vUv).r;

    gl_FragColor = vec4((p0 + p1 + p2 + p3) / (4.0 + straightness) - div);
  }
`;

/** Subtract the pressure gradient — this is what makes the motion curl rather
 *  than simply spread. Scaled by dt, matching the divergence pass. */
const projectFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D pressure;
  uniform sampler2D velocity;
  uniform float dt;
  uniform vec2  px;
  varying vec2 vUv;

  void main() {
    float p0 = texture2D(pressure, vUv + vec2(px.x, 0.0)).r;
    float p1 = texture2D(pressure, vUv - vec2(px.x, 0.0)).r;
    float p2 = texture2D(pressure, vUv + vec2(0.0, px.y)).r;
    float p3 = texture2D(pressure, vUv - vec2(0.0, px.y)).r;

    vec2 v = texture2D(velocity, vUv).xy;
    vec2 gradP = vec2(p0 - p1, p2 - p3) * 0.5;
    gl_FragColor = vec4(v - gradP * dt, 0.0, 1.0);
  }
`;

/**
 * Inject force at the pointer.
 *
 * The reference draws a small quad with additive blending; a fullscreen pass
 * that reads and adds is the same operation with one less piece of geometry to
 * keep in sync with the viewport. The falloff is squared-linear rather than
 * gaussian, matching theirs — it gives a firmer-edged push, which is part of
 * why their blobs have shape instead of fading off into a haze.
 */
const forceFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D velocity;
  uniform vec2  center;
  uniform vec2  force;
  uniform vec2  scale;
  varying vec2 vUv;

  void main() {
    vec2 circle = (vUv - center) / scale;
    float d = 1.0 - min(length(circle), 1.0);
    d *= d;
    gl_FragColor = vec4(texture2D(velocity, vUv).xy + force * d, 0.0, 1.0);
  }
`;

/**
 * Velocity to colour — the reference's `138-velocity.frag`, verbatim in
 * behaviour. This is the texture everything else samples as tCursorEffect.
 *
 * White where still, tinted by direction where moving, with the blend weighted
 * by speed. Consumers invert and threshold it, so "how white" is really "how
 * still", and the visible blob is the fast-moving part of the field.
 */
const outputFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D velocity;
  varying vec2 vUv;

  void main() {
    vec2 vel = texture2D(velocity, vUv).xy;
    float len = length(vel);
    vel = vel * 0.5 + 0.5;

    vec3 color = vec3(vel.x, vel.y, 1.0);
    color = mix(vec3(1.0), color, len);

    gl_FragColor = vec4(color, 1.0);
  }
`;

/** A ping-pong pair. Every pass reads one and writes the other, then swaps. */
class DoubleTarget {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;

  constructor(width: number, height: number, type: THREE.TextureDataType) {
    const opts = {
      type,
      format: THREE.RGBAFormat,
      // Bilinear: advection reads at arbitrary sub-texel positions, and nearest
      // sampling turns that into visible blocking.
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      // Clamp, or velocity leaving one edge re-enters at the opposite one and
      // the fluid wraps around the frame.
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.a = new THREE.WebGLRenderTarget(width, height, opts);
    this.b = new THREE.WebGLRenderTarget(width, height, opts);
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
  setSize(w: number, h: number): void {
    this.a.setSize(w, h);
    this.b.setSize(w, h);
  }
  dispose(): void {
    this.a.dispose();
    this.b.dispose();
  }
}

export class FluidCursor {
  /**
   * Sample this as the cursor mask.
   *
   * NOTE THE POLARITY: this is the reference's velocity-to-colour output, so it
   * rests at WHITE and darkens where the fluid moves. Consumers must invert
   * before thresholding — `step(0.1, 1.0 - texture(...).r)`. Reading it the
   * same way round as a dye buffer lights up the entire frame.
   */
  get texture(): THREE.Texture {
    return this.output.texture;
  }

  /** Kinematic viscosity. Higher is thicker and more coupled. */
  viscosity = 30;
  /**
   * Jacobi iterations for the viscous diffusion. ZERO by default — the pass is
   * skipped entirely.
   *
   * The reference ships this effect with viscosity off, and that is the right
   * call for the look being chased here: diffusion couples neighbouring
   * velocities, which smooths the field and pulls separate lobes back into one
   * mass. Turning it off is what lets a sharp change of direction strand the
   * old shape and start a new one, and lets fast flicks throw ragged, erratic
   * forms instead of tidy ovals. It also removes several fullscreen passes.
   */
  viscousIterations = 0;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private readonly quad: THREE.Mesh;

  private readonly velocity: DoubleTarget;
  private readonly viscous: DoubleTarget;
  private readonly pressure: DoubleTarget;
  private readonly divergence: THREE.WebGLRenderTarget;
  private readonly output: THREE.WebGLRenderTarget;

  private readonly advect: THREE.ShaderMaterial;
  private readonly viscousMat: THREE.ShaderMaterial;
  private readonly divergenceMat: THREE.ShaderMaterial;
  private readonly pressureMat: THREE.ShaderMaterial;
  private readonly projectMat: THREE.ShaderMaterial;
  private readonly force: THREE.ShaderMaterial;
  private readonly outputMat: THREE.ShaderMaterial;

  private readonly pointer = new THREE.Vector2(0.5, 0.5);
  private readonly lastPointer = new THREE.Vector2(0.5, 0.5);
  private moved = false;

  private width = SIM_HEIGHT;
  private height = SIM_HEIGHT;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // Half float, not full float: universally renderable where full float is
    // not, and the field never needs more precision than this.
    const type = THREE.HalfFloatType;
    const w = this.width;
    const h = this.height;

    this.velocity = new DoubleTarget(w, h, type);
    this.viscous = new DoubleTarget(w, h, type);
    this.pressure = new DoubleTarget(w, h, type);
    this.divergence = new THREE.WebGLRenderTarget(w, h, {
      type,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    // The consumer-facing texture. Plain 8-bit is enough — it is thresholded.
    this.output = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    const px = new THREE.Vector2(1 / w, 1 / h);
    const fboSize = new THREE.Vector2(w, h);
    const shader = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({
        vertexShader: quadVertex,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
      });

    this.advect = shader(advectFragment, {
      velocity: { value: null },
      dt: { value: DT },
      // Velocity decay. Close to 1 so the field keeps drifting after the
      // pointer stops — but this is velocity, not dye, so it still dies quickly
      // enough that the blob tracks the cursor rather than trailing behind it.
      dissipation: { value: 0.991 },
      fboSize: { value: fboSize },
    });
    this.viscousMat = shader(viscousFragment, {
      velocity: { value: null },
      velocityNew: { value: null },
      v: { value: this.viscosity },
      dt: { value: DT },
      px: { value: px },
    });
    this.divergenceMat = shader(divergenceFragment, {
      velocity: { value: null },
      dt: { value: DT },
      px: { value: px },
    });
    this.pressureMat = shader(pressureFragment, {
      pressure: { value: null },
      divergence: { value: null },
      straightness: { value: 0.1 },
      px: { value: px },
    });
    this.projectMat = shader(projectFragment, {
      pressure: { value: null },
      velocity: { value: null },
      dt: { value: DT },
      px: { value: px },
    });
    this.force = shader(forceFragment, {
      velocity: { value: null },
      center: { value: new THREE.Vector2(0.5, 0.5) },
      force: { value: new THREE.Vector2() },
      scale: { value: new THREE.Vector2(0.1, 0.1) },
    });
    this.outputMat = shader(outputFragment, { velocity: { value: null } });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.advect);
    // Written in clip space by the vertex shader, so it must never be culled.
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Pointer position in 0..1 UV space, y up. */
  setPointer(u: number, v: number): void {
    this.pointer.set(u, v);
    this.moved = true;
  }

  /**
   * Match the simulation buffer to the viewport's shape.
   *
   * The buffer has to be the right SHAPE, not just the right size: the
   * advection pass derives its anisotropy correction from fboSize, so a square
   * buffer on a wide viewport makes the fluid run faster vertically than
   * horizontally.
   */
  setAspect(aspect: number): void {
    const w = Math.max(8, Math.round(SIM_HEIGHT * aspect));
    const h = SIM_HEIGHT;
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;

    this.velocity.setSize(w, h);
    this.viscous.setSize(w, h);
    this.pressure.setSize(w, h);
    this.divergence.setSize(w, h);
    this.output.setSize(w, h);

    for (const m of [this.viscousMat, this.divergenceMat, this.pressureMat, this.projectMat]) {
      (m.uniforms.px!.value as THREE.Vector2).set(1 / w, 1 / h);
    }
    (this.advect.uniforms.fboSize!.value as THREE.Vector2).set(w, h);
    /* Keep the push round ON SCREEN, not in UV.
     *
     * A given UV distance covers more pixels horizontally on a wide viewport,
     * so an isotropic UV radius comes out as a horizontally-stretched ellipse.
     * Dividing x by the aspect makes the injected spot circular where it is
     * actually seen — and a circular seed is what lets the direction of travel,
     * rather than the shape of the brush, decide which way the teardrop points.
     */
    (this.force.uniforms.scale!.value as THREE.Vector2).set(
      CURSOR_RADIUS / aspect,
      CURSOR_RADIUS,
    );
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  update(): void {
    // Inject force from pointer movement.
    if (this.moved) {
      const dx = this.pointer.x - this.lastPointer.x;
      const dy = this.pointer.y - this.lastPointer.y;
      this.force.uniforms.center!.value.copy(this.pointer);
      (this.force.uniforms.force!.value as THREE.Vector2).set(dx * MOUSE_FORCE, dy * MOUSE_FORCE);
      this.force.uniforms.velocity!.value = this.velocity.read.texture;
      this.pass(this.force, this.velocity.write);
      this.velocity.swap();
      this.lastPointer.copy(this.pointer);
      this.moved = false;
    }

    // Advect velocity through itself.
    this.advect.uniforms.velocity!.value = this.velocity.read.texture;
    this.pass(this.advect, this.velocity.write);
    this.velocity.swap();

    /* Viscous diffusion. Iterated Jacobi, seeded from the advected field.
     *
     * `working` is what the projection reads next, and it must NOT be assumed
     * to be the viscous buffer: at zero iterations that target is never written
     * and still holds whatever was last in it, so the rest of the solve would
     * run on a stale frame and the fluid would visibly stutter. Off means the
     * advected velocity passes straight through. */
    let working = this.velocity.read.texture;
    if (this.viscousIterations > 0) {
      this.viscousMat.uniforms.v!.value = this.viscosity;
      this.viscousMat.uniforms.velocity!.value = this.velocity.read.texture;
      for (let i = 0; i < this.viscousIterations; i++) {
        this.viscousMat.uniforms.velocityNew!.value =
          i === 0 ? this.velocity.read.texture : this.viscous.read.texture;
        this.pass(this.viscousMat, this.viscous.write);
        this.viscous.swap();
      }
      working = this.viscous.read.texture;
    }

    // Project to divergence-free.
    this.divergenceMat.uniforms.velocity!.value = working;
    this.pass(this.divergenceMat, this.divergence);

    this.pressureMat.uniforms.divergence!.value = this.divergence.texture;
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      this.pressureMat.uniforms.pressure!.value = this.pressure.read.texture;
      this.pass(this.pressureMat, this.pressure.write);
      this.pressure.swap();
    }

    this.projectMat.uniforms.pressure!.value = this.pressure.read.texture;
    this.projectMat.uniforms.velocity!.value = working;
    this.pass(this.projectMat, this.velocity.write);
    this.velocity.swap();

    // Velocity -> colour, the texture everything else samples.
    this.outputMat.uniforms.velocity!.value = this.velocity.read.texture;
    this.pass(this.outputMat, this.output);

    // Hand the default framebuffer back — the caller renders the scene next,
    // and leaving a target bound here draws the whole hero into it.
    this.renderer.setRenderTarget(null);
  }

  dispose(): void {
    this.velocity.dispose();
    this.viscous.dispose();
    this.pressure.dispose();
    this.divergence.dispose();
    this.output.dispose();
    this.quad.geometry.dispose();
    for (const m of [
      this.advect,
      this.viscousMat,
      this.divergenceMat,
      this.pressureMat,
      this.projectMat,
      this.force,
      this.outputMat,
    ]) {
      m.dispose();
    }
  }
}
