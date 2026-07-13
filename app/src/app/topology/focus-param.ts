/** Resolve a focus query (id or label, case-insensitive; exact id/label
 *  preferred over substring) to a node, or null. Mirrors the canvas search. */
export function resolveFocusNode<T extends { id: string; label: string }>(
  nodes: T[],
  query: string,
): T | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = nodes.find((n) => n.id.toLowerCase() === q || n.label.toLowerCase() === q);
  if (exact) return exact;
  return nodes.find((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)) ?? null;
}
