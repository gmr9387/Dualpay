/**
 * Guided Recovery — full lifecycle workbench for appeal_recovery_cases.
 * Create, read, and advance cases through: denied → appeal_filed → submitted
 * → payer_response → recovered / closed.
 */
import { useState } from 'react';
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
import { makeIdempotencyKey } from '@/data/operational-workflows';
import { Loader2, Plus, RefreshCw, ChevronRight, AlertCircle } from 'lucide-react';

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
  const [newClaimId, setNewClaimId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<AppealRecoveryState | 'all'>('all');

  const filtered = stateFilter === 'all'
    ? cases
    : cases.filter(c => c.current_state === stateFilter);

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

  async function handleAdvance(arc: AppealRecoveryCase, next: AppealRecoveryState) {
    setAdvancing(arc.id);
    const idempotencyKey = makeIdempotencyKey('appeal');
    await advance(arc, next, idempotencyKey);
    setAdvancing(null);
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
                  return (
                    <div key={arc.id} className="grid grid-cols-[140px_1fr_160px_180px_160px] gap-3 items-center px-4 py-2.5 hover:bg-muted/40 text-[12px]">
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
                              onClick={() => handleAdvance(arc, next)}
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
