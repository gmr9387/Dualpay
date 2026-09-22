import { Link } from 'react-router-dom';
import { PageHeader, Panel, ScrollBody } from '@/components/clarity/primitives';
import { Upload, FileJson, FileText } from 'lucide-react';

export default function Ingestion() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Ingestion" subtitle="Normalize incoming ERA/EOB responses, payer payloads, and denial files into claims, lines, and reimbursement events." />
      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title="Drop a file to ingest">
              <div className="border-2 border-dashed rounded-md py-12 text-center text-muted-foreground">
                <Upload className="h-8 w-8 mx-auto mb-2 opacity-60" />
                <div className="text-[13px] font-medium text-foreground">Drag &amp; drop ERA / EOB / Claim JSON here</div>
                <div className="text-[11.5px] mt-1">Supports 835, 837P/I, custom denial files, payer portal exports</div>
                <Link
                  to="/edi/import"
                  className="mt-3 h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Go to EDI Import
                </Link>
                <div className="text-[11px] mt-1.5 text-muted-foreground">
                  Real 835/837 upload, parsing, and claim import lives on the EDI Import page.
                </div>
              </div>
            </Panel>

            <Panel title="Ingestion Lineage">
              <div className="divide-y -mx-4 -my-4 text-[12px]">
                <Row icon={<FileJson className="h-3.5 w-3.5" />} name="batch_835_2024-11-14.json" type="835 EDI" claims={18} status="Normalized" />
                <Row icon={<FileText className="h-3.5 w-3.5" />} name="aetna_portal_export.csv" type="Portal Export" claims={6} status="Normalized" />
                <Row icon={<FileJson className="h-3.5 w-3.5" />} name="medicare_pra_q3.json" type="835 EDI" claims={4} status="Normalized" />
              </div>
            </Panel>
          </div>
          <div className="space-y-4">
            <Panel title="Normalization Mappings">
              <ul className="space-y-1.5 text-[12px]">
                <li className="flex justify-between"><span className="text-muted-foreground">835 → Claims</span><span className="font-mono text-status-paid">active</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">837P → Claim Lines</span><span className="font-mono text-status-paid">active</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">CAS → Denial Events</span><span className="font-mono text-status-paid">active</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">CARC/RARC lookup</span><span className="font-mono text-status-paid">14 mapped</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Portal export parser</span><span className="font-mono text-status-pending">scaffold</span></li>
              </ul>
            </Panel>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Row({ icon, name, type, claims, status }: { icon: React.ReactNode; name: string; type: string; claims: number; status: string }) {
  return (
    <div className="grid grid-cols-[1fr_120px_80px_120px] gap-3 items-center px-4 py-2.5">
      <span className="flex items-center gap-2 text-foreground"><span className="text-muted-foreground">{icon}</span><span className="font-mono text-[11.5px]">{name}</span></span>
      <span className="text-[11.5px] text-muted-foreground">{type}</span>
      <span className="font-mono text-[11.5px] text-foreground">{claims} claims</span>
      <span className="text-[11.5px] text-status-paid font-mono">{status}</span>
    </div>
  );
}
