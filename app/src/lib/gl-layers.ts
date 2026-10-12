/**
 * One WebGL context, shown on more than one DOM canvas.
 *
 * The Home hero is two GL layers with DOM text between them: the contour field
 * at the bottom, the marquee bands over it, the portrait plate over those. A
 * canvas cannot interleave with a DOM element, so the two layers are two
 * canvases -- and they used to be two WebGLRenderers, which is two contexts,
 * two copies of every shader program, and a second GPU process allocation for
 * a scene that is one full-screen quad.
 *
 * Instead the one renderer draws into a surface that is never on the page, and
 * each finished frame is handed to its layer.
 */

/** What the renderer draws into. */
export type GLSurface = OffscreenCanvas | HTMLCanvasElement;

/**
 * The surface, with the context the renderer will draw through, or null where
 * the browser has no WebGL2 to give.
 *
 * An OffscreenCanvas wherever one takes a WebGL context, because its frame can
 * be given away with transferToImageBitmap rather than copied. Safari has had
 * the canvas since 16.4 but only its 2D context until 17, and iOS 16 is where
 * an iPhone 8 or X stays: there the same renderer draws into an ordinary
 * canvas that is never attached, and its layers copy from it. Decided once,
 * here, and each layer follows from the surface it is given.
 *
 * The context is made here, not by Three, so that a browser which refuses one
 * is found by asking and not by catching what Three throws and logs. These are
 * the attributes Three would ask for on a renderer with antialias and alpha.
 */
export function createSurface(): { canvas: GLSurface; context: WebGL2RenderingContext } | null {
  const attributes: WebGLContextAttributes = { alpha: true, antialias: true };
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('webgl2', attributes);
    if (context) return { canvas, context };
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', attributes);
  return context ? { canvas, context } : null;
}

export class GLLayer {
  readonly canvas = document.createElement('canvas');

  /**
   * Show what the renderer just drew. Called straight after the draw, in the
   * same task: a surface that copies has only that long before its drawing
   * buffer is no longer its to read.
   */
  readonly present: () => void;

  /**
   * Show an empty picture: transparent on a layer with alpha, black on an
   * opaque one.
   *
   * For a layer whose CSS box has to paint before any frame reaches it.
   * Chrome draws nothing at all for a `bitmaprenderer` canvas that has never
   * been handed a bitmap — not its background either — and keeps drawing it
   * once it has, through every later resize.
   */
  readonly clear: () => void;

  /**
   * `opaque` for a layer that paints every pixel, so the compositor need not
   * blend it. `surface` is null where there is no renderer: the layer is still
   * a box on the page, and still paints its ground.
   */
  constructor(host: HTMLElement, opaque: boolean, surface: GLSurface | null) {
    if (typeof OffscreenCanvas !== 'undefined' && surface instanceof OffscreenCanvas) {
      /* A `bitmaprenderer` canvas only displays what it is handed -- and keeps
         displaying it, so a layer whose picture has not changed is simply not
         handed a new one. The transfer leaves the surface a fresh, empty
         buffer. */
      const context = this.canvas.getContext('bitmaprenderer', { alpha: !opaque });
      if (!context) throw new Error('[gl] this browser has no bitmaprenderer canvas');
      this.present = () => context.transferFromImageBitmap(surface.transferToImageBitmap());
      this.clear = () => context.transferFromImageBitmap(null);
    } else {
      const context = this.canvas.getContext('2d', { alpha: !opaque });
      if (!context) throw new Error('[gl] this browser has no 2D canvas');
      this.clear = () => context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.present = () => {
        if (!surface) return;
        // The plate is transparent round the portrait, so the last frame has
        // to go before this one is laid down or the two would add up.
        this.clear();
        context.drawImage(surface, 0, 0);
      };
    }
    host.appendChild(this.canvas);
  }

  /**
   * The drawing buffer size, in device pixels, which is the size every frame
   * handed over will be. Set it here too so the canvas never resamples one.
   */
  setSize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
}
