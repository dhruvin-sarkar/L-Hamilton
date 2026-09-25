import * as THREE from 'three';

/**
 * The reference's pointer fluid, ported from its own shader set
 * (`140-velocity`, `143-velocity`, `144-velocity`, `145-pressure`,
 * `146-pressure`, `138-velocity`) and run with its own live options, read off
 * the running site (`world.fluidCursor.simulation.options`):
 *
 *   resolution 0.1, cursor_size 18, mouse_force 50, dissipation 0.96,
 *   iterations_poisson 4, straightness 1, dt 0.014, BFECC on, viscosity off,
 *   one step per 1/60s.
 *
 * Those numbers are the look. An earlier port ran the fluid library's stock
 * defaults instead (32-ish pressure iterations, force 20, no dissipation to
 * speak of) and the reveal lingered for well over a second where the
 * reference's is gone in about one.
 *
 * THE THING TO UNDERSTAND FIRST, because it drives every other decision here:
 *
 *   There is no dye. `138-velocity.frag` -- which is what the site samples as
 *   tCursorEffect -- renders the VELOCITY FIELD to colour:
 *
 *       vel = texture(velocity, uv).xy;  len = length(vel);
 *       color = mix(vec3(1.0), vec3(vel * 0.5 + 0.5, 1.0), len);
 *
 *   White where the fluid is still, tinted where it is moving. The consumer
 *   then inverts and thresholds it. So the blob IS live velocity: it moves at
 *   the speed of the fluid and dies the moment the fluid stops.
 */

/** Simulation size as a fraction of the CSS viewport. The reference's `resolution`. */
const RESOLUTION = 0.1;

/**
 * The reference's cell scale: the finite-difference step, in UV, is NOT one
 * texel. It is 1/110 of the width on both axes -- about 1.6 texels at any
 * viewport -- so the stencil, the boundary and the brush all scale with the
 * width of the screen rather than with the buffer.
 */
const CELL_DIVISOR = 1100 * RESOLUTION;

/** Brush radius, in cells. At 1728px wide that is a 141px disc. */
const CURSOR_SIZE = 18;
/** Force per unit of pointer travel, in the reference's units (NDC / 2). */
const MOUSE_FORCE = 50;
/** Velocity kept per step. 0.96^60 leaves under a tenth after one second. */
const DISSIPATION = 0.96;
/** Jacobi iterations. Few, and leaky (below), so the field stays loose. */
const PRESSURE_ITERATIONS = 4;
/**
 * The leak in the pressure solve's divisor. At 1 it is large: pressure never
 * fully builds, so the fluid spreads less and dies sooner than a converged
 * solve would let it.
 */
const STRAIGHTNESS = 1;
/** Fixed timestep, baked into the advection and projection terms. */
const DT = 0.014;
/** How often a step is taken. At most one per frame, never more. */
const STEP_INTERVAL = 1 / 60;

/**
 * Fullscreen pass, pulled in from the edge by one cell.
 *
 * The border cells are never written, so they hold zero velocity forever: the
 * reference's `boundarySpace`, which stops the solve pushing fluid off the
 * edge of the buffer and back in again.
 */
const passVertex = /* glsl */ `
  uniform vec2 boundarySpace;
  varying vec2 vUv;
  void main() {
    vec2 pos = position.xy * (1.0 - boundarySpace * 2.0);
    vUv = 0.5 + pos * 0.5;
    gl_Position = vec4(pos, 0.0, 1.0);
  }
`;

/**
 * BFECC advection with the reference's dissipation.
 *
 * Semi-Lagrangian advection is stable but lossy; BFECC advects forward, back,
 * and re-advects from a point corrected by half the round-trip error, so the
 * swirls keep their shape. `ratio` rescales the step so a velocity covers the
 * same distance on both axes of a non-square buffer.
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

/** Divergence, divided by dt so the pressure solve runs on advection's clock. */
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
    gl_FragColor = vec4((x1 - x0 + y1 - y0) / 2.0 / dt);
  }
