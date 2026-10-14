/** Summarize document links without merging or modifying their evidence fragments. */
export function uniqueSourceLinks<
  T extends { url: string; collectedAt?: string; verifiedAt?: string },
>(sources: readonly T[]): T[] {
  const documents = new Map<string, T>();
  const timestamp = (value?: string) => {
    const parsed = Date.parse(value ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  };
  for (const source of sources) {
    const previous = documents.get(source.url);
    if (
      !previous ||
      timestamp(source.collectedAt) > timestamp(previous.collectedAt) ||
      (timestamp(source.collectedAt) === timestamp(previous.collectedAt) &&
        timestamp(source.verifiedAt) > timestamp(previous.verifiedAt))
    ) {
      documents.set(source.url, source);
    }
  }
  return [...documents.values()];
}
