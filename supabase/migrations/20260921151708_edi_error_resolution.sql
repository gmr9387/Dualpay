-- EDI error resolution: closes the EDI Errors loop. Errors surfaced by the
-- X12 validator (edi-validator.ts, persisted via ingestEdiFile) had no
-- status field — EdiErrors.tsx was a pure read-only list with nowhere for a
-- reviewed/corrected error to go. Mirrors the status/resolved_at shape
-- already used on import_exceptions.
ALTER TABLE public.edi_errors
  ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  ADD COLUMN resolution_note text,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX edi_err_status_idx ON public.edi_errors(status);
