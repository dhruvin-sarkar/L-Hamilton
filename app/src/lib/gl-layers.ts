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
 * Instead the one renderer draws into an OffscreenCanvas, and each finished
 * frame is handed to its layer with transferToImageBitmap, which gives the
 * drawing buffer away rather than copying it. The layers are `bitmaprenderer`
 * canvases, which only display what they are handed -- and keep displaying it,
 * so a layer whose picture has not changed is simply not handed a new one.
 */
export class GLLayer {
  readonly canvas = document.createElement('canvas');
  private readonly context: ImageBitmapRenderingContext;

  /** `opaque` for a layer that paints every pixel, so the compositor need not blend it. */
  constructor(host: HTMLElement, opaque: boolean) {
    const context = this.canvas.getContext('bitmaprenderer', { alpha: !opaque });
    if (!context) throw new Error('[gl] this browser has no bitmaprenderer canvas');
    this.context = context;
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

  /** Show what the renderer just drew. Leaves `source` with a fresh, empty buffer. */
  present(source: OffscreenCanvas): void {
    this.context.transferFromImageBitmap(source.transferToImageBitmap());
  }
}
