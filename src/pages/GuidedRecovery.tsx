/**
 * Guided Recovery — full lifecycle workbench for appeal_recovery_cases.
 * Create, read, and advance cases through: denied → appeal_filed → submitted
 * → payer_response → recovered / closed.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatCents } from '@/hooks/use-clarity-data';
import {
  PageHeader, KpiStrip, ScrollBody, Panel, EmptyState,
} from '@/components/clarity/primitives';
import {
  useAppealRecoveryCases,
  canTransitionTo,
  APPEAL_RECOVERY_STATES,
  type AppealRecoveryCase,
  type AppealRecoveryState,
} from '@/hooks/use-appeal-recovery-cases';
import { makeIdempotencyKey, logRecoveryEvent, logWriteOff } from '@/data/operational-workflows';
import { useOrg } from '@/hooks/use-org';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, Plus, RefreshCw, ChevronRight, AlertCircle, Search } from 'lucide-react';

/** Transitions that need more than a click — they capture the payer's real response before advancing. */
const NEEDS_INPUT: Partial<Record<AppealRecoveryState, true>> = {
  payer_response: true,
  recovered: true,
};

interface AdvanceExtra { payer_response_status?: string; recovered_amount_cents?: number }

function AdvanceForm({
  from, target, busy, onCancel, onConfirm,
}: {
  from: AppealRecoveryState;
  target: AppealRecoveryState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (extra: AdvanceExtra, writeOffReason?: string) => void;
}) {
  const [statusText, setStatusText] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  // closed reached directly from payer_response means the appeal was lost —
  // capture why, so it's a real write-off record, not a silently dropped case.
  if (target === 'closed' && from === 'payer_response') {
    return (
      <div className="flex items-center gap-2 py-1">
        <input placeholder="Reason the appeal was closed without recovery…" value={reason} onChange={e => setReason(e.target.value)}
          className="flex-1 h-7 px-2 text-[11px] rounded border bg-background" />
        <button disabled={busy || !reason.trim()} onClick={() => onConfirm({}, reason.trim())}
          className="text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">Confirm</button>
        <button onClick={onCancel} className="text-[11px] px-2 py-1 rounded border">Cancel</button>
      </div>
    );
  }
  if (target === 'recovered') {
    return (
      <div className="flex items-center gap-2 py-1">
        <input type="number" step="0.01" placeholder="Amount recovered ($)" value={amount} onChange={e => setAmount(e.target.value)}
          className="w-36 h-7 px-2 text-[11px] rounded border bg-background" />
        <button disabled={busy || !amount || Number(amount) <= 0}
          onClick={() => onConfirm({ recovered_amount_cents: Math.round(Number(amount) * 100) })}
          className="text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">Confirm</button>
        <button onClick={onCancel} className="text-[11px] px-2 py-1 rounded border">Cancel</button>
      </div>
    );
  }
  // payer_response
  return (
    <div className="flex items-center gap-2 py-1">
      <input placeholder="e.g. Partial approval — $450 of $1200" value={statusText} onChange={e => setStatusText(e.target.value)}
        className="flex-1 h-7 px-2 text-[11px] rounded border bg-background" />
      <button disabled={busy || !statusText.trim()} onClick={() => onConfirm({ payer_response_status: statusText.trim() })}
        className="text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">Confirm</button>
      <button onClick={onCancel} className="text-[11px] px-2 py-1 rounded border">Cancel</button>
    </div>
  );
}

const STATE_LABEL: Record<AppealRecoveryState, string> = {
  denied:         'Denied',
  appeal_filed:   'Appeal Filed',
  submitted:      'Submitted',
  payer_response: 'Payer Response',
  recovered:      'Recovered',
  closed:         'Closed',
};

const STATE_CLS: Record<AppealRecoveryState, string> = {
  denied:         'bg-status-denied/10 text-status-denied border-status-denied/30',
  appeal_filed:   'bg-status-cob/10 text-status-cob border-status-cob/30',
  submitted:      'bg-status-pending/10 text-status-pending border-status-pending/30',
  payer_response: 'bg-status-adjusted/10 text-status-adjusted border-status-adjusted/30',
  recovered:      'bg-status-paid/10 text-status-paid border-status-paid/30',
  closed:         'bg-muted text-muted-foreground border-border',
};

