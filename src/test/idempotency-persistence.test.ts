import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  consumeIdempotencyKey,
  isIdempotencyKeyConsumed,
  clearIdempotencyKeysForDev,
  canTransition,
  type TransitionContext,
} from '@/engine/state-machine';
import { supabase } from '@/integrations/supabase/client';

describe('Idempotency — Persistence', () => {
  beforeEach(() => {
    clearIdempotencyKeysForDev();
  });

  afterEach(() => {
    clearIdempotencyKeysForDev();
  });

  describe('In-Memory Key Consumption', () => {
    it('consumes key on first use', () => {
      const key = 'idem_test_001';
      const result = consumeIdempotencyKey(key);
      expect(result).toBe(true);
    });

    it('rejects key on second use', () => {
      const key = 'idem_test_001';
      consumeIdempotencyKey(key);
      const result = consumeIdempotencyKey(key);
      expect(result).toBe(false);
    });

    it('tracks consumed keys', () => {
      const key = 'idem_test_001';
      expect(isIdempotencyKeyConsumed(key)).toBe(false);
      
      consumeIdempotencyKey(key);
      expect(isIdempotencyKeyConsumed(key)).toBe(true);
    });

    it('rejects empty keys', () => {
      const result = consumeIdempotencyKey('');
      expect(result).toBe(false);
    });
  });

  describe('Persistent Key Recording via Phase 4B RPC', () => {
    afterEach(() => vi.restoreAllMocks());

    it('advancePaymentState warms the in-memory cache on first execution', async () => {
      vi.spyOn(supabase, 'rpc' as never).mockResolvedValue({
        data: { already_consumed: false, result_id: 'PAY-CLM-001-abc', new_status: 'PAYMENT_IN_PROGRESS' },
        error: null,
      } as never);

      const { advancePaymentState } = await import('@/engine/state-machine');
      const key = 'payment:idem_persistent_001';

      await advancePaymentState({
        idempotencyKey: key,
        claimId: 'CLM-001',
        orgId: 'org-uuid',
        fromStatus: 'ADJUDICATED',
        toStatus: 'PAYMENT_IN_PROGRESS',
        actor: 'analyst-1',
      });

      expect(isIdempotencyKeyConsumed(key)).toBe(true);
    });

    it('advancePaymentState does NOT warm cache when already_consumed', async () => {
      vi.spyOn(supabase, 'rpc' as never).mockResolvedValue({
        data: { already_consumed: true, result_id: 'PAY-CLM-001-original', new_status: 'PAYMENT_IN_PROGRESS' },
        error: null,
      } as never);

      const { advancePaymentState } = await import('@/engine/state-machine');
      const key = 'payment:idem_persistent_002';

      await advancePaymentState({
        idempotencyKey: key,
        claimId: 'CLM-001',
        orgId: 'org-uuid',
        fromStatus: 'ADJUDICATED',
        toStatus: 'PAYMENT_IN_PROGRESS',
        actor: 'analyst-1',
      });

      // already_consumed = true means the key was recorded in a prior session;
      // the UI cache is intentionally NOT warmed to avoid hiding the replay state.
      expect(isIdempotencyKeyConsumed(key)).toBe(false);
    });
  });

  describe('Payment Transition Protection', () => {
    it('rejects payment transition without idempotency key', () => {
      const context: TransitionContext = {
        claimId: 'CLM-001',
        currentStatus: 'ADJUDICATED',
        targetStatus: 'PAYMENT_IN_PROGRESS',
        idempotencyKey: '',
      };
      
      const result = canTransition(context);
      expect(result.allowed).toBe(false);
      expect(result.failedGuards).toContain('REQUIRE_IDEMPOTENCY_KEY');
    });

    it('allows payment transition with fresh key', () => {
      const context: TransitionContext = {
        claimId: 'CLM-001',
        currentStatus: 'ADJUDICATED',
        targetStatus: 'PAYMENT_IN_PROGRESS',
        idempotencyKey: 'idem_fresh_123',
      };
      
      const result = canTransition(context);
      expect(result.allowed).toBe(true);
    });

    it('rejects payment transition with consumed key', () => {
      const key = 'idem_consumed_123';
      consumeIdempotencyKey(key);
      
      const context: TransitionContext = {
        claimId: 'CLM-001',
        currentStatus: 'ADJUDICATED',
        targetStatus: 'PAYMENT_IN_PROGRESS',
        idempotencyKey: key,
      };
      
      const result = canTransition(context);
      expect(result.allowed).toBe(false);
      expect(result.failedGuards).toContain('IDEMPOTENCY_KEY_ALREADY_USED');
    });

    it('protects both payment transitions', () => {
      const key1 = 'idem_step1_001';
      const key2 = 'idem_step2_002';
      
      // First transition: ADJUDICATED → PAYMENT_IN_PROGRESS
      const result1 = canTransition({
        claimId: 'CLM-001',
        currentStatus: 'ADJUDICATED',
        targetStatus: 'PAYMENT_IN_PROGRESS',
        idempotencyKey: key1,
      });
      expect(result1.allowed).toBe(true);
      
      // Second transition: PAYMENT_IN_PROGRESS → PAID
      const result2 = canTransition({
        claimId: 'CLM-001',
        currentStatus: 'PAYMENT_IN_PROGRESS',
        targetStatus: 'PAID',
        idempotencyKey: key2,
      });
      expect(result2.allowed).toBe(true);
      
      // Replay with same keys should fail
      consumeIdempotencyKey(key1);
      
      const replay = canTransition({
        claimId: 'CLM-001',
        currentStatus: 'ADJUDICATED',
        targetStatus: 'PAYMENT_IN_PROGRESS',
        idempotencyKey: key1,
      });
      expect(replay.allowed).toBe(false);
    });
  });

  describe('Non-Payment Transitions', () => {
    it('do not require idempotency key', () => {
      const context: TransitionContext = {
        claimId: 'CLM-001',
        currentStatus: 'RECEIVED',
        targetStatus: 'ELIGIBILITY_CHECK',
        idempotencyKey: undefined,
      };
      
      const result = canTransition(context);
      expect(result.allowed).toBe(true);
    });

    it('do not consume idempotency keys', () => {
      const key = 'idem_non_payment';
      
      const context: TransitionContext = {
        claimId: 'CLM-001',
        currentStatus: 'IN_ADJUDICATION',
        targetStatus: 'ADJUDICATED',
        idempotencyKey: key,
      };
      
      canTransition(context);
      
      // Key should NOT be consumed
      expect(isIdempotencyKeyConsumed(key)).toBe(false);
    });
  });

  describe('Key Isolation', () => {
    it('different keys tracked separately', () => {
      const key1 = 'idem_key_1';
      const key2 = 'idem_key_2';
      
      consumeIdempotencyKey(key1);
      
      expect(isIdempotencyKeyConsumed(key1)).toBe(true);
      expect(isIdempotencyKeyConsumed(key2)).toBe(false);
    });

    it('clearing removes all keys', () => {
      const key1 = 'idem_key_1';
      const key2 = 'idem_key_2';
      
      consumeIdempotencyKey(key1);
      consumeIdempotencyKey(key2);
      
      expect(isIdempotencyKeyConsumed(key1)).toBe(true);
      expect(isIdempotencyKeyConsumed(key2)).toBe(true);
      
      clearIdempotencyKeysForDev();
      
      expect(isIdempotencyKeyConsumed(key1)).toBe(false);
      expect(isIdempotencyKeyConsumed(key2)).toBe(false);
    });
  });

  describe('Multiple Claims via Phase 4B RPC', () => {
    afterEach(() => vi.restoreAllMocks());

    it('independent keys for different claims are tracked separately', async () => {
      const spy = vi.spyOn(supabase, 'rpc' as never)
        .mockResolvedValueOnce({
          data: { already_consumed: false, result_id: 'PAY-CLM-001-x', new_status: 'PAYMENT_IN_PROGRESS' },
          error: null,
        } as never)
        .mockResolvedValueOnce({
          data: { already_consumed: false, result_id: 'PAY-CLM-002-y', new_status: 'PAYMENT_IN_PROGRESS' },
          error: null,
        } as never);

      const { advancePaymentState } = await import('@/engine/state-machine');
      const key1 = 'payment:idem_clm_001_payment';
      const key2 = 'payment:idem_clm_002_payment';

      await advancePaymentState({ idempotencyKey: key1, claimId: 'CLM-001', orgId: 'org-uuid', fromStatus: 'ADJUDICATED', toStatus: 'PAYMENT_IN_PROGRESS', actor: 'system' });
      await advancePaymentState({ idempotencyKey: key2, claimId: 'CLM-002', orgId: 'org-uuid', fromStatus: 'ADJUDICATED', toStatus: 'PAYMENT_IN_PROGRESS', actor: 'system' });

      expect(isIdempotencyKeyConsumed(key1)).toBe(true);
      expect(isIdempotencyKeyConsumed(key2)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
