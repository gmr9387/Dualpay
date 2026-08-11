import { describe, it, expect } from 'vitest';
import { sha256, hashObject, buildTraceFingerprint, buildContentHash } from '@/engine/hash';

describe('Hash Utilities', () => {
  describe('sha256', () => {
    it('returns a 64-character hex string', async () => {
      const result = await sha256('hello');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('is deterministic — same input produces same hash', async () => {
      const a = await sha256('test-input');
      const b = await sha256('test-input');
      expect(a).toBe(b);
    });

    it('produces different hashes for different inputs', async () => {
      const a = await sha256('input-a');
      const b = await sha256('input-b');
      expect(a).not.toBe(b);
    });

    it('matches known SHA-256 vector for empty string', async () => {
      // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const result = await sha256('');
      expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
  });

  describe('hashObject', () => {
    it('hashes two canonically equal objects to the same value', async () => {
      const a = { b: 2, a: 1 };
      const b = { a: 1, b: 2 };
      expect(await hashObject(a)).toBe(await hashObject(b));
    });

    it('returns different hash when object values differ', async () => {
      const a = await hashObject({ amount: 100 });
      const b = await hashObject({ amount: 101 });
      expect(a).not.toBe(b);
    });
  });

  describe('buildTraceFingerprint', () => {
    it('returns a non-empty hex string', async () => {
      const fp = await buildTraceFingerprint({
        claim: { claim_id: 'CLM-001' },
        accumulators: { individual_deductible_used: 0 },
        contract: { contract_id: 'C-001' },
        plan: { plan_id: 'P-001' },
        priorOutcomes: [],
        calcPolicyVersion: '1.0.0',
      });
      expect(fp).toHaveLength(64);
      expect(fp).toMatch(/^[0-9a-f]+$/);
    });

    it('is stable across calls with same inputs', async () => {
      const args = {
        claim: { claim_id: 'CLM-001' },
        accumulators: {},
        contract: {},
        plan: {},
        priorOutcomes: [],
        calcPolicyVersion: '1.0.0',
      };
      expect(await buildTraceFingerprint(args)).toBe(await buildTraceFingerprint(args));
    });

    it('differs when calcPolicyVersion changes', async () => {
      const base = { claim: {}, accumulators: {}, contract: {}, plan: {}, priorOutcomes: [] };
      const v1 = await buildTraceFingerprint({ ...base, calcPolicyVersion: '1.0.0' });
      const v2 = await buildTraceFingerprint({ ...base, calcPolicyVersion: '2.0.0' });
      expect(v1).not.toBe(v2);
    });
  });

  describe('buildContentHash', () => {
    it('produces different hashes for different labels with same value', async () => {
      const a = await buildContentHash('plan_document', { version: '1' });
      const b = await buildContentHash('fee_schedule', { version: '1' });
      expect(a).not.toBe(b);
    });
  });
});
