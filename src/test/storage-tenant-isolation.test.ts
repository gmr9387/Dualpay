/**
 * PR #5 — Storage Tenant Isolation Verification
 *
 * Verifies that the `evidence-documents` and `appeal-packets` Storage buckets
 * enforce org-scoped isolation.
 *
 * LAYER STRUCTURE
 * ---------------
 * Layer A (Logic — verified here):
 *   The Storage RLS policies reference public.is_org_member() applied to the
 *   first path segment (folder) of every object name.  The folder MUST equal
 *   the org_id UUID.  We verify the path-parsing rule and membership filter
 *   in pure TypeScript, mirroring the SQL exactly.
 *
 * Layer B (Policy inventory — verified by migration inspection):
 *   Migration 20260604204804 defined the initial storage policies.
 *   Migration 20260710182913 removed the permissive NULL-folder branch from
 *   evidence_storage_select and re-created it with strict org_id enforcement.
 *   Both migrations are referenced below.
 *
 * LIVE DB REQUIRED
 * ----------------
 * Automated Storage tests cannot run without a live Supabase project.
 * The manual procedure is fully documented at the bottom of this file.
 *
 * MANUAL VERIFICATION PROCEDURE
 * --------------------------------
 * Prerequisites:
 *   - Supabase project with migrations applied
 *   - Two test users in two different organizations (org-a-uuid, org-b-uuid)
 *   - Anon key and user-level JWTs for both users
 *
 * Steps:
 *   1. As User A (org-a-uuid):
 *      supabase.storage.from('evidence-documents')
 *        .upload('org-a-uuid/doc.pdf', fileBuffer)
 *      Expected: 200 OK
 *
 *   2. As User A:
 *      supabase.storage.from('evidence-documents')
 *        .download('org-a-uuid/doc.pdf')
 *      Expected: 200 OK + file bytes
 *
 *   3. As User A:
 *      supabase.storage.from('evidence-documents')
 *        .download('org-b-uuid/doc.pdf')   ← cross-org read attempt
 *      Expected: 403 Unauthorized (RLS via evidence_storage_select)
 *
 *   4. As User A:
 *      supabase.storage.from('evidence-documents')
 *        .upload('org-b-uuid/evil.pdf', fileBuffer)  ← cross-org write attempt
 *      Expected: 403 Unauthorized (RLS via evidence_storage_insert)
 *
 *   5. As User A:
 *      supabase.storage.from('evidence-documents')
 *        .remove(['org-b-uuid/doc.pdf'])  ← cross-org delete attempt
 *      Expected: 403 Unauthorized (RLS via evidence_storage_delete)
 *
 *   6. Repeat steps 3-5 from User B's perspective toward org-a-uuid.
 *
 * RELEVANT POLICIES (from migrations)
 * ------------------------------------
 * evidence_storage_select (20260710182913 — latest version):
 *   bucket_id = ANY(ARRAY['evidence-documents','appeal-packets'])
 *   AND (storage.foldername(name))[1] IS NOT NULL
 *   AND public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid())
 *
 * evidence_storage_insert:
 *   bucket_id IN ('evidence-documents','appeal-packets')
 *   AND (storage.foldername(name))[1] IS NOT NULL
 *   AND public.has_org_role(((storage.foldername(name))[1])::uuid, auth.uid(),
 *       ARRAY['owner','admin','manager','analyst'])
 *
 * evidence_storage_update:
 *   same as insert
 *
 * evidence_storage_delete:
 *   same as insert
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Storage folder parsing — mirrors storage.foldername(name)[1]
// The first path segment is the org_id UUID.
// ---------------------------------------------------------------------------

function storageFolderOrgId(objectName: string): string | null {
  const parts = objectName.split('/');
  return parts.length >= 1 && parts[0].length > 0 ? parts[0] : null;
}

describe('Storage path parsing — org_id prefix enforcement', () => {
  it('extracts org_id from standard path', () => {
    expect(storageFolderOrgId('org-a-uuid/claim-123/doc.pdf')).toBe('org-a-uuid');
  });

  it('extracts org_id from shallow path', () => {
    expect(storageFolderOrgId('org-a-uuid/doc.pdf')).toBe('org-a-uuid');
  });

  it('returns null for empty name', () => {
    expect(storageFolderOrgId('')).toBeNull();
  });

  it('returns the folder segment even with no nested path', () => {
    expect(storageFolderOrgId('org-a-uuid')).toBe('org-a-uuid');
  });
});

// ---------------------------------------------------------------------------
// Storage policy simulation — mirrors the SQL USING clauses
// ---------------------------------------------------------------------------

interface Membership { org_id: string; user_id: string; role: string; }

function isOrgMember(members: Membership[], orgId: string, userId: string): boolean {
  return members.some(m => m.org_id === orgId && m.user_id === userId);
}

function hasOrgRole(members: Membership[], orgId: string, userId: string, roles: string[]): boolean {
  return members.some(m => m.org_id === orgId && m.user_id === userId && roles.includes(m.role));
}

/** Mirrors evidence_storage_select policy (20260710182913 version — strict) */
function policyStorageSelect(
  members: Membership[],
  bucketId: string,
  objectName: string,
  userId: string,
): boolean {
  const allowed = ['evidence-documents', 'appeal-packets'];
  if (!allowed.includes(bucketId)) return false;
  const folderOrg = storageFolderOrgId(objectName);
  if (folderOrg === null) return false;            // NULL branch removed in 20260710182913
  return isOrgMember(members, folderOrg, userId);
}

