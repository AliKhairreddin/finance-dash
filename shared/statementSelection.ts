/** A saved, explicit selection that can be shared by future bulk actions. */
export function changeSelectedPage<T extends { _id: string }>(selected: T[], page: T[], checked: boolean): T[] {
  const rows = new Map(selected.map(row => [row._id, row]));
  for (const row of page) { if (checked) rows.set(row._id, row); else rows.delete(row._id); }
  return [...rows.values()];
}

export async function collectSelectedRows<T extends { _id: string }>(load: (offset: number) => Promise<{ transactions: T[]; total: number; hasMore: boolean; truncated: boolean }>, expectedTotal: number, signal?: AbortSignal): Promise<T[]> {
  const rows = new Map<string, T>();
  for (let offset = 0; offset <= 2000;) {
    signal?.throwIfAborted();
    const page = await load(offset);
    signal?.throwIfAborted();
    if (page.truncated || page.total > 2000) throw new Error("Choose a smaller date range before selecting all. This list is too large to load completely.");
    if (page.total !== expectedTotal) throw new Error("The list changed. Refresh it, then select all again.");
    for (const row of page.transactions) {
      if (rows.has(row._id)) throw new Error("The list changed while loading. Refresh it, then select all again.");
      rows.set(row._id, row);
    }
    if (!page.hasMore) {
      if (rows.size !== expectedTotal) throw new Error("Some transactions could not be loaded. Refresh the list and try again.");
      return [...rows.values()];
    }
    if (!page.transactions.length) break;
    offset += page.transactions.length;
  }
  throw new Error("All transactions could not be loaded. Choose a smaller date range and try again.");
}

/** Stop on the first failure. A lost response may already have changed records, so never retry automatically. */
export async function applySelectedBatches(ids: string[], apply: (batch: string[]) => Promise<unknown>, completed: (ids: string[]) => void): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  for (let offset = 0; offset < uniqueIds.length; offset += 50) {
    const batch = uniqueIds.slice(offset, offset + 50);
    await apply(batch);
    completed(batch);
  }
}
