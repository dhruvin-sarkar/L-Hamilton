/**
 * The motion preference and the GSAP registration, in one place.
 *
 * Both exist because every page needs them and neither may be answered twice.
 * `reducedMotion` is read once at load rather than per component, so a single
 * page can never end up with half its motion honouring the preference and half
 * ignoring it. Registering the plugins here as an import side effect means any
 * module that reaches for `morphSVG` or ScrollTrigger has already caused the
 * registration by importing this — there is no ordering to get wrong.
 *
 * CLAUDE.md: "One animation orchestrator (GSAP + ScrollTrigger)."
 */

import gsap from 'gsap';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(MorphSVGPlugin, ScrollTrigger);

/** Read once, honoured everywhere. */
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One matchMedia context for the whole site, and the query the wide, animated
 * layouts are built behind.
 *
 * Shared because the sections are: the helmet wall's column drift is created
 * here and consumed by two pages, and two contexts answering the same query
 * would revert each other's work on a resize.
 *
 * Below 992px the layouts these guard are columns and stacks rather than
 * scroll-driven scenes, and under reduced motion they are not scenes at all —
 * so both fall out of the same query rather than each being checked separately.
 */
export const mm = gsap.matchMedia();
export const WIDE_AND_ANIMATED = '(min-width: 992px) and (prefers-reduced-motion: no-preference)';

export { gsap, ScrollTrigger, MorphSVGPlugin };
