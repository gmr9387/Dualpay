/**
 * Phase 3B — My Worklist
 *
 * Operational home for billing managers/analysts:
 *  • Assigned to Me · Overdue · Due Today · High Dollar tabs
 *  • Recovery dashboard summary card
 *  • Click a row → ClaimDrawer with timeline, notes, appeal, recovery
 *
 * Uses only Phase 3A repository functions; no new tables, no mock data.
 */
import { useCallback, useEffect, useState } from 'react';
import { PageHeader, EmptyState } from '@/components/clarity/primitives';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useOrg } from '@/hooks/use-org';
import {
  getMyWorklist, getOverdueClaims, getDueTodayClaims, getHighDollarClaims,
  updateAssignment, type WorklistItem,
} from '@/data/operational-workflows';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { ClaimDrawer } from '@/components/worklist/ClaimDrawer';
import {
  Inbox, AlarmClock, CalendarClock, DollarSign, Loader2,
  TrendingUp, Gavel, Target,
} from 'lucide-react';

const PRIORITY_TONE: Record<string, string> = {
  urgent: 'bg-status-denied/15 text-status-denied border-status-denied/30',
  high:   'bg-status-pending/15 text-status-pending border-status-pending/30',
  medium: 'bg-status-adjusted/15 text-status-adjusted border-status-adjusted/30',
  low:    'bg-muted text-muted-foreground border-border',
};
const STATUS_TONE: Record<string, string> = {
  open: 'status-pending',
  in_progress: 'status-cob',
  snoozed: 'status-adjusted',
  resolved: 'status-paid',
};

interface ClaimMeta { payer: string }

function fmtMoney(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    .format((cents ?? 0) / 100);
}

type TabKey = 'mine' | 'overdue' | 'today' | 'high_dollar';

export default function MyWorklist() {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const userId = user?.id ?? '';
  const orgId = currentOrg?.org_id ?? '';

  const [tab, setTab] = useState<TabKey>('mine');
  const [items, setItems] = useState<Record<TabKey, WorklistItem[]>>({
    mine: [], overdue: [], today: [], high_dollar: [],
  });
  const [meta, setMeta] = useState<Record<string, ClaimMeta>>({});
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState({
    openClaims: 0, appealsPending: 0, opportunities: 0, recoveredCents: 0,
  });
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId || !orgId) return;
    setLoading(true);
    try {
      const [mine, overdue, today, hi] = await Promise.all([
        getMyWorklist(userId, orgId),
        getOverdueClaims(userId, orgId),
        getDueTodayClaims(userId, orgId),
        getHighDollarClaims(userId, orgId),
      ]);
      setItems({ mine, overdue, today, high_dollar: hi });

      // Hydrate payer info for any new claim IDs.
      const allIds = Array.from(new Set([...mine, ...overdue, ...today, ...hi].map(i => i.claim_id)));
      const needed = allIds.filter(id => !meta[id]);
      if (needed.length > 0) {
        const { data: rows } = await supabase
          .from('claims').select('claim_id, payload').in('claim_id', needed);
        const next = { ...meta };
        for (const r of rows ?? []) {
          const p = (r.payload as Record<string, unknown> | null);
          next[r.claim_id] = { payer: p?.ohi_indicators?.[0]?.payer_name ?? '—' };
        }
        setMeta(next);
      }

      // Dashboard: org-wide counts via direct queries.
      const [
        { count: openAssn },
        { data: appealEvents },
        { count: openClaims },
        { data: recoveryEvents },
      ] = await Promise.all([
        supabase.from('claim_assignments').select('claim_id', { count: 'exact', head: true })
          .eq('org_id', orgId).neq('status', 'resolved'),
        supabase.from('ops_events').select('claim_id, kind').eq('org_id', orgId)
          .in('kind', ['appeal_submitted', 'appeal_responded']),
        supabase.from('claims').select('claim_id', { count: 'exact', head: true }).eq('org_id', orgId),
        supabase.from('ops_events').select('payload').eq('org_id', orgId).eq('kind', 'recovery_recorded'),
      ]);
      const appealsBySClaim = new Map<string, string>();
      for (const e of appealEvents ?? []) {
        // Latest event per claim wins (insertion order from select is by occurred_at default).
        appealsBySClaim.set(e.claim_id as string, e.kind as string);
      }
      const pendingAppeals = Array.from(appealsBySClaim.values())
        .filter(k => k === 'appeal_submitted').length;
      const recovered = (recoveryEvents ?? []).reduce(
        (sum, r) => sum + Number(((r.payload as Record<string, unknown> | null)?.amount_cents) ?? 0), 0,
      );
      setDashboard({
        openClaims: openClaims ?? 0,
        appealsPending: pendingAppeals,
        opportunities: openAssn ?? 0,
        recoveredCents: recovered,
      });
    } catch (e) {
      toast({ title: 'Worklist load failed', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, orgId]);

  useEffect(() => { refresh(); }, [refresh]);

  const active = items[tab];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="My Worklist"
        subtitle="Work your assigned claims to recovery — assign, note, appeal, recover, and close."
        actions={
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Refresh
          </Button>
        }
      />

      <RecoveryDashboardCard d={dashboard} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex-1 flex flex-col min-h-0">
        <div className="px-5 pt-3 border-b">
          <TabsList className="h-9">
            <TabsTrigger value="mine" className="text-[12px]">
              <Inbox className="h-3.5 w-3.5 mr-1" /> Assigned to me
              <Count n={items.mine.length} />
            </TabsTrigger>
            <TabsTrigger value="overdue" className="text-[12px]">
              <AlarmClock className="h-3.5 w-3.5 mr-1" /> Overdue
              <Count n={items.overdue.length} tone="denied" />
            </TabsTrigger>
            <TabsTrigger value="today" className="text-[12px]">
              <CalendarClock className="h-3.5 w-3.5 mr-1" /> Due today
              <Count n={items.today.length} tone="pending" />
            </TabsTrigger>
            <TabsTrigger value="high_dollar" className="text-[12px]">
              <DollarSign className="h-3.5 w-3.5 mr-1" /> High dollar
              <Count n={items.high_dollar.length} />
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={tab} className="flex-1 min-h-0 overflow-hidden mt-0">
          {loading ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading worklist…
            </div>
          ) : active.length === 0 ? (
            <EmptyForTab tab={tab} userId={userId} orgId={orgId} onAssigned={refresh} />
          ) : (
            <WorklistTable
              items={active}
              meta={meta}
              onSelect={setSelected}
            />
          )}
        </TabsContent>
      </Tabs>

      <ClaimDrawer
        claimId={selected}
        orgId={orgId}
        userId={userId}
        onClose={() => setSelected(null)}
        onChanged={refresh}
      />
    </div>
  );
}

