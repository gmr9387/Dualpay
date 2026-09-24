/**
 * Shared UI primitives for Claim Clarity modules.
 * Flat, enterprise-grade — no decorative gradients or motion.
 */
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DenialSeverity, WorkflowOwner, ReimbursementState, AgingBucket, WorkQueueId } from '@/types/clarity';
import { ChevronRight } from 'lucide-react';

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="px-6 py-4 border-b bg-card flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[20px] font-semibold tracking-tight text-foreground leading-tight">{title}</h1>
        {subtitle && <p className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function KpiStrip({ tiles }: { tiles: Array<{ label: string; value: string; tone?: string; sub?: string }> }) {
  return (
    <div className="flex items-stretch border-b bg-card">
      {tiles.map(t => (
        <div key={t.label} className="kpi flex-1">
          <div className="kpi-label">{t.label}</div>
          <div className={`kpi-value ${t.tone ?? ''}`}>{t.value}</div>
          {t.sub && <div className="text-[10.5px] font-mono text-muted-foreground/80 mt-0.5">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

const SEV_CLS: Record<DenialSeverity, string> = {
  critical: 'bg-status-denied/15 text-status-denied border-status-denied/30',
  high:     'bg-status-pending/15 text-status-pending border-status-pending/30',
  medium:   'bg-status-adjusted/15 text-status-adjusted border-status-adjusted/30',
  low:      'bg-status-paid/10 text-status-paid border-status-paid/25',
};
export function SeverityBadge({ severity }: { severity: DenialSeverity }) {
  return (
    <span className={`pill border ${SEV_CLS[severity]}`}>{severity}</span>
  );
}

const STATE_CLS: Record<ReimbursementState, string> = {
  submitted:        'status-pending',
  pending_payer:    'status-pending',
  partially_paid:   'status-adjusted',
  denied:           'status-denied',
  paid:             'status-paid',
  appealing:        'status-cob',
  resolved:         'status-paid',
  written_off:      'status-denied',
};
export function StateBadge({ state }: { state: ReimbursementState }) {
  return <span className={STATE_CLS[state]}>{state.replace(/_/g, ' ')}</span>;
}

const OWNER_LABEL: Record<WorkflowOwner, string> = {
  biller: 'Billing', coder: 'Coding', auth_team: 'Auth', clinical: 'Clinical',
  appeals: 'Appeals', cob_team: 'COB', eligibility: 'Eligibility', unassigned: 'Unassigned',
};
export function OwnerChip({ owner }: { owner: WorkflowOwner }) {
  return (
    <span className="text-[10.5px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      {OWNER_LABEL[owner]}
    </span>
  );
}

export function RecoverabilityBar({ score }: { score: number }) {
  const tone = score >= 70 ? 'bg-status-paid' : score >= 40 ? 'bg-status-pending' : 'bg-status-denied';
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${score}%` }} />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-foreground">{score}</span>
    </div>
  );
}

export function AgingChip({ bucket }: { bucket: AgingBucket }) {
  const tone =
    bucket === '120+' ? 'bg-status-denied/15 text-status-denied border-status-denied/30'
    : bucket === '91-120' ? 'bg-status-denied/10 text-status-denied border-status-denied/25'
    : bucket === '61-90' ? 'bg-status-pending/15 text-status-pending border-status-pending/30'
    : bucket === '31-60' ? 'bg-status-adjusted/10 text-status-adjusted border-status-adjusted/25'
    : 'bg-muted text-muted-foreground border-border';
  return <span className={`pill border ${tone}`}>{bucket}</span>;
}

export function QueueChip({ queue }: { queue: WorkQueueId }) {
  return (
    <Link
      to={`/queues/${queue}`}
      className="text-[10.5px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-accent-foreground border border-primary/20 hover:bg-primary/10"
    >
      {queue.replace(/_/g, ' ')}
    </Link>
  );
}

export function Panel({
  title, action, children, dense,
}: { title: string; action?: ReactNode; children: ReactNode; dense?: boolean }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">{title}</span>
        {action}
      </div>
      <div className={dense ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, body, icon }: { title: string; body?: string; icon?: ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-sm py-12">
        {icon && <div className="h-12 w-12 mx-auto rounded-full bg-muted flex items-center justify-center mb-3 text-muted-foreground">{icon}</div>}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {body && <p className="text-[12.5px] text-muted-foreground mt-1">{body}</p>}
      </div>
    </div>
  );
}

export function ScrollBody({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-y-auto">{children}</div>;
}

export function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b hover:bg-muted/50 transition-colors">
      {children}
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
