/**
 * Phase 23 — Payer Findings demo seed.
 *
 * Deliberately does NOT hand-write any expected/variance/severity number.
 * It builds realistic ParsedRow input (as if from a real 835 CSV upload)
 * and runs it through the exact same production pipeline a real import
 * takes: rowToClaim -> saveClaim, runContractRecoverySweep (fee-schedule
 * match -> detectUnderpayment -> maybeGenerateDispute), and
 * persistRemittanceBatch (real COB/denial/underpayment classification).
 * Every number on the Payer Findings dashboard is computed by that real
 * engine from these inputs, not authored directly.
 */
import type { Claim } from '@/types/claim';
import type { ParsedRow, ImportBatch } from '@/types/import';
import type { RemittanceLineRow } from '@/lib/lineage';
import { createContract, addFeeScheduleRows } from '@/lib/contracts';
import { rowToClaim } from '@/engine/import-to-claim';
import { runContractRecoverySweep } from '@/engine/contract-recovery';
import { persistRemittanceBatch } from '@/lib/remittance-batches';

const DEMO_CONTRACT_NAME = 'Payer Findings Demo — Commercial PPO';
const DEMO_PAYER_NAME = 'BlueCross BlueShield NC';

interface DemoRemittanceRow {
  claim_id: string;
  member_id: string;
  provider_npi: string;
  provider_name: string;
  service_date: string;
  procedure_code: string;
  billed_cents: number;
  allowed_cents: number;
  paid_cents: number;
  carc_code?: string;
  group_code?: 'CO' | 'PR' | 'OA' | 'PI' | 'CR';
}

// Four claims where the payer's own EOB paid at (or above) the allowed
// amount, but that allowed amount itself sits above the real contracted
// fee-schedule rate — a stale/misapplied rate, the real-world shape of a
// payment-integrity finding. Billed:allowed ratios (0.54-0.61) match the
// same ratios already used for the provider-side demo dataset.
const OVERPAYMENT_ROWS: DemoRemittanceRow[] = [
  { claim_id: 'PF-2024-101', member_id: 'MEM-88301', provider_npi: '4412007733', provider_name: 'Dr. Nina Okafor',
    service_date: '2024-10-02', procedure_code: '99213', billed_cents: 16_500, allowed_cents: 10_000, paid_cents: 10_000 },
  { claim_id: 'PF-2024-102', member_id: 'MEM-88322', provider_npi: '5523118844', provider_name: 'Dr. Marcus Webb',
    service_date: '2024-10-05', procedure_code: '99214', billed_cents: 28_500, allowed_cents: 17_200, paid_cents: 17_200 },
  { claim_id: 'PF-2024-103', member_id: 'MEM-88347', provider_npi: '6634229955', provider_name: 'Coastal Lab Services',
    service_date: '2024-10-09', procedure_code: '85025', billed_cents: 5_800, allowed_cents: 3_150, paid_cents: 3_150 },
  { claim_id: 'PF-2024-104', member_id: 'MEM-88359', provider_npi: '7745330066', provider_name: 'Dr. Priya Ramesh',
    service_date: '2024-10-11', procedure_code: '93000', billed_cents: 5_850, allowed_cents: 3_210, paid_cents: 3_210 },
];

// Two claims pended for coordination of benefits (CARC 22 / group OA) —
// classifyRemittance() flags these as 'cob' independent of the fee-schedule
// comparison above, feeding the dashboard's real COB Conflicts count.
const COB_ROWS: DemoRemittanceRow[] = [
  { claim_id: 'PF-2024-201', member_id: 'MEM-88401', provider_npi: '8856441177', provider_name: 'Dr. Leah Foster',
    service_date: '2024-10-14', procedure_code: '99215', billed_cents: 32_000, allowed_cents: 0, paid_cents: 0,
    carc_code: '22', group_code: 'OA' },
  { claim_id: 'PF-2024-202', member_id: 'MEM-88418', provider_npi: '9967552288', provider_name: 'Dr. Omar Haddad',
    service_date: '2024-10-16', procedure_code: '99204', billed_cents: 27_000, allowed_cents: 5_000, paid_cents: 5_000,
    carc_code: '22', group_code: 'OA' },
];

