import assert from "node:assert/strict";
type RecordRow = Record<string, any>;
export function database(seed: Record<string, RecordRow[]>) {
  const tables = structuredClone(seed);
  let serial = 0;
  const find = (id: string) => Object.values(tables).flat().find((row) => row._id === id);
  return { tables, db: {
    query(table: string) {
      let rows = tables[table] ?? [];
      const index = {
        eq(key: string, value: unknown) { rows = rows.filter((r) => r[key] === value); return index; },
        gt(key: string, value: any) { rows = rows.filter(r => r[key] > value); return index; },
        lte(key: string, value: any) { rows = rows.filter((r) => r[key] <= value); return index; }
      };
      const query = {
        withIndex(_name: string, filter?: (i: typeof index) => unknown) { filter?.(index); return query; },
        order(_direction: string) { return query; },
        async take(count: number) { return structuredClone(rows.slice(0, count)); },
        async unique() { assert(rows.length <= 1); return structuredClone(rows[0] ?? null); },
        async first() { return structuredClone(rows[0] ?? null); }
      };
      return query;
    },
    async get(id: string) { return structuredClone(find(id) ?? null); },
    async insert(table: string, row: RecordRow) { const _id = `insert-${++serial}`; (tables[table] ??= []).push({ ...row, _id, _creationTime: 0 }); return _id; },
    async patch(id: string, row: RecordRow) { Object.assign(find(id)!, row); },
    async replace(id: string, row: RecordRow) { const current = find(id)!; for (const key of Object.keys(current)) if (!key.startsWith("_")) delete current[key]; Object.assign(current, row); },
    async delete(id: string) { for (const table of Object.keys(tables)) tables[table] = tables[table].filter((row) => row._id !== id); }
  } };
}
export function call(fn: object, ctx: unknown, args: unknown): Promise<any> {
  return Reflect.get(fn, "_handler")(ctx, args);
}
