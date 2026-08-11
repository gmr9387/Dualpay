-- Phase 2: Persistence Tables — service_role grants
--
-- Tables, indexes, RLS, and authenticated grants were established by:
--   20260624150000_create_persistence_tables.sql
--
-- This migration retains only the statements that were unique to this file:
-- service_role full-access grants required by the application backend.

GRANT ALL ON public.replay_records TO service_role;
GRANT ALL ON public.replay_ledger_events TO service_role;
GRANT ALL ON public.idempotency_keys TO service_role;