function toParsedRow(r: DemoRemittanceRow, index: number): ParsedRow {
  return {
    index,
    raw: {},
    status: 'ok',
    issues: [],
    normalized: {
      claim_id: r.claim_id,
      payer_name: DEMO_PAYER_NAME,
      member_id: r.member_id,
      provider_npi: r.provider_npi,
      provider_name: r.provider_name,
      service_date: r.service_date,
      billed_amount: r.billed_cents,
      allowed_amount: r.allowed_cents,
      paid_amount: r.paid_cents,
      procedure_code: r.procedure_code,
      ...(r.carc_code ? { carc_code: r.carc_code } : {}),
      ...(r.group_code ? { group_code: r.group_code } : {}),
    },
  };
}

/**
 * Seeds a real payer contract + fee schedule, then runs realistic
 * remittance rows through the real import pipeline so Payer Findings has
 * content on first load. No-ops if the demo contract already exists.
 */
export async function seedPayerFindingsDemo(
  orgId: string,
  saveClaim: (claim: Claim, orgId?: string) => Promise<void>,
): Promise<void> {
  const { supabase } = await import('@/integrations/supabase/client');
  const { data: existing } = await supabase
    .from('payer_contracts').select('contract_id').eq('contract_name', DEMO_CONTRACT_NAME).maybeSingle();
  if (existing) return;

  const contract = await createContract({
    payer_name: DEMO_PAYER_NAME,
    contract_name: DEMO_CONTRACT_NAME,
    effective_date: '2024-01-01',
    contract_type: 'commercial',
  });
  if (!contract) return;

  await addFeeScheduleRows(contract.contract_id, [
    { procedure_code: '99213', modifier: null, reimbursement_method: 'fixed_fee', contracted_amount_cents: 9_200 },
    { procedure_code: '99214', modifier: null, reimbursement_method: 'fixed_fee', contracted_amount_cents: 14_800 },
    { procedure_code: '85025', modifier: null, reimbursement_method: 'fixed_fee', contracted_amount_cents: 2_400 },
    { procedure_code: '93000', modifier: null, reimbursement_method: 'fixed_fee', contracted_amount_cents: 3_100 },
  ]);

  const allRows = [...OVERPAYMENT_ROWS, ...COB_ROWS];
  const parsedRows = allRows.map(toParsedRow);
  const batchId = crypto.randomUUID();

  let expected = 0;
  const lines: RemittanceLineRow[] = [];
  for (const row of parsedRows) {
    const { claim, expectedRecoveryCents } = rowToClaim(row, 'remittance_835', batchId);
    await saveClaim(claim, orgId);
    expected += expectedRecoveryCents;

    const src = allRows[row.index];
    lines.push({
      remittance_line_id: crypto.randomUUID(),
      org_id: orgId,
      remittance_batch_id: batchId,
      import_batch_id: null,
      source_row_number: row.index,
      claim_id: claim.claim_id,
      payer_name: DEMO_PAYER_NAME,
      service_date: src.service_date,
      procedure_code: src.procedure_code,
      modifier: null,
      billed_amount_cents: src.billed_cents,
      allowed_amount_cents: src.allowed_cents,
      paid_amount_cents: src.paid_cents,
      patient_responsibility_cents: 0,
      adjustment_amount_cents: Math.max(0, src.billed_cents - src.paid_cents),
      carc_code: src.carc_code ?? null,
      rarc_code: null,
      group_code: src.group_code ?? null,
      classification: null,
      created_at: new Date().toISOString(),
    });
  }

  // Real fee-schedule match -> detectUnderpayment -> dispute persistence
  // (both directions — this is what populates the Payer Findings table).
  await runContractRecoverySweep(lines, batchId);

  // Real denial/underpayment/COB classification -> remittance_batches
  // summary row (this is what populates the COB Conflicts KPI).
  const batch: ImportBatch = {
    batch_id: batchId,
    file_name: 'demo-835-payer-findings.csv',
    source_type: 'remittance_835',
    uploaded_by: null,
    status: 'committed',
    record_count: parsedRows.length,
    success_count: parsedRows.length,
    error_count: 0,
    warning_count: 0,
    import_score: 100,
    mapping: {},
    validation: {},
    generated_claim_ids: lines.map(l => l.claim_id ?? '').filter(Boolean),
    expected_recovery_cents: expected,
    uploaded_at: new Date().toISOString(),
  };
  await persistRemittanceBatch(batch, parsedRows, expected);
}
