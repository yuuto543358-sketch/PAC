// データベースの設計図（SQL）。アプリが最初に動いたとき自動で適用されます。
// 新しい変更を加えるときは、既存の項目を書き換えず、MIGRATIONS の末尾に追加してください。

export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "phase1_foundation",
    sql: /* sql */ `
-- ===== 共通: 変更・削除を禁止するトリガー関数 =====
create or replace function pac_forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'PAC: % の記録は変更・削除できません', TG_TABLE_NAME;
end $$;

-- ===== 会社設定（1行のみ） =====
create table if not exists company_settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default 'PERSONAL AI COMPANY',
  philosophy text not null default 'AIの力で、個人の可能性を最大化する。',
  custom_rules text not null default '',
  model_standard text not null default 'claude-haiku-5-5',
  model_advanced text not null default 'claude-opus-5-5',
  advanced_model_allowed boolean not null default false,
  usd_jpy_rate numeric(10,2) not null default 160,
  autorun_frequency text not null default 'off',
  notify_approvals boolean not null default true,
  notify_budget boolean not null default true,
  emergency_stop boolean not null default false,
  hosting_cost_jpy_monthly int not null default 0,
  session_version int not null default 1,
  updated_at timestamptz not null default now()
);

-- ===== 予算設定（1行のみ） =====
create table if not exists budgets (
  id int primary key default 1 check (id = 1),
  monthly_limit_jpy numeric(10,2) not null default 2000,
  monthly_target_jpy numeric(10,2) not null default 1500,
  emergency_stop_jpy numeric(10,2) not null default 1800,
  per_task_limit_jpy numeric(10,2) not null default 30,
  daily_limit_jpy numeric(10,2) not null default 50,
  max_calls_per_task int not null default 8,
  max_calls_per_day int not null default 100,
  max_calls_per_minute int not null default 6,
  updated_at timestamptz not null default now(),
  check (monthly_limit_jpy >= 0 and monthly_target_jpy >= 0 and emergency_stop_jpy >= 0
         and per_task_limit_jpy >= 0 and daily_limit_jpy >= 0),
  check (max_calls_per_task between 1 and 100 and max_calls_per_day between 1 and 2000
         and max_calls_per_minute between 1 and 60)
);

-- ===== 部署 =====
create table if not exists departments (
  id text primary key,
  name text not null,
  description text not null default '',
  sort_order int not null default 0
);

-- ===== 社員 =====
create table if not exists employees (
  id text primary key,
  role_key text not null,
  name text not null,
  name_kana text not null default '',
  role_title text not null,
  department_id text not null references departments(id),
  personality text not null default '',
  speaking_style text not null default '',
  expertise text[] not null default '{}',
  strengths text[] not null default '{}',
  weaknesses text[] not null default '{}',
  judgment_criteria text not null default '',
  avatar_color text not null default '#334155',
  avatar_style text not null default 'short',
  status text not null default 'idle' check (status in ('idle','working','offline')),
  experience_points int not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== 経営者からの社員評価 =====
create table if not exists employee_ratings (
  id bigserial primary key,
  employee_id text not null references employees(id),
  task_id uuid,
  rating int not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now()
);

-- ===== 事業案件（Phase 3〜4で本格利用） =====
create table if not exists business_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  summary text not null default '',
  target_customer text not null default '',
  customer_problem text not null default '',
  competitors text not null default '',
  price_jpy numeric(12,2),
  initial_cost_jpy numeric(12,2),
  running_cost_jpy numeric(12,2),
  monetization text not null default '',
  difficulty text not null default '',
  risks text not null default '',
  validation_method text not null default '',
  status text not null default 'idea',
  owner_employee_id text references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== 業務 =====
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  description text not null default '',
  source text not null default 'user' check (source in ('user','ai_discovered','scheduled')),
  status text not null default 'discovered' check (status in (
    'discovered','researching','analyzing','producing','ready','awaiting_approval',
    'approved','executing','completed','rejected','on_hold','failed')),
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  assignee_id text references employees(id),
  created_by_employee_id text references employees(id),
  business_project_id uuid references business_projects(id),
  due_date date,
  budget_limit_jpy numeric(10,2) not null default 30 check (budget_limit_jpy >= 0),
  ai_call_count int not null default 0,
  deliverable text not null default '',
  dedupe_key text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_status_idx on tasks(status);
create index if not exists tasks_assignee_idx on tasks(assignee_id);
create index if not exists tasks_created_idx on tasks(created_at desc);

-- ===== 業務履歴（追記のみ。変更・削除不可） =====
create table if not exists task_logs (
  id bigserial primary key,
  task_id uuid not null references tasks(id),
  actor_type text not null check (actor_type in ('user','employee','system')),
  actor_employee_id text references employees(id),
  action text not null,
  from_status text,
  to_status text,
  message text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists task_logs_task_idx on task_logs(task_id, id);
drop trigger if exists task_logs_immutable on task_logs;
create trigger task_logs_immutable before update or delete on task_logs
  for each row execute function pac_forbid_change();
drop trigger if exists task_logs_no_truncate on task_logs;
create trigger task_logs_no_truncate before truncate on task_logs
  for each statement execute function pac_forbid_change();

-- ===== 承認依頼 =====
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id),
  requested_by_employee_id text references employees(id),
  action_type text not null,
  title text not null,
  content text not null,
  reason text not null default '',
  destination text not null default '',
  estimated_cost_jpy numeric(12,2) not null default 0 check (estimated_cost_jpy >= 0),
  risks text not null default '',
  after_effect text not null default '',
  payload jsonb not null default '{}'::jsonb,
  content_hash text not null,
  status text not null default 'pending' check (status in (
    'pending','on_hold','approved','rejected','superseded','executing','executed','execution_failed')),
  decision_note text not null default '',
  supersedes_id uuid references approvals(id),
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approvals_status_idx on approvals(status, created_at desc);

-- 承認依頼の「中身」は作成後に変更できない。状態は決められた順序でしか変えられない。削除も不可。
create or replace function pac_approvals_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAC: 承認記録は削除できません';
  end if;
  if new.id <> old.id or new.action_type <> old.action_type or new.title <> old.title
     or new.content <> old.content or new.reason <> old.reason or new.destination <> old.destination
     or new.estimated_cost_jpy <> old.estimated_cost_jpy or new.risks <> old.risks
     or new.after_effect <> old.after_effect or new.payload <> old.payload
     or new.content_hash <> old.content_hash or new.created_at <> old.created_at
     or new.task_id is distinct from old.task_id
     or new.requested_by_employee_id is distinct from old.requested_by_employee_id
     or new.supersedes_id is distinct from old.supersedes_id then
    raise exception 'PAC: 承認依頼の内容は変更できません（修正する場合は再提出してください）';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending'   and new.status in ('approved','rejected','on_hold','superseded'))
    or (old.status = 'on_hold'   and new.status in ('approved','rejected','pending','superseded'))
    or (old.status = 'approved'  and new.status in ('executing'))
    or (old.status = 'executing' and new.status in ('executed','execution_failed'))
  ) then
    raise exception 'PAC: 承認状態を % から % へは変更できません', old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists approvals_guard on approvals;
create trigger approvals_guard before update or delete on approvals
  for each row execute function pac_approvals_guard();
drop trigger if exists approvals_no_truncate on approvals;
create trigger approvals_no_truncate before truncate on approvals
  for each statement execute function pac_forbid_change();

-- ===== 承認履歴（追記のみ） =====
create table if not exists approval_events (
  id bigserial primary key,
  approval_id uuid not null references approvals(id),
  event text not null,
  from_status text,
  to_status text,
  note text not null default '',
  actor_type text not null default 'user',
  created_at timestamptz not null default now()
);
drop trigger if exists approval_events_immutable on approval_events;
create trigger approval_events_immutable before update or delete on approval_events
  for each row execute function pac_forbid_change();
drop trigger if exists approval_events_no_truncate on approval_events;
create trigger approval_events_no_truncate before truncate on approval_events
  for each statement execute function pac_forbid_change();

-- ===== 会話 =====
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references employees(id),
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_employee_idx on conversations(employee_id, updated_at desc);

create table if not exists conversation_messages (
  id bigserial primary key,
  conversation_id uuid not null references conversations(id),
  role text not null check (role in ('user','assistant','notice')),
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  api_usage_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists conversation_messages_conv_idx on conversation_messages(conversation_id, id);

-- ===== 社内知識・社員の記憶（Phase 2で本格利用） =====
create table if not exists knowledge (
  id uuid primary key default gen_random_uuid(),
  employee_id text references employees(id),
  category text not null check (category in ('lesson','expertise','feedback','caution','success','failure','note')),
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  source_task_id uuid references tasks(id),
  created_by text not null default 'user',
  created_at timestamptz not null default now()
);
create index if not exists knowledge_employee_idx on knowledge(employee_id, category);

-- ===== API利用記録（予約→確定のみ可。削除不可） =====
create table if not exists api_usage (
  id uuid primary key default gen_random_uuid(),
  employee_id text references employees(id),
  task_id uuid references tasks(id),
  conversation_id uuid references conversations(id),
  purpose text not null,
  model text not null,
  status text not null default 'reserved' check (status in ('reserved','completed','failed','unknown')),
  estimated_cost_jpy numeric(12,4) not null,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  cost_usd numeric(12,6),
  cost_jpy numeric(12,4),
  usd_jpy_rate numeric(10,2) not null,
  error text,
  request_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists api_usage_created_idx on api_usage(created_at desc);
create index if not exists api_usage_task_idx on api_usage(task_id);

create or replace function pac_api_usage_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAC: API利用記録は削除できません';
  end if;
  if old.status <> 'reserved' then
    raise exception 'PAC: 確定済みのAPI利用記録は変更できません';
  end if;
  if new.id <> old.id or new.created_at <> old.created_at or new.model <> old.model
     or new.estimated_cost_jpy <> old.estimated_cost_jpy or new.purpose <> old.purpose
     or new.employee_id is distinct from old.employee_id or new.task_id is distinct from old.task_id
     or new.usd_jpy_rate <> old.usd_jpy_rate then
    raise exception 'PAC: API利用記録の基本情報は変更できません';
  end if;
  return new;
end $$;
drop trigger if exists api_usage_guard on api_usage;
create trigger api_usage_guard before update or delete on api_usage
  for each row execute function pac_api_usage_guard();
drop trigger if exists api_usage_no_truncate on api_usage;
create trigger api_usage_no_truncate before truncate on api_usage
  for each statement execute function pac_forbid_change();

-- ===== 報告書（Phase 2で本格利用） =====
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('daily','weekly','monthly','bizdev','employee')),
  title text not null,
  content text not null,
  employee_id text references employees(id),
  period_start date,
  period_end date,
  created_at timestamptz not null default now()
);

-- ===== 操作履歴（追記のみ） =====
create table if not exists audit_logs (
  id bigserial primary key,
  actor text not null,
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on audit_logs(created_at desc);
drop trigger if exists audit_logs_immutable on audit_logs;
create trigger audit_logs_immutable before update or delete on audit_logs
  for each row execute function pac_forbid_change();
drop trigger if exists audit_logs_no_truncate on audit_logs;
create trigger audit_logs_no_truncate before truncate on audit_logs
  for each statement execute function pac_forbid_change();

-- ===== ログイン試行（総当たり攻撃対策） =====
create table if not exists login_attempts (
  id bigserial primary key,
  ip_hash text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_idx on login_attempts(created_at desc);

-- ===== 行レベルセキュリティ =====
-- このアプリはサーバーからのみデータベースに接続します。
-- Supabase の公開API（anon / authenticated）からは一切読み書きできないよう、
-- すべての表でRLSを有効にし、許可ルール（policy）は作りません。
do $$
declare t text;
begin
  foreach t in array array['company_settings','budgets','departments','employees','employee_ratings',
    'business_projects','tasks','task_logs','approvals','approval_events','conversations',
    'conversation_messages','knowledge','api_usage','reports','audit_logs','login_attempts']
  loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end $$;
`,
  },
  {
    version: 2,
    name: "switch_ai_provider_to_openai",
    sql: /* sql */ `
-- AIの提供元を OpenAI に変更。以前の設定（Claude のモデル名）が残っていれば置き換える。
alter table company_settings alter column model_standard set default 'gpt-5-mini';
alter table company_settings alter column model_advanced set default 'gpt-5';
update company_settings set model_standard = 'gpt-5-mini', updated_at = now() where model_standard like 'claude-%';
update company_settings set model_advanced = 'gpt-5', updated_at = now() where model_advanced like 'claude-%';
`,
  },
  {
    version: 3,
    name: "phase2_teams_workflow",
    sql: /* sql */ `
-- ===== Phase 2: チーム・グループチャット・成果物・自動進行 =====

-- 業務ごとのチーム（リーダー・メンバー・監査役・社長）
create table if not exists task_members (
  task_id uuid not null references tasks(id),
  employee_id text not null references employees(id),
  role text not null check (role in ('lead','member','reviewer','ceo')),
  joined_at timestamptz not null default now(),
  primary key (task_id, employee_id)
);

-- 業務ごとの自動進行の状態
create table if not exists task_workflows (
  task_id uuid primary key references tasks(id),
  phase text not null default 'kickoff' check (phase in (
    'kickoff','discussion','drafting','review','rework','final_report','waiting_human','done','stopped')),
  resume_phase text,
  waiting_reason text not null default '',
  autopilot boolean not null default true,
  plan jsonb not null default '{}'::jsonb,
  lead_id text references employees(id),
  reviewer_id text references employees(id),
  discussion_index int not null default 0,
  rework_count int not null default 0,
  steps int not null default 0,
  failures int not null default 0,
  lease_until timestamptz,
  lease_owner text,
  last_step_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_workflows_active_idx on task_workflows(phase, autopilot);

-- グループチャット（追記のみ。変更・削除不可）
create table if not exists task_messages (
  id bigserial primary key,
  task_id uuid not null references tasks(id),
  author_type text not null check (author_type in ('employee','owner','system')),
  employee_id text references employees(id),
  kind text not null default 'message',
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  api_usage_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists task_messages_task_idx on task_messages(task_id, id);
drop trigger if exists task_messages_immutable on task_messages;
create trigger task_messages_immutable before update or delete on task_messages
  for each row execute function pac_forbid_change();
drop trigger if exists task_messages_no_truncate on task_messages;
create trigger task_messages_no_truncate before truncate on task_messages
  for each statement execute function pac_forbid_change();

-- 成果物（版ごとに保存。本文は変更不可、状態と監査コメントだけ更新可。削除不可）
create table if not exists deliverables (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  version int not null,
  title text not null,
  format text not null default 'markdown_report',
  content text not null,
  author_employee_id text references employees(id),
  status text not null default 'draft' check (status in ('draft','in_review','revise','passed','accepted','rejected')),
  review_note text not null default '',
  created_at timestamptz not null default now(),
  unique (task_id, version)
);
create or replace function pac_deliverables_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAC: 成果物は削除できません';
  end if;
  if new.id <> old.id or new.task_id <> old.task_id or new.version <> old.version or new.title <> old.title
     or new.format <> old.format or new.content <> old.content or new.created_at <> old.created_at
     or new.author_employee_id is distinct from old.author_employee_id then
    raise exception 'PAC: 成果物の本文は変更できません（新しい版として保存してください）';
  end if;
  return new;
end $$;
drop trigger if exists deliverables_guard on deliverables;
create trigger deliverables_guard before update or delete on deliverables
  for each row execute function pac_deliverables_guard();

-- 報告書に「業務の完了報告」を追加
alter table reports add column if not exists task_id uuid references tasks(id);
alter table reports drop constraint if exists reports_report_type_check;
alter table reports add constraint reports_report_type_check
  check (report_type in ('daily','weekly','monthly','bizdev','employee','task'));

-- チームで進めると1業務あたりのAI呼び出しが増えるため、初期値のままなら上限を引き上げる（8回→20回）
update budgets set max_calls_per_task = 20, updated_at = now() where max_calls_per_task = 8;
alter table budgets alter column max_calls_per_task set default 20;
-- チームの社員が順番に発言するため、1分あたりの上限も初期値のままなら引き上げる（6回→12回）
update budgets set max_calls_per_minute = 12, updated_at = now() where max_calls_per_minute = 6;
alter table budgets alter column max_calls_per_minute set default 12;

do $$
declare t text;
begin
  foreach t in array array['task_members','task_workflows','task_messages','deliverables'] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end $$;
`,
  },
  {
    version: 4,
    name: "phase3_autonomy",
    sql: /* sql */ `
-- ===== Phase 3: 自主的な仕事の発見・Web調査・事業候補・自動報告 =====
alter table company_settings add column if not exists web_research_enabled boolean not null default true;
alter table company_settings add column if not exists discovery_auto_start boolean not null default true;
alter table company_settings add column if not exists last_discovery_on date;
alter table company_settings add column if not exists last_daily_report_on date;
alter table company_settings add column if not exists last_weekly_report_on date;

-- Web検索の回数（費用の計算に使う）
alter table api_usage add column if not exists web_search_calls int not null default 0;

-- 事業候補
alter table business_projects add column if not exists sources jsonb not null default '[]'::jsonb;
alter table business_projects add column if not exists discovered_by text references employees(id);
alter table business_projects add column if not exists validation_task_id uuid references tasks(id);
alter table business_projects add column if not exists owner_note text not null default '';
update business_projects set status = 'idea' where status not in ('idea','validating','promising','adopted','rejected','on_hold');
alter table business_projects drop constraint if exists business_projects_status_check;
alter table business_projects add constraint business_projects_status_check
  check (status in ('idea','validating','promising','adopted','rejected','on_hold'));
create index if not exists business_projects_created_idx on business_projects(created_at desc);
`,
  },
  {
    version: 5,
    name: "phase4_revenue_notifications",
    sql: /* sql */ `
-- ===== Phase 4: 収益・費用の記録／月報／プッシュ通知 =====

-- 収益・費用の記録（経営者が入力）。記録は変更・削除できない。間違えたときは「取り消し」にする（理由つき）
create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('income','expense')),
  amount_jpy numeric(12,0) not null check (amount_jpy > 0 and amount_jpy <= 100000000),
  occurred_on date not null,
  category text not null default '',
  description text not null default '' check (length(description) <= 500),
  business_project_id uuid references business_projects(id),
  voided_at timestamptz,
  void_reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ledger_entries_occurred_idx on ledger_entries(occurred_on desc);
create index if not exists ledger_entries_business_idx on ledger_entries(business_project_id);
create or replace function pac_ledger_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAC: 収益・費用の記録は削除できません（取り消しにしてください）';
  end if;
  if new.id <> old.id or new.kind <> old.kind or new.amount_jpy <> old.amount_jpy or new.occurred_on <> old.occurred_on
     or new.category <> old.category or new.description <> old.description or new.created_at <> old.created_at
     or new.business_project_id is distinct from old.business_project_id then
    raise exception 'PAC: 収益・費用の記録は変更できません（取り消して、新しく記録してください）';
  end if;
  if old.voided_at is not null then
    raise exception 'PAC: 取り消した記録は元に戻せません';
  end if;
  if new.voided_at is null or length(trim(new.void_reason)) = 0 then
    raise exception 'PAC: 取り消しには理由が必要です';
  end if;
  return new;
end $$;
drop trigger if exists ledger_guard on ledger_entries;
create trigger ledger_guard before update or delete on ledger_entries
  for each row execute function pac_ledger_guard();

-- 月報
alter table company_settings add column if not exists last_monthly_report_on date;

-- プッシュ通知の受け取り先（iPhone のホーム画面アプリ）
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_label text not null default '',
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures int not null default 0
);

-- 送る通知の順番待ち（同じ通知を二度送らないよう dedupe_key は重複不可）
create table if not exists notifications (
  id bigserial primary key,
  kind text not null,
  title text not null,
  body text not null default '',
  url text not null default '/',
  dedupe_key text unique,
  status text not null default 'pending' check (status in ('pending','sent','skipped','failed')),
  attempts int not null default 0,
  error text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notifications_pending_idx on notifications(created_at) where status = 'pending';

do $$
declare t text;
begin
  foreach t in array array['ledger_entries','push_subscriptions','notifications'] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end $$;
`,
  },
  {
    version: 6,
    name: "sns_operation",
    sql: /* sql */ `
-- ===== SNS運用（SNS担当のAIが投稿案を作り、経営者の承認後に投稿する） =====
alter table company_settings add column if not exists sns_plan_frequency text not null default 'off';
alter table company_settings drop constraint if exists company_settings_sns_plan_frequency_check;
alter table company_settings add constraint company_settings_sns_plan_frequency_check
  check (sns_plan_frequency in ('off','weekly','daily'));
alter table company_settings add column if not exists sns_posts_per_plan int not null default 3;
alter table company_settings drop constraint if exists company_settings_sns_posts_per_plan_check;
alter table company_settings add constraint company_settings_sns_posts_per_plan_check
  check (sns_posts_per_plan between 1 and 7);
alter table company_settings add column if not exists sns_monthly_post_limit int not null default 60;
alter table company_settings drop constraint if exists company_settings_sns_monthly_post_limit_check;
alter table company_settings add constraint company_settings_sns_monthly_post_limit_check
  check (sns_monthly_post_limit between 0 and 300);
alter table company_settings add column if not exists last_sns_plan_on date;
`,
  },
  {
    version: 7,
    name: "sns_owner_posts",
    sql: /* sql */ `
-- SNSへの投稿は経営者が自分で行う。投稿案をどのSNS向けに作るかを選べるようにする
alter table company_settings add column if not exists sns_platforms text[] not null default '{x}';
`,
  },
  {
    version: 8,
    name: "life_intelligence",
    sql: /* sql */ `
-- ===== ライフインテリジェンス（生活情報の収集・分析・改善提案） =====

-- カテゴリ（家計・住居など）。あとから追加・変更できる
create table if not exists life_categories (
  id text primary key,
  name text not null,
  description text not null default '',
  sort_order int not null default 0,
  is_active boolean not null default true,
  -- false にすると、このカテゴリの情報はAI（OpenAI）に渡さない
  ai_allowed boolean not null default true,
  created_at timestamptz not null default now()
);

-- 「何の情報か」の一覧（例：携帯電話料金・円/月・半年ごとに確認）。AIが新しい項目を提案して増えることもある
create table if not exists life_fields (
  id text primary key,
  category_id text not null references life_categories(id),
  label text not null,
  value_type text not null check (value_type in ('number','text','choice')),
  unit text not null default '',
  choices text[] not null default '{}',
  -- state: いまの状態（家賃など。変わったら新しい記録が増える）／ periodic: 期間ごとの記録（今月の食費など）
  kind text not null default 'state' check (kind in ('state','periodic')),
  period text not null default 'none' check (period in ('none','week','month')),
  refresh_days int not null default 180 check (refresh_days between 1 and 730),
  importance int not null default 3 check (importance between 1 and 5),
  question text not null,
  reason text not null default '',
  -- 例：'car_owned=はい'（車を持っている人にだけ聞く）
  depends_on text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by text not null default 'system' check (created_by in ('system','ai','owner')),
  created_at timestamptz not null default now()
);

-- 生活の記録（回答ごとに1行。上書きしない）
create table if not exists life_records (
  id uuid primary key default gen_random_uuid(),
  field_id text not null references life_fields(id),
  value_num numeric(14,2),
  value_text text not null default '' check (length(value_text) <= 2000),
  period_start date,
  period_end date,
  source text not null check (source in ('owner','auto','ai_estimate')),
  confidence text not null default 'high' check (confidence in ('high','medium','low')),
  note text not null default '',
  question_id uuid,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists life_records_field_idx on life_records(field_id, confirmed_at desc);

-- 記録の修正の履歴（修正前と修正後）。記録を削除すると、履歴もいっしょに消える
create table if not exists life_record_history (
  id bigserial primary key,
  record_id uuid not null references life_records(id) on delete cascade,
  old_value_num numeric(14,2),
  old_value_text text not null default '',
  new_value_num numeric(14,2),
  new_value_text text not null default '',
  reason text not null default '',
  changed_at timestamptz not null default now()
);
create or replace function pac_life_history_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'PAC: 修正の履歴は変更できません';
end $$;
drop trigger if exists life_history_guard on life_record_history;
create trigger life_history_guard before update on life_record_history
  for each row execute function pac_life_history_guard();

-- AI社員からの質問
create table if not exists life_questions (
  id uuid primary key default gen_random_uuid(),
  field_id text references life_fields(id),
  text text not null,
  reason text not null default '',
  status text not null default 'pending'
    check (status in ('pending','answered','skipped','later','unknown','expired')),
  source text not null default 'rule' check (source in ('rule','ai','owner')),
  employee_id text references employees(id),
  batch_on date not null default ((now() at time zone 'Asia/Tokyo')::date),
  period_start date,
  period_end date,
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  remind_after timestamptz,
  record_id uuid references life_records(id) on delete set null
);
create index if not exists life_questions_status_idx on life_questions(status, asked_at desc);
create index if not exists life_questions_field_idx on life_questions(field_id, asked_at desc);

-- 分析レポート（数字はプログラムが計算した事実。AIはコメントだけ）
create table if not exists life_reports (
  id uuid primary key default gen_random_uuid(),
  period_months int not null check (period_months in (1,3,6,12)),
  period_start date not null,
  period_end date not null,
  stats jsonb not null default '{}'::jsonb,
  ai_summary text not null default '',
  ai_used boolean not null default false,
  data_gaps text[] not null default '{}',
  employee_id text references employees(id),
  created_at timestamptz not null default now()
);
create index if not exists life_reports_created_idx on life_reports(created_at desc);

-- 改善提案
create table if not exists life_suggestions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  problem text not null default '',
  evidence text not null default '',
  benefit text not null default '',
  cost_text text not null default '',
  difficulty text not null default 'ふつう' check (difficulty in ('やさしい','ふつう','むずかしい')),
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  recommendation text not null default '',
  is_estimate boolean not null default true,
  category_id text references life_categories(id),
  related_field_ids text[] not null default '{}',
  status text not null default 'new' check (status in ('new','considering','adopted','rejected','done')),
  -- 調査・比較・企画が必要で、チームで検討したほうがよい提案
  needs_team boolean not null default false,
  task_id uuid references tasks(id),
  report_id uuid references life_reports(id),
  owner_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists life_suggestions_status_idx on life_suggestions(status, created_at desc);

-- 設定
alter table company_settings add column if not exists life_question_frequency text not null default 'normal';
alter table company_settings drop constraint if exists company_settings_life_question_frequency_check;
alter table company_settings add constraint company_settings_life_question_frequency_check
  check (life_question_frequency in ('off','low','normal','high'));
alter table company_settings add column if not exists life_questions_per_batch int not null default 3;
alter table company_settings drop constraint if exists company_settings_life_questions_per_batch_check;
alter table company_settings add constraint company_settings_life_questions_per_batch_check
  check (life_questions_per_batch between 1 and 3);
alter table company_settings add column if not exists life_auto_task boolean not null default true;
alter table company_settings add column if not exists last_life_question_on date;
alter table company_settings add column if not exists last_life_analysis_on date;

do $$
declare t text;
begin
  foreach t in array array['life_categories','life_fields','life_records','life_record_history',
    'life_questions','life_reports','life_suggestions'] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end $$;
`,
  },
  {
    version: 9,
    name: "qol",
    sql: /* sql */ `
-- ===== QOL（生活の質）：毎日のチェック・習慣・これから起きること・目標・週のふりかえり =====

-- 毎日のQOLチェック（1日1件。その日のうちは直せる）。数字は1〜5（ストレスは1=少ない、5=多い）
create table if not exists life_checkins (
  id uuid primary key default gen_random_uuid(),
  check_date date not null unique,
  mood int not null check (mood between 1 and 5),
  energy int not null check (energy between 1 and 5),
  sleep int not null check (sleep between 1 and 5),
  stress int not null check (stress between 1 and 5),
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 小さな習慣
create table if not exists life_habits (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 80),
  why text not null default '',
  -- daily: 毎日 / weekly: 週に target_per_week 回
  frequency text not null default 'daily' check (frequency in ('daily','weekly')),
  target_per_week int not null default 7 check (target_per_week between 1 and 7),
  category_id text references life_categories(id),
  -- proposed: AI社員の提案（まだ始めていない）
  status text not null default 'active' check (status in ('proposed','active','paused','done','archived')),
  source text not null default 'owner' check (source in ('owner','suggestion','ai')),
  suggestion_id uuid references life_suggestions(id) on delete set null,
  start_date date not null default ((now() at time zone 'Asia/Tokyo')::date),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists life_habit_logs (
  habit_id uuid not null references life_habits(id) on delete cascade,
  log_date date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, log_date)
);

-- これから起きること（車検・更新・税金・誕生日など）
create table if not exists life_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 80),
  event_date date not null,
  repeat text not null default 'none' check (repeat in ('none','monthly','yearly')),
  amount_jpy numeric(12,0) check (amount_jpy is null or amount_jpy >= 0),
  remind_days int not null default 7 check (remind_days between 0 and 90),
  category_id text references life_categories(id),
  note text not null default '' check (length(note) <= 500),
  -- 最後に「済んだ」にした回の日付（くり返す予定は、その次の回が「次の予定」になる）
  last_done_date date,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 目標
create table if not exists life_goals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 80),
  why text not null default '',
  category_id text references life_categories(id),
  unit text not null default '',
  start_value numeric(14,2),
  target_value numeric(14,2),
  due_date date,
  status text not null default 'active' check (status in ('active','achieved','paused','dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists life_goal_progress (
  id bigserial primary key,
  goal_id uuid not null references life_goals(id) on delete cascade,
  value numeric(14,2),
  note text not null default '' check (length(note) <= 500),
  recorded_at timestamptz not null default now()
);
create index if not exists life_goal_progress_goal_idx on life_goal_progress(goal_id, recorded_at desc);

-- 週のふりかえり（月曜の朝に、先週の分を森野が書く）
create table if not exists life_reviews (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  stats jsonb not null default '{}'::jsonb,
  ai_summary text not null default '',
  ai_used boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists life_reviews_created_idx on life_reviews(created_at desc);

alter table company_settings add column if not exists last_life_review_on date;
alter table company_settings add column if not exists life_review_enabled boolean not null default true;

do $$
declare t text;
begin
  foreach t in array array['life_checkins','life_habits','life_habit_logs','life_events','life_goals',
    'life_goal_progress','life_reviews'] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end $$;
`,
  },
  {
    version: 10,
    name: "proactive",
    sql: /* sql */ `
-- ===== AI社員が裏で動く仕事：先回りの準備・変化への声かけ・自主研究 =====

-- これから起きること：近づいたらチームに下調べを頼むか／頼んだ業務
alter table life_events add column if not exists prep boolean not null default true;
alter table life_events add column if not exists prep_task_id uuid references tasks(id);
alter table life_events add column if not exists prep_for date;

-- 森野からのひとこと（記録の変化に気づいたとき）
create table if not exists life_nudges (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  subject text not null default '',
  title text not null,
  body text not null default '',
  url text not null default '/',
  ai_used boolean not null default false,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists life_nudges_created_idx on life_nudges(created_at desc);

alter table company_settings add column if not exists life_prep_enabled boolean not null default true;
alter table company_settings add column if not exists life_nudge_enabled boolean not null default true;
alter table company_settings add column if not exists life_research_enabled boolean not null default true;
alter table company_settings add column if not exists last_life_nudge_on date;
alter table company_settings add column if not exists last_life_prep_on date;
alter table company_settings add column if not exists last_life_research_on date;
-- 最後に自動の仕事が動いた時刻（設定画面で確認できるように）
alter table company_settings add column if not exists last_cron_at timestamptz;

alter table life_nudges enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table life_nudges from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table life_nudges from authenticated; end if;
end $$;
`,
  },
  {
    version: 11,
    name: "sales_pipeline",
    sql: /* sql */ `
-- ===== 事業を「採用」したら、出品・販売・運営まで自動で進める =====
-- 段階：idea（アイデア）→ research（調査）→ product（商品づくり）→ listing（出品パッケージ）
--       → launch（出品の承認・出品待ち）→ selling（販売中）／ paused（止めている）
alter table business_projects add column if not exists stage text not null default 'idea';
alter table business_projects drop constraint if exists business_projects_stage_check;
alter table business_projects add constraint business_projects_stage_check
  check (stage in ('idea','research','product','listing','launch','selling','paused'));
update business_projects set stage = 'research' where stage = 'idea' and validation_task_id is not null;
alter table business_projects add column if not exists auto_advance boolean not null default true;
alter table business_projects add column if not exists stage_task_id uuid references tasks(id);
alter table business_projects add column if not exists launch_approval_id uuid references approvals(id);
alter table business_projects add column if not exists platform text not null default '';
alter table business_projects add column if not exists listing_url text not null default '';
alter table business_projects add column if not exists launched_at timestamptz;
alter table business_projects add column if not exists last_improve_at timestamptz;
alter table company_settings add column if not exists last_ops_review_on date;
`,
  },
];
