-- =====================================================================
-- DATABASE FINGERPRINT — run BEFORE and AFTER every applied migration.
--
-- The whole point is that this file does not change. A digest is only
-- evidence while the formula that produced it is fixed and written down;
-- editing this file silently invalidates every value recorded in
-- CLAUDE.md, so a change here means re-taking the baseline in the same
-- commit.
--
-- The Pass C digests were lost to exactly this: their formula was never
-- recorded, their "non-inv_" label turned out to be wrong, and they had to
-- be deleted rather than diffed against. See CLAUDE.md.
--
-- NO NAME FILTERING, deliberately. Every part covers all of `public`.
-- Filtering by an `inv_` prefix is what made the old set ambiguous — the
-- label said one thing and the query did another. Scope questions are
-- answered by reading the migration, not by pre-filtering the proof.
--
--   supabase db query --linked --file supabase/smoke/fingerprint.sql
--
-- Read-only. Runs no DDL and writes nothing.
-- =====================================================================
select 'schema' as part,
 (select md5(string_agg(x, E'\n' order by x)) from (
    select c.table_name||'.'||c.column_name||':'||c.data_type||':'||c.is_nullable||':'||coalesce(c.column_default,'') as x
    from information_schema.columns c
    join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
    where c.table_schema='public' and t.table_type='BASE TABLE') s) as md5,
 (select count(*) from information_schema.tables
   where table_schema='public' and table_type='BASE TABLE')::text as cnt
union all
select 'policies',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select tablename||'|'||policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||array_to_string(roles,',') as x
    from pg_policies where schemaname='public') s),
 (select count(*)::text from pg_policies where schemaname='public')
union all
select 'functions',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')='||md5(p.prosrc) as x
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') s),
 (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public')
union all
select 'constraints',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select rel.relname||':'||con.conname||':'||con.contype::text||':'||pg_get_constraintdef(con.oid) as x
    from pg_constraint con join pg_class rel on rel.oid=con.conrelid
    join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public') s),
 (select count(*)::text from pg_constraint con join pg_class rel on rel.oid=con.conrelid
    join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public')
union all
select 'triggers',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select c.relname||':'||t.tgname||':'||pg_get_triggerdef(t.oid) as x
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='public') s),
 (select count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='public')
union all
-- pg_get_viewdef, NOT information_schema.views.view_definition.
--
-- Caught while validating this very file: information_schema returns NULL for
-- view_definition when the querying role lacks privileges on the view. Read as
-- `supabase_read_only_user` (which is what the MCP tool connects as), all 11
-- definitions came back NULL, so the digest was the md5 of eleven empty
-- strings — a stable, confident, entirely meaningless number that would have
-- matched itself forever while the views changed underneath it.
--
-- pg_get_viewdef reads pg_rewrite directly and returns the same text from both
-- the CLI's privileged role and the read-only role. A fingerprint part that
-- depends on WHO RAN IT is not a fingerprint.
select 'views',
 (select md5(string_agg(x, E'\n' order by x)) from (
    select c.relname||'='||md5(pg_get_viewdef(c.oid)) as x
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('v','m')) s),
 (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('v','m'))
union all
-- The three legacy namesakes carry the inv_ prefix but belong to the OLD
-- module: they write public.stock_moves and products.stock_on_hand. They are
-- called their own line because they must stay byte-identical while the
-- inv_ rebuild happens around them.
select 'legacy:'||p.proname, md5(p.prosrc), length(p.prosrc)::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('inv_save_stock_move','inv_validate_stock_move','inv_delete_stock_move')
order by 1;