export default function GuidedRecovery() {
  const { cases, loading, error, reload, create, advance } = useAppealRecoveryCases();
  const { currentOrg } = useOrg();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [newClaimId, setNewClaimId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<AppealRecoveryState | 'all'>('all');
  const [claimQuery, setClaimQuery] = useState(() => searchParams.get('claim') ?? '');
  const [advanceForm, setAdvanceForm] = useState<{ caseId: string; from: AppealRecoveryState; target: AppealRecoveryState } | null>(null);

  const byState = stateFilter === 'all' ? cases : cases.filter(c => c.current_state === stateFilter);
  const filtered = claimQuery.trim()
    ? byState.filter(c => c.claim_id.toLowerCase().includes(claimQuery.trim().toLowerCase()))
    : byState;

  const totalRecovered = cases.reduce((s, c) => s + c.recovered_amount_cents, 0);
  const openCount = cases.filter(c => c.current_state !== 'recovered' && c.current_state !== 'closed').length;
  const recoveredCount = cases.filter(c => c.current_state === 'recovered').length;

  async function handleCreate() {
    const id = newClaimId.trim();
    if (!id) return;
    setCreating(true);
    setCreateError(null);
    const result = await create(id);
    if (!result) {
      setCreateError('Failed to create case — claim may already exist for this organization.');
    } else {
      setNewClaimId('');
    }
    setCreating(false);
  }

  /** Transitions with no extra data to capture advance immediately, as before. */
  function handleNextClick(arc: AppealRecoveryCase, next: AppealRecoveryState) {
    if (NEEDS_INPUT[next] || (next === 'closed' && arc.current_state === 'payer_response')) {
      setAdvanceForm({ caseId: arc.id, from: arc.current_state, target: next });
      return;
    }
    void handleAdvance(arc, next);
  }

  async function handleAdvance(arc: AppealRecoveryCase, next: AppealRecoveryState, extra?: AdvanceExtra, writeOffReason?: string) {
    setAdvancing(arc.id);
    try {
      const idempotencyKey = makeIdempotencyKey('appeal');
      await advance(arc, next, idempotencyKey, extra);

      // Close the loop into real financial records: a recovered case writes
      // a recovery_outcomes row (so Outcome Log / executive dashboards see
      // it without a second manual entry); a lost appeal writes a write-off
      // so the amount isn't silently dropped.
      if (next === 'recovered' && extra?.recovered_amount_cents && currentOrg) {
        await logRecoveryEvent(arc.claim_id, currentOrg.org_id, {
          recoveryType: 'payer_payment',
          amountCents: extra.recovered_amount_cents,
          recoveredFrom: extra.payer_response_status || arc.payer_response_status || 'payer',
          analystUserId: user?.id,
          notes: 'Recorded via Guided Recovery',
          idempotencyKey: makeIdempotencyKey('recovery'),
        });
      }
      if (next === 'closed' && arc.current_state === 'payer_response' && writeOffReason && currentOrg) {
        await logWriteOff(arc.claim_id, currentOrg.org_id, writeOffReason, user?.email ?? undefined, makeIdempotencyKey('write_off'));
      }
    } catch (e) {
      console.error('[guided-recovery] advance failed', e);
    }
    setAdvancing(null);
    setAdvanceForm(null);
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading cases…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Guided Recovery"
        subtitle="Track appeal-based recovery cases from denial through payer response to final recovery."
      />

      <KpiStrip tiles={[
        { label: 'Total Cases',    value: String(cases.length) },
        { label: 'Open',           value: String(openCount), tone: openCount > 0 ? 'text-status-cob' : 'text-muted-foreground' },
        { label: 'Recovered',      value: String(recoveredCount), tone: 'text-status-paid' },
        { label: 'Amount Recovered', value: formatCents(totalRecovered), tone: 'amount-positive' },
      ]} />

      {/* Create new case */}
      <div className="px-5 py-3 border-b bg-card">
        <div className="flex items-center gap-2 max-w-lg">
          <input
            type="text"
            placeholder="Claim ID (e.g. CLM-00123)"
            value={newClaimId}
            onChange={e => setNewClaimId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            className="flex-1 text-[12.5px] border rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newClaimId.trim()}
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            New Case
          </button>
          <button
            onClick={reload}
            title="Refresh"
            className="p-1.5 rounded-md border hover:bg-muted transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
        {createError && (
          <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-status-denied">
            <AlertCircle className="h-3.5 w-3.5" /> {createError}
          </div>
        )}
        {error && (
          <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-status-denied">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </div>
        )}
        <div className="mt-2 flex items-center gap-1.5 max-w-lg text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            type="text"
            placeholder="Filter by claim ID…"
            value={claimQuery}
            onChange={e => {
              setClaimQuery(e.target.value);
              const next = new URLSearchParams(searchParams);
              if (e.target.value.trim()) next.set('claim', e.target.value.trim()); else next.delete('claim');
              setSearchParams(next, { replace: true });
            }}
            className="flex-1 text-[12px] border rounded-md px-2.5 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* State filter tabs */}
      <div className="px-5 py-2.5 border-b bg-card flex items-center gap-2 flex-wrap text-[11.5px]">
        <button
          onClick={() => setStateFilter('all')}
          className={`px-2.5 py-1 rounded-md border transition-colors ${stateFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground hover:bg-muted'}`}
        >
          All <span className="font-mono opacity-70">({cases.length})</span>
        </button>
        {APPEAL_RECOVERY_STATES.map(s => (
          <button
            key={s}
            onClick={() => setStateFilter(s)}
            className={`px-2.5 py-1 rounded-md border transition-colors ${stateFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >
            {STATE_LABEL[s]} <span className="font-mono opacity-70">({cases.filter(c => c.current_state === s).length})</span>
          </button>
        ))}
      </div>

      <ScrollBody>
        <div className="p-5">
          {filtered.length === 0 ? (
            <EmptyState
              title="No cases"
              body={stateFilter === 'all' ? 'Create your first recovery case above.' : `No cases in "${STATE_LABEL[stateFilter]}" state.`}
              icon={<RefreshCw className="h-5 w-5" />}
            />
          ) : (
            <Panel title={`Cases (${filtered.length})`} dense>
              <div className="divide-y">
                <div className="grid grid-cols-[140px_1fr_160px_180px_160px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <span>Claim ID</span>
                  <span>Payer / Packet</span>
                  <span>State</span>
                  <span className="text-right">Recovered</span>
                  <span>Next Step</span>
                </div>
                {filtered.map(arc => {
                  const nextStates = APPEAL_RECOVERY_STATES.filter(s => canTransitionTo(arc.current_state as AppealRecoveryState, s));
                  const isAdvancing = advancing === arc.id;
                  const activeForm = advanceForm?.caseId === arc.id ? advanceForm : null;
                  return (
                    <div key={arc.id}>
                      <div className="grid grid-cols-[140px_1fr_160px_180px_160px] gap-3 items-center px-4 py-2.5 hover:bg-muted/40 text-[12px]">
                        <div>
                          <div className="font-mono font-semibold text-foreground">{arc.claim_id}</div>
                          <div className="text-[10.5px] text-muted-foreground font-mono">{arc.id.slice(0, 8)}…</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-muted-foreground truncate">{arc.packet_id ?? '—'}</div>
                          {arc.payer_response_status && (
                            <div className="text-[10.5px] text-muted-foreground">{arc.payer_response_status}</div>
                          )}
                        </div>
                        <span className={`pill border text-[11px] ${STATE_CLS[arc.current_state as AppealRecoveryState]}`}>
                          {STATE_LABEL[arc.current_state as AppealRecoveryState] ?? arc.current_state}
                        </span>
                        <span className="font-mono text-right tabular-nums amount-positive">
                          {arc.recovered_amount_cents > 0 ? formatCents(arc.recovered_amount_cents) : '—'}
                        </span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {nextStates.length === 0 ? (
                            <span className="text-muted-foreground text-[11px]">Final</span>
                          ) : (
                            nextStates.map(next => (
                              <button
                                key={next}
                                disabled={isAdvancing}
                                onClick={() => handleNextClick(arc, next)}
                                className="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded border hover:bg-muted transition-colors disabled:opacity-50"
                                title={`Advance to ${STATE_LABEL[next]}`}
                              >
                                {isAdvancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
                                {STATE_LABEL[next]}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                      {activeForm && (
                        <div className="px-4 pb-2.5 -mt-1 bg-muted/20">
                          <AdvanceForm
                            from={activeForm.from}
                            target={activeForm.target}
                            busy={isAdvancing}
                            onCancel={() => setAdvanceForm(null)}
                            onConfirm={(extra, writeOffReason) => void handleAdvance(arc, activeForm.target, extra, writeOffReason)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>
      </ScrollBody>
    </div>
  );
}
