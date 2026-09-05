/**
 * Country codes, in the form the sport itself uses.
 *
 * The FIA labels sessions, timing screens and results with three-letter codes
 * that are the IOC set rather than ISO 3166 — Netherlands is NED and not NLD,
 * Bahrain is BRN, Saudi Arabia is KSA, Germany is GER. CLAUDE.md asks for real
 * F1 vocabulary, and on a timing-screen-shaped panel that is what the code has
 * to be.
 *
 * These stand in for the reference's national flag artwork, which is bitmap
 * assets we neither have nor may rehost. A code is not a downgrade of a flag so
 * much as the other label the sport already prints in the same slot.
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
