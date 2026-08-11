/**
 * Phase 3B — Claim Drawer
 *
 * Slide-over sheet for working a single claim end-to-end:
 * summary, timeline, assignment, notes, appeal, recovery, write-off.
 *
 * Uses only Phase 3A repository functions in src/data/operational-workflows.ts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import {
  updateAssignment, addNote, logAppealEvent, logRecoveryEvent, logWriteOff,
  getClaimTimeline, getNoteTimeline, makeIdempotencyKey,
  type TimelineEvent, type ClaimAssignmentRecord,
} from '@/data/operational-workflows';
import { supabase } from '@/integrations/supabase/client';
import type { Claim } from '@/types/claim';
import {
  Loader2, FileText, History, UserCheck, StickyNote, Gavel, Banknote, XCircle,
} from 'lucide-react';

interface Props {
  claimId: string | null;
  orgId: string;
  userId: string;
  onClose: () => void;
  onChanged?: () => void;
}

const PRIORITY_TONE: Record<string, string> = {
  urgent: 'bg-status-denied/15 text-status-denied border-status-denied/30',
  high:   'bg-status-pending/15 text-status-pending border-status-pending/30',
  medium: 'bg-status-adjusted/15 text-status-adjusted border-status-adjusted/30',
  low:    'bg-muted text-muted-foreground border-border',
};

const KIND_TONE: Record<string, string> = {
  note_added: 'bg-muted text-foreground',
  assignment_created: 'bg-status-cob/10 text-status-cob',
  assignment_updated: 'bg-status-cob/10 text-status-cob',
  appeal_submitted: 'bg-status-pending/15 text-status-pending',
  appeal_responded: 'bg-status-adjusted/15 text-status-adjusted',
  appeal_resolved: 'bg-status-paid/15 text-status-paid',
  recovery_recorded: 'bg-status-paid/15 text-status-paid',
  claim_written_off: 'bg-status-denied/15 text-status-denied',
};

function fmtMoney(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format((cents ?? 0) / 100);
}

export function ClaimDrawer({ claimId, orgId, userId, onClose, onChanged }: Props) {
  const open = !!claimId;
  const [loading, setLoading] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [assignment, setAssignment] = useState<ClaimAssignmentRecord | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!claimId) return;
    setLoading(true);
    try {
      const [{ data: claimRow }, { data: asgnRow }, tl] = await Promise.all([
        supabase.from('claims').select('payload').eq('claim_id', claimId).maybeSingle(),
        supabase.from('claim_assignments').select('*').eq('claim_id', claimId).maybeSingle(),
        getClaimTimeline(claimId, orgId),
      ]);
      setClaim(((claimRow?.payload as unknown) as Claim) ?? null);
      setAssignment((asgnRow as ClaimAssignmentRecord) ?? null);
      setTimeline(tl);
    } catch (e) {
      toast({ title: 'Failed to load claim', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [claimId, orgId]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const wrap = async (fn: () => Promise<unknown>, successMsg: string) => {
    if (!claimId) return;
    setBusy(true);
    try {
      await fn();
      toast({ title: successMsg });
      await refresh();
      onChanged?.();
    } catch (e) {
      toast({ title: 'Action failed', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const payerName = useMemo(
    () => claim?.ohi_indicators?.[0]?.payer_name ?? '—',
    [claim],
  );

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b">
          <SheetTitle className="text-base font-semibold tracking-tight font-mono">
            {claimId ?? '—'}
          </SheetTitle>
          <SheetDescription className="text-[12px]">
            {claim ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <span>{claim.provider_name}</span>
                <span>·</span>
                <span>{payerName}</span>
                <span>·</span>
                <span className="font-mono">{fmtMoney(claim.total_billed)}</span>
              </span>
            ) : 'Loading…'}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading claim…
          </div>
        ) : (
          <Tabs defaultValue="summary" className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-5 mt-3 grid grid-cols-5 h-9">
              <TabsTrigger value="summary" className="text-[11.5px]"><FileText className="h-3.5 w-3.5 mr-1" />Summary</TabsTrigger>
              <TabsTrigger value="timeline" className="text-[11.5px]"><History className="h-3.5 w-3.5 mr-1" />Timeline</TabsTrigger>
              <TabsTrigger value="notes" className="text-[11.5px]"><StickyNote className="h-3.5 w-3.5 mr-1" />Notes</TabsTrigger>
              <TabsTrigger value="appeal" className="text-[11.5px]"><Gavel className="h-3.5 w-3.5 mr-1" />Appeal</TabsTrigger>
              <TabsTrigger value="recovery" className="text-[11.5px]"><Banknote className="h-3.5 w-3.5 mr-1" />Recovery</TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* ── SUMMARY ── */}
              <TabsContent value="summary" className="mt-0 space-y-4">
                {claim && (
                  <div className="grid grid-cols-2 gap-3 text-[12.5px]">
                    <SummaryRow label="Member" value={claim.member_id} />
                    <SummaryRow label="Type" value={claim.claim_type} />
                    <SummaryRow label="Provider" value={claim.provider_name} />
                    <SummaryRow label="Provider NPI" value={claim.provider_npi} />
                    <SummaryRow label="Service from" value={claim.service_date_from} />
                    <SummaryRow label="Service to" value={claim.service_date_to} />
                    <SummaryRow label="Total billed" value={fmtMoney(claim.total_billed)} mono />
                    <SummaryRow label="Adj. status" value={claim.status} />
                    <SummaryRow label="Primary payer" value={payerName} />
                    <SummaryRow label="Lines" value={String(claim.lines?.length ?? 0)} />
                  </div>
                )}

                <AssignmentPanel
                  assignment={assignment}
                  busy={busy}
                  userId={userId}
                  onSave={async (params) =>
                    wrap(
                      () => updateAssignment(claimId!, orgId, { ...params, assignedByUserId: userId }),
                      'Assignment updated',
                    )
                  }
                />

                <div className="border rounded-md p-3 bg-card">
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                    Danger zone
                  </div>
                  <WriteOffForm
                    busy={busy}
                    onSubmit={(reason, idempotencyKey) =>
                      wrap(() => logWriteOff(claimId!, orgId, reason, userId, idempotencyKey), 'Claim written off')
                    }
                  />
                </div>
              </TabsContent>

              {/* ── TIMELINE ── */}
              <TabsContent value="timeline" className="mt-0">
                <TimelineView events={timeline} />
              </TabsContent>

              {/* ── NOTES ── */}
              <TabsContent value="notes" className="mt-0 space-y-3">
                <NotesPanel
                  claimId={claimId!}
                  orgId={orgId}
                  userId={userId}
                  busy={busy}
                  onAdd={(note) =>
                    wrap(() => addNote(claimId!, orgId, note, userId), 'Note added')
                  }
                />
              </TabsContent>

              {/* ── APPEAL ── */}
              <TabsContent value="appeal" className="mt-0 space-y-3">
                <AppealPanel
                  busy={busy}
                  onSubmit={(params) =>
                    wrap(() => logAppealEvent(claimId!, orgId, params), `Appeal: ${params.summary}`)
                  }
                />
                <TimelineView
                  events={timeline.filter(e => e.kind.startsWith('appeal_'))}
                  emptyText="No appeal activity yet."
                />
              </TabsContent>

              {/* ── RECOVERY ── */}
              <TabsContent value="recovery" className="mt-0 space-y-3">
                <RecoveryPanel
                  busy={busy}
                  onSubmit={(params) =>
                    wrap(
                      () => logRecoveryEvent(claimId!, orgId, { ...params, analystUserId: userId }),
                      'Recovery recorded',
                    )
                  }
                />
                <TimelineView
                  events={timeline.filter(e => e.kind === 'recovery_recorded')}
                  emptyText="No recoveries logged yet."
                />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

