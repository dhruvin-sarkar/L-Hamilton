/**
 * Off Track content: Lewis Hamilton's work away from the car.
 *
 * Mapped onto the reference's Off Track sections one for one. Its page is
 * Lando Norris's lifestyle, gaming and personal projects; this is Hamilton's
 * foundation, research commission, fashion, film and drinks brand, in the same
 * slots and the same shapes.
 *
 * Rules this file keeps (CLAUDE.md, docs/CONTENT-DATA.md):
 *
 *   - Every claim carries the URL it was checked against, and validate() below
 *     refuses to let the page build around one that does not.
 *   - Nothing here is in his voice. Where the reference prints a first-person
 *     line from its driver, this prints third-person site copy.
 *   - Off-track ventures go stale faster than race stats. Re-check each source
 *     before launch; the `checked` date says when they were last read.
 *
 * Images: every photo slot points at a named file under /assets/off-track/.
 * The files there now are stand-ins copied from photography already supplied
 * for this site; each slot's `subject` says what the real photo should show.
 */

/** When the sources below were last read. */
export const checked = '2026-09-25';

export interface Fact {
  /** Third-person site copy. Never a quote. */
  text: string;
  /** Where the claim was verified. At least one. */
  sources: readonly string[];
}

export interface Photo {
  /** Absolute public path. Always under /assets/off-track/. */
  src: string;
  /** Intrinsic size of the file, so the layout reserves the right box. */
  width: number;
  height: number;
  /** The caption the reference prints above each picture ("Miami, 2024"). */
  caption: string;
  /** What the photo in this slot should show. For whoever replaces the file. */
  subject: string;
}

/* ------------------------------------------------------------------ *
 * The page header
 * ------------------------------------------------------------------ */

export const hero = {
  /** The small grey label over the paragraph. Reference: "bringing the fight". */
  eyebrow: 'beyond the circuit',

  /**
   * The paragraph. The reference's opens on its driver's debut year and closes
   * on an accent clause; so does this. `{debut}` is filled from the driver
   * record rather than typed.
   */
  lead: {
    before: 'Since his F1 debut with McLaren in {debut}, Lewis Hamilton has pushed as hard off the track as on it – in education, fashion, film and',
    accent: 'the fight for change',
    after: '.',
    sources: [
      'https://mission44.org/',
      'https://raeng.org.uk/news/the-hamilton-commission-publishes-report-on-improving-representation-of-black-people-in-uk-motorsport',
      'https://newsroom.tommy.com/lewis-hamilton/',
      'https://www.formula1.com/en/latest/article/release-date-confirmed-for-apple-original-films-formula-1-movie.18IMLaYq0UFsKfEELXjO2w',
    ],
  },

  /** The short "recently" note. Reference: "Recently, Lando has been…". */
  recently: {
    text: 'Recently, Lewis co-chaired the 2025 Met Gala and produced F1, the film released in June 2025.',
    sources: [
      'https://www.formula1.com/en/latest/article/hamilton-reflects-on-really-special-moment-as-co-chair-of-2025-met-gala.4WtmIKncsWEmVfaVHCzxrd',
      'https://www.formula1.com/en/latest/article/release-date-confirmed-for-apple-original-films-formula-1-movie.18IMLaYq0UFsKfEELXjO2w',
    ],
  } satisfies Fact,

  /**
   * The row along the foot of the header. The reference runs its partners'
   * logos here; these are his own ventures, set as type, because the marks
   * are third-party trademarks this build does not redistribute.
   */
  ventures: [
    { name: 'Mission 44', sources: ['https://mission44.org/'] },
    {
      name: 'Almave',
      sources: [
        'https://www.almave.com/blogs/news/lewis-hamilton-casa-lumbre-and-copper-introduce-almave-the-first-super-premium-distilled-non-alcoholic-blue-agave-spirit',
      ],
    },
    {
      name: '+44',
      sources: [
        'https://hypebeast.com/2025/11/lewis-hamilton-plus44-ralph-steadman-collaboration-las-vegas-grand-prix-collection-release-info',
      ],
    },
    {
      name: 'Dawn Apollo Films',
      sources: ['https://www.blackbookmotorsport.com/news/f1-star-lewis-hamilton-film-tv-production-company-dawn-apollo-apple-tv/'],
    },
    { name: 'X44', sources: ['https://www.extreme-e.com/en/news/118_Lewis-Hamilton-founds-Extreme-E-team'] },
    {
      name: 'Neat Burger',
      sources: [
        'https://www.euronews.com/green/2019/08/30/lewis-hamilton-to-open-vegan-burger-joint-off-london-s-regent-street',
      ],
    },
  ],

  /**
   * The picture that flies from the header into the statement, and the ten it
   * flicks through on the way. Reference: .off-t-hero-scroll-meda, ten images.
   */
  flight: [
    { src: '/assets/off-track/hero-01.webp', width: 1115, height: 1600, caption: '', subject: 'Portrait, off duty' },
    { src: '/assets/off-track/hero-02.webp', width: 1080, height: 1440, caption: '', subject: 'Fashion' },
    { src: '/assets/off-track/hero-03.webp', width: 1121, height: 1400, caption: '', subject: 'Mission 44' },
    { src: '/assets/off-track/hero-04.webp', width: 1120, height: 1400, caption: '', subject: 'Fashion, editorial' },
    { src: '/assets/off-track/hero-05.webp', width: 1050, height: 1400, caption: '', subject: 'Travel' },
    { src: '/assets/off-track/gallery-10.webp', width: 1050, height: 1400, caption: '', subject: 'Film' },
    { src: '/assets/off-track/hero-06.webp', width: 1400, height: 1820, caption: '', subject: 'Portrait' },
    { src: '/assets/off-track/gallery-12.webp', width: 1115, height: 1600, caption: '', subject: 'Almave' },
    { src: '/assets/off-track/gallery-08.webp', width: 1050, height: 1400, caption: '', subject: 'Film' },
    { src: '/assets/off-track/hero-07.webp', width: 1050, height: 1400, caption: '', subject: 'Art' },
  ] satisfies readonly Photo[],
};

