interface FilterCountInput {
  minPrice: string;
  minQuantity: string;
  minTimePassed: string;
  stateCities: Record<string, string[]>;
  includeKeywords: string[];
  excludeKeywords: string[];
}

export function countActiveFilters({
  minPrice,
  minQuantity,
  minTimePassed,
  stateCities,
  includeKeywords,
  excludeKeywords,
}: FilterCountInput): number {
  const states = Object.keys(stateCities);
  return [
    minPrice.trim(),
    minQuantity.trim(),
    minTimePassed.trim(),
    states.length > 0,
    states.some((state) => stateCities[state].length > 0),
    includeKeywords.length > 0,
    excludeKeywords.length > 0,
  ].filter(Boolean).length;
}