// =====================================================================

function Count({ n, tone }: { n: number; tone?: 'denied' | 'pending' }) {
  if (!n) return null;
  const cls = tone === 'denied'
    ? 'bg-status-denied/15 text-status-denied'
    : tone === 'pending'
      ? 'bg-status-pending/15 text-status-pending'
      : 'bg-muted text-muted-foreground';
  return <span className={`ml-1.5 px-1.5 rounded text-[10px] font-mono ${cls}`}>{n}</span>;
}

function RecoveryDashboardCard({ d }: { d: { openClaims: number; appealsPending: number; opportunities: number; recoveredCents: number } }) {
  const tiles = [
    { label: 'Open claims', value: String(d.openClaims), icon: Inbox },
    { label: 'Appeals pending', value: String(d.appealsPending), icon: Gavel },
    { label: 'Recovery opportunities', value: String(d.opportunities), icon: Target },
    { label: 'Dollars recovered', value: fmtMoney(d.recoveredCents), icon: TrendingUp, tone: 'text-status-paid' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 border-b bg-card">
      {tiles.map(t => {
        const Icon = t.icon;
        return (
          <div key={t.label} className="px-4 py-3 border-r last:border-r-0">
            <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
              <Icon className="h-3 w-3" /> {t.label}
            </div>
            <div className={`text-[20px] font-semibold tabular-nums mt-0.5 ${t.tone ?? ''}`}>
              {t.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorklistTable({
  items, meta, onSelect,
}: {
  items: WorklistItem[];
  meta: Record<string, { payer: string }>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-card border-b">
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 font-semibold">Claim ID</th>
            <th className="px-4 py-2 font-semibold">Payer</th>
            <th className="px-4 py-2 font-semibold text-right">Amount at risk</th>
            <th className="px-4 py-2 font-semibold">Priority</th>
            <th className="px-4 py-2 font-semibold">Due date</th>
            <th className="px-4 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr
              key={it.claim_id}
              onClick={() => onSelect(it.claim_id)}
              className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-2.5 font-mono">{it.claim_id}</td>
              <td className="px-4 py-2.5">{meta[it.claim_id]?.payer ?? '—'}</td>
              <td className="px-4 py-2.5 font-mono tabular-nums text-right">
                {fmtMoney(it.total_billed_cents)}
              </td>
              <td className="px-4 py-2.5">
                <span className={`pill border ${PRIORITY_TONE[it.priority] ?? ''}`}>{it.priority}</span>
              </td>
              <td className="px-4 py-2.5 font-mono">
                {it.due_date ? (
                  <span className={it.is_overdue ? 'text-status-denied font-semibold' : ''}>
                    {new Date(it.due_date).toLocaleDateString()}
                    {typeof it.days_until_due === 'number' && (
                      <span className="text-muted-foreground ml-1.5">
                        ({it.days_until_due >= 0 ? `${it.days_until_due}d` : `${-it.days_until_due}d late`})
                      </span>
                    )}
                  </span>
                ) : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-4 py-2.5">
                <span className={STATUS_TONE[it.status] ?? 'status-pending'}>
                  {it.status.replace('_', ' ')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyForTab({
  tab, userId, orgId, onAssigned,
}: { tab: TabKey; userId: string; orgId: string; onAssigned: () => void }) {
  const titles: Record<TabKey, string> = {
    mine: 'No claims assigned to you',
    overdue: 'No overdue claims — nicely done.',
    today: 'Nothing due today.',
    high_dollar: 'No high-dollar claims assigned to you.',
  };
  const body: Record<TabKey, string> = {
    mine: 'Pick up an unassigned claim from the org pool below.',
    overdue: 'Keep working items as they come in.',
    today: 'Your due-today inbox is empty.',
    high_dollar: 'High-value claims will appear here when assigned.',
  };

  return (
    <div className="h-full flex flex-col">
      <EmptyState
        title={titles[tab]}
        body={body[tab]}
        icon={<Inbox className="h-5 w-5" />}
      />
      {tab === 'mine' && (
        <div className="px-5 pb-5">
          <UnassignedPool userId={userId} orgId={orgId} onAssigned={onAssigned} />
        </div>
      )}
    </div>
  );
}

function UnassignedPool({
  userId, orgId, onAssigned,
}: { userId: string; orgId: string; onAssigned: () => void }) {
  const [pool, setPool] = useState<Array<{ claim_id: string; total_billed_cents: number; payer: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Claims with no assignment yet, or assignment unassigned + open.
    const [{ data: claims }, { data: asgn }] = await Promise.all([
      supabase.from('claims').select('claim_id, total_billed_cents, payload')
        .eq('org_id', orgId).order('total_billed_cents', { ascending: false }).limit(50),
      supabase.from('claim_assignments').select('claim_id, assigned_to_user_id, status').eq('org_id', orgId),
    ]);
    const assigned = new Map((asgn ?? []).map(a => [a.claim_id, a]));
    const items = (claims ?? [])
      .filter(c => {
        const a = assigned.get(c.claim_id);
        return !a || (!a.assigned_to_user_id && a.status !== 'resolved');
      })
      .slice(0, 20)
      .map(c => ({
        claim_id: c.claim_id,
        total_billed_cents: Number(c.total_billed_cents ?? 0),
        payer: ((c.payload as Record<string, unknown> | null)?.ohi_indicators?.[0]?.payer_name) ?? '—',
      }));
    setPool(items);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const assignToMe = async (claimId: string) => {
    setBusy(claimId);
    try {
      await updateAssignment(claimId, orgId, {
        assignedToUserId: userId,
        assignedByUserId: userId,
        status: 'open',
      });
      toast({ title: 'Assigned to you' });
      await load();
      onAssigned();
    } catch (e) {
      toast({ title: 'Assign failed', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border rounded-md bg-card">
      <div className="px-3 py-2 border-b text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
        Unassigned pool · top 20 by amount
      </div>
      {loading ? (
        <div className="p-3 text-[12px] text-muted-foreground">Loading…</div>
      ) : pool.length === 0 ? (
        <div className="p-3 text-[12px] text-muted-foreground">No unassigned claims.</div>
      ) : (
        <ul className="divide-y">
          {pool.map(c => (
            <li key={c.claim_id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
              <span className="font-mono">{c.claim_id}</span>
              <span className="text-muted-foreground">·</span>
              <span>{c.payer}</span>
              <span className="ml-auto font-mono tabular-nums">{fmtMoney(c.total_billed_cents)}</span>
              <Button
                size="sm" variant="outline"
                disabled={busy === c.claim_id}
                onClick={() => assignToMe(c.claim_id)}
              >
                {busy === c.claim_id ? 'Assigning…' : 'Take'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

