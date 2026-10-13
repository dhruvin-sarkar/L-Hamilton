/**
 * The hooked arrow's hover: the reference's `btn-ui` Rive (artboard `arrow`,
 * animation `arrows`, 90 frames at 60fps), timed off its own file frame by
 * frame. The reference plays the one file on every hooked arrow of On Track and
 * the Calendar -- On Track's "full schedule" links, the Calendar's "Track
 * visualiser" and "Calendar list", and the round panel's next and previous on
 * both, the previous turned half round -- so both pages mount it from here.
 *
 * One cycle is 1.5s. The body -- tail, turn and shaft -- rubs out from the
 * tail forward (frames 4-38); the head's two arms draw back into their point
 * (24-36); the body writes itself in again from the tail (28.5-50.5), and the
 * arms grow back out of the point (46-68). The rest of the cycle holds the
 * whole arrow. While the button is hovered the cycle repeats; on leave the
 * running cycle finishes and it stops -- the state machine's behaviour, read
 * by holding and releasing its `hover` input.
 *
 * The icon's one path becomes five so each part can be dashed on its own: the
 * body twice (the copy rubbing out and the copy writing in overlap in time)
 * and one path per arm, each drawn from the point outward. Same geometry, so
 * the resting arrow is unchanged.
 *
 * It is aria-hidden decoration; under reduced motion it stays still.
 */

import { gsap, reducedMotion } from './motion';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW_CYCLE = 1.5;
const frame = (n: number): number => n / 60;

/** Every hooked arrow icon the reference animates, on either page. */
const ARROW_ICONS = '.ot-cal__btn-icon, .ot-cal__ctrl-icon';

function mountArrowCycle(button: HTMLElement, icon: SVGSVGElement): void {
  const part = (d: string): SVGPathElement => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    return path;
  };
  /* The body from the tail's end, round the turn, along the shaft to the
     point; and the two arms from the point out. */
  const BODY = 'M13 19H10A5 5 0 0 1 10 9H19.5';
  const bodyOut = part(BODY);
  const bodyIn = part(BODY);
  const arms = [part('M19.5 9L15 4.5'), part('M19.5 9L15 13.5')];
  /* An arrow turned in the markup (the panel's previous) keeps its turn: the
     parts go in a group that carries it. */
  const turn = icon.querySelector('path')?.getAttribute('transform');
  if (turn) {
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('transform', turn);
    group.append(bodyOut, bodyIn, ...arms);
    icon.replaceChildren(group);
  } else {
    icon.replaceChildren(bodyOut, bodyIn, ...arms);
  }

  const bodyLength = bodyOut.getTotalLength();
  const armLength = arms[0]?.getTotalLength() ?? 0;
  /* A dash the part's length and a gap twice that, so a hidden part has no
     dash end inside it for its round cap to paint as a dot -- and the copy
     rubbing out runs half a unit past its end for the same reason. */
  const dash = (length: number): string => `${length} ${2 * length}`;
  gsap.set([bodyOut, bodyIn], { attr: { 'stroke-dasharray': dash(bodyLength) } });
  gsap.set(arms, { attr: { 'stroke-dasharray': dash(armLength) } });

  const cycle = gsap.timeline({ paused: true });
  cycle
    .set(bodyOut, { attr: { 'stroke-dashoffset': 0 } }, 0)
    .set(bodyIn, { attr: { 'stroke-dashoffset': bodyLength } }, 0)
    .set(arms, { attr: { 'stroke-dashoffset': 0 } }, 0)
    .to(
      bodyOut,
      { attr: { 'stroke-dashoffset': -bodyLength - 0.5 }, duration: frame(34), ease: 'power1.inOut' },
      frame(4),
    )
    .to(arms, { attr: { 'stroke-dashoffset': armLength }, duration: frame(12), ease: 'power1.inOut' }, frame(24))
    .to(bodyIn, { attr: { 'stroke-dashoffset': 0 }, duration: frame(22), ease: 'power1.inOut' }, frame(28.5))
    .to(arms, { attr: { 'stroke-dashoffset': 0 }, duration: frame(22), ease: 'none' }, frame(46))
    .set({}, {}, ARROW_CYCLE);

  let hovered = false;
  cycle.eventCallback('onComplete', () => {
    if (hovered) cycle.restart();
  });
  const on = (): void => {
    hovered = true;
    if (!cycle.isActive()) cycle.restart();
  };
  const off = (): void => {
    hovered = false;
  };
  // Keyboard focus counts as hover, as it does for the label's roll.
  button.addEventListener('pointerenter', on);
  button.addEventListener('pointerleave', off);
  button.addEventListener('focus', on);
  button.addEventListener('blur', off);
}

/** Cycles every hooked arrow on the page while its button is hovered or focused. */
export function mountArrowCycles(): void {
  if (reducedMotion) return;
  for (const icon of document.querySelectorAll<SVGSVGElement>(ARROW_ICONS)) {
    const button = icon.closest<HTMLElement>('a, button');
    if (!button) throw new Error('[arrow-cycle] a hooked arrow sits outside any link or button');
    mountArrowCycle(button, icon);
  }
}
