import { useEffect, useState } from 'react';
import { RequireRole } from '@/components/auth/RequireRole';
import { useOrg } from '@/hooks/use-org';
import { supabase } from '@/integrations/supabase/client';
import { formatCents } from '@/hooks/use-clarity-data';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { BillingInvoice } from '@/types/billing';
import { Landmark, ExternalLink } from 'lucide-react';

const STATUS_TONE: Record<string, string> = {
  paid: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  open: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  draft: 'bg-muted text-muted-foreground border-border',
  payment_failed: 'bg-destructive/15 text-destructive border-destructive/30',
  void: 'bg-muted text-muted-foreground border-border',
  uncollectible: 'bg-destructive/15 text-destructive border-destructive/30',
};

function AdminBillingContent() {
  const { currentOrg, refresh } = useOrg();
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const loadInvoices = async () => {
    if (!currentOrg) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('billing_invoices')
      .select('*')
      .eq('org_id', currentOrg.org_id)
      .order('created_at', { ascending: false });
    if (error) console.error('[billing] load invoices failed', error.message);
    setInvoices((data ?? []) as BillingInvoice[]);
    setLoading(false);
  };

  useEffect(() => { loadInvoices(); }, [currentOrg?.org_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === '1') {
      toast({ title: 'Bank account connected', description: 'Contingency fees will now be invoiced via ACH.' });
      refresh();
      window.history.replaceState({}, '', '/admin/billing');
    } else if (params.get('cancelled') === '1') {
      toast({ title: 'Bank connection cancelled', variant: 'destructive' });
      window.history.replaceState({}, '', '/admin/billing');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connectBank = async () => {
    if (!currentOrg) return;
    setConnecting(true);
    const origin = window.location.origin;
    const { data, error } = await supabase.functions.invoke('stripe-sync-customer', {
      body: {
        org_id: currentOrg.org_id,
        success_url: `${origin}/admin/billing?connected=1`,
        cancel_url: `${origin}/admin/billing?cancelled=1`,
      },
    });
    setConnecting(false);
    if (error || !data?.url) {
      toast({ title: 'Could not start bank connection', description: data?.error ?? error?.message, variant: 'destructive' });
      return;
    }
    window.location.href = data.url;
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Contingency fees on recovered underpayment disputes are rolled up into one invoice per org, monthly, and charged via ACH bank debit.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Landmark className="h-4 w-4" /> Bank account</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {currentOrg?.ach_connected_at ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Connected</Badge>
              <span className="text-xs text-muted-foreground">since {new Date(currentOrg.ach_connected_at).toLocaleDateString()}</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              No bank account connected yet — invoices will be sent by email (net-15) until you connect one for automatic ACH debit.
            </div>
          )}
          <Button onClick={connectBank} disabled={connecting} size="sm">
            {connecting ? 'Redirecting…' : currentOrg?.ach_connected_at ? 'Reconnect bank account' : 'Connect bank account'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Invoice history</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : invoices.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No invoices yet — the monthly rollup bills every recovered dispute with an assessed fee that hasn't been invoiced.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Disputes</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.invoice_id}>
                    <TableCell className="text-xs font-mono">{inv.period_start} – {inv.period_end}</TableCell>
                    <TableCell className="text-xs">{inv.dispute_count}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCents(inv.subtotal_cents)}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-[10px] uppercase ${STATUS_TONE[inv.status] ?? ''}`}>{inv.status.replace('_', ' ')}</Badge></TableCell>
                    <TableCell>
                      {inv.hosted_invoice_url ? (
                        <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminBilling() {
  return (
    <RequireRole min="admin">
      <AdminBillingContent />
    </RequireRole>
  );
}
