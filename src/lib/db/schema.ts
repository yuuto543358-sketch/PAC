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
];
