/**
 * Every partner, in the order they appear on the rows.
 *
 * Set as type rather than as logo files: these are third-party trademarks and
 * this build does not redistribute them. Grouped the way they were supplied -
 * personal partners first, then the Scuderia Ferrari partners he carries on
 * race gear as part of the team contract.
 *
 * Its own module because two pages read it: Home runs it through the partners
 * row and the footer's row, On Track through the footer's row alone.
 */
export const PARTNERS = [
  'Tommy Hilfiger',
  'Puma',
  'Dior',
  'IWC Schaffhausen',
  'Police',
  'Sanpellegrino',
  'Perplexity AI',
  'CFI',
  'Monster Energy',
  'Sony',
  'HP',
  'Shell',
  'IBM',
  'Ceva Logistics',
  'UniCredit',
] as const;
