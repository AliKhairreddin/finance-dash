/** Wise includes payment notes explicitly in statement descriptions as well as structured fields. */
export function wiseDescriptionReference(description: string): string | undefined {
  const match = description.match(/\b(?:with reference\s+|Reference:\s*)(.+?)(?:\s+\(fee:[^)]*\))?$/iu);
  return match?.[1]?.trim() || undefined;
}
