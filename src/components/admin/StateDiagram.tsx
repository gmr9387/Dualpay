import { useMemo } from 'react';
import type { ClaimStatus } from '@/types/claim';
import {
  CLAIM_TRANSITIONS,
  ALL_STATUSES,
  getValidTransitions,
  getStatusCategory,
  canTransition,
  type StatusTransition,
} from '@/engine/state-machine';
import { Shield, Lock, ArrowRight, CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';

interface StateDiagramProps {
  currentStatus: ClaimStatus;
  claimId: string;
  hasPrimacyConfirmation?: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  intake: 'Intake',
  cob: 'COB / Multi-Payer',
  adjudication: 'Adjudication',
  payment: 'Payment',
  terminal: 'Terminal',
};

const CATEGORY_COLORS: Record<string, string> = {
  intake: 'border-primary/30 bg-primary/5',
  cob: 'border-status-cob/30 bg-status-cob/5',
  adjudication: 'border-status-pending/30 bg-status-pending/5',
  payment: 'border-status-paid/30 bg-status-paid/5',
  terminal: 'border-status-adjusted/30 bg-status-adjusted/5',
};

function getStatusNodeClass(status: ClaimStatus, currentStatus: ClaimStatus, isReachable: boolean): string {
  const base = 'relative rounded-md border px-3 py-2 text-xs font-mono transition-all cursor-default';
  if (status === currentStatus) {
    return `${base} border-primary bg-primary/15 text-primary ring-1 ring-primary/30 shadow-sm`;
  }
  if (isReachable) {
    return `${base} border-border bg-surface-2 text-foreground hover:border-primary/40`;
  }
  return `${base} border-border/40 bg-surface-1 text-muted-foreground/50`;
}

function getStatusIcon(status: ClaimStatus, currentStatus: ClaimStatus) {
  if (status === currentStatus) return <CheckCircle2 className="h-3 w-3 text-primary" />;
  const cat = getStatusCategory(status);
  switch (cat) {
    case 'cob': return <Shield className="h-3 w-3" />;
    case 'payment': return <Clock className="h-3 w-3" />;
    case 'terminal': return <AlertTriangle className="h-3 w-3" />;
    default: return null;
  }
}

export function StateDiagram({ currentStatus, claimId, hasPrimacyConfirmation, onClose }: StateDiagramProps) {
  const validTransitions = useMemo(() => getValidTransitions(currentStatus), [currentStatus]);
  const reachableStatuses = useMemo(() => new Set(validTransitions.map(t => t.to)), [validTransitions]);

  // Group statuses by category
  const grouped = useMemo(() => {
    const groups: Record<string, ClaimStatus[]> = {};
    for (const s of ALL_STATUSES) {
      const cat = getStatusCategory(s);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    }
    return groups;
  }, []);

  // Evaluate guards for each valid transition
  const transitionResults = useMemo(() => {
    return validTransitions.map(t => ({
      transition: t,
      result: canTransition({
        claimId,
        currentStatus,
        targetStatus: t.to,
        hasPrimacyConfirmation,
        idempotencyKey: `payment:demo-${claimId}-${currentStatus}-${t.to}`,
      }),
    }));
  }, [validTransitions, claimId, currentStatus, hasPrimacyConfirmation]);

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 text-primary" />
          Claim State Machine
        </h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* State Node Grid */}
        <div className="space-y-3">
          {Object.entries(grouped).map(([category, statuses]) => (
            <div key={category} className={`rounded-md border p-3 ${CATEGORY_COLORS[category] ?? ''}`}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                {CATEGORY_LABELS[category] ?? category}
              </div>
              <div className="flex flex-wrap gap-2">
                {statuses.map(status => (
                  <div
                    key={status}
                    className={getStatusNodeClass(status, currentStatus, reachableStatuses.has(status))}
                  >
                    <div className="flex items-center gap-1.5">
                      {getStatusIcon(status, currentStatus)}
                      <span>{status.replace(/_/g, ' ')}</span>
                    </div>
                    {status === currentStatus && (
                      <div className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Valid Transitions from current state */}
        <div className="rounded-md border bg-surface-1 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Valid Transitions from {currentStatus.replace(/_/g, ' ')}
          </div>
          {transitionResults.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No transitions available (terminal state)</div>
          ) : (
            <div className="space-y-1.5">
              {transitionResults.map(({ transition, result }) => (
                <div
                  key={`${transition.from}-${transition.to}`}
                  className={`flex items-center gap-3 rounded px-3 py-2 text-xs border ${
                    result.allowed
                      ? 'border-status-paid/20 bg-status-paid/5'
                      : 'border-status-denied/20 bg-status-denied/5'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="font-mono text-muted-foreground shrink-0">
                      {transition.from.replace(/_/g, ' ')}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-mono font-medium text-foreground shrink-0">
                      {transition.to.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <span className="text-muted-foreground truncate">{transition.label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {result.allowed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-status-paid" />
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5 text-status-denied" />
                        <span className="text-[10px] text-status-denied font-mono">
                          {result.failedGuards.join(', ')}
                        </span>
                      </>
                    )}
                  </div>
                  {result.appliedGuards.length > 0 && result.appliedGuards[0] !== 'NO_GUARD' && (
                    <span title={result.appliedGuards.join(', ')}><Lock className="h-3 w-3 text-status-pending shrink-0" /></span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Guard Legend */}
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border/50">
          <span className="flex items-center gap-1">
            <Lock className="h-2.5 w-2.5 text-status-pending" /> Guarded transition
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-2.5 w-2.5 text-status-paid" /> Guard passed
          </span>
          <span className="flex items-center gap-1">
            <XCircle className="h-2.5 w-2.5 text-status-denied" /> Guard blocked
          </span>
          <span className="flex items-center gap-1">
            <div className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" /> Current state
          </span>
        </div>
      </div>
    </div>
  );
}
