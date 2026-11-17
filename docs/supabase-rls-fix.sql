-- PAC：Supabase のセキュリティ警告（rls_disabled_in_public）を直すSQL
-- Supabase の「SQL Editor」に全部貼り付けて「Run」を押してください。何度実行しても大丈夫です。
-- （アプリの新しい版が動くと、同じことが自動で行われます）

-- ===== Supabase のセキュリティ警告（rls_disabled_in_public）への対応 =====
-- このアプリは、サーバーからデータベースの持ち主（postgres）として接続するだけで、
-- Supabase の公開用の役割（anon / authenticated、URLとAPIキーで誰でも使える入口）は一切使わない。
-- そのため「公開用の役割からは、すべての表を読めない・書けない」が正しい設定。
-- 1) すべての表で RLS を有効にする（schema_migrations だけ、これまで有効になっていなかった）
-- 2) 公開用の役割の権限を取り消す
-- 3) 「公開用の役割は、何もできない」ことをはっきり書いたポリシーを付ける（RESTRICTIVE・常に false）
--    ※ 持ち主（アプリ）は RLS の対象外なので、アプリの動きは変わらない
-- 4) これから作る表・連番にも、公開用の役割の権限が自動で付かないようにする
do $$
declare
  t text;
  sq text;
  has_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
  has_auth boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  for t in
    select tablename from pg_tables where schemaname = 'public' and tablename = any (array[
    'api_usage', 'approval_events', 'approvals', 'audit_logs', 'budgets', 'business_projects',
    'company_settings', 'content_series', 'conversation_messages', 'conversations', 'deliverables', 'departments',
    'employee_ratings', 'employees', 'knowledge', 'ledger_entries', 'life_categories', 'life_checkins',
    'life_events', 'life_fields', 'life_goal_progress', 'life_goals', 'life_habit_logs', 'life_habits',
    'life_nudges', 'life_questions', 'life_record_history', 'life_records', 'life_reports', 'life_reviews',
    'life_suggestions', 'login_attempts', 'media_assets', 'notifications', 'push_subscriptions', 'reports',
    'schema_migrations', 'task_logs', 'task_members', 'task_messages', 'task_workflows', 'tasks'
    ])
  loop
    execute format('alter table public.%I enable row level security', t);
    if has_anon then execute format('revoke all on table public.%I from anon', t); end if;
    if has_auth then execute format('revoke all on table public.%I from authenticated', t); end if;
    if has_anon and has_auth then
      execute format('drop policy if exists pac_deny_client_roles on public.%I', t);
      execute format(
        'create policy pac_deny_client_roles on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
    end if;
  end loop;

  for sq in select sequence_name from information_schema.sequences where sequence_schema = 'public' loop
    if has_anon then execute format('revoke all on sequence public.%I from anon', sq); end if;
    if has_auth then execute format('revoke all on sequence public.%I from authenticated', sq); end if;
  end loop;

  if has_anon and has_auth then
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
  end if;
end $$;

-- ===== 確認：下の2つとも「0」なら直っています（0でないときは、いちばん下の一覧に出た表の名前を教えてください） =====
select
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as rls_off_tables,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated')) as public_role_grants;

-- ===== 参考：アプリが作っていない表（あれば教えてください。上のSQLでは触っていません） =====
select tablename, rowsecurity from pg_tables where schemaname = 'public'
  and tablename <> all (array['api_usage', 'approval_events', 'approvals', 'audit_logs', 'budgets', 'business_projects',
    'company_settings', 'content_series', 'conversation_messages', 'conversations', 'deliverables', 'departments',
    'employee_ratings', 'employees', 'knowledge', 'ledger_entries', 'life_categories', 'life_checkins',
    'life_events', 'life_fields', 'life_goal_progress', 'life_goals', 'life_habit_logs', 'life_habits',
    'life_nudges', 'life_questions', 'life_record_history', 'life_records', 'life_reports', 'life_reviews',
    'life_suggestions', 'login_attempts', 'media_assets', 'notifications', 'push_subscriptions', 'reports',
    'schema_migrations', 'task_logs', 'task_members', 'task_messages', 'task_workflows', 'tasks'])
order by tablename;