// =====================================================================
// Sub-panels
// =====================================================================

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
      <span className={`text-[12.5px] ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
    </div>
  );
}

function AssignmentPanel({
  assignment, busy, userId, onSave,
}: {
  assignment: ClaimAssignmentRecord | null;
  busy: boolean;
  userId: string;
  onSave: (p: {
    assignedToUserId?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    dueDate?: Date;
    status?: 'open' | 'in_progress' | 'snoozed' | 'resolved';
  }) => void;
}) {
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>(
    (assignment?.priority as never) ?? 'medium',
  );
  const [status, setStatus] = useState<'open' | 'in_progress' | 'snoozed' | 'resolved'>(
    (assignment?.status as never) ?? 'open',
  );
  const [due, setDue] = useState<string>(
    assignment?.due_date ? assignment.due_date.slice(0, 10) : '',
  );

  useEffect(() => {
    setPriority((assignment?.priority as never) ?? 'medium');
    setStatus((assignment?.status as never) ?? 'open');
    setDue(assignment?.due_date ? assignment.due_date.slice(0, 10) : '');
  }, [assignment]);

  const assigned = assignment?.assigned_to_user_id;
  const isMine = assigned === userId;

  return (
    <div className="border rounded-md p-3 bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
          Assignment
        </div>
        <div className="flex items-center gap-2">
          {assigned && (
            <span className={`pill border ${PRIORITY_TONE[priority] ?? ''} font-mono`}>
              <UserCheck className="h-3 w-3 mr-1 inline" />
              {isMine ? 'Mine' : assigned.slice(0, 8)}
            </span>
          )}
          {assigned ? (
            <Button
              size="sm" variant="outline"
              disabled={busy}
              onClick={() => onSave({ assignedToUserId: undefined })}
            >Unassign</Button>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onSave({ assignedToUserId: userId })}
            >Assign to me</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10.5px]">Priority</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as never)}>
            <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['low', 'medium', 'high', 'urgent'].map(p => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10.5px]">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as never)}>
            <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['open', 'in_progress', 'snoozed', 'resolved'].map(s => (
                <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10.5px]">Due date</Label>
          <Input
            type="date" value={due}
            onChange={(e) => setDue(e.target.value)}
            className="h-8 text-[12.5px]"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm" disabled={busy}
          onClick={() => onSave({
            priority,
            status,
            dueDate: due ? new Date(due) : undefined,
          })}
        >Save changes</Button>
      </div>
    </div>
  );
}

function NotesPanel({
  claimId, orgId, userId, busy, onAdd,
}: {
  claimId: string; orgId: string; userId: string;
  busy: boolean; onAdd: (note: string) => void;
}) {
  const [text, setText] = useState('');
  const [notes, setNotes] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getNoteTimeline(claimId, orgId)
      .then(n => { if (alive) setNotes(n); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [claimId, orgId, busy]);

  return (
    <>
      <div className="border rounded-md p-3 bg-card">
        <Label className="text-[10.5px]">Add note</Label>
        <Textarea
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder="What did you observe or do on this claim?"
          className="text-[12.5px] mt-1" rows={3}
        />
        <div className="flex justify-end mt-2">
          <Button
            size="sm" disabled={busy || !text.trim()}
            onClick={() => { onAdd(text.trim()); setText(''); }}
          >Save note</Button>
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-[12px] text-muted-foreground">Loading notes…</div>
        ) : notes.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No notes yet.</div>
        ) : notes.slice().reverse().map(n => (
          <div key={n.event_id} className="border rounded-md p-2.5 bg-card">
            <div className="text-[10.5px] text-muted-foreground font-mono">
              {new Date(n.occurred_at).toLocaleString()}
              {n.actor && <> · {String(n.actor).slice(0, 8)}</>}
            </div>
            <div className="text-[12.5px] mt-1 whitespace-pre-wrap">
              {(n.payload?.note as string) ?? n.summary}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function AppealPanel({
  busy, onSubmit,
}: {
  busy: boolean;
  onSubmit: (p: {
    kind: 'appeal_submitted' | 'appeal_responded' | 'appeal_resolved';
    summary: string;
    appealStatus?: 'pending_response' | 'won' | 'lost' | 'withdrawn';
    payerResponse?: string;
    notes?: string;
  }) => void;
}) {
  const [notes, setNotes] = useState('');
  return (
    <div className="border rounded-md p-3 bg-card space-y-2">
      <Label className="text-[10.5px]">Appeal notes (optional)</Label>
      <Textarea
        rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
        className="text-[12.5px]"
        placeholder="Reason, reference number, payer contact…"
      />
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button size="sm" disabled={busy} onClick={() => {
          onSubmit({
            kind: 'appeal_submitted',
            summary: 'Appeal submitted to payer',
            appealStatus: 'pending_response',
            notes: notes || undefined,
          });
          setNotes('');
        }}>Submit appeal</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => {
          onSubmit({
            kind: 'appeal_responded',
            summary: 'Payer responded to appeal',
            payerResponse: notes || 'response received',
            notes: notes || undefined,
          });
          setNotes('');
        }}>Record response</Button>
        <Button size="sm" variant="outline" className="border-status-paid/40 text-status-paid"
          disabled={busy} onClick={() => {
            onSubmit({
              kind: 'appeal_resolved',
              summary: 'Appeal won',
              appealStatus: 'won',
              notes: notes || undefined,
            });
            setNotes('');
          }}>Mark won</Button>
        <Button size="sm" variant="outline" className="border-status-denied/40 text-status-denied"
          disabled={busy} onClick={() => {
            onSubmit({
              kind: 'appeal_resolved',
              summary: 'Appeal lost',
              appealStatus: 'lost',
              notes: notes || undefined,
            });
            setNotes('');
          }}>Mark lost</Button>
      </div>
    </div>
  );
}

function RecoveryPanel({
  busy, onSubmit,
}: {
  busy: boolean;
  onSubmit: (p: {
    recoveryType: 'payer_payment' | 'patient_payment' | 'writeoff' | 'adjustment';
    amountCents: number;
    recoveredFrom: string;
    notes?: string;
    idempotencyKey: string;
  }) => void;
}) {
  const [type, setType] = useState<'payer_payment' | 'patient_payment' | 'writeoff' | 'adjustment'>('payer_payment');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [notes, setNotes] = useState('');

  const valid = !!amount && !!source && Number(amount) > 0;

  return (
    <div className="border rounded-md p-3 bg-card space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10.5px]">Recovery type</Label>
          <Select value={type} onValueChange={(v) => setType(v as never)}>
            <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="payer_payment">Payer payment</SelectItem>
              <SelectItem value="patient_payment">Patient payment</SelectItem>
              <SelectItem value="adjustment">Adjustment</SelectItem>
              <SelectItem value="writeoff">Write-off</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10.5px]">Amount (USD)</Label>
          <Input
            type="number" min="0" step="0.01"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className="h-8 text-[12.5px] font-mono"
          />
        </div>
      </div>
      <div>
        <Label className="text-[10.5px]">Source / payer</Label>
        <Input
          value={source} onChange={(e) => setSource(e.target.value)}
          placeholder="e.g. Blue Cross, Patient, Adjustment - timely filing"
          className="h-8 text-[12.5px]"
        />
      </div>
      <div>
        <Label className="text-[10.5px]">Notes (optional)</Label>
        <Textarea
          rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
          className="text-[12.5px]"
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={busy || !valid} onClick={() => {
          const idempotencyKey = makeIdempotencyKey('recovery');
          onSubmit({
            recoveryType: type,
            amountCents: Math.round(Number(amount) * 100),
            recoveredFrom: source.trim(),
            notes: notes || undefined,
            idempotencyKey,
          });
          setAmount(''); setSource(''); setNotes('');
        }}>Record recovery</Button>
      </div>
    </div>
  );
}

function WriteOffForm({
  busy, onSubmit,
}: { busy: boolean; onSubmit: (reason: string, idempotencyKey: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-2">
      <Label className="text-[10.5px]">Write-off reason</Label>
      <Input
        value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Timely filing exhausted, uncollectable, etc."
        className="h-8 text-[12.5px]"
      />
      <div className="flex justify-end">
        <Button
          size="sm" variant="outline" disabled={busy || !reason.trim()}
          className="border-status-denied/40 text-status-denied hover:bg-status-denied/10"
          onClick={() => { onSubmit(reason.trim(), makeIdempotencyKey('write_off')); setReason(''); }}
        >
          <XCircle className="h-3.5 w-3.5 mr-1" /> Write off claim
        </Button>
      </div>
    </div>
  );
}

function TimelineView({
  events, emptyText = 'No activity yet.',
}: { events: TimelineEvent[]; emptyText?: string }) {
  if (events.length === 0) {
    return <div className="text-[12px] text-muted-foreground py-4">{emptyText}</div>;
  }
  return (
    <ol className="relative border-l border-border ml-2 space-y-3">
      {events.slice().reverse().map((e) => (
        <li key={e.event_id} className="ml-4">
          <div className="absolute -left-1.5 h-3 w-3 rounded-full bg-card border border-border" />
          <div className="flex items-center gap-2 text-[10.5px] font-mono text-muted-foreground">
            <span>{new Date(e.occurred_at).toLocaleString()}</span>
            <span className={`pill ${KIND_TONE[e.kind] ?? 'bg-muted text-foreground'}`}>
              {e.kind.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="text-[12.5px] mt-0.5">{e.summary}</div>
        </li>
      ))}
    </ol>
  );
}
