import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlanBenefits } from '@/hooks/use-plan-benefits';
import { FileText, Upload } from 'lucide-react';
import { formatCents } from '@/hooks/use-clarity-data';

export default function PlanBenefitsHome() {
  const { plans, loading } = usePlanBenefits();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return plans.filter(p =>
      !q || p.payer_name.toLowerCase().includes(q) || p.plan_name.toLowerCase().includes(q));
  }, [plans, search]);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Plan Benefits</h1>
          <p className="text-[12.5px] text-muted-foreground">
            Deductibles, OOP max, coinsurance, and covered services — the plan-side data the adjudication kernel needs alongside your payer contracts.
          </p>
        </div>
        <Link to="/plan-benefits/upload" className="px-3 py-1.5 text-[12.5px] rounded-md bg-primary text-primary-foreground inline-flex items-center gap-1.5">
          <Upload className="h-3.5 w-3.5" />Add Plan
        </Link>
      </header>

      <div className="rounded-lg border bg-card">
        <div className="p-3 border-b flex items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search payer or plan…"
            className="flex-1 h-8 px-2 text-[12.5px] rounded border bg-background" />
        </div>
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading plans…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No plans on file yet. Outside demo mode, claims for a payer with no plan on file are skipped rather than
            adjudicated against zeroed benefits. <Link to="/plan-benefits/upload" className="text-primary underline">Add your first plan</Link>.
          </div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="text-muted-foreground border-b">
              <tr>
                <th className="text-left p-2">Payer</th>
                <th className="text-left p-2">Plan</th>
                <th className="text-left p-2">Version</th>
                <th className="text-left p-2">Year</th>
                <th className="text-right p-2">Deductible (Ind.)</th>
                <th className="text-right p-2">OOP Max (Ind.)</th>
                <th className="text-right p-2">Coinsurance</th>
                <th className="text-left p-2">Effective</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.plan_id} className="border-b hover:bg-muted/40">
                  <td className="p-2 font-medium">{p.payer_name}</td>
                  <td className="p-2">
                    <Link to={`/plan-benefits/${p.plan_id}/edit`} className="text-primary hover:underline inline-flex items-center gap-1">
                      <FileText className="h-3 w-3" />{p.plan_name}
                    </Link>
                  </td>
                  <td className="p-2 font-mono">v{p.plan_version}</td>
                  <td className="p-2 font-mono">{p.plan_year}</td>
                  <td className="p-2 text-right font-mono">{formatCents(p.deductible_individual)}</td>
                  <td className="p-2 text-right font-mono">{formatCents(p.oop_max_individual)}</td>
                  <td className="p-2 text-right font-mono">{Math.round(p.coinsurance_rate * 100)}%</td>
                  <td className="p-2 font-mono">{p.effective_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
