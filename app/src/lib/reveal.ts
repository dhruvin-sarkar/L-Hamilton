/**
 * The accent-bar text reveal — the reference's `.high-line-reveal`, and by its
 * own count the highest-leverage mechanic on any of these pages (82 elements on
 * /on-track alone).
 *
 * MOVED from main.ts rather than rewritten. The three couplings that were
 * specific to the homepage are now options, because the shape of the problem
 * repeats on every page while the selectors do not:
 *
 *   immediate  lines that must fire with the page entrance instead of on
 *              intersection. A block sitting at the bottom of a full-height
 *              hero starts inside the observer's dead band and would never
 *              trigger at any scroll position — content lost to an animation
 *              that never ran.
 *   sideways   lines that arrive on the X axis under a horizontal scrub, where
 *              a bottom-edge margin is simply the wrong axis.
 *   whenReady  how the page signals its entrance is done.
 *
 * CSS owns the animation (see `.reveal-text` in home.css); this only decides
 * when each line starts and how long it waits.
 */

import { ScrollTrigger, reducedMotion } from './motion';

export interface RevealOptions {
  /** Selector for an ancestor whose lines fire on entrance, not on scroll. */
  immediate?: string;
  /** Selector for an ancestor whose lines arrive horizontally. */
  sideways?: string;
  /**
   * The sideways lines' trigger, as an IntersectionObserver rootMargin.
   * Defaults to Home's: 14% in from the right edge.
   */
  sidewaysMargin?: string;
  /** Runs its callback once the page entrance has finished. */
  whenReady: (run: () => void) => void;
}

