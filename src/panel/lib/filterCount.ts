interface FilterCountInput {
  minPrice: string;
  minQuantity: string;
  minTimePassed: string;
  selectedStates: string[];
  selectedCities: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
}

export function countActiveFilters({
  minPrice,
  minQuantity,
  minTimePassed,
  selectedStates,
  selectedCities,
  includeKeywords,
  excludeKeywords,
}: FilterCountInput): number {
  return [
    minPrice.trim(),
    minQuantity.trim(),
    minTimePassed.trim(),
    selectedStates.length > 0,
    selectedCities.length > 0,
    includeKeywords.length > 0,
    excludeKeywords.length > 0,
  ].filter(Boolean).length;
}
