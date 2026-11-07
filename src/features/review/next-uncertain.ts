/**
 * Week 4 Step 6: "Next uncertain field" cycling.
 *
 * Returns the uncertain field after `currentId`, wrapping to the first one. When there is no
 * current field (or it is no longer uncertain) the first uncertain field is returned; when there
 * are no uncertain fields, null.
 */
export function nextUncertainFieldId(uncertainIds: readonly string[], currentId: string | null | undefined): string | null {
  if (uncertainIds.length === 0) return null;
  if (!currentId) return uncertainIds[0];
  const index = uncertainIds.indexOf(currentId);
  if (index === -1) return uncertainIds[0];
  return uncertainIds[(index + 1) % uncertainIds.length];
}
