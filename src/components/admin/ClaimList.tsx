import { useMemo, useState } from 'react';
import type { Claim, AdjudicationRun } from '@/types/claim';
import type { TraceObject } from '@/types/trace';
import { Search, ArrowDownUp, AlertTriangle, CheckCircle2, ArrowRightLeft, Clock, FileText } from 'lucide-react';

interface AdjResult {
  claimId: string;
  run: AdjudicationRun;
  trace: TraceObject;
}

interface ClaimListProps {
  claims: Claim[];
  adjResults: AdjResult[];
  selectedClaimId: string | null;
  onSelect: (id: string) => void;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusClass(status: string): string {
  switch (status) {
    case 'PAID': case 'ADJUDICATED': return 'status-paid';
    case 'DENIED': return 'status-denied';
    case 'COB_ROUTED': case 'AWAITING_PRIMARY_EOB': return 'status-cob';
    case 'PENDED': case 'IN_ADJUDICATION': return 'status-pending';
    default: return 'status-adjusted';
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'PAID': case 'ADJUDICATED': return <CheckCircle2 className="h-3 w-3" />;
    case 'DENIED': return <AlertTriangle className="h-3 w-3" />;
    case 'COB_ROUTED': case 'AWAITING_PRIMARY_EOB': return <ArrowRightLeft className="h-3 w-3" />;
    case 'PENDED': case 'IN_ADJUDICATION': return <Clock className="h-3 w-3" />;
    default: return <FileText className="h-3 w-3" />;
  }
}

const FILTERS = ['All', 'Pending', 'Paid', 'Denied', 'COB'] as const;

export function ClaimList({ claims, adjResults, selectedClaimId, onSelect }: ClaimListProps) {
  const [filter, setFilter] = useState<typeof FILTERS[number]>('All');
  const [query, setQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  const filtered = useMemo(() => {
    const rows = claims.filter(c => {
      if (filter === 'Paid' && !['PAID', 'ADJUDICATED'].includes(c.status)) return false;
      if (filter === 'Denied' && c.status !== 'DENIED') return false;
      if (filter === 'COB' && c.ohi_indicators.length === 0) return false;
      if (filter === 'Pending' && !['PENDED', 'IN_ADJUDICATION', 'AWAITING_PRIMARY_EOB'].includes(c.status)) return false;
      if (query && !`${c.claim_id} ${c.member_id} ${c.provider_name}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      const cmp = a.service_date_from.localeCompare(b.service_date_from);
      return sortDesc ? -cmp : cmp;
    });
  }, [claims, filter, query, sortDesc]);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="px-4 pt-3.5 pb-2.5 border-b">
        <div className="flex items-baseline justify-between mb-2.5">
          <h2 className="text-sm font-semibold text-foreground">Claims Queue</h2>
          <span className="text-[11px] font-mono text-muted-foreground">
            {filtered.length} of {claims.length}
          </span>
        </div>
        <div className="relative mb-2.5">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter by ID, member, provider…"
            className="w-full h-8 pl-8 pr-3 text-[12.5px] rounded-md bg-muted/60 border border-transparent focus:bg-card focus:border-input focus:outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-1">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                filter === f ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {f}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => setSortDesc(v => !v)}
              title={sortDesc ? 'Newest service date first' : 'Oldest service date first'}
              className="h-7 w-7 rounded hover:bg-muted text-muted-foreground flex items-center justify-center"
            >
              <ArrowDownUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">No claims match filters.</div>
        )}
        {filtered.map(claim => {
          const adj = adjResults.find(r => r.claimId === claim.claim_id);
          const isSelected = claim.claim_id === selectedClaimId;
          const hasCOB = claim.ohi_indicators.length > 0;

          return (
            <button
              key={claim.claim_id}
              onClick={() => onSelect(claim.claim_id)}
              className={`w-full text-left px-4 py-2.5 border-b border-border/70 transition-colors relative ${
                isSelected ? 'bg-accent' : 'hover:bg-muted/50'
              }`}
            >
              {isSelected && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary" />}

              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-[12.5px] font-semibold text-foreground truncate">
                  {claim.claim_id}
                </span>
                <span className={statusClass(claim.status)}>
                  {statusIcon(claim.status)}
                  <span>{claim.status.replace(/_/g, ' ')}</span>
                </span>
              </div>

              <div className="flex items-center justify-between text-[11.5px] text-muted-foreground mb-1">
                <span className="truncate pr-2">{claim.provider_name}</span>
                <span className="font-mono shrink-0">{claim.member_id}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {claim.service_date_from} · {claim.lines.length} line{claim.lines.length !== 1 ? 's' : ''}
                  {hasCOB && <span className="ml-2 status-cob">COB</span>}
                </span>
                <span className="font-mono text-[12.5px] font-semibold text-foreground tabular-nums">
                  {formatCents(claim.total_billed)}
                </span>
              </div>

              {adj && (
                <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-border/50">
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Plan</div>
                    <div className="font-mono text-[11.5px] font-medium amount-positive tabular-nums">{formatCents(adj.run.total_plan_paid)}</div>
                  </div>
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Member</div>
                    <div className="font-mono text-[11.5px] font-medium amount-negative tabular-nums">{formatCents(adj.run.total_member_responsibility)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Trace</div>
                    <div className="font-mono text-[10px] text-primary truncate">{adj.trace.trace_id.slice(0, 10)}…</div>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
