-- The evidence-documents and appeal-packets Storage buckets never got
-- recreated during the Supabase consolidation into nucleus-2 -- the RLS
-- policies referencing them (evidence_storage_select/insert/update/delete)
-- were migrated correctly, but with no underlying bucket row, every
-- upload from EvidenceUploader/uploadAppealPacket has been failing with
-- "bucket not found". Creates both, private, with file_size_limit and
-- allowed_mime_types set server-side (RISK_REGISTER #68 -- zip-bomb/
-- oversized upload DoS -- belongs at this boundary, not just a client
-- check that a modified request could skip).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence-documents',
  'evidence-documents',
  false,
  26214400, -- 25 MB
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'appeal-packets',
  'appeal-packets',
  false,
  10485760, -- 10 MB
  ARRAY['application/pdf', 'text/markdown']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
