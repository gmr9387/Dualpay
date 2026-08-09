import { describe, it, expect } from 'vitest';
import { toCanonicalValue, canonicalStringify, canonicalClone } from '@/engine/canonical-json';

describe('Canonical JSON', () => {
  describe('toCanonicalValue — primitives', () => {
    it('passes through strings unchanged', () => {
      expect(toCanonicalValue('hello')).toBe('hello');
    });

    it('passes through finite numbers unchanged', () => {
      expect(toCanonicalValue(42)).toBe(42);
      expect(toCanonicalValue(3.14)).toBe(3.14);
    });

    it('converts non-finite numbers to null', () => {
      expect(toCanonicalValue(Infinity)).toBeNull();
      expect(toCanonicalValue(-Infinity)).toBeNull();
      expect(toCanonicalValue(NaN)).toBeNull();
    });

    it('passes through booleans unchanged', () => {
      expect(toCanonicalValue(true)).toBe(true);
      expect(toCanonicalValue(false)).toBe(false);
    });

    it('passes through null unchanged', () => {
      expect(toCanonicalValue(null)).toBeNull();
    });

    it('converts Date to ISO string', () => {
      const d = new Date('2024-01-15T12:00:00.000Z');
      expect(toCanonicalValue(d)).toBe('2024-01-15T12:00:00.000Z');
    });
  });

  describe('toCanonicalValue — objects', () => {
    it('sorts object keys alphabetically', () => {
      const obj = { z: 3, a: 1, m: 2 };
      const result = toCanonicalValue(obj) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['a', 'm', 'z']);
    });

    it('omits undefined values from objects', () => {
      const obj = { a: 1, b: undefined, c: 3 };
      const result = toCanonicalValue(obj) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['a', 'c']);
    });

    it('converts Map to sorted key-value object', () => {
      const m = new Map<string, number>([['z', 3], ['a', 1], ['m', 2]]);
      const result = toCanonicalValue(m) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['a', 'm', 'z']);
      expect(result['a']).toBe(1);
    });

    it('recursively canonicalizes nested objects', () => {
      const obj = { outer: { z: 2, a: 1 } };
      const result = toCanonicalValue(obj) as Record<string, unknown>;
      const inner = result['outer'] as Record<string, unknown>;
      expect(Object.keys(inner)).toEqual(['a', 'z']);
    });
  });

  describe('canonicalStringify', () => {
    it('produces identical output for two objects with different key order', () => {
      const a = { b: 2, a: 1 };
      const b = { a: 1, b: 2 };
      expect(canonicalStringify(a)).toBe(canonicalStringify(b));
    });

    it('is stable across multiple calls', () => {
      const obj = { claim_id: 'CLM-001', amount: 10000, payer: 'BCBS' };
      expect(canonicalStringify(obj)).toBe(canonicalStringify(obj));
    });
  });

  describe('canonicalClone', () => {
    it('deep-clones a value round-trip through JSON', () => {
      const obj = { a: 1, b: [2, 3], c: { d: 4 } };
      const cloned = canonicalClone(obj);
      expect(cloned).toEqual(obj);
      // Mutation isolation
      cloned.b.push(99);
      expect(obj.b).toHaveLength(2);
    });

    it('strips undefined values in clone', () => {
      const obj = { a: 1, b: undefined as unknown as number };
      const cloned = canonicalClone(obj);
      expect('b' in cloned).toBe(false);
    });
  });
});
