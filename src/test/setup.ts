import "@testing-library/jest-dom";
import { vi } from "vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// ---------------------------------------------------------------------------
// Stateful in-memory Supabase mock — applied to ALL test files.
//
// Provides a chainable query-builder that stores rows in a plain Map so tests
// that exercise the full persistence stack (upsert → select, insert → query,
// etc.) can pass without a live Supabase instance.
//
// Cross-file isolation: vitest runs each test file in its own worker (separate
// module registry), so `_db` is never shared across test files — no cleanup
// hook is needed between files.
//
// Within-file isolation: the `_db` map persists across describe() blocks so
// tests that intentionally build up state (e.g. insert then query) work
// correctly. Tests that need a clean slate should call `_db.clear()` in their
// own `beforeEach`.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** In-memory store — isolated per test file by vitest's module worker boundary. */
const _db = new Map<string, Row[]>();

function _getTable(name: string): Row[] {
  if (!_db.has(name)) _db.set(name, []);
  return _db.get(name)!;
}

function _matchFilters(row: Row, filters: [string, unknown][]): boolean {
  return filters.every(([col, val]) => {
    if (col.startsWith("__in__")) {
      const realCol = col.slice("__in__".length);
      return Array.isArray(val) && val.includes(row[realCol]);
    }
    if (col.startsWith("__neq__")) {
      const realCol = col.slice("__neq__".length);
      return row[realCol] !== val;
    }
    return row[col] === val;
  });
}

class MockQueryBuilder {
  private _table: string;
  private _filters: [string, unknown][] = [];
  private _pendingWrite: {
    kind: "insert" | "upsert" | "update";
    rows: Row[];
    conflictCol?: string;
  } | null = null;
  private _hasSelect = false;

  constructor(table: string) {
    this._table = table;
  }

  // ── Chainable filter / modifier methods ────────────────────────────────
  select(_cols?: string) { this._hasSelect = true; return this; }
  eq(col: string, val: unknown) { this._filters.push([col, val]); return this; }
  neq(col: string, val: unknown) { this._filters.push([`__neq__${col}`, val]); return this; }
  lt(_col: string, _val: unknown) { return this; }
  lte(_col: string, _val: unknown) { return this; }
  gt(_col: string, _val: unknown) { return this; }
  gte(_col: string, _val: unknown) { return this; }
  order(_col: string, _opts?: unknown) { return this; }
  limit(_n: number) { return this; }
  range(_from: number, _to: number) { return this; }
  not(_col: string, _op: string, _val: unknown) { return this; }
  in(col: string, vals: unknown[]) { this._filters.push([`__in__${col}`, vals]); return this; }
  is(_col: string, _val: unknown) { return this; }
  filter(_col: string, _op: string, _val: unknown) { return this; }
  or(_query: string) { return this; }
  count(_col?: string, _opts?: unknown) { return this; }

  // ── Write operations — always return `this` so callers can chain
  // .select().single()/.maybeSingle() or simply await the builder directly.
  // ─────────────────────────────────────────────────────────────────────────
  insert(rows: Row | Row[]) {
    const arr = Array.isArray(rows) ? rows : [rows];
    this._pendingWrite = { kind: "insert", rows: arr };
    return this;
  }

  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    const arr = Array.isArray(rows) ? rows : [rows];
    this._pendingWrite = { kind: "upsert", rows: arr, conflictCol: opts?.onConflict };
    return this;
  }

  update(data: Row) {
    this._pendingWrite = { kind: "update", rows: [data] };
    return this;
  }

  delete() {
    const table = _getTable(this._table);
    const remaining = table.filter((r) => !_matchFilters(r, this._filters));
    _db.set(this._table, remaining);
    return Promise.resolve({ data: null, error: null });
  }

  // ── Terminal read operations ─────────────────────────────────────────────
  async single(): Promise<{ data: Row | null; error: null }> {
    const row = await this._resolveRow();
    return { data: row, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const row = await this._resolveRow();
    return { data: row, error: null };
  }

  // Make the builder itself awaitable (e.g. `await supabase.from('t').update({}).eq('id','x')`)
  then(
    onFulfilled: (v: { data: Row[] | null; error: null; count?: number }) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) {
    return this._resolveAll().then(onFulfilled, onRejected);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────
  private async _resolveAll(): Promise<{ data: Row[] | null; error: null; count?: number }> {
    if (this._pendingWrite) {
      const rows = await this._executePending();
      return { data: rows, error: null, count: rows.length };
    }
    const table = _getTable(this._table);
    const rows = table.filter((r) => _matchFilters(r, this._filters));
    return { data: rows, error: null, count: rows.length };
  }

  private async _resolveRow(): Promise<Row | null> {
    if (this._pendingWrite) {
      const rows = await this._executePending();
      return rows[0] ?? null;
    }
    const table = _getTable(this._table);
    return table.find((r) => _matchFilters(r, this._filters)) ?? null;
  }

  private async _executePending(): Promise<Row[]> {
    if (!this._pendingWrite) return [];
    const { kind, rows, conflictCol } = this._pendingWrite;
    const table = _getTable(this._table);

    if (kind === "upsert") {
      const result: Row[] = [];
      for (const row of rows) {
        if (conflictCol) {
          const idx = table.findIndex((r) => r[conflictCol] === row[conflictCol]);
          if (idx >= 0) {
            table[idx] = { ...table[idx], ...row };
            result.push(table[idx]);
          } else {
            table.push({ ...row });
            result.push(row);
          }
        } else {
          table.push({ ...row });
          result.push(row);
        }
      }
      return result;
    }

    if (kind === "update") {
      const matched = table.filter((r) => _matchFilters(r, this._filters));
      for (const r of matched) Object.assign(r, rows[0]);
      return matched;
    }

    if (kind === "insert") {
      table.push(...rows);
      return rows;
    }

    return [];
  }
}

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: (table: string) => new MockQueryBuilder(table),
      auth: {
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      storage: {
        from: (_bucket: string) => ({
          upload: () => Promise.resolve({ data: null, error: null }),
          download: () => Promise.resolve({ data: null, error: null }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
        }),
      },
      channel: () => ({
        on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
      }),
      removeChannel: () => {},
    },
  };
});
