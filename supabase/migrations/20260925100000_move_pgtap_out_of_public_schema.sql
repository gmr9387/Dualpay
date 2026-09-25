-- Supabase's security advisor flags any extension installed in `public`
-- (extension_in_public, WARN) -- pgtap was installed there earlier this
-- session (docs/RISK_REGISTER.md risk #102) without specifying a schema.
-- Moves it to `extensions`, the schema Supabase's own default
-- search_path already includes (confirmed live: '"$user", public,
-- extensions'), so every existing supabase/tests/*.pgtap.sql file's
-- unqualified plan()/ok()/throws_ok()/finish() calls keep working
-- unchanged -- re-ran phase4b_write_off_authorization.pgtap.sql's first
-- two assertions live after this move to confirm (2/2 passed, 0 failed).
create schema if not exists extensions;
alter extension pgtap set schema extensions;