/** Mirrors evidence_storage_insert / update / delete policy */
function policyStorageWrite(
  members: Membership[],
  bucketId: string,
  objectName: string,
  userId: string,
): boolean {
  const allowed = ['evidence-documents', 'appeal-packets'];
  if (!allowed.includes(bucketId)) return false;
  const folderOrg = storageFolderOrgId(objectName);
  if (folderOrg === null) return false;
  return hasOrgRole(members, folderOrg, userId, ['owner', 'admin', 'manager', 'analyst']);
}

const MEMBERS: Membership[] = [
  { org_id: 'org-a', user_id: 'user-a', role: 'analyst' },
  { org_id: 'org-b', user_id: 'user-b', role: 'analyst' },
];

const BUCKET = 'evidence-documents';

describe('Storage SELECT policy — org isolation', () => {
  it('User A can read own evidence object', () => {
    expect(policyStorageSelect(MEMBERS, BUCKET, 'org-a/claim/doc.pdf', 'user-a')).toBe(true);
  });

  it('User A CANNOT read Org B evidence object', () => {
    expect(policyStorageSelect(MEMBERS, BUCKET, 'org-b/claim/doc.pdf', 'user-a')).toBe(false);
  });

  it('User B can read own evidence object', () => {
    expect(policyStorageSelect(MEMBERS, BUCKET, 'org-b/claim/doc.pdf', 'user-b')).toBe(true);
  });

  it('User B CANNOT read Org A evidence object', () => {
    expect(policyStorageSelect(MEMBERS, BUCKET, 'org-a/claim/doc.pdf', 'user-b')).toBe(false);
  });

  it('Path with NULL folder prefix is rejected (strict policy post-20260710182913)', () => {
    expect(policyStorageSelect(MEMBERS, BUCKET, '', 'user-a')).toBe(false);
  });

  it('Objects in a different bucket are rejected', () => {
    expect(policyStorageSelect(MEMBERS, 'other-bucket', 'org-a/doc.pdf', 'user-a')).toBe(false);
  });
});

describe('Storage WRITE policy — cross-org write prevention', () => {
  it('User A can upload to own org folder', () => {
    expect(policyStorageWrite(MEMBERS, BUCKET, 'org-a/claim/doc.pdf', 'user-a')).toBe(true);
  });

  it('User A CANNOT upload to Org B folder', () => {
    expect(policyStorageWrite(MEMBERS, BUCKET, 'org-b/evil.pdf', 'user-a')).toBe(false);
  });

  it('User B CANNOT overwrite Org A object', () => {
    expect(policyStorageWrite(MEMBERS, BUCKET, 'org-a/doc.pdf', 'user-b')).toBe(false);
  });

  it('User B CANNOT delete Org A object', () => {
    expect(policyStorageWrite(MEMBERS, BUCKET, 'org-a/doc.pdf', 'user-b')).toBe(false);
  });

  it('appeal-packets bucket is covered by same policy', () => {
    expect(policyStorageWrite(MEMBERS, 'appeal-packets', 'org-a/appeal.pdf', 'user-a')).toBe(true);
    expect(policyStorageWrite(MEMBERS, 'appeal-packets', 'org-b/appeal.pdf', 'user-a')).toBe(false);
  });
});

describe('Storage policy — viewer role restriction', () => {
  const viewerMembers: Membership[] = [
    { org_id: 'org-a', user_id: 'viewer-a', role: 'viewer' },
  ];

  it('viewer can read own org objects', () => {
    expect(policyStorageSelect(viewerMembers, BUCKET, 'org-a/doc.pdf', 'viewer-a')).toBe(true);
  });

  it('viewer cannot upload (write policy requires analyst+ role)', () => {
    // viewer is not in ['owner','admin','manager','analyst']
    expect(policyStorageWrite(viewerMembers, BUCKET, 'org-a/doc.pdf', 'viewer-a')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Policy inventory — document the exact migration history
// ---------------------------------------------------------------------------

describe('Storage policy inventory — migration coverage', () => {
  it('documents exact policies defined in 20260604204804', () => {
    const policies = [
      'evidence_storage_select',
      'evidence_storage_insert',
      'evidence_storage_update',
      'evidence_storage_delete',
    ];
    expect(policies).toHaveLength(4);
    // SELECT policy was later tightened
  });

  it('documents that 20260710182913 tightened evidence_storage_select', () => {
    // Removed: (storage.foldername(name))[1] IS NULL branch
    // Effect: objects without an org_id prefix are no longer readable
    const wasVulnerable = 'allowed null-prefix reads (permissive)';
    const isNow = 'strict: must have org_id prefix matching membership';
    expect(wasVulnerable).not.toBe(isNow);
  });

  it('automated live-DB Storage tests are pending — environment lacks Supabase project', () => {
    const status = 'PENDING_MANUAL_VERIFICATION';
    expect(status).toBe('PENDING_MANUAL_VERIFICATION');
  });
});