export function mountReveals(opts: RevealOptions): void {
  if (!reducedMotion) {
    /* Hides the lines so they can be swept in. Set here rather than in the
       stylesheet so the hidden state cannot outlive the code that reveals it. */
    document.documentElement.dataset.revealAnimated = '';

    const lines = [...document.querySelectorAll<HTMLElement>('.reveal-text')];

    /**
     * The stagger, counted within a section rather than across the document.
     *
     * It used to be the element's global index, which quietly punished anything
     * far down the page: the On Track and Off Track blurbs came out at 1260ms and
     * 1350ms and visibly trailed the section they belong to. The stagger exists to
     * make one group read top to bottom, so it has to restart at each group —
     * otherwise it is not a stagger, it is an accumulating delay.
     */
    /* ---- splitting a block into one bar per visual line ----
     *
     * The reference does this and it is the whole reason its copy arrives a line
     * at a time: every paragraph is cut into <span class="line"> boxes, each with
     * its own bar, ~0.15s apart. One bar across a four-line paragraph cannot
     * express that no matter how it is eased.
     *
     * Lines are a rendering fact, not a markup one, so they have to be MEASURED:
     * wrap each word, read the line box it landed in off offsetTop, then rebuild
     * the block one span per distinct box. */

    /* Read from --stagger-line rather than restated here. The token said 150ms
       and this said 150, which is two sources of truth for one beat — and the
       token was the one nothing read, so tuning it did nothing. */
    const LINE_STAGGER =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--stagger-line'),
      ) || 150;

    /**
     * A block's authored content, flattened to a list of formatted runs.
     *
     * Kept so a re-split starts from what was written and not from the spans
     * the previous split left behind — and kept as a LIST rather than a string
     * because a block can legitimately carry inline formatting. The reference's
     * On Track hero closes its paragraph on an accent clause set in a second
     * face, mid-sentence, and a block rebuilt from `textContent` loses that span
     * silently: the words survive, the emphasis does not.
     *
     * A WeakMap rather than a data attribute, because markup does not survive a
     * round trip through a string and an attribute holding serialised HTML is a
     * second parser nobody asked for.
     */
    interface Run {
      text: string;
      /** Class of the inline element this run came from; '' at the top level. */
      cls: string;
      /** A hard <br>. Carried because the author put a line there on purpose. */
      br?: boolean;
    }

    const authored = new WeakMap<HTMLElement, Run[]>();

    const runsOf = (el: HTMLElement): Run[] => {
      const cached = authored.get(el);
      if (cached) return cached;
      const runs: Run[] = [];
      const walk = (node: Node, cls: string): void => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            runs.push({ text: child.nodeValue ?? '', cls });
          } else if (child instanceof HTMLElement) {
            /* A <br> has no text to recurse into, so walking it found nothing
               and the break vanished from the rebuild — a six-line statement
               came back as five with its opening word pulled up into the
               second. Recorded as a run of its own instead. */
            if (child.tagName === 'BR') runs.push({ text: '', cls: '', br: true });
            else walk(child, child.className);
          }
        }
      };
      walk(el, '');
      authored.set(el, runs);
      return runs;
    };

    /** Writes a run list back as authored. The restore path, and the one-line case. */
    const writeRuns = (el: HTMLElement, runs: Run[]): void => {
      el.textContent = '';
      for (const run of runs) {
        if (run.br) {
          el.appendChild(document.createElement('br'));
          continue;
        }
        if (!run.cls) {
          el.appendChild(document.createTextNode(run.text));
          continue;
        }
        const span = document.createElement('span');
        span.className = run.cls;
        span.textContent = run.text;
        el.appendChild(span);
      }
    };

    /* Blocks laid out as blocks, whose markup the rebuild above can put back.
       Plain text always qualifies. Anything with element children has to say so
       with `data-reveal-rich`, because most of them — a link wrapping an
       .sr-only label, an eyebrow wrapping an icon — carry structure the run list
       would flatten into meaningless spans. Opting in per block keeps that
       decision at the markup, where the author can see what is at stake. */
    const splittable = (el: HTMLElement): boolean =>
      // A block we split ourselves is still eligible: its only children are the
      // `.reveal-line` spans this module created, and `runsOf` kept what they
      // were built from. Requiring zero children unconditionally — as this did —
      // meant the resize re-split below skipped every block it had already cut,
      // so it had never actually re-cut anything.
      (el.childElementCount === 0 ||
        el.dataset.revealSplit !== undefined ||
        el.dataset.revealRich !== undefined) &&
      (el.textContent ?? '').trim().length > 0 &&
      getComputedStyle(el).display.includes('block');

    const splitIntoLines = (el: HTMLElement, baseDelay: number): void => {
      const runs = runsOf(el);

      /* Every break opportunity its own box, so offsetTop reports which line it
       * fell on.
       *
       * A "word" here is NOT simply a run between spaces, because that is not
       * where browsers are allowed to break. They also break after a hyphen —
       * so `race-by-race` can occupy two visual lines while being a single
       * whitespace-delimited token. Grouping by whitespace alone put that whole
       * compound on one row and, because a `.reveal-line` is `nowrap`, produced
       * a line 384px wide inside a 320px column and pushed the document 44px
       * past the viewport at 360px.
       *
       * Each piece therefore records whether real whitespace followed it, and
       * the row is reassembled from that rather than by rejoining with spaces —
       * otherwise the fragments of a hyphenated compound come back as
       * "race- by- race".
       */
      interface Piece {
        span: HTMLElement;
        text: string;
        /** Carried through the cut so the rebuild can re-wrap it. */
        cls: string;
        spaceAfter: boolean;
      }

      el.textContent = '';
      const pieces: Piece[] = [];
      for (const run of runs) {
        /* Put the break into the MEASURING pass rather than handling it in the
           grouping below: with a real <br> in the flow the pieces after it land
           on a new line box on their own, and the row splitter sees it the same
           way it sees a natural wrap. */
        if (run.br) {
          el.appendChild(document.createElement('br'));
          continue;
        }
        for (const token of run.text.split(/(\s+)/)) {
          if (!token) continue;
          if (/^\s+$/.test(token)) {
            el.appendChild(document.createTextNode(token));
            const last = pieces[pieces.length - 1];
            if (last) last.spaceAfter = true;
            continue;
          }
          // Keep the hyphen on the fragment before it — that is the side it
          // stays on when a browser breaks there.
          for (const fragment of token.split(/(?<=-)/)) {
            if (!fragment) continue;
            const span = document.createElement('span');
            span.textContent = fragment;
            /* The measuring span wears the run's class too. The accent clause is
               a different face at a different width, and a line cut against the
               base face's metrics would break in the wrong place. */
            if (run.cls) span.className = run.cls;
            el.appendChild(span);
            pieces.push({ span, text: fragment, cls: run.cls, spaceAfter: false });
          }
        }
      }

      /* Grouped by each piece's vertical MIDPOINT, against a half-line
       * tolerance — not by its offsetTop against a 1px one.
       *
       * offsetTop is the top of an inline box, not the line it sits on, and two
       * faces on the same line do not agree on it: the Didone the accent clause
       * is set in has a taller ascent than the grotesque around it, so its box
       * starts several pixels higher. Against a 1px tolerance that reads as a
       * line break, and a four-line paragraph came out as six rows — "still",
       * "driving for the eighth" and "." each on their own.
       *
       * A midpoint moves by a few pixels between faces and by a whole
       * line-height at a real break, so the two cases stop overlapping. */
      const leading = Number.parseFloat(getComputedStyle(el).lineHeight);
      const tolerance = Number.isFinite(leading) ? leading / 2 : 2;

      const rows: Piece[][] = [];
      let current: Piece[] = [];
      let anchor: number | null = null;
      for (const piece of pieces) {
        const middle = piece.span.offsetTop + piece.span.offsetHeight / 2;
        // Measured against the row's FIRST piece rather than the previous one,
        // so a run of small drifts cannot accumulate into a false break.
        if (anchor === null || Math.abs(middle - anchor) > tolerance) {
          current = [];
          rows.push(current);
          anchor = middle;
        }
        current.push(piece);
      }

      /** A row's text, with the separators it actually had.
       *
       * The trailing space on a row's last piece is kept rather than trimmed.
       * Dropping it looked harmless — a line box discards trailing whitespace,
       * so nothing moves — but the block's own text is the concatenation of its
       * lines, and without it the word boundary at every break disappeared:
       * "61 of" + "them from" read back as "61 ofthem" to `textContent`,
       * find-in-page, copy-paste and anything extracting the accessible name. */
      const fillRow = (line: HTMLElement, row: Piece[]): void => {
        /* Consecutive pieces sharing a class go into ONE span rather than one
           each, so a clause set in the accent face stays a single run of text
           and kerns as it was written. */
        let wrapper: HTMLElement | null = null;
        let open: string | null = null;
        for (const piece of row) {
          if (piece.cls !== open) {
            open = piece.cls;
            wrapper = null;
            if (piece.cls) {
              wrapper = document.createElement('span');
              wrapper.className = piece.cls;
              line.appendChild(wrapper);
            }
          }
          const text = piece.spaceAfter ? `${piece.text} ` : piece.text;
          (wrapper ?? line).appendChild(document.createTextNode(text));
        }
      };

      // One line is not a cascade, and wrapping it would swap its inline layout
      // for a block one for no gain. Put the block back exactly as it was.
      if (rows.length < 2) {
        writeRuns(el, runs);
        delete el.dataset.revealSplit;
        return;
      }

      el.textContent = '';
      rows.forEach((row, i) => {
        const line = document.createElement('span');
        line.className = 'reveal-line';
        fillRow(line, row);
        line.style.setProperty('--reveal-delay', `${baseDelay + i * LINE_STAGGER}ms`);
        el.appendChild(line);
      });
      el.dataset.revealSplit = '';

      /* Backstop. Every line is `nowrap`, so one that does not fit does not
       * wrap — it spills, and the page grows sideways. The tokeniser above is
       * the fix for the case we found; this catches the ones we have not, from
       * a break opportunity nobody anticipated (an em dash, a slash, a soft
       * hyphen) to a font whose metrics shift after the split.
       *
       * Reverting to plain text costs the per-line cascade and keeps the whole
       * block's single reveal, which is what an unsplittable block already
       * gets. A line reveal is never worth a broken layout. */
      /* Measured with a Range over the line's own text, NOT via scrollWidth.
       * The bar is an absolutely-positioned ::after inset -0.15em horizontally
       * so it covers descenders, and because the line is the containing block
       * that overhang inflates its scrollWidth by ~4px at this size. Testing
       * scrollWidth therefore detects the bar rather than the text, and reverted
       * every split block on the page.
       *
       * Compared against the BLOCK's width, not the line's. A `.reveal-line` is
       * `inline-size: fit-content` — it is sized BY its text, so its own width
       * can never be exceeded by that text and the test would pass for every
       * line however far it hung off the page. The block is the box the words
       * actually have to fit inside. */
      const limit = el.clientWidth;
      const range = document.createRange();
      const spills = [...el.querySelectorAll<HTMLElement>('.reveal-line')].some((line) => {
        range.selectNodeContents(line);
        return range.getBoundingClientRect().width > limit + 1;
      });
      if (spills) {
        writeRuns(el, runs);
        delete el.dataset.revealSplit;
      }
    };

    const groupOf = (el: HTMLElement): Element => el.closest('section') ?? document.body;
    /* 25ms, not the 90ms this used to be. The reference's own staggers measure
       0.015-0.03s and cluster on 0.02s; 90ms was more than four times its widest.
       Across the six lines of On Track / Off Track that put the last one 450ms
       behind the first, and on top of the time the bar spends covering it the
       closing line did not read for the better part of a second after the section
       had arrived. At 25ms those six span 125ms and still resolve top to bottom
       rather than snapping in together. */
    const delayFor = (el: HTMLElement): number => {
      const group = groupOf(el);
      const peers = lines.filter((line) => groupOf(line) === group);
      return peers.indexOf(el) * 25;
    };

    /* Split every block that turns out to be more than one line long.
     *
     * After the fonts, not before: line boxes measured against the fallback face
     * break in different places, and a block cut on those breaks keeps the wrong
     * cuts once the real face swaps in.
     *
     * Re-cut on resize for the same reason. Between 992 and 1920 the root scales
     * with the viewport so the text and its column grow together and the breaks
     * barely move, but below 992 the root locks at 16px while the column keeps
     * narrowing — and there the breaks change completely. A block that has
     * already played is marked done rather than re-cut into a fresh animation,
     * so re-measuring never replays a reveal the reader has watched. */
    const applySplits = (): void => {
      const targets = lines.filter(splittable);

      /* Restore every block to plain text BEFORE measuring any of them.
       *
       * A `.reveal-line` is `nowrap`, so its width is a hard minimum for
       * whatever column it sits in. Re-cutting one block at a time means the
       * stale lines of its neighbours are still propping that column open, and
       * the fresh measurement is taken against the OLD width — which produces
       * lines that fit the old width, and the column never comes back down.
       *
       * Measured: resizing 1728 -> 360 left the band's grid column pinned at
       * 378px inside a 320px shell, 41px of horizontal document overflow that a
       * fresh load at 360 did not have. Clearing first lets the column collapse
       * to its real width, and every block is then measured against it. */
      for (const el of targets) {
        writeRuns(el, runsOf(el));
        delete el.dataset.revealSplit;
      }

      for (const el of targets) {
        const played = el.classList.contains('is-in');
        splitIntoLines(el, delayFor(el));
        if (played) el.classList.add('is-done');
      }
    };

    void document.fonts.ready.then(() => {
      applySplits();
      // The rebuild can move a block's height by a fraction of a line, and every
      // pinned section below it is positioned off that.
      ScrollTrigger.refresh();
    });

    let resplit = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(resplit);
      resplit = window.setTimeout(applySplits, 200);
    });

    /**
     * Hero lines fire with the entrance, NOT on intersection.
     *
     * The observer below uses a negative bottom margin so nothing triggers while
     * still at the very edge of the viewport. Inside the hero that is a trap: the
     * card sits at the bottom of a 100dvh section, so its last line starts inside
     * that dead band and there is no scroll position that ever moves it out. The
     * line stayed at opacity 0 permanently — content lost to an animation that
     * never ran.
     */
    const immediateLines = opts.immediate
      ? lines.filter((el) => el.closest(opts.immediate as string))
      : [];

    /* Gallery captions enter sideways, not from below, so the bottom margin that
       holds back a normal reveal is on the wrong axis for them — it would do
       nothing at all. They also arrive one at a time under the horizontal scrub,
       which already staggers them; a document-order delay on top of that would
       fire a caption long after its own picture had gone past. */
    const sidewaysLines = opts.sideways
      ? lines.filter((el) => el.closest(opts.sideways as string))
      : [];
    const scrollLines = lines.filter(
      (el) => !immediateLines.includes(el) && !sidewaysLines.includes(el),
    );

    for (const line of immediateLines) line.style.setProperty('--reveal-delay', `${delayFor(line)}ms`);
    opts.whenReady(() => {
      for (const line of immediateLines) line.classList.add('is-in');
    });

    const textRevealer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.style.setProperty('--reveal-delay', `${delayFor(el)}ms`);
          el.classList.add('is-in');
          textRevealer.unobserve(el);
        }
      },
      /* A LEAD, not an inset. This used to be -8%, which held the reveal back
         until the line was already 8% of the viewport inside the frame — so the
         bar's covering half ran in full view and the line sat blank while the
         reader was looking straight at it.
       *
       * +10% starts it just under a viewport-tenth before the line crosses the
       * edge, which is roughly the covering half at an ordinary scroll rate. What
       * arrives on screen is the bar already retracting off finished text, which
       * is the half of this animation worth watching. */
      { rootMargin: '0px 0px 10% 0px' },
    );
    for (const line of scrollLines) textRevealer.observe(line);

    /* Inset on the RIGHT, which is the edge a caption actually crosses. A caption
       fires once it is properly inside the frame rather than the instant it clips
       the boundary, so the sweep reads as part of the picture arriving instead of
       something that already happened off-screen. */
    const sidewaysRevealer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          sidewaysRevealer.unobserve(entry.target);
        }
      },
      { rootMargin: opts.sidewaysMargin ?? '0px -14% 0px 0px' },
    );
    for (const line of sidewaysLines) sidewaysRevealer.observe(line);
  }

}
