/**
 * Country codes, in the form the sport itself uses.
 *
 * The FIA labels sessions, timing screens and results with three-letter codes
 * that are the IOC set rather than ISO 3166 — Netherlands is NED and not NLD,
 * Bahrain is BRN, Saudi Arabia is KSA, Germany is GER. CLAUDE.md asks for real
 * F1 vocabulary, and on a timing-screen-shaped panel that is what the code has
 * to be.
 *
 * Flags are separate: `flagUrl` points at our own copies from the MIT-licensed
 * country-flag-icons set, drawn at 3:2 -- the reference's flags are the same
 * aspect (23x15, 34x21) -- and keyed by ISO 3166-1 alpha-2, which is what that
 * set is named by.
 *
 * Keyed by the country names Jolpica returns, which is why "UK" and "USA" are
 * here in that shape rather than as "United Kingdom" and "United States".
 */
const CODES: Readonly<Record<string, string>> = {
  Australia: 'AUS',
  Austria: 'AUT',
  Azerbaijan: 'AZE',
  Bahrain: 'BRN',
  Belgium: 'BEL',
  Brazil: 'BRA',
  Canada: 'CAN',
  China: 'CHN',
  France: 'FRA',
  Germany: 'GER',
  Hungary: 'HUN',
  India: 'IND',
  Italy: 'ITA',
  Japan: 'JPN',
  Korea: 'KOR',
  Malaysia: 'MAS',
  Mexico: 'MEX',
  Monaco: 'MON',
  Netherlands: 'NED',
  Portugal: 'POR',
  Qatar: 'QAT',
  Russia: 'RUS',
  'Saudi Arabia': 'KSA',
  Singapore: 'SIN',
  Spain: 'ESP',
  Turkey: 'TUR',
  UAE: 'UAE',
  UK: 'GBR',
  USA: 'USA',
};

/**
 * The code for a country, or a thrown error.
 *
 * Fails fast on purpose (CLAUDE.md, design principle 5): a calendar that gains
 * a country this map has not got should stop the page in development rather
 * than quietly print an empty chip where a nation belongs.
 */
export function countryCode(country: string): string {
  const code = CODES[country];
  if (!code) throw new Error(`[countries] no code for "${country}" — add it to countries.ts`);
  return code;
}

/** ISO 3166-1 alpha-2, for the flag files. Same keys as CODES. */
const ISO2: Readonly<Record<string, string>> = {
  Argentina: 'ar',
  Australia: 'au',
  Austria: 'at',
  Azerbaijan: 'az',
  Bahrain: 'bh',
  Belgium: 'be',
  Brazil: 'br',
  Canada: 'ca',
  China: 'cn',
  France: 'fr',
  Germany: 'de',
  Hungary: 'hu',
  India: 'in',
  Italy: 'it',
  Japan: 'jp',
  Korea: 'kr',
  Malaysia: 'my',
  Mexico: 'mx',
  Monaco: 'mc',
  Netherlands: 'nl',
  Portugal: 'pt',
  Qatar: 'qa',
  Russia: 'ru',
  'Saudi Arabia': 'sa',
  Singapore: 'sg',
  'South Africa': 'za',
  Spain: 'es',
  Sweden: 'se',
  Switzerland: 'ch',
  Turkey: 'tr',
  UAE: 'ae',
  UK: 'gb',
  USA: 'us',
};

/** The flag for a country, as a URL under /assets/flags. Throws for one it lacks. */
export function flagUrl(country: string): string {
  const iso = ISO2[country];
  if (!iso) throw new Error(`[countries] no flag for "${country}" -- add it to countries.ts`);
  return `/assets/flags/${iso}.svg`;
}

/** The three names Jolpica abbreviates. Every other one it returns is already the name to print. */
const NAMES: Readonly<Record<string, string>> = {
  UK: 'United Kingdom',
  USA: 'United States',
  UAE: 'United Arab Emirates',
};

/**
 * A country as a reader names it -- "United Kingdom" where Jolpica says "UK".
 * Throws for a country this file has no flag for, because the two are printed
 * side by side and a name without its flag is half a venue.
 */
export function countryName(country: string): string {
  if (!(country in ISO2)) {
    throw new Error(`[countries] no entry for "${country}" -- add it to countries.ts`);
  }
  return NAMES[country] ?? country;
}