`;

/** One Jacobi relaxation toward the pressure that cancels the divergence. */
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

/** Subtract the pressure gradient -- what makes the motion curl rather than spread. */
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
 * Push at the pointer. The reference draws a small quad with additive blending;
 * a pass that reads and adds is the same sum. The falloff is squared-linear, a
 * firmer edge than a gaussian, which is part of why its blobs have shape.
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
 * Velocity to colour -- the reference's `138-velocity.frag`. Rendered at the
 * viewport's own resolution, as the reference's is: the velocity is
 * interpolated first and coloured per pixel, so the thresholded edge a consumer
 * draws is a smooth curve rather than the facets of a 10%-scale buffer.
 */
const outputVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const outputFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D velocity;
  varying vec2 vUv;

  void main() {
    vec2 vel = texture2D(velocity, vUv).xy;
    float len = length(vel);
    vel = vel * 0.5 + 0.5;
    vec3 color = mix(vec3(1.0), vec3(vel.x, vel.y, 1.0), len);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** A ping-pong pair. Every pass reads one and writes the other, then swaps. */
class DoubleTarget {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;

  constructor(opts: THREE.RenderTargetOptions) {
    this.a = new THREE.WebGLRenderTarget(1, 1, opts);
    this.b = new THREE.WebGLRenderTarget(1, 1, opts);
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
   * NOTE THE POLARITY: it rests at WHITE and darkens where the fluid moves.
   * Consumers invert before thresholding -- `step(0.1, 1.0 - texture(...).r)`.
   */
  get texture(): THREE.Texture {
    return this.output.texture;
  }

  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private readonly quad: THREE.Mesh;

  private readonly velocity: DoubleTarget;
  private readonly pressure: DoubleTarget;
  private readonly divergence: THREE.WebGLRenderTarget;
  private readonly output: THREE.WebGLRenderTarget;

  private readonly advect: THREE.ShaderMaterial;
  private readonly divergenceMat: THREE.ShaderMaterial;
  private readonly pressureMat: THREE.ShaderMaterial;
  private readonly projectMat: THREE.ShaderMaterial;
  private readonly force: THREE.ShaderMaterial;
  private readonly outputMat: THREE.ShaderMaterial;

  /** The cell scale, in UV. Shared by every pass that samples its neighbours. */
  private readonly px = new THREE.Vector2(1 / CELL_DIVISOR, 1 / CELL_DIVISOR);
  /** Buffer size in texels, for advection's anisotropy correction. */
  private readonly fboSize = new THREE.Vector2(1, 1);
  private readonly forceCentre = new THREE.Vector2(0.5, 0.5);
  private readonly forceVector = new THREE.Vector2();
  /** Brush radius in UV, per axis -- a circle on screen. */
  private readonly forceScale = new THREE.Vector2();
  /** The border left unwritten; the reference's boundarySpace. */
  private readonly noBoundary = new THREE.Vector2(0, 0);

  /**
   * Uniforms held by reference, not looked up by name every frame: through
   * `material.uniforms` each write needs a `!`, and that is what lets a
   * misspelt name compile and write to nothing.
   */
  private readonly u = {
    advect: {
      velocity: { value: null as THREE.Texture | null },
      dt: { value: DT },
      dissipation: { value: DISSIPATION },
      fboSize: { value: this.fboSize },
      boundarySpace: { value: this.px },
    },
    divergence: {
      velocity: { value: null as THREE.Texture | null },
      dt: { value: DT },
      px: { value: this.px },
      boundarySpace: { value: this.px },
    },
    pressure: {
      pressure: { value: null as THREE.Texture | null },
      divergence: { value: null as THREE.Texture | null },
      straightness: { value: STRAIGHTNESS },
      px: { value: this.px },
      boundarySpace: { value: this.px },
    },
    project: {
      pressure: { value: null as THREE.Texture | null },
      velocity: { value: null as THREE.Texture | null },
      dt: { value: DT },
      px: { value: this.px },
      boundarySpace: { value: this.px },
    },
    force: {
      velocity: { value: null as THREE.Texture | null },
      center: { value: this.forceCentre },
      force: { value: this.forceVector },
      scale: { value: this.forceScale },
      boundarySpace: { value: this.px },
    },
    output: {
      velocity: { value: null as THREE.Texture | null },
      boundarySpace: { value: this.noBoundary },
    },
  };

  private readonly pointer = new THREE.Vector2(0.5, 0.5);
  private readonly lastPointer = new THREE.Vector2(0.5, 0.5);
  /**
   * False until the first position arrives. The reference zeroes the first
   * delta rather than measuring it from wherever its default happened to be,
   * which would throw a splash across the screen on the first mouse move.
   */
  private hasPointer = false;
  private moved = false;
  /** Seconds banked toward the next step. */
  private pending = 0;
  /** Scratch for restOutput, so a resize allocates nothing. */
  private readonly savedClearColor = new THREE.Color();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // Half float: renderable everywhere full float is not, and plenty for this.
    const simTarget: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      // Bilinear: advection reads at sub-texel positions.
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.velocity = new DoubleTarget(simTarget);
    this.pressure = new DoubleTarget(simTarget);
    this.divergence = new THREE.WebGLRenderTarget(1, 1, {
      ...simTarget,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    // The consumer-facing texture. 8-bit is enough -- it is thresholded.
    this.output = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    const shader = (
      fragmentShader: string,
      uniforms: Record<string, THREE.IUniform>,
      vertexShader = passVertex,
    ) =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
      });

    this.advect = shader(advectFragment, this.u.advect);
    this.divergenceMat = shader(divergenceFragment, this.u.divergence);
    this.pressureMat = shader(pressureFragment, this.u.pressure);
    this.projectMat = shader(projectFragment, this.u.project);
    this.force = shader(forceFragment, this.u.force);
    this.outputMat = shader(outputFragment, this.u.output, outputVertex);

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.advect);
    // Written in clip space by the vertex shader, so it must never be culled.
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Pointer position in 0..1 UV space, y up. */
  setPointer(u: number, v: number): void {
    this.pointer.set(u, v);
    if (!this.hasPointer) {
      this.lastPointer.copy(this.pointer);
      this.hasPointer = true;
    }
    this.moved = true;
  }

  /**
   * Size everything off the CSS viewport, as the reference does.
   *
   * The buffer is 10% of the viewport on each axis, and the cell scale, the
   * brush and the boundary are all fractions of its WIDTH -- so the trail is
   * the same size relative to the screen at any resolution, and a round brush
   * stays round on a wide one.
   */
  setSize(cssWidth: number, cssHeight: number): void {
    const w = Math.max(8, Math.round(RESOLUTION * cssWidth));
    const h = Math.max(8, Math.round(RESOLUTION * cssHeight));
    this.velocity.setSize(w, h);
    this.pressure.setSize(w, h);
    this.divergence.setSize(w, h);
    this.output.setSize(Math.max(1, Math.round(cssWidth)), Math.max(1, Math.round(cssHeight)));
    this.restOutput();

    this.fboSize.set(w, h);
    this.px.set(1 / CELL_DIVISOR, w / h / CELL_DIVISOR);
    // CURSOR_SIZE cells is the brush's half-extent in NDC; halve it for UV.
    this.forceScale.set((CURSOR_SIZE * this.px.x) / 2, (CURSOR_SIZE * this.px.y) / 2);
  }

  /**
   * Fill the output with white, "nothing moving", until a step writes it.
   *
   * A freshly sized target is black, and black reads as fluid moving
   * everywhere: the first frame after load or a resize would show the whole
   * screen in the cursor palette with the full helmet over it. (The clock's
   * first delta is zero, so that first frame never steps.)
   */
  private restOutput(): void {
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.getClearColor(this.savedClearColor);
    const savedAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(this.output);
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.clear(true, false, false);
    this.renderer.setClearColor(this.savedClearColor, savedAlpha);
    this.renderer.setRenderTarget(previousTarget);
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Advance by `dt` seconds of wall time. Steps on a fixed 60Hz clock, at most
   * once per call, exactly as the reference does -- so a 120Hz display does
   * not run the fluid at double speed, and a stalled frame does not replay a
   * backlog of steps.
   */
  update(dt: number): void {
    this.pending += dt;
    if (this.pending <= STEP_INTERVAL) return;
    this.pending %= STEP_INTERVAL;
    this.step();
  }

  private step(): void {
    // Advect velocity through itself.
    this.u.advect.velocity.value = this.velocity.read.texture;
    this.pass(this.advect, this.velocity.write);
    this.velocity.swap();

    // Push at the pointer, by however far it travelled since the last step.
    if (this.moved) {
      const dx = this.pointer.x - this.lastPointer.x;
      const dy = this.pointer.y - this.lastPointer.y;
      // The reference's force is diff / 2 * 50 with diff in NDC, which is
      // twice UV -- so it is diff * 50 here.
      this.forceVector.set(dx * MOUSE_FORCE, dy * MOUSE_FORCE);
      // Keep the whole brush inside the written area, as the reference clamps.
      const mx = this.forceScale.x + this.px.x;
      const my = this.forceScale.y + this.px.y;
      this.forceCentre.set(
        Math.min(Math.max(this.pointer.x, mx), 1 - mx),
        Math.min(Math.max(this.pointer.y, my), 1 - my),
      );
      this.u.force.velocity.value = this.velocity.read.texture;
      this.pass(this.force, this.velocity.write);
      this.velocity.swap();
      this.lastPointer.copy(this.pointer);
      this.moved = false;
    }

    // Project to divergence-free.
    const working = this.velocity.read.texture;
    this.u.divergence.velocity.value = working;
    this.pass(this.divergenceMat, this.divergence);

    this.u.pressure.divergence.value = this.divergence.texture;
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      this.u.pressure.pressure.value = this.pressure.read.texture;
      this.pass(this.pressureMat, this.pressure.write);
      this.pressure.swap();
    }

    this.u.project.pressure.value = this.pressure.read.texture;
    this.u.project.velocity.value = working;
    this.pass(this.projectMat, this.velocity.write);
    this.velocity.swap();

    // Velocity -> colour, the texture everything else samples.
    this.u.output.velocity.value = this.velocity.read.texture;
    this.pass(this.outputMat, this.output);

    // Hand the default framebuffer back -- the caller renders the scene next.
    this.renderer.setRenderTarget(null);
  }

  dispose(): void {
    this.velocity.dispose();
    this.pressure.dispose();
    this.divergence.dispose();
    this.output.dispose();
    this.quad.geometry.dispose();
    for (const m of [
      this.advect,
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
