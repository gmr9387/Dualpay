import { useMemo, useState } from 'react';

import { PageHeader, Panel, ScrollBody } from '@/components/clarity/primitives';

import {
  listReplayRecords,
  type ReplayRecord,
} from '@/engine/replay-store';

import {
  replaySnapshot,
} from '@/engine/replay-engine';

import {
  verifyReplay,
  type VerificationResult,
} from '@/engine/trace-verifier';

import {
  Play,
  CheckCircle2,
  XCircle,
  History,
  FileSearch,
} from 'lucide-react';

export default function ReplayWorkbench() {
  const records = useMemo(
    () => listReplayRecords(),
    [],
  );

  const [selectedId, setSelectedId] = useState<string>();
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [running, setRunning] = useState(false);

  const selected: ReplayRecord | undefined =
    records.find(
      (r) =>
        r.snapshot.snapshot_id ===
        selectedId,
    ) ?? records[0];

  async function runReplay() {
    if (!selected) return;

    setRunning(true);

    try {
      const replay =
        await replaySnapshot(
          selected.snapshot,
          selected.run,
        );
      const verify =
        await verifyReplay(
          selected.snapshot,
          selected.run,
          selected.fingerprint,
          {
            actor: 'ReplayWorkbench',
            verifiedAt:
              selected.snapshot.created_at,
            writeLedgerEvent: true,
          },
        );

      setVerification({
        replay,
        verify,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Replay Workbench"
        subtitle="Replay historical adjudications and verify deterministic outcomes."
      />

      <ScrollBody>
        <div className="grid grid-cols-[360px_1fr] gap-4 p-5">
          <Panel
            title={`Snapshots (${records.length})`}
          >
            <div className="space-y-2">
              {records.map((record) => (
                <button
                  key={
                    record.snapshot.snapshot_id
                  }
                  onClick={() =>
                    setSelectedId(
                      record.snapshot.snapshot_id,
                    )
                  }
                  className={`w-full text-left rounded border p-3 transition-colors ${
                    selected?.snapshot
                      .snapshot_id ===
                    record.snapshot.snapshot_id
                      ? 'bg-primary/5 border-primary/30'
                      : 'bg-card hover:bg-muted/40'
                  }`}
                >
                  <div className="font-mono text-[11px]">
                    {
                      record.snapshot
                        .snapshot_id
                    }
                  </div>

                  <div className="text-[12px] mt-1">
                    {
                      record.snapshot
                        .claim_id
                    }
                  </div>

                  <div className="text-[10px] text-muted-foreground mt-1">
                    {record.created_at}
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <div className="space-y-4">
            {selected && (
              <>
                <Panel
                  title="Selected Snapshot"
                  action={
                    <button
                      onClick={runReplay}
                      disabled={running}
                      className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] inline-flex items-center gap-1.5"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Replay
                    </button>
                  }
                >
                  <div className="grid grid-cols-2 gap-3 text-[12px]">
                    <Field
                      label="Claim"
                      value={
                        selected.snapshot
                          .claim_id
                      }
                    />

                    <Field
                      label="Snapshot"
                      value={
                        selected.snapshot
                          .snapshot_id
                      }
                    />

                    <Field
                      label="Policy"
                      value={
                        selected.snapshot
                          .calc_policy_version
                      }
                    />

                    <Field
                      label="Fingerprint"
                      value={
                        selected.fingerprint.slice(
                          0,
                          16,
                        ) + '...'
                      }
                    />
                  </div>
                </Panel>

                {verification && (
                  <>
                    <Panel
                      title="Verification Result"
                    >
                      <div className="flex items-center gap-2">
                        {verification.verify
                          .verified ? (
                          <>
                            <CheckCircle2 className="h-5 w-5 text-status-paid" />
                            <span className="text-status-paid font-semibold">
                              VERIFIED
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-5 w-5 text-status-denied" />
                            <span className="text-status-denied font-semibold">
                              FAILED
                            </span>
                          </>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
                        <Field
                          label="Replay Match"
                          value={
                            verification.verify
                              .replay_match
                              ? 'PASS'
                              : 'FAIL'
                          }
                        />

                        <Field
                          label="Snapshot Match"
                          value={
                            verification.verify
                              .snapshot_match
                              ? 'PASS'
                              : 'FAIL'
                          }
                        />
                      </div>
                    </Panel>

                    <Panel title="Differences">
                      {verification.replay
                        .differences.length ===
                      0 ? (
                        <div className="text-status-paid text-[12px]">
                          No differences found.
                        </div>
                      ) : (
                        <ul className="space-y-1 text-[12px]">
                          {verification.replay.differences.map(
                            (
                              diff: string,
                              idx: number,
                            ) => (
                              <li
                                key={idx}
                                className="text-status-denied"
                              >
                                • {diff}
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </Panel>

                    <Panel title="Replay Summary">
                      <div className="grid grid-cols-2 gap-3 text-[12px]">
                        <Field
                          label="Original Run"
                          value={
                            verification.replay
                              .original_run_id
                          }
                        />

                        <Field
                          label="Replay Run"
                          value={
                            verification.replay
                              .replay_run_id
                          }
                        />
                      </div>
                    </Panel>
                  </>
                )}

                {!verification && (
                  <Panel title="Replay Status">
                    <div className="text-[12px] text-muted-foreground flex items-center gap-2">
                      <History className="h-4 w-4" />
                      Select a snapshot and run verification.
                    </div>
                  </Panel>
                )}
              </>
            )}

            {!selected && (
              <Panel title="Replay Status">
                <div className="text-[12px] text-muted-foreground flex items-center gap-2">
                  <FileSearch className="h-4 w-4" />
                  No snapshots found.
                </div>
              </Panel>
            )}
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>

      <div className="text-[12.5px] font-mono text-foreground break-all">
        {value}
      </div>
    </div>
  );
}