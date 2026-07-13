/** Initial FacetRail selection, seeded from the ?ns= deep-link param. */
export function initialFacetSel(ns: string | null): { namespace: string; category: string } {
  return { namespace: ns && ns.length > 0 ? ns : 'all', category: 'all' };
}