/* ------------------------------------------------------------------ *
 * The gallery: "Personal Projects"
 *
 * The reference's side-scroller carries four projects, each a title with a
 * one-line descriptor, two or three photos and a callout. The same four slots.
 * ------------------------------------------------------------------ */

export interface Project {
  id: string;
  /** Set in the display serif. A `\n` is a hard break, as the reference sets two. */
  title: string;
  /** The line under the title. */
  descriptor: string;
  /** The body line in the callout block. Third person, sourced. */
  callout: Fact;
  photos: readonly Photo[];
}

export const galleryIntro = {
  /** The section heading, in two faces: "Personal" / "Projects". */
  plain: 'Personal',
  serif: 'Projects',
  lead: {
    src: '/assets/off-track/gallery-01.webp', width: 1050, height: 1400,
    caption: '',
    subject: 'Opening picture of the section',
  } satisfies Photo,
};

export const projects: readonly Project[] = [
  {
    id: 'mission-44',
    title: 'Mission 44',
    descriptor: 'His foundation for young people from under-represented groups',
    callout: {
      text: 'Launched in 2021 with a personal pledge of £20m, Mission 44 backs young people from classroom to career.',
      sources: [
        'https://www.skysports.com/f1/news/24181/12365284/lewis-hamilton-launches-mission-44-charitable-foundation-with-personal-pledge-of-20m',
        'https://mission44.org/',
      ],
    },
    photos: [
      { src: '/assets/off-track/gallery-02.webp', width: 1121, height: 1400, caption: 'Mission 44, 2021', subject: 'Mission 44 event' },
      { src: '/assets/off-track/gallery-03.webp', width: 760, height: 1013, caption: 'Mission 44', subject: 'Mission 44 programme' },
      { src: '/assets/off-track/gallery-04.webp', width: 760, height: 1013, caption: 'Mission 44', subject: 'Mission 44 programme' },
    ],
  },
  {
    id: 'fashion',
    title: 'Fashion\n& the Met',
    descriptor: 'Met Gala co-chair, 2025',
    callout: {
      text: 'In May 2025 he co-chaired the Met Gala, whose exhibition was Superfine: Tailoring Black Style.',
      sources: [
        'https://www.formula1.com/en/latest/article/hamilton-reflects-on-really-special-moment-as-co-chair-of-2025-met-gala.4WtmIKncsWEmVfaVHCzxrd',
        'https://www.formula1.com/en/latest/article/its-a-real-honour-hamilton-really-grateful-after-being-announced-as-co-chair.zU6HWhIazigSpq8NeZZzm',
      ],
    },
    photos: [
      { src: '/assets/off-track/gallery-05.webp', width: 1080, height: 1440, caption: 'New York, 2025', subject: 'Met Gala' },
      { src: '/assets/off-track/gallery-06.webp', width: 1120, height: 1400, caption: 'Tommy Hilfiger, 2018', subject: 'TommyXLewis' },
      { src: '/assets/off-track/gallery-07.webp', width: 1055, height: 1400, caption: '+44', subject: 'His +44 label' },
    ],
  },
  {
    id: 'film',
    title: 'F1\nthe movie',
    descriptor: 'Producer, with Apple Original Films',
    callout: {
      text: 'Through his company Dawn Apollo Films, Lewis produced F1, directed by Joseph Kosinski and released in June 2025.',
      sources: [
        'https://www.formula1.com/en/latest/article/release-date-confirmed-for-apple-original-films-formula-1-movie.18IMLaYq0UFsKfEELXjO2w',
        'https://www.blackbookmotorsport.com/news/f1-star-lewis-hamilton-film-tv-production-company-dawn-apollo-apple-tv/',
      ],
    },
    photos: [
      { src: '/assets/off-track/gallery-08.webp', width: 1050, height: 1400, caption: 'F1, 2025', subject: 'F1 the movie' },
      { src: '/assets/off-track/gallery-09.webp', width: 760, height: 1013, caption: 'F1, 2025', subject: 'F1 the movie, premiere' },
      { src: '/assets/off-track/gallery-10.webp', width: 1050, height: 1400, caption: 'Dawn Apollo Films', subject: 'On set' },
    ],
  },
  {
    id: 'almave',
    title: 'Almave',
    descriptor: '2023–current',
    callout: {
      text: 'Created with master distiller Iván Saldaña, Almave is a distilled non-alcoholic blue agave spirit, launched in 2023.',
      sources: [
        'https://www.almave.com/blogs/news/lewis-hamilton-casa-lumbre-and-copper-introduce-almave-the-first-super-premium-distilled-non-alcoholic-blue-agave-spirit',
      ],
    },
    photos: [
      { src: '/assets/off-track/gallery-11.webp', width: 1050, height: 1400, caption: 'Almave, 2023', subject: 'Almave launch' },
      { src: '/assets/off-track/gallery-12.webp', width: 1115, height: 1600, caption: 'Almave', subject: 'Almave' },
      { src: '/assets/off-track/gallery-13.webp', width: 760, height: 949, caption: 'Almave', subject: 'Almave' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Validation
 *
 * Fail fast (CLAUDE.md): a slot with no source, no copy or an image outside
 * the off-track folder is a build error in dev, never a quietly empty box.
 * ------------------------------------------------------------------ */

function fail(where: string, what: string): never {
  throw new Error(`[content/off-track] ${where}: ${what}`);
}

function checkSources(where: string, sources: readonly string[]): void {
  if (!sources.length) fail(where, 'no source');
  for (const url of sources) {
    if (!/^https:\/\/\S+$/.test(url)) fail(where, `source "${url}" is not an https URL`);
  }
}

function checkPhoto(where: string, photo: Photo): void {
  if (!photo.src.startsWith('/assets/off-track/')) fail(where, `image "${photo.src}" is outside /assets/off-track/`);
  if (!(photo.width > 0 && photo.height > 0)) fail(where, `image "${photo.src}" has no size`);
  if (!photo.subject.trim()) fail(where, `image "${photo.src}" does not say what it shows`);
}

function validate(): void {
  if (!hero.eyebrow.trim()) fail('hero', 'empty eyebrow');
  if (!hero.lead.before.includes('{debut}')) fail('hero.lead', 'missing the {debut} slot');
  checkSources('hero.lead', hero.lead.sources);
  if (!hero.recently.text.trim()) fail('hero.recently', 'empty');
  checkSources('hero.recently', hero.recently.sources);
  if (hero.ventures.length < 2) fail('hero.ventures', 'a marquee needs at least two names');
  for (const v of hero.ventures) checkSources(`hero.ventures "${v.name}"`, v.sources);
  if (hero.flight.length < 2) fail('hero.flight', 'the flight needs at least two pictures');
  hero.flight.forEach((p, i) => checkPhoto(`hero.flight[${i}]`, p));
  checkPhoto('galleryIntro.lead', galleryIntro.lead);
  if (projects.length !== 4) fail('projects', `the gallery is laid out for 4 projects, got ${projects.length}`);
  for (const p of projects) {
    if (!p.title.trim() || !p.descriptor.trim()) fail(`projects "${p.id}"`, 'missing title or descriptor');
    if (!p.callout.text.trim()) fail(`projects "${p.id}"`, 'empty callout');
    checkSources(`projects "${p.id}"`, p.callout.sources);
    if (p.photos.length !== 3) fail(`projects "${p.id}"`, `laid out for 3 photos, got ${p.photos.length}`);
    p.photos.forEach((photo, i) => {
      checkPhoto(`projects "${p.id}" photo ${i}`, photo);
      if (!photo.caption.trim()) fail(`projects "${p.id}" photo ${i}`, 'no caption');
    });
  }
}

validate();
