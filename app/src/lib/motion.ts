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

export { gsap, ScrollTrigger, MorphSVGPlugin };